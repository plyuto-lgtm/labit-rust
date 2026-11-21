// labit --native (docs/native.md): a lab for an app that draws its own window and posts its pins over HTTP, as the
// GPUI app does. No page files exist; the pages are the ones with pins, and the agent reads where the Rust code is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, rm, spawnLab, up, cli as command } from './harness.mjs';

const { DIR, PORT, B } = site('native', 9950, 9);
const env = { ...process.env, PORT: '' };
const lab = spawnLab(DIR, PORT, { flags: ['--native', '--new'], env });
after(() => {
  lab.kill();
  rm([DIR]);
});
const cli = (...args) => command(args, { cwd: DIR, env });
// What the Rust client sends: JSON, no Origin and no cookie.
const send = async (body) => {
  const r = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const list = async (page) => {
  const r = await fetch(`${B}/_lab/api/comments?page=${page}`);
  return { rev: r.headers.get('x-lab-rev'), comments: (await r.json()).comments };
};
const ANCHOR = { kind: 'element', selector: 'gpui:k12345678', element: 'Stepper', component: 'Stepper', source: 'bridge/crates/ui/src/stepper.rs:88', usedAt: 'bridge/app/src/board.rs:120', x: 0.5, y: 0.25, width: 1280, height: 800 };

test('a pin from the app is listed, reaches the agent with where the Rust code is, and the agent answers it', async () => {
  await up(B + '/');
  const made = await send({ page: '/gallery/inspector', name: 'Alex', text: 'too tight', nonce: 'k12345678-0001', anchor: ANCHOR });
  assert.equal(made.status, 201);
  const { comment, edit } = made.json;
  assert.ok(edit, 'the answer carries the key that resolves this thread');
  assert.equal(comment.num, 1);
  assert.deepEqual(comment.anchor, { ...ANCHOR, docX: 0, docY: 0 }, 'every field the app sends is kept (the page-position fields default to 0)');
  assert.equal((await send({ page: '/gallery/inspector', name: 'Alex', text: 'too tight', nonce: 'k12345678-0001', anchor: ANCHOR })).json.comment.id, comment.id, 'the same nonce is the same pin');

  const got = await list('/gallery/inspector');
  assert.deepEqual(got.comments.map((c) => c.id), [comment.id]);
  assert.ok(got.rev, 'the list says which version it is as of');

  const labs = (await (await fetch(B + '/_lab/pages')).json()).pages;
  assert.ok(labs.some((p) => p.path === '/gallery/inspector' && p.open === 1), 'the page is listed though no HTML exists for it');
  assert.match((await cli('list')).out, /1 page, 1 waiting/);
  await cli('pages');
  assert.match(fs.readFileSync(path.join(DIR, '.lab/lab-pages.md'), 'utf8'), /gallery\/inspector/, 'labit pages lists it too');

  const handed = (await cli('wait', '--bg', '--timeout', '5')).out;
  assert.match(handed, /^component: Stepper$/m);
  assert.match(handed, /^written at: bridge\/crates\/ui\/src\/stepper\.rs:88\b/m);
  assert.match(handed, /^component used at: bridge\/app\/src\/board\.rs:120$/m);
  assert.match(handed, /Drawn by GPUI/);

  await cli('reply', comment.id, 'Gave it 4px more.', '--done');
  const after = (await list('/gallery/inspector')).comments;
  const answer = after.find((c) => c.parent === comment.id);
  assert.equal(answer.intent, 'done');
  assert.ok(answer.session, 'an agent reply says so with its session');
  assert.equal(after.find((c) => c.id === comment.id).resolved, true, 'done closes the thread');
});

test('reply, reopen, resolve and the changes since a rev work with no browser', async () => {
  const page = '/app';
  const { json: { comment, edit } } = await send({ page, name: 'Alex', text: 'spacing', anchor: { ...ANCHOR, selector: 'gpui:k2' } });
  const rev = (await list(page)).rev;
  assert.equal((await send({ page, parent: comment.id, name: 'Alex', text: 'and the colour' })).status, 201);
  const delta = await (await fetch(`${B}/_lab/api/changes?page=${page}&since=${rev}`)).json();
  assert.equal(delta.set.length, 1, 'only what changed since');
  assert.equal(delta.set[0].text, 'and the colour');
  assert.ok(delta.rev > Number(rev));

  assert.equal((await send({ page, action: 'resolve', id: comment.id })).status, 403, 'resolving takes the thread\'s key');
  const done = await send({ page, action: 'resolve', id: comment.id, edit });
  assert.equal(done.status, 200);
  assert.equal(done.json.comment.resolved, true);
  assert.equal((await send({ page, action: 'reopen', id: comment.id, edit })).json.comment.resolved, false);
});

test('a page from another site cannot post', async () => {
  const r = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ page: '/app', name: 'x', text: 'y' }) });
  assert.equal(r.status, 403);
});
