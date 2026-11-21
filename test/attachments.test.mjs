// Pictures in a comment: sent to POST /_lab/api/image (no board), kept as a token until the comment is posted with it,
// then a file at .lab/attachments/<comment id>-<n>.<type> the agent reads by path and the thread shows by URL.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { claimPort, tmp, rm, spawnLab, up, serverJson, agentCall, H1, cli } from './harness.mjs';
import { imagesOf, imageLine } from '../lib/schema.mjs';
import { png, gif } from './pictures.mjs';

const DIR = fs.realpathSync(tmp('attach'));
const PORT = claimPort(6300, 90);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>Home</title><h1>Home</h1>');
const lab = spawnLab(DIR, PORT);
after(() => {
  lab.kill();
  rm([DIR]);
});
const key = async () => (await up(`${B}/_lab/state`), serverJson(DIR));
const upload = async (body, { type = 'image/png', headers = {}, token = true } = {}) =>
  fetch(`${B}/_lab/api/image`, { method: 'POST', headers: { 'content-type': type, origin: B, ...(token ? { 'x-lab-admin': (await key()).token } : {}), ...headers }, body });
const comment = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', anchor: H1, ...body }) });
let n = 0;
const nonce = () => `attach-nonce-${++n}-${Date.now()}`;
const agentText = () => fetch(`${B}/_lab/agent/index`).then((r) => r.text());
const att = (name) => path.join(DIR, '.lab/attachments', name);

test('a picture is sent, then comes with the comment: a file under its id, a line for the agent, served safely', async () => {
  const bytes = png(8, 6);
  const up1 = await upload(bytes);
  assert.equal(up1.status, 201);
  const staged = await up1.json();
  assert.match(staged.token, /^[a-f0-9]{24}$/);
  assert.deepEqual([staged.w, staged.h, staged.type, staged.size], [8, 6, 'png', bytes.length]);
  assert.ok(fs.existsSync(path.join(DIR, '.lab/attachments/.staged', `${staged.token}.png`)));
  const body = { text: 'the header overlaps here', attachments: [staged.token], nonce: nonce() };
  const r = await comment(body);
  assert.equal(r.status, 201, await r.clone().text());
  const { comment: c } = await r.json();
  assert.deepEqual(c.images, [{ n: 1, type: 'png', w: 8, h: 6, size: bytes.length }]);
  assert.ok(fs.readFileSync(att(`${c.id}-1.png`)).equals(bytes));
  assert.equal(fs.existsSync(path.join(DIR, '.lab/attachments/.staged', `${staged.token}.png`)), false, 'the staged file moved');
  const got = await fetch(`${B}/_lab/attachments/${c.id}-1.png`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(got.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(bytes));
  const t = await agentText();
  assert.match(t, new RegExp(`comment: the header overlaps here\\nimage: \\.lab/attachments/${c.id}-1\\.png \\(8×6\\)`));
  assert.match(t, /Pictures: an "image:" line is a file the person attached/);
  // a retry of the same send (the answer was lost) is the same comment: no 409, no second file
  const again = await comment(body);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).comment.id, c.id);
  assert.equal(fs.readdirSync(path.join(DIR, '.lab/attachments')).filter((f) => f.startsWith(c.id)).length, 1);
});

test('a reply may carry a picture, and a picture alone is a message', async () => {
  const root = (await (await comment({ text: 'look' })).json()).comment;
  const tok = (await (await upload(gif(4, 3), { type: 'image/gif' })).json()).token;
  const reply = await comment({ text: '', parent: root.id, attachments: [tok], nonce: nonce() });
  assert.equal(reply.status, 201, await reply.clone().text());
  const r = (await reply.json()).comment;
  assert.equal(r.text, '');
  assert.equal(r.images[0].type, 'gif');
  assert.ok(fs.existsSync(att(`${r.id}-1.gif`)));
  assert.match(await agentText(), new RegExp(`reply: Leo · .* id ${r.id}: \\(a picture, no words\\)\\n  image: \\.lab/attachments/${r.id}-1\\.gif \\(4×3\\)`));
  assert.equal((await comment({ text: '' })).status, 400, 'no words and no picture');
});

test('images in a record: a bad entry is skipped, never a path', () => {
  const c = { id: 'abcdef012345', images: [{ n: 1, type: 'png', w: 1, h: 2 }, { n: 9, type: 'png' }, { n: 2, type: 'svg' }, { n: 1, type: '../x' }] };
  assert.deepEqual(imagesOf(c).map((i) => imageLine(c, i)), ['image: .lab/attachments/abcdef012345-1.png (1×2)']);
  assert.deepEqual(imagesOf({ ...c, id: '../x' }), []);
});

test('refused: svg, a lie about the type, too big, a foreign site, the agent; a bad or used token; paths that are not pictures', async () => {
  assert.equal((await upload('<svg/>', { type: 'image/svg+xml' })).status, 403, 'svg is not an accepted type (the lab takes only json and the four picture types)');
  assert.equal((await upload('<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 415, 'svg bytes under a png header');
  assert.equal((await upload(png(), { type: 'image/jpeg' })).status, 415, 'png bytes declared jpeg');
  // over 25 MB: by its length before a byte is read, and as it streams with no length (cut off by the running count)
  const raw = async (headers, chunks) => {
    const token = (await key()).token;
    return new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/_lab/api/image', method: 'POST', headers: { host: `localhost:${PORT}`, origin: B, 'content-type': 'image/png', 'x-lab-admin': token, ...headers } }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode))));
      req.on('error', () => resolve('reset'));
      for (const c of chunks) req.write(c);
      req.end();
    });
  };
  assert.equal(await raw({ 'content-length': String(25 * 1024 * 1024 + 1) }, []), 413, 'by its length');
  assert.equal(await raw({}, Array.from({ length: 26 }, () => Buffer.alloc(1024 * 1024, 1))), 413, 'as it streams');
  assert.equal((await upload(png(), { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await upload(png(), { token: false })).status, 403, 'no key');
  const agent = await fetch(`${B}/_lab/api/image`, { method: 'POST', headers: { 'content-type': 'image/png', origin: B, 'x-lab-agent': '1', 'x-lab-admin': (await key()).agent }, body: png() });
  assert.equal(agent.status, 403, 'the agent cannot attach');
  const tok = (await (await upload(png())).json()).token;
  assert.equal((await comment({ text: 'x', attachments: ['a'.repeat(24), 'nope'] })).status, 400, 'a bad token');
  assert.equal((await comment({ text: 'x', attachments: Array(5).fill(tok) })).status, 400, 'five');
  assert.equal((await comment({ text: 'x', attachments: ['b'.repeat(24)] })).status, 409, 'unknown token');
  const ok = await comment({ text: 'uses it', attachments: [tok], nonce: nonce() });
  assert.equal(ok.status, 201);
  assert.equal((await comment({ text: 'uses it again', attachments: [tok], nonce: nonce() })).status, 409, 'a used token');
  const agentKey = (await key()).agent;
  const viaAgent = await agentCall(PORT, () => agentKey)('/_lab/api/comments', { page: '/index', name: 'Claude', text: 'x', attachments: [tok] }, 's1');
  assert.equal(viaAgent.status, 400, 'the agent posting attachments');
  const id = (await ok.json()).comment.id;
  assert.equal((await fetch(`${B}/_lab/attachments/..%2fcomments`)).status, 404);
  assert.equal((await fetch(`${B}/_lab/attachments/${tok}.png`)).status, 404, 'staged names are not served');
  assert.equal((await fetch(`${B}/_lab/attachments/.staged/${tok}.png`)).status, 404);
  assert.equal((await fetch(`${B}/_lab/attachments/${id}-1.svg`)).status, 404);
  assert.equal((await fetch(`${B}/_lab/attachments/${id}-5.png`)).status, 404);
});

test('a deleted comment takes its pictures with it', async () => {
  const tok = (await (await upload(png())).json()).token;
  const mine = await comment({ text: 'to delete', attachments: [tok], nonce: nonce() });
  const c = (await mine.json()).comment;
  assert.ok(fs.existsSync(att(`${c.id}-1.png`)));
  const del = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': (await key()).token }, body: JSON.stringify({ page: '/index', action: 'delete', id: c.id }) });
  assert.equal(del.status, 200, await del.clone().text());
  assert.equal(fs.existsSync(att(`${c.id}-1.png`)), false);
  assert.equal((await fetch(`${B}/_lab/attachments/${c.id}-1.png`)).status, 404);
});

test('the wait that brings only new replies puts each picture under its own message, the opening one once', async () => {
  const wait = () => cli(['wait', '--timeout', '6', '--pages', '/index'], { cwd: DIR, env: process.env });
  const rootTok = (await (await upload(png(5, 5))).json()).token;
  const root = (await (await comment({ text: 'first look', attachments: [rootTok], nonce: nonce() })).json()).comment;
  const opened = await wait();
  assert.match(opened.out, /first look/);
  const replyTok = (await (await upload(png(6, 6))).json()).token;
  const reply = (await (await comment({ text: '', parent: root.id, attachments: [replyTok], nonce: nonce() })).json()).comment;
  const next = (await wait()).out;
  const block = next.slice(next.indexOf('# New replies'));
  assert.equal(block.split(`${root.id}-1.png`).length - 1, 1, 'the opening picture once');
  assert.ok(block.indexOf(`${reply.id}-1.png`) > block.indexOf(`id ${reply.id}`), 'the reply\'s picture follows the reply');
  assert.equal(block.split(`${reply.id}-1.png`).length - 1, 1, 'and only there');
  assert.match(block, new RegExp(`id ${reply.id}: \\(a picture, no words\\)`), 'a reply with no words says it is a picture');
  assert.match(opened.out, /Pictures: an "image:" line is a file the person attached/, 'the wait says what an image: line is');
  assert.match(next, /Pictures: an "image:" line/, 'and so does the one with only new replies');
});
