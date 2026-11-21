// Boards: the board file, its API, the page of a variant, the watcher, in a folder lab and behind a dev server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { LAB, claimPort, tmp, rm, spawnLab, sleep, up as answers } from './harness.mjs';

const mk = (flags) => {
  const dir = fs.realpathSync(tmp('board'));
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags }));
  return dir;
};
const DIR = mk({});
const PX = mk({});
const [PORT, PPX, UP] = [claimPort(9600, 100), claimPort(9800, 100), claimPort(9900, 100)];
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><html><head><title>Pricing</title><link rel="stylesheet" href="s.css"></head><body><h1>Pricing</h1></body></html>');
fs.mkdirSync(path.join(DIR, 'sub'));
fs.writeFileSync(path.join(DIR, 'sub', 'deep.html'), '<!doctype html><html><head><title>Deep</title></head><body><h1>Deep</h1></body></html>');
fs.writeFileSync(path.join(DIR, 'cart.html'), '<!doctype html><title>Cart</title><h1>Cart</h1>');
const upstream = http.createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><h1>dev</h1></body></html>')).listen(UP);
const procs = [spawnLab(DIR, PORT), spawnLab(PX, PPX, { args: ['--proxy', String(UP)] })];
after(() => {
  procs.forEach((p) => p.kill());
  upstream.close();
  rm([DIR, PX]);
});
const up = (port) => answers(`http://localhost:${port}/_lab/state`);
const put = (base, q, body, headers = {}) => fetch(`${base}/_lab/api/board?${q}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body) });
const get = (base, q) => fetch(`${base}/_lab/api/board?${q}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const live = (base) =>
  new Promise((resolve) => {
    const u = new URL(base + '/_lab/live');
    const req = http.get({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8');
      const seen = [];
      res.on('data', (d) => {
        for (const l of d.split('\n')) if (l.startsWith('data: ')) seen.push(JSON.parse(l.slice(6)));
      });
      resolve({ seen, close: () => req.destroy() });
    });
  });
const settle = (ms = 400) => sleep(ms);

test('PUT then GET round-trips; the file is .lab/boards/<name>.json with v 1', async () => {
  await up(PORT);
  const frames = [{ id: 'a', src: '/pricing', w: 1440, h: 900, label: 'Pricing' }, { id: 'b', src: '/pricing', w: 390, h: 844, variantOf: 'a' }];
  const r = await put(B, 'name=checkout', { frames });
  assert.equal(r.status, 200);
  const got = await get(B, 'name=checkout');
  assert.equal(got.body.exists, true);
  assert.deepEqual(got.body.frames.map((f) => f.id), ['a', 'b']);
  const disk = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/boards/checkout.json'), 'utf8'));
  assert.equal(disk.v, 1);
  assert.equal(disk.name, 'checkout');
  assert.equal(disk.frames[1].variantOf, 'a');
  assert.equal('x' in disk.frames[0], false, 'the lab chose the places: none stored');
});

test('frames without x and y are laid out in rows, in array order; their own places stay', async () => {
  const frames = [1, 2, 3, 4].map((n) => ({ id: 'abcd'[n - 1], src: '/pricing', w: 1440, h: 900 }));
  frames.push({ id: 'e', src: '/cart', w: 390, h: 844, x: 7, y: 9 });
  await put(B, 'name=rows', { frames });
  const { body } = await get(B, 'name=rows');
  const at = body.frames.map((f) => [f.x, f.y]);
  assert.deepEqual(at[0], [0, 0]);
  assert.deepEqual(at[1], [1520, 0]);
  assert.deepEqual(at[2], [3040, 0]);
  assert.equal(at[3][0], 0, 'the fourth wraps to a new row');
  assert.ok(at[3][1] > 900);
  assert.deepEqual(at[4], [7, 9]);
  assert.equal(body.frames[0].auto, true);
});

test('refused: bad name, other origin, no same origin, dropped frame, stale rev; a damaged file is put aside', async () => {
  const ok = [{ id: 'a', src: '/pricing', w: 1280, h: 800 }];
  assert.equal((await put(B, 'name=Bad%20Name', { frames: ok })).status, 400);
  assert.equal((await put(B, 'name=x1', { frames: [{ id: 'a', src: 'https://example.com/', w: 1, h: 1 }] })).status, 422);
  assert.equal((await put(B, 'name=x1', { frames: [{ id: 'a', src: '//example.com/', w: 1, h: 1 }] })).status, 422);
  assert.equal((await put(B, 'name=x1', { frames: ok }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await put(B, 'name=x1', { frames: ok })).status, 200);
  const { body } = await get(B, 'name=x1');
  assert.equal((await put(B, 'name=x1', { rev: body.rev, frames: [] })).status, 422, 'a frame is archived, not removed');
  assert.equal((await put(B, 'name=x1', { rev: body.rev + 5, frames: ok })).status, 409);
  assert.equal((await put(B, 'name=x1', { rev: body.rev, frames: [{ ...ok[0], state: 'archived' }] })).status, 200);
  fs.writeFileSync(path.join(DIR, '.lab/boards/broken.json'), '{nope');
  assert.equal((await get(B, 'name=broken')).status, 404);
  assert.ok(fs.readdirSync(path.join(DIR, '.lab/boards')).some((n) => n.startsWith('broken.json.broken-')));
  assert.equal(fs.existsSync(path.join(DIR, '.lab/boards/broken.json')), false);
});

test('the board of a page: named for the page, saved by the first PUT', async () => {
  const a = await get(B, 'page=/sub/deep');
  assert.equal(a.body.name, 'sub--deep');
  assert.equal(a.body.exists, false);
  assert.equal(a.body.frames[0].src, '/sub/deep');
  assert.equal(fs.existsSync(path.join(DIR, '.lab/boards/sub--deep.json')), false);
  const r = await put(B, 'page=/sub/deep', { rev: 0, frames: [...a.body.frames, { id: 'b', src: '/sub/deep', w: 390, h: 844 }] });
  assert.equal(r.status, 200);
  const disk = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/boards/sub--deep.json'), 'utf8'));
  assert.equal(disk.of, '/sub/deep');
  assert.equal((await get(B, 'page=/sub/deep')).body.exists, true);
});

test('a variant file is served at /_lab/board/<n>/<f> with the widget; .lab is still never served', async () => {
  fs.mkdirSync(path.join(DIR, '.lab/boards/hero'), { recursive: true });
  for (const id of 'abc') fs.writeFileSync(path.join(DIR, `.lab/boards/hero/${id}.html`), `<!doctype html><html><head><title>v</title></head><body><h1>${id}</h1></body></html>`);
  for (const id of 'abc') {
    const res = await fetch(`${B}/_lab/board/hero/${id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`<h1>${id}</h1>`));
    assert.match(html, new RegExp(`data-page="/_board/hero/${id}"`));
    assert.equal(html.match(/_lab\/comments\.js/g).length, 1);
  }
  assert.equal((await fetch(`${B}/.lab/boards/hero/a.html`)).status, 404);
  assert.equal((await fetch(`${B}/_lab/board/hero/z`)).status, 404);
  assert.notEqual((await fetch(`${B}/_lab/board/..%2f/a`)).status, 200);
  assert.equal((await fetch(`${B}/_lab/board/hero`)).status, 200, 'the board page itself is served (test/boardpage.test.mjs)');
});

test('the lab watches .lab/boards: a board file bumps boards, a saved variant is a hot update of its frame alone, a page save is neither', async () => {
  const s = await live(B);
  await settle(300);
  const n0 = s.seen.at(-1);
  fs.appendFileSync(path.join(DIR, '.lab/boards/hero/b.html'), '<!-- x -->');
  await settle(600);
  const h = s.seen.at(-1);
  assert.equal(h.hot, (n0.hot || 0) + 1);
  assert.deepEqual(h.hotFiles, [{ path: '/_lab/board/hero/b', kind: 'html' }]);
  assert.equal(h.files, n0.files, 'no page reloads');
  const f = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/boards/checkout.json'), 'utf8'));
  fs.writeFileSync(path.join(DIR, '.lab/boards/checkout.json'), JSON.stringify({ ...f, title: 'edited' }));
  await settle(600);
  const b = s.seen.at(-1);
  assert.equal(b.boards, h.boards + 1);
  assert.ok(b.boardNames.includes('checkout'));
  fs.appendFileSync(path.join(DIR, 'cart.html'), '\n<!-- save -->');
  await settle(600);
  assert.equal(s.seen.at(-1).boards, b.boards, 'a page save is not a board change');
  s.close();
});

test('pages list: boards are listed, scratch frames and board keys are not pages', async () => {
  await put(B, 'name=hero', { frames: 'abc'.split('').map((id) => ({ id, src: `/_lab/board/hero/${id}`, w: 1280, h: 800 })) });
  const info = await (await fetch(`${B}/_lab/pages`)).json();
  assert.ok(info.boards.some((b) => b.name === 'hero' && b.frames === 3));
  assert.equal(info.pages.some((p) => /board|\.lab/.test(p.file + p.path)), false);
});

test('behind a dev server the board works the same', async () => {
  await up(PPX);
  const P = `http://localhost:${PPX}`;
  assert.equal((await put(P, 'page=/pricing', { frames: [{ id: 'a', src: '/pricing', w: 390, h: 844 }] })).status, 200);
  assert.equal((await get(P, 'page=/pricing')).body.name, 'pricing');
  assert.equal((await put(P, 'name=widths', { frames: [{ id: 'a', src: '/pricing', w: 390, h: 844 }] })).status, 200);
  // the watcher works here too (the project watcher is off behind a dev server)
  const s = await live(P);
  await settle(300);
  const n = s.seen.at(-1).boards;
  fs.appendFileSync(path.join(PX, '.lab/boards/widths.json'), '\n');
  await settle(600);
  assert.equal(s.seen.at(-1).boards, n + 1);
  s.close();
});

test('a page loaded into a frame is not opened by anybody', async () => {
  const opened = async () => (await (await fetch(`${B}/_lab/pages`)).json()).pages.find((p) => p.path === '/cart').opened;
  await fetch(`${B}/cart`, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(await opened(), null);
  await fetch(`${B}/cart`, { headers: { 'sec-fetch-dest': 'document' } });
  assert.ok(await opened());
});

// ---------- the commands (labit board …) ----------
import { execFile } from 'node:child_process';
const cli = (dir, ...args) =>
  new Promise((resolve) => execFile(process.execPath, [LAB, 'board', ...args], { cwd: dir, env: process.env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));

test('board new --variants copies the page, prints the link, and each file is the page plus a base', async () => {
  const r = await cli(DIR, 'new', 'Pricing hero', '--of', '/pricing', '--variants', '3');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^# Board pricing-hero · Pricing hero\nurl: http:\/\/localhost:\d+\/pricing#board=pricing-hero \(the board opens over its page: its pins are that page's\)\n/);
  // Frame a is the page as it is now (the real page, not a copy); the variants sit beside it.
  assert.match(r.out, /\na {2}\/pricing {2}1280×800 {2}"now"\n/);
  assert.match(r.out, /\nb {2}b\.html {2}1280×800\n/);
  assert.ok(!fs.existsSync(path.join(DIR, '.lab/boards/pricing-hero/a.html')), 'now is no copy');
  assert.equal(JSON.parse(fs.readFileSync(path.join(DIR, '.lab/boards/pricing-hero.json'), 'utf8')).frames[0].src, '/pricing');
  for (const id of 'bcd') {
    const file = fs.readFileSync(path.join(DIR, `.lab/boards/pricing-hero/${id}.html`), 'utf8');
    assert.match(file, /<head><base href="\/"><title>Pricing<\/title>/);
    assert.match(await (await fetch(`${B}/_lab/board/pricing-hero/${id}`)).text(), /<h1>Pricing<\/h1>/);
  }
  const nested = await cli(DIR, 'new', 'Deep', '--of', '/sub/deep', '--variants', '1');
  assert.equal(nested.code, 0, nested.out);
  assert.match(fs.readFileSync(path.join(DIR, '.lab/boards/deep/b.html'), 'utf8'), /<base href="\/sub\/">/);
  const same = await cli(DIR, 'new', 'Pricing hero', '--of', '/pricing', '--variants', '2');
  assert.match(same.out, /# Board pricing-hero-2/, 'a second board of the same topic never overwrites the first');
});

test('variants: default is the caller\'s, 7 is refused, a missing page or a non-page is said plainly', async () => {
  assert.notEqual((await cli(DIR, 'new', 'Many', '--of', '/pricing', '--variants', '7')).code, 0);
  assert.match((await cli(DIR, 'new', 'Nope', '--of', '/missing', '--variants', '2')).out, /not a page of this lab/);
  assert.match((await cli(DIR, 'new', 'Bad', '--of', 'https://example.com/', '--variants', '2')).out, /page of this lab/);
});

test('variants behind a dev server (or of a page that is no .html file) are the live page with ?lab-variant=<frame>; pick says which won', async () => {
  await up(PPX);
  const inPx = (...a) => cli(PX, ...a);
  const made = await inPx('new', 'Live', '--of', '/pricing', '--variants', '2');
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /\na {2}\/pricing {2}1280×800 {2}"now"\n/);
  assert.match(made.out, /\nb {2}\/pricing\?lab-variant=b {2}1280×800\n/);
  assert.match(made.out, /\nc {2}\/pricing\?lab-variant=c {2}1280×800\n/);
  assert.match(made.out, /Each variant frame is the live page with \?lab-variant=<frame>; branch on new URLSearchParams\(location\.search\)\.get\('lab-variant'\)/);
  assert.match(made.out, /Remove the branching when one is picked\./);
  assert.doesNotMatch(made.out, /folder: \.lab\/boards/, 'nothing is copied');
  assert.equal(fs.existsSync(path.join(PX, '.lab/boards/live')), false);
  const picked = await inPx('pick', 'live', 'c');
  assert.match(picked.out, /Picked c\. Archived a, b/);
  assert.match((await inPx('list', 'live')).out, /\nc {2}\/pricing\?lab-variant=c {2}1280×800 {2}picked\n/);
  // The pick comes back to the agent as a pin on the board, saying which branch won (the board is over its page: the page's pin).
  const t = await (await fetch(`http://localhost:${PPX}/_lab/agent/pricing`)).text();
  assert.match(t, /^picked: a, b archived\. Keep the c branch \(\?lab-variant=c\) in \/pricing's source and remove the lab-variant branching, then resolve it with no words \(resolve <id>\)\.$/m);
});

test('picking frame a, the page as it is now, keeps the page and says what to clean up; "files kept" only where there are files', async () => {
  const made = await cli(DIR, 'new', 'Keep now', '--of', '/pricing', '--variants', '2');
  const name = /# Board (\S+)/.exec(made.out)[1];
  assert.match((await cli(DIR, 'pick', name, 'a')).out, /Picked a\. Archived b, c \(files kept\)\./);
  const t = await (await fetch(`${B}/_lab/agent/pricing`)).text();
  assert.match(t, /^picked: b, c archived, files kept\. Keep pricing\.html as it is: change nothing in it\. Delete the variant files \(\.lab\/boards\/[^/]+\/b\.html, c\.html\)\. Then resolve it with no words \(resolve <id>\)\.$/m);
  assert.doesNotMatch(t, /Put a's change/);
  // Live variants: no files to keep; the page's own branching is what goes.
  await up(PPX);
  const live = await cli(PX, 'new', 'Keep now live', '--of', '/pricing', '--variants', '2');
  const n2 = /# Board (\S+)/.exec(live.out)[1];
  assert.match((await cli(PX, 'pick', n2, 'a')).out, /^Picked a\. Archived b, c\.$/m);
  const t2 = await (await fetch(`http://localhost:${PPX}/_lab/agent/pricing`)).text();
  assert.match(t2, /^picked: b, c archived\. Keep \/pricing as it is: change nothing in it\. Remove any lab-variant branching you added to its source\. Then resolve it with no words \(resolve <id>\)\.$/m);
});

test('widths copy no file and run narrow to wide; flow keeps its order; add puts a step after another', async () => {
  const w = await cli(DIR, 'new', 'Pricing widths', '--of', '/pricing', '--widths', '1280,390,820');
  assert.equal(w.code, 0, w.out);
  assert.deepEqual(w.out.split('\n').filter((l) => /^[abc] /.test(l)).map((l) => l.split(/ {2}/)[2]), ['390×844', '820×1180', '1280×800']);
  assert.equal(fs.existsSync(path.join(DIR, '.lab/boards/pricing-widths')), false);
  const f = await cli(DIR, 'new', 'Checkout flow', '--flow', '/pricing,/cart,/sub/deep');
  assert.match(f.out, /"1 Pricing"/);
  assert.match(f.out, /"3 Deep"/);
  const added = await cli(DIR, 'add', 'checkout-flow', '/cart', '--after', 'a', '--label', 'again');
  assert.match(added.out, /Added d \(\/cart\) after a\./);
  const list = await cli(DIR, 'list', 'checkout-flow');
  assert.deepEqual(list.out.split('\n').filter((l) => /^[a-d] /.test(l)).map((l) => l[0]), ['a', 'd', 'b', 'c']);
  assert.match((await cli(DIR, 'move', 'checkout-flow', 'c', '--first')).out, /c is now first\./);
  assert.match((await cli(DIR, 'move', 'checkout-flow', 'a', '--after', 'a')).out, /after itself/);
  assert.match((await cli(DIR, 'add', 'checkout-flow', 'b', '--label', 'second', '--width', '390')).out, /Changed b\./);
  const disk = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/boards/checkout-flow.json'), 'utf8'));
  assert.deepEqual(disk.frames.map((x) => x.id), ['c', 'a', 'd', 'b']);
  assert.equal(disk.frames.find((x) => x.id === 'b').h, 844);
});

test('add copies a file in as a new variant; list with no name lists boards; the page of a board of a page via board new --of', async () => {
  fs.writeFileSync(path.join(DIR, 'mine.html'), '<!doctype html><title>mine</title><h1>mine</h1>');
  const r = await cli(DIR, 'add', 'pricing-hero', 'mine.html', '--label', 'my take');
  assert.match(r.out, /Added e \(e\.html\)\./);
  assert.match(await (await fetch(`${B}/_lab/board/pricing-hero/e`)).text(), /<h1>mine<\/h1>/);
  const all = await cli(DIR, 'list');
  assert.match(all.out, /^pricing-hero {2}5 frames {2}of \/pricing {2}http/m);
  const one = await cli(DIR, 'new', '--of', '/sub/deep');
  assert.match(one.out, /# Board sub--deep/);
  assert.match((await cli(DIR, 'list', 'nope')).out, /No board nope/);
});

// ---------- what an agent reads ----------
import { spawn as spawnProc } from 'node:child_process';
const pin = (page, body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page, name: 'Leo', ...body }) }).then((r) => r.json());
const text = (page) => fetch(`${B}/_lab/agent${page}`).then((r) => r.text());
const wait = (dir, ...args) => new Promise((resolve) => execFile(process.execPath, [LAB, 'wait', '--timeout', '8', ...args], { cwd: dir, env: process.env }, (e, out, err) => resolve(out + err)));

test('a pin on a variant: its page text names the frame, the board and the file', async () => {
  const made = await cli(DIR, 'new', 'Hero', '--of', '/pricing', '--variants', '2');
  const name = /# Board (\S+)/.exec(made.out)[1];
  await cli(DIR, 'add', name, 'b', '--label', 'price first');
  const c = await pin(`/_board/${name}/b`, { text: 'bigger price', anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5, width: 1280, height: 800 } });
  assert.ok(c.comment);
  const t = await text(`/_board/${name}/b`);
  assert.match(t, new RegExp(`^frame: b of board ${name} \\(variant of /pricing, 1280×800, "price first", beside a, c\\)$`, 'm'));
  assert.match(t, new RegExp(`^file: \\.lab/boards/${name}/b\\.html$`, 'm'));
  assert.match(t, /^page: http:\/\/localhost:\d+\/_lab\/board\/[^/]+\/b$/m);
});

test('a board pin keeps signed numbers; the board text lists frames in order, then the pin near its frame', async () => {
  const made = await cli(DIR, 'new', 'Set', '--of', '/pricing', '--widths', '390,1280');
  const name = /# Board (\S+)/.exec(made.out)[1];
  await cli(DIR, 'add', name, 'b', '--label', 'Wide');
  // A board about a page lives on that page: its pins are the page's, the board text is `labit board list <name>`.
  const c = await pin('/pricing', { text: 'these should share a header', anchor: { kind: 'board', frame: 'b', fx: -120, fy: 40, bx: -1640, by: 7, board: name } });
  assert.equal(c.comment.anchor.kind, 'board');
  assert.deepEqual([c.comment.anchor.fx, c.comment.anchor.fy, c.comment.anchor.bx], [-120, 40, -1640]);
  const t = await text('/pricing');
  const l = (await cli(DIR, 'list', name)).out;
  assert.match(l, new RegExp(`^# Board ${name} · Set\\nurl: http://localhost:\\d+/pricing#board=${name} \\(the board opens over its page: its pins are that page's\\)\\nof: /pricing \\(file pricing\\.html\\)\\n`));
  assert.match(l, /\na {2}\/pricing {2}390×844\n/);
  assert.match(l, /\nb {2}\/pricing {2}1280×800 {2}"Wide"\n/);
  assert.match(t, new RegExp(`^on: the board ${name} over this page, not the page itself$`, 'm'));
  assert.match(t, /^near: frame b "Wide" \(\/pricing at 1280×800\), 120 px left of its left edge, 40 px below its top$/m);
  assert.doesNotMatch(t, /selector \(at comment time\)|where on element/);
  // the frames of the board the pin names follow the page's own text, with the pins open on each
  assert.match(t, new RegExp(`# The frames of board ${name}, which the pins above name\\n# Board ${name} · Set`));
  assert.match(t, /\nb {2}\/pricing {2}1280×800 {2}"Wide" {2}1 open\n/);
  // a pin made on a phone says so, and that its spot was scaled to the frame as stored
  const onPhone = await pin('/pricing', { text: 'phone pin', anchor: { kind: 'board', frame: 'b', fx: 100, fy: 50, bx: 1, by: 1, board: name, lay: 390, selector: '', x: 0, y: 0, docX: 0, docY: 0, width: 390 } });
  assert.ok(onPhone.comment);
  assert.match(await text('/pricing'), /near: frame b "Wide" \(\/pricing at 1280×800\), 100 px right of its left edge, 50 px below its top \(made on a phone, the page laid out 390 px wide: the spot is scaled to the frame's size above\)/);
  // a pin on a page, made on a board
  const p = await pin('/cart', { text: 'x', anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5, board: name, frame: 'a' } });
  assert.match(await text('/cart'), new RegExp(`^seen on: board ${name}, frame a "?`, 'm'));
  assert.ok(p.comment);
});

test('the board text for 6 frames is under 900 bytes and a frame line under 120', async () => {
  const made = await cli(DIR, 'new', 'Six', '--of', '/pricing', '--variants', '6');
  const name = /# Board (\S+)/.exec(made.out)[1];
  const t = await text(`/_board/${name}`);
  assert.ok(Buffer.byteLength(t.split('# Comments')[0]) < 900, String(Buffer.byteLength(t.split('# Comments')[0])));
  assert.ok(t.split('\n').find((l) => l.startsWith('frame:') || /^a {2}/.test(l)).length < 120);
});

test('wait with no pages hears a variant\'s pin, with the frame line; --pages on the board or its page covers its frames', async () => {
  const made = await cli(DIR, 'new', 'Waited', '--of', '/pricing', '--variants', '2');
  const name = /# Board (\S+)/.exec(made.out)[1];
  await pin(`/_board/${name}/b`, { text: 'tighten the header', anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } });
  const got = await wait(DIR, '--pages', `/_board/${name}`);
  assert.match(got, /tighten the header/);
  assert.match(got, new RegExp(`frame: b of board ${name}`));
  const other = await cli(DIR, 'new', 'Waited too', '--of', '/pricing', '--variants', '2');
  const n2 = /# Board (\S+)/.exec(other.out)[1];
  await pin(`/_board/${n2}/a`, { text: 'via the page', anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } });
  assert.match(await wait(DIR, '--pages', '/pricing'), /via the page/);
});

test('a wait on a board is heard by its frames', async () => {
  const made = await cli(DIR, 'new', 'Heard', '--of', '/pricing', '--variants', '2');
  const name = /# Board (\S+)/.exec(made.out)[1];
  const w = spawnProc(process.execPath, [LAB, 'wait', '--timeout', '20', '--pages', `/_board/${name}`], { cwd: DIR, env: process.env });
  let heard;
  for (let i = 0; i < 50 && !heard?.pages.includes(`/_board/${name}/b`); i++) {
    await settle(100);
    heard = (await (await fetch(`${B}/_lab/state`)).json()).heard;
  }
  w.kill();
  assert.ok(heard.pages.includes(`/_board/${name}`) && heard.pages.includes('/pricing') && heard.pages.includes(`/_board/${name}/b`), JSON.stringify(heard));
});

test('pick: one frame is picked and the rest archived, files kept; the pick comes back in the next wait as a pin once', async () => {
  const made = await cli(DIR, 'new', 'Pick me', '--of', '/pricing', '--variants', '3');
  const name = /# Board (\S+)/.exec(made.out)[1];
  const r = await cli(DIR, 'pick', name, 'b');
  assert.match(r.out, /Picked b\. Archived a, c, d \(files kept\)\./);
  const disk = JSON.parse(fs.readFileSync(path.join(DIR, `.lab/boards/${name}.json`), 'utf8'));
  assert.deepEqual(disk.frames.map((f) => f.state), ['archived', 'picked', 'archived', 'archived']);
  for (const id of 'bcd') assert.ok(fs.existsSync(path.join(DIR, `.lab/boards/${name}/${id}.html`)));
  const got = await wait(DIR, '--pages', `/_board/${name}`);
  assert.match(got, /Picked b/);
  assert.match(got, /near: frame b \(b\.html at 1280×800\)/);
  assert.match(got, /picked: a, c, d archived, files kept\. Put b's change into pricing\.html, then resolve it with no words \(resolve <id>\)\./);
  assert.match((await cli(DIR, 'pick', name, 'b')).out, /already picked/);
  assert.equal((await (await fetch(`${B}/_lab/api/comments?page=/pricing`)).json()).comments.filter((c) => c.anchor.board === name).length, 1, 'a second pick posts nothing (the pin is on the board\'s page)');
  const two = await cli(DIR, 'new', 'Pick two', '--of', '/pricing', '--variants', '3');
  const n2 = /# Board (\S+)/.exec(two.out)[1];
  assert.match((await cli(DIR, 'pick', n2, 'a', 'b')).out, /Kept a, b\. Archived c, d/);
  const d2 = JSON.parse(fs.readFileSync(path.join(DIR, `.lab/boards/${n2}.json`), 'utf8'));
  assert.deepEqual(d2.frames.map((f) => f.state), ['live', 'live', 'archived', 'archived']);
  assert.match((await cli(DIR, 'pick', n2, 'z')).out, /No frame z/);
});

test('git stays clean: a repo that ignores .lab sees nothing of boards', async () => {
  const { execFileSync } = await import('node:child_process');
  const g = (...a) => execFileSync('git', a, { cwd: DIR, encoding: 'utf8' });
  fs.writeFileSync(path.join(DIR, '.gitignore'), '.lab/\n');
  g('init', '-q');
  g('add', '-A');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  await cli(DIR, 'new', 'Clean', '--of', '/pricing', '--variants', '3');
  await cli(DIR, 'pick', 'clean', 'b');
  assert.equal(g('status', '--porcelain').trim(), '');
});
