// Pictures on a board: pasted or dropped (POST /_lab/api/image?board=), put there by the agent (labit board add shot.png),
// served back safely, and read by the agent as a frame it can open.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { LAB, claimPort, tmp, rm, spawnLab, up, serverJson } from './harness.mjs';
import { imageInfo } from '../lib/images.mjs';
import { png, pngHeader, gif, jpegHeader, webpHeader } from './pictures.mjs';

const DIR = fs.realpathSync(tmp('boardimage'));
const PORT = claimPort(6200, 90);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
const lab = spawnLab(DIR, PORT);
after(() => {
  lab.kill();
  rm([DIR]);
});
const key = async () => (await up(`${B}/_lab/state`), serverJson(DIR));
const put = async (name, frames = [{ id: 'a', src: '/pricing', w: 1440, h: 900 }]) =>
  (await up(`${B}/_lab/state`), fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ frames }) }));
const post = async (q, body, { type = 'image/png', headers = {}, token = true } = {}) =>
  fetch(`${B}/_lab/api/image?${q}`, { method: 'POST', headers: { 'content-type': type, origin: B, ...(token ? { 'x-lab-admin': (await key()).token } : {}), ...headers }, body });
const board = async (name) => (await fetch(`${B}/_lab/api/board?name=${name}`)).json();
const MAX = 25 * 1024 * 1024;
// A raw POST of a picture: the headers as given, the body in chunks (none: only what content-length says). The answer's status, or 'reset'.
const rawPost = async (headers, chunks) => {
  const token = (await key()).token;
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/_lab/api/image?board=refuse', method: 'POST', headers: { host: `localhost:${PORT}`, origin: B, 'content-type': 'image/png', 'x-lab-admin': token, ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve('reset'));
    for (const c of chunks) req.write(c);
    req.end();
  });
};
const text = (page) => fetch(`${B}/_lab/agent${page}`).then((r) => r.text());
const labit = (...args) => new Promise((resolve) => execFile(process.execPath, [LAB, 'board', ...args], { cwd: DIR, env: process.env }, (err, out, e) => resolve({ code: err ? err.code : 0, out: out + e })));

test('imageInfo: the type and size come from the first bytes, and nothing else is a picture', () => {
  assert.deepEqual(imageInfo(png(8, 6)), { ext: 'png', type: 'image/png', w: 8, h: 6 });
  assert.deepEqual(imageInfo(gif(4, 3)), { ext: 'gif', type: 'image/gif', w: 4, h: 3 });
  assert.deepEqual(imageInfo(jpegHeader(640, 480)), { ext: 'jpg', type: 'image/jpeg', w: 640, h: 480 });
  for (const kind of ['VP8 ', 'VP8L', 'VP8X']) assert.deepEqual(imageInfo(webpHeader(kind, 321, 123)), { ext: 'webp', type: 'image/webp', w: 321, h: 123 }, kind);
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')), null);
  assert.equal(imageInfo(Buffer.from('<!doctype html><script>1</script>')), null);
  assert.equal(imageInfo(png(8, 6).subarray(0, 20)), null, 'cut off');
  const heic = Buffer.alloc(40);
  heic.write('ftypheic', 4);
  assert.equal(imageInfo(heic), null, 'heic');
  const avif = Buffer.alloc(40);
  avif.write('ftypavif', 4);
  assert.equal(imageInfo(avif), null, 'avif is drawn again as png, jpeg or webp before it is sent');
  assert.equal(imageInfo(pngHeader(20000, 10)), null, 'over 16384 px');
  assert.equal(imageInfo(pngHeader(10000, 6000)), null, 'over 50 MP');
  assert.equal(imageInfo(pngHeader(0, 6)), null);
});

test('a picture posted on a board is a frame centred on the point, its bytes kept as they came, and served safely', async () => {
  await put('hero');
  const bytes = png(400, 300);
  const r = await post('board=hero&x=500&y=300', bytes);
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json();
  assert.equal(out.frame.kind, 'image');
  assert.equal(out.frame.file, 'b.png');
  assert.match(out.text, /^Added b \(pasted image \.lab\/boards\/hero\/b\.png\)$/);
  const b = await board('hero');
  const f = b.frames.find((g) => g.id === 'b');
  assert.deepEqual([f.src, f.iw, f.ih, f.w, f.h, f.x + f.w / 2, f.y + f.h / 2, f.state], ['/_lab/board/hero/b', 400, 300, 400, 300, 500, 300, 'live']);
  assert.ok(b.rev >= 2);
  assert.ok(fs.readFileSync(path.join(DIR, '.lab/boards/hero/b.png')).equals(bytes));
  const got = await fetch(`${B}/_lab/board/hero/b`);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(got.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  const body = Buffer.from(await got.arrayBuffer());
  assert.ok(body.equals(bytes));
  assert.equal((await fetch(`${B}/_lab/board/hero/b`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${B}/_lab/board/hero/b`, { headers: { 'if-none-match': got.headers.get('etag') } })).status, 304);
});

test('a big picture is shown at 1440 on its long side, a banner is held to 200 px tall, the file keeps its own size', async () => {
  await put('sizes');
  const big = await (await post('board=sizes', png(3000, 2000))).json();
  assert.deepEqual([big.frame.iw, big.frame.ih, big.frame.w, big.frame.h], [3000, 2000, 1440, 960]);
  const banner = await (await post('board=sizes', png(3000, 150))).json();
  assert.deepEqual([banner.frame.w, banner.frame.h], [1440, 200 /* 72 held up to 200 */]);
});

test('a page that has no board yet gets the one its address shows, then the picture', async () => {
  const r = await post('board=pricing&page=/pricing&x=10&y=10', png(8, 6));
  assert.equal(r.status, 200, await r.clone().text());
  const b = await board('pricing');
  assert.deepEqual(b.frames.map((f) => f.id), ['a', 'b']);
  assert.equal(b.of, '/pricing');
  assert.equal((await post('board=nothing', png(8, 6))).status, 404, 'no board and no page');
});

test('refused: no key, a foreign origin, svg, a type that is not the bytes, too big, a bad name, the 61st frame', async () => {
  await put('refuse');
  const dir = path.join(DIR, '.lab/boards/refuse');
  const none = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  assert.equal((await post('board=refuse', png(), { token: false })).status, 403, 'no key');
  assert.equal((await post('board=refuse', png(), { headers: { origin: 'https://evil.example' } })).status, 403, 'foreign origin');
  assert.equal((await post('board=refuse', '<svg/>', { type: 'image/svg+xml' })).status, 403, 'svg is not a picture type');
  assert.equal((await post('board=refuse', '<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 415, 'svg bytes under a png header');
  assert.equal((await post('board=refuse', png(), { type: 'image/jpeg' })).status, 415, 'png bytes declared jpeg');
  const bad = await post('board=..%2Fx', png());
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /\?board=/, 'the message names the parameter that is there');
  const lied = await post('board=refuse', png(), { type: 'image/gif' });
  assert.equal(lied.status, 415);
  assert.match(await lied.text(), /png, jpeg, webp or gif picture/);
  assert.equal((await post('board=refuse&x=1', png())).status, 400, 'x without y');
  assert.equal(await rawPost({ 'content-length': String(MAX + 1) }, []), 413, 'over 25 MB by its length: refused before a byte is read');
  assert.equal(await rawPost({}, Array.from({ length: 26 }, () => Buffer.alloc(1024 * 1024, 1))), 413, 'over 25 MB as it streams (no length): cut off by the running count');
  assert.deepEqual(none(), [], 'nothing was written');
  const full = Array.from({ length: 58 }, (_, i) => ({ id: i < 25 ? String.fromCharCode(98 + i) : `z${i - 23}`, src: '/pricing', w: 200, h: 200 }));
  await put('full', [{ id: 'a', src: '/pricing', w: 200, h: 200 }, ...full]);
  assert.equal((await post('board=full', png())).status, 200, 'the 60th');
  const r61 = await post('board=full', png());
  assert.equal(r61.status, 422, '61st');
  assert.match((await r61.json()).error, /at most 60 frames/);
});

test('a PUT cannot point an image frame at another file', async () => {
  await put('safe');
  await post('board=safe', png());
  const cur = await board('safe');
  const edit = (patch) => fetch(`${B}/_lab/api/board?name=safe`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ rev: cur.rev, frames: cur.frames.map((f) => (f.id === 'b' ? { ...f, ...patch } : f)) }) });
  assert.equal((await edit({ file: '../../package.json' })).status, 422);
  assert.equal((await edit({ file: 'a.png' })).status, 422);
  assert.equal((await edit({ src: '/_lab/board/other/b' })).status, 422);
  assert.equal((await edit({ label: 'ok' })).status, 200);
});

test('the agent adds a picture, reads a pin on it as a frame with its file, and a pick archives it and keeps the file', async () => {
  await put('agent');
  fs.writeFileSync(path.join(DIR, 'shot.png'), png(60, 40));
  const added = await labit('add', 'agent', 'shot.png', '--label', 'from the agent');
  assert.equal(added.code, 0, added.out);
  assert.match(added.out, /Added b \(pasted image \.lab\/boards\/agent\/b\.png\)/);
  assert.ok(fs.existsSync(path.join(DIR, '.lab/boards/agent/b.png')));
  const list = (await labit('list', 'agent')).out;
  assert.match(list, /^b {2}pasted image \.lab\/boards\/agent\/b\.png {2}200×200 {2}"from the agent"$/m, list);
  assert.doesNotMatch(list, /folder:/);
  const c = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/_board/agent', name: 'Leo', text: 'crop this', anchor: { kind: 'board', board: 'agent', frame: 'b', fx: 10, fy: 20, bx: 10, by: 20 } }) }).then((r) => r.json());
  assert.ok(c.comment);
  const t = await text('/_board/agent');
  assert.match(t, /near: frame b "from the agent" \(pasted image \.lab\/boards\/agent\/b\.png at 60×40 px shown at 200×200\)/);
  const pick = await labit('pick', 'agent', 'a');
  assert.doesNotMatch(pick.out, /Delete|files kept/);
  const pick2 = await labit('pick', 'agent', 'b');
  assert.match(pick2.out, /Picked b\. Archived a\./);
  assert.ok(fs.existsSync(path.join(DIR, '.lab/boards/agent/b.png')));
  // a pin near a frame that was taken off says so
  const onGone = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/_board/agent', name: 'Leo', text: 'what was here?', anchor: { kind: 'board', board: 'agent', frame: 'a', fx: 5, fy: 6, bx: 5, by: 6 } }) }).then((r) => r.json());
  assert.ok(onGone.comment);
  assert.match(await text('/_board/agent'), /near: frame a \(\/pricing at 1440×900, archived\), 5 px right of its left edge/);
  const pt = await text('/_board/agent/b');
  assert.match(pt, /picked: a archived\./);
  assert.doesNotMatch(pt, /Delete the variant files/);
});

test('a pin or an area on a pasted picture says where it is on the file itself, as one on a page image does', async () => {
  await put('spot');
  const r = await (await post('board=spot&x=0&y=0', png(2400, 1600))).json(); // shown at 1440 × 960
  assert.deepEqual([r.frame.w, r.frame.h], [1440, 960]);
  const at = (extra) => ({ kind: 'board', board: 'spot', frame: 'b', file: 'b.png', nw: 2400, nh: 1600, selector: '', x: 0, y: 0, docX: 0, docY: 0, width: 1000, ...extra });
  const say = (text, anchor) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/_board/spot', name: 'Leo', text, anchor }) });
  // the spot 720,480 of the frame (its middle) is the file's pixel 1200,800: shares of the frame times the file's size
  assert.equal((await say('here', at({ fx: 720, fy: 480, imgX: 0.5, imgY: 0.5 }))).status, 201);
  // an area from 360,240 to 1080,720 of the frame
  assert.equal((await say('this part', at({ fx: 360, fy: 240, imgX: 0.25, imgY: 0.25, imgX2: 0.75, imgY2: 0.75 }))).status, 201);
  const t = await text('/_board/spot');
  assert.match(t, /on: image "b\.png" \(pasted onto this board: \.lab\/boards\/spot\/b\.png\)\nspot in original: 50% across, 50% down of 2400×1600 \(pixel 1200,800\)/);
  assert.match(t, /on: image "b\.png" \(pasted onto this board: \.lab\/boards\/spot\/b\.png\)\narea in original: 25%–75% across, 25%–75% down of 2400×1600 \(pixels 600,400 to 1800,1200\)/);
  assert.match(t, /near: frame b .*pasted image \.lab\/boards\/spot\/b\.png at 2400×1600 px shown at 1440×960\), 720 px right of its left edge, 480 px below its top/, 'the frame line stays');
  // a file name that is not a pasted picture's, or no board, adds nothing
  await say('odd', at({ fx: 1, fy: 1, imgX: 0.1, imgY: 0.1, file: '../../x.png' }));
  assert.doesNotMatch(await text('/_board/spot'), /x\.png/);
});

test('an archived picture does not count toward the 60 frames, an archived page does', async () => {
  const pages = Array.from({ length: 58 }, (_, i) => ({ id: i < 24 ? String.fromCharCode(99 + i) : `z${i - 22}`, src: '/pricing', w: 200, h: 200 }));
  await put('count', [{ id: 'a', src: '/pricing', w: 200, h: 200 }, ...pages]); // 59
  assert.equal((await post('board=count', png())).status, 200, 'the 60th frame');
  assert.equal((await post('board=count', png())).status, 422, 'the 61st');
  const cur = await board('count');
  const pic = cur.frames.find((f) => f.kind === 'image');
  const arch = (id) => fetch(`${B}/_lab/api/board?name=count`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ rev: cur.rev, frames: cur.frames.map((f) => (f.id === id ? { ...f, state: 'archived' } : f)) }) });
  assert.equal((await arch(pic.id)).status, 200, 'archive the picture');
  assert.equal((await post('board=count', png())).status, 200, 'a place is free again');
  const after = await board('count');
  assert.equal(after.frames.length, 61, 'the board file holds the archived picture too');
  assert.equal((await fetch(`${B}/_lab/api/board?name=count`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ rev: after.rev, frames: after.frames.map((f) => (f.id === 'c' ? { ...f, state: 'archived' } : f)) }) })).status, 200, 'an archived page frame is still counted: the board stays at its 60 counted');
  assert.equal((await post('board=count', png())).status, 422);
});

test('board add reads a picture once, and says so when one is over 25 MB', async () => {
  await put('big');
  fs.writeFileSync(path.join(DIR, 'huge.png'), Buffer.alloc(MAX + 1, 1));
  const r = await labit('add', 'big', 'huge.png');
  assert.equal(r.code, 1);
  assert.match(r.out, /huge\.png: a picture is at most 25 MB\./);
});
