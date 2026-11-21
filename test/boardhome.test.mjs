// One board, one set of comments: a board about a page opens over that page (its pins are the page's), its own address goes
// there, and pins left on the old address move to the page once (whole, with a backup). A board with no page keeps its own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up as answers, cli } from './harness.mjs';

const DIR = fs.realpathSync(tmp('boardhome'));
const PORT = claimPort(9700, 100);
const B = `http://localhost:${PORT}`;
const write = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIR, rel), typeof body === 'string' ? body : JSON.stringify(body));
};
const board = (name, of) => write(`.lab/boards/${name}.json`, { v: 1, name, rev: 1, ...(of ? { of } : {}), frames: [{ id: 'a', src: of ? of.split('#')[0] : '/pricing', w: 1440, h: 900, state: 'live' }, { id: 'b', src: '/cart', w: 390, h: 844, state: 'live' }] });
// A page's comment file as the lab keeps it (the name: lib/labs's storeName, in local.mjs).
const file = (page) => `.lab/comments/${[...Buffer.from(page.replace(/^\//, ''))].map((b) => (/[a-z0-9-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `_${b.toString(16).padStart(2, '0')}`)).join('')}.json`;
const pin = (id, board, num, extra = {}) => ({ id, name: 'Leo', text: `pin ${id}`, createdAt: `2026-11-1${num}T10:00:00.000Z`, num, anchor: { kind: 'board', board, frame: 'a', fx: 10 * num, fy: 5 }, ...extra });
const keep = (page, ...cs) => write(file(page), { page, comments: Object.fromEntries(cs.map((c) => [c.id, c])) });
write('pricing.html', '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
write('cart.html', '<!doctype html><title>Cart</title><h1>Cart</h1>');
write('labit.json', { flags: {} });
board('withpage', '/pricing#hero');
board('nopage');
board('gone', '/not-here');
// Left behind on the board's own address: two pins and a reply to the first; the page has a pin of its own (number 1).
keep('/_board/withpage', pin('b1', 'withpage', 1), pin('b2', 'withpage', 2), { id: 'r1', name: 'Claude', text: 'on it', createdAt: '2026-11-13T10:00:00.000Z', parent: 'b1' });
keep('/pricing', { id: 'p1', name: 'Leo', text: 'a page pin', createdAt: '2026-11-09T10:00:00.000Z', num: 1, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } });
keep('/_board/nopage', pin('n1', 'nopage', 1));
keep('/_board/gone', pin('g1', 'gone', 1));
// …and a person had read both pins there: on the page they are read too (the page is not unread on every device).
write('.lab/state.json', { reads: { leo: { '/_board/withpage': ['b1', 'b2', 'r1'] } }, opened: { '/_board/withpage': '2026-11-14T10:00:00.000Z' } });
const bak = path.join(DIR, `${file('/_board/withpage')}.bak-board`);
const ownFile = path.join(DIR, file('/_board/withpage'));
const held = () => { const b = JSON.parse(fs.readFileSync(bak, 'utf8')); return [b.page, Object.entries(b.comments).map(([id, c]) => [id, c.text, c.parent, c.num]).sort()]; };
const original = [ '/_board/withpage', [['b1', 'pin b1', undefined, 1], ['b2', 'pin b2', undefined, 2], ['r1', 'on it', 'b1', undefined]] ];
let lab = spawnLab(DIR, PORT);
after(async () => {
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
});
const list = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${page}`)).json()).comments;
const ids = (cs) => cs.map((c) => c.id).sort();
const go = (p) => fetch(B + p, { redirect: 'manual' });

test('a board about a page goes to that page: its own address redirects to the page with #board=', async () => {
  await answers(`${B}/_lab/state`);
  const r = await go('/_lab/board/withpage');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/pricing#board=withpage');
});

test('a board with no page, or whose page this lab does not have, keeps its own address', async () => {
  for (const name of ['nopage', 'gone']) {
    const r = await go(`/_lab/board/${name}`);
    assert.equal(r.status, 200, name);
    assert.match(await r.text(), new RegExp(`data-page="/_board/${name}"`));
  }
});

test('the pins left on the old address are on the page now: ids, thread and reply kept, numbers after the page\'s own', async () => {
  const page = await list('/pricing');
  assert.deepEqual(ids(page), ['b1', 'b2', 'p1', 'r1']);
  const root = (id) => page.find((c) => c.id === id);
  assert.equal(root('r1').parent, 'b1');
  assert.equal(root('b1').anchor.board, 'withpage');
  assert.deepEqual([root('b1').anchor.fx, root('b2').anchor.fx], [10, 20]);
  assert.deepEqual(['p1', 'b1', 'b2'].map((id) => root(id).num), [1, 2, 3]);
  assert.deepEqual(await list('/_board/withpage'), [], 'nothing is left on the old address');
  const read = async (pg) => (await (await fetch(`${B}/_lab/api/reads?name=Leo&page=${pg}`)).json()).ids || [];
  assert.deepEqual([...(await read('/pricing'))].sort(), ['b1', 'b2', 'r1'], 'what was read there is read on the page');
  assert.deepEqual(await read('/_board/withpage'), [], 'and nothing is left on the old key');
  assert.equal(fs.existsSync(ownFile), false);
});

test('the file as it was is kept once beside the comments, and a board without a page is not touched', async () => {
  assert.deepEqual(held(), original);
  assert.deepEqual(ids(await list('/_board/nopage')), ['n1']);
  assert.deepEqual(ids(await list('/_board/gone')), ['g1']);
  assert.equal(fs.existsSync(path.join(DIR, `${file('/_board/nopage')}.bak-board`)), false);
});

test('the agent reads such a pin as on the board of its page, near its frame', async () => {
  const t = await (await fetch(`${B}/_lab/agent/pricing`)).text();
  assert.match(t, /^on: the board withpage over this page, not the page itself$/m);
  assert.match(t, /^near: frame a "?.*", 10 px right of its left edge, 5 px below its top$|^near: frame a .*10 px right of its left edge/m);
});

test('labit board list says the page address for a board about a page, its own for the others', async () => {
  const out = async (n) => (await cli(['board', 'list', n], { cwd: DIR })).out;
  assert.match(await out('withpage'), new RegExp(`^url: http://localhost:${PORT}/pricing#board=withpage \\(the board opens over its page`, 'm'));
  assert.match(await out('nopage'), new RegExp(`^url: http://localhost:${PORT}/_lab/board/nopage$`, 'm'));
  assert.match(await out('gone'), new RegExp(`^url: http://localhost:${PORT}/_lab/board/gone$`, 'm'));
  assert.match((await cli(['board', 'list'], { cwd: DIR })).out, new RegExp(`withpage .*of /pricing#hero  http://localhost:${PORT}/pricing#board=withpage`));
});

test('a restart changes nothing (no duplicates), and a pin that lands late on the old address is merged by the redirect, backup untouched', async () => {
  await stop(lab);
  lab = spawnLab(DIR, PORT);
  await answers(`${B}/_lab/state`);
  assert.deepEqual(ids(await list('/pricing')), ['b1', 'b2', 'p1', 'r1']);
  const sent = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/_board/withpage', name: 'Leo', text: 'late pin', anchor: { kind: 'board', board: 'withpage', frame: 'b', fx: 1, fy: 2 } }) });
  assert.equal(sent.status, 201);
  const late = (await sent.json()).comment.id;
  assert.equal((await go('/_lab/board/withpage')).status, 302);
  const page = await list('/pricing');
  assert.deepEqual(ids(page), ['b1', 'b2', late, 'p1', 'r1'].sort());
  assert.equal(page.find((c) => c.id === late).num, 4);
  assert.deepEqual(await list('/_board/withpage'), []);
  assert.deepEqual(held(), original, 'the backup is the first one');
  await stop(lab);
  lab = spawnLab(DIR, PORT);
  await answers(`${B}/_lab/state`);
  assert.equal((await list('/pricing')).length, 5, 'what was saved reads back whole');
});
