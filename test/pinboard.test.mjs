// A pin's own board (the "board" key on its card): made once by the lab as board pin-<id> about the page at #pin-<id>,
// never made again over itself, kept out of the lab's list of boards, and what is put on it said under the pin in the
// agent's text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up as answers } from './harness.mjs';

const DIR = fs.realpathSync(tmp('pinboard'));
const PORT = claimPort(9800, 100);
const B = `http://localhost:${PORT}`;
const write = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIR, rel), typeof body === 'string' ? body : JSON.stringify(body));
};
const ID = 'a1b2c3d4e5f6';
write('pricing.html', '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
write('cart.html', '<!doctype html><title>Cart</title><h1>Cart</h1>');
write('labit.json', { flags: {} });
write('.lab/comments/pricing.json', { page: '/pricing', comments: { [ID]: { id: ID, name: 'Leo', text: 'make the hero like these', createdAt: '2026-11-21T09:00:00.000Z', num: 1, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } } } });
const lab = spawnLab(DIR, PORT);
after(async () => {
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
});
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const post = (body, headers) => fetch(`${B}/_lab/api/board`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: B, ...headers } });
const agentText = async () => (await fetch(`${B}/_lab/agent/pricing`)).text();
const name = `pin-${ID}`;

test('the card makes the pin its board: about the page at the pin, opened over the page', async () => {
  await answers(`${B}/_lab/state`);
  const r = await post({ action: 'new', name, of: `/pricing#${name}` }, { 'x-lab-admin': keys().token });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.board.name, name);
  assert.equal(out.board.of, `/pricing#${name}`);
  assert.equal(out.home, '/pricing');
  assert.deepEqual(out.board.frames.map((f) => f.src), ['/pricing']);
});

test('with only the page on it, the pin says nothing of a board', async () => {
  assert.doesNotMatch(await agentText(), /board for this pin/);
});

test('what is put on it is said under the pin, the page itself left out', async () => {
  const add = await post({ action: 'add', name, target: '/cart', label: 'like this' }, { 'x-lab-admin': keys().agent, 'x-lab-agent': '1' });
  assert.equal(add.status, 200);
  const t = await agentText();
  const pin = t.split('\n## ').find((b) => b.split('\n')[0].endsWith(`· id ${ID}`));
  assert.match(pin, new RegExp(`^comment: make the hero like these\\nboard for this pin: ${B}/pricing#board=${name} `, 'm'));
  assert.match(pin, /^ {2}frame b: page \/cart "like this"$/m);
  assert.doesNotMatch(pin, /frame a:/);
});

test('asked again, it is the same board, not a new one over it', async () => {
  const r = await post({ action: 'new', name, of: `/pricing#${name}` }, { 'x-lab-admin': keys().token });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).board.frames.map((f) => f.id), ['a', 'b']);
});

test('a guest or a page without the key cannot make one', async () => {
  assert.equal((await post({ action: 'new', name: 'pin-0000000000ff', of: '/pricing#pin-0000000000ff' }, {})).status, 403);
  assert.equal(fs.existsSync(path.join(DIR, '.lab/boards/pin-0000000000ff.json')), false);
});

test('the lab\'s list of boards leaves the pin\'s own out', async () => {
  const pages = await (await fetch(`${B}/_lab/pages`)).json();
  assert.deepEqual(pages.boards, []);
});

test('a pin sent with +board waits for its board to close before the agent gets it', async () => {
  const pending = async () => (await (await fetch(`${B}/_lab/pending`, { headers: { 'x-lab-admin': keys().agent, 'x-lab-agent': '1' } })).json()).fresh;
  const before = await pending();
  const r = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().token }, body: JSON.stringify({ page: '/pricing', name: 'Leo', text: '+board', anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5, act: '+board: the person put references for this pin on its board' } }) });
  assert.equal(r.status, 201);
  const { comment } = await r.json();
  assert.equal(await pending(), before, 'held while its board is open');
  assert.equal((await post({ action: 'ready', name: `pin-${comment.id}` }, {})).status, 403, 'only this computer closes it');
  assert.equal((await post({ action: 'ready', name: `pin-${comment.id}` }, { 'x-lab-admin': keys().token })).status, 200);
  assert.equal(await pending(), before + 1, 'the agent gets it once the board is closed');
});

// The pin's board as a section of the page (+board): <lab-board name> written into the page's file after the element.
test('the board goes into the page\'s file after the pinned element, once', async () => {
  const place = (body) => post({ action: 'place', name, of: `/pricing#${name}`, ...body }, { 'x-lab-admin': keys().token });
  const r = await place({ path: [['h1', 1]], words: 'Pricing' });
  assert.equal(r.status, 200);
  const file = () => fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8');
  assert.equal(file(), `<!doctype html><title>Pricing</title><h1>Pricing</h1>\n<lab-board name="${name}"></lab-board>`);
  assert.equal((await place({ path: [['h1', 1]], words: 'Pricing' })).status, 200);
  assert.equal(file().split('<lab-board').length, 2, 'not twice');
});

test('a spot the file doesn\'t have, or a page without the key, writes nothing', async () => {
  const before = fs.readFileSync(path.join(DIR, 'cart.html'), 'utf8');
  write('.lab/comments/cart.json', { page: '/cart', comments: { ['0000000000aa']: { id: '0000000000aa', name: 'Leo', text: '+board', createdAt: '2026-11-21T09:00:00.000Z', num: 1, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } } } });
  const of = '/cart#pin-0000000000aa';
  assert.equal((await post({ action: 'place', name: 'pin-0000000000aa', of, path: [['h1', 1]], words: 'Checkout' }, { 'x-lab-admin': keys().token })).status, 422);
  assert.equal((await post({ action: 'place', name: 'pin-0000000000aa', of, path: [['h2', 1]] }, { 'x-lab-admin': keys().token })).status, 422);
  assert.equal((await post({ action: 'place', name: 'pin-0000000000aa', of, path: [['h1', 1]] }, {})).status, 403);
  assert.equal(fs.readFileSync(path.join(DIR, 'cart.html'), 'utf8'), before);
});

test('a deleted pin takes its board and its section in the page\'s file with it', async () => {
  const file = () => fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8');
  assert.match(file(), /<lab-board name="pin-a1b2c3d4e5f6">/);
  const del = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().token }, body: JSON.stringify({ page: '/pricing', action: 'delete', id: ID }) });
  assert.equal(del.status, 200);
  assert.equal(file(), '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
  assert.equal(fs.existsSync(path.join(DIR, `.lab/boards/${name}.json`)), false);
  assert.equal((await fetch(`${B}/_lab/api/board?name=${name}`)).status, 404);
});
