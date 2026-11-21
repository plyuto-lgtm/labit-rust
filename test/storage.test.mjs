// Where a local lab keeps its comments: one file per page in .lab/comments/, the old single comments.json moved over
// once, each page's list kept until it changes, and done threads a month old moved out to .lab/archive/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { LAB, H1 as anchor, claimPort, tmp, rm, spawnLab, sleep, up, serverJson } from './harness.mjs';

const dirs = [];
const running = new Set();
after(() => {
  for (const s of running) s.kill();
  rm(dirs);
});
const nextPort = () => claimPort(7100, 266); // clear of 5060 and 5061, which fetch refuses ("bad port")
const folder = () => {
  const d = tmp('storage');
  dirs.push(d);
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><h1>Hi</h1>');
  return d;
};
// A lab on the folder, once it answers; stop() ends it and waits for it to exit.
async function start(dir, env = {}) {
  const port = nextPort();
  const server = spawnLab(dir, port, { env: { ...process.env, PORT: String(port), ...env } });
  running.add(server);
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const B = `http://localhost:${port}`;
  await up(B + '/', { fail: false });
  const token = serverJson(dir).token;
  const post = (body, admin) =>
    fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...(admin ? { 'x-lab-admin': token } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
  const list = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${encodeURIComponent(page)}`, { headers: { 'accept-encoding': 'br' } })).json()).comments;
  const stop = () =>
    new Promise((resolve) => {
      server.once('exit', () => (running.delete(server), resolve()));
      server.kill('SIGTERM');
    });
  return { B, post, list, stop, log: () => log, alive: () => server.exitCode === null, agent: () => serverJson(dir).agent };
}

const until = async (check, what) => {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await sleep(50);
  }
  assert.fail(`timed out: ${what}`);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('each page has its own file; a comment rewrites only its page; a restart loads them all', async () => {
  const dir = folder();
  const lab = await start(dir);
  const fileA = path.join(dir, '.lab/comments/a.json');
  const fileB = path.join(dir, '.lab/comments/b.json');
  const a1 = (await lab.post({ page: '/a', name: 'Leo', text: 'one on a', anchor })).comment;
  const b1 = (await lab.post({ page: '/b', name: 'Leo', text: 'one on b', anchor })).comment;
  await until(() => fs.existsSync(fileA) && fs.existsSync(fileB), 'both page files written');
  assert.equal(readJson(fileB).page, '/b');
  assert.ok(readJson(fileB).comments[b1.id], 'the comment is in its page file');
  assert.ok(!fs.existsSync(path.join(dir, '.lab/comments.json')), 'no single file any more');
  // Each write is a new file put in place (write then rename), so an unchanged inode means b.json wasn't rewritten.
  const bBefore = fs.statSync(fileB).ino;
  const aBefore = fs.statSync(fileA).ino;
  const a2 = (await lab.post({ page: '/a', name: 'Leo', text: 'two on a', anchor })).comment;
  await until(() => readJson(fileA).comments[a2.id], 'a.json has the new comment');
  assert.notEqual(fs.statSync(fileA).ino, aBefore, 'a.json rewritten');
  assert.equal(fs.statSync(fileB).ino, bBefore, 'b.json left alone');
  // A page whose last comment is deleted has no file left.
  await lab.post({ page: '/b', action: 'delete', id: b1.id }, true);
  await until(() => !fs.existsSync(fileB), 'empty page file removed');

  await lab.stop();
  const again = await start(dir);
  const onA = await again.list('/a');
  assert.deepEqual(onA.map((c) => c.id).sort(), [a1.id, a2.id].sort(), 'both comments on /a back after a restart');
  assert.deepEqual(await again.list('/b'), []);
  await again.stop();
});

test('a lab with the old comments.json is not started over it: it says how to move it', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab'));
  fs.writeFileSync(path.join(dir, '.lab/comments.json'), '{}');
  const port = String(nextPort());
  const out = await new Promise((resolve) => execFile(process.execPath, [LAB, '.', '--no-open', '--port', port], { cwd: dir, env: { ...process.env, PORT: port } }, (err, o, e) => resolve({ code: err?.code ?? 0, text: o + e })));
  assert.notEqual(out.code, 0);
  assert.match(out.text, /labit@0\.6\.2/);
  assert.ok(!fs.existsSync(path.join(dir, '.lab/comments')), 'nothing started beside it');
});

test("a page's kept list is dropped when the page changes (new comment, reply, delete)", async () => {
  const dir = folder();
  const lab = await start(dir);
  const c1 = (await lab.post({ page: '/p', name: 'Leo', text: 'first', anchor })).comment;
  const one = await lab.list('/p');
  assert.deepEqual(await lab.list('/p'), one, 'asked again: the same list');
  const c2 = (await lab.post({ page: '/p', name: 'Leo', text: 'second', anchor })).comment;
  assert.deepEqual((await lab.list('/p')).map((c) => c.id), [c1.id, c2.id], 'the new comment shows');
  const r = (await lab.post({ page: '/p', parent: c1.id, name: 'Leo', text: 'a reply' })).comment;
  assert.ok((await lab.list('/p')).some((c) => c.id === r.id), 'the reply shows');
  await lab.post({ page: '/p', action: 'delete', id: c2.id }, true);
  assert.ok(!(await lab.list('/p')).some((c) => c.id === c2.id), 'the deleted comment is gone');
  // Another page's change leaves this one's list as it is, and is seen on its own page.
  await lab.post({ page: '/q', name: 'Leo', text: 'elsewhere', anchor });
  assert.equal((await lab.list('/q')).length, 1);
  assert.equal((await lab.list('/p')).length, 2);
  await lab.stop();
});

test('done threads with nothing new in 30 days are archived on start; open and recent ones stay', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.lab/archive'), { recursive: true });
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const c = (id, days, extra = {}) => ({ id, parent: null, name: 'Leo', text: `comment ${id}`, createdAt: ago(days), resolved: false, anchor, ...extra });
  const comments = {
    old: c('old', 60, { resolved: true }), // done, last message 50 days ago: archived with its reply
    oldReply: c('oldReply', 50, { parent: 'old', anchor: null }),
    recent: c('recent', 60, { resolved: true }), // done, but a reply 2 days ago: stays
    recentReply: c('recentReply', 2, { parent: 'recent', anchor: null }),
    open: c('open', 90), // open, however old: stays
    fresh: c('fresh', 5, { resolved: true }), // done 5 days ago: stays
  };
  fs.writeFileSync(path.join(dir, '.lab/comments/h.json'), JSON.stringify({ page: '/h', comments }));
  // An archive already there is added to, not replaced.
  fs.writeFileSync(path.join(dir, '.lab/archive/h.json'), JSON.stringify({ page: '/h', comments: { before: c('before', 100, { resolved: true }) } }));
  const lab = await start(dir);
  const live = (await lab.list('/h')).map((x) => x.id).sort();
  assert.deepEqual(live, ['fresh', 'open', 'recent', 'recentReply'], 'the old done thread is no longer sent');
  const archived = readJson(path.join(dir, '.lab/archive/h.json'));
  assert.equal(archived.page, '/h');
  assert.deepEqual(Object.keys(archived.comments).sort(), ['before', 'old', 'oldReply'], 'archived next to what was there');
  assert.deepEqual(Object.keys(readJson(path.join(dir, '.lab/comments/h.json')).comments).sort(), ['fresh', 'open', 'recent', 'recentReply'], 'the page file no longer has it');
  assert.match(lab.log(), /archived 1 done thread/);
  await lab.stop();
});

test('an older page file loads unchanged in meaning: replies lose resolved:false, agent replies get their intent, the rule fields are one, hand-off marks move beside the comments, the file is written in the new shape without being touched', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  const now = new Date().toISOString();
  const comments = {
    t1: { id: 't1', parent: null, name: 'Leo', text: 'red', createdAt: now, resolved: true, resolvedBy: 'agent', anchor, deliveredAt: now, deliveredTo: 'sess-a', handedAt: now, remindedAt: now },
    r1: { id: 'r1', parent: 't1', name: 'Claude', text: 'Done: red', createdAt: now, resolved: false, anchor: null, session: { agent: 'claude' }, suggest: 'Say where', suggestDone: 'kept', rule: 'Say where' },
    r2: { id: 'r2', parent: 't1', name: 'Claude', text: 'On it', createdAt: now, resolved: false, anchor: null, session: { agent: 'claude' }, suggest: 'Shorter', suggestDone: 'no' },
    r3: { id: 'r3', parent: 't1', name: 'Leo', text: 'Done: thanks', createdAt: now, resolved: false, anchor: null, from: 'this computer', deliveredAt: now },
    r4: { v: 1, id: 'r4', parent: 't1', name: 'Claude', text: 'Done', createdAt: now, anchor: null, session: { agent: 'claude' }, rule: 'Link it', ruleUndone: true },
    r5: { v: 1, id: 'r5', parent: 't1', name: 'Claude', text: 'Which one?', createdAt: now, anchor: null, session: { agent: 'claude' }, suggest: 'Ask less' },
    w1: { id: 'w1', parent: null, name: 'Leo', text: 'this word', createdAt: now, resolved: false, anchor: { ...anchor, selector: 'body', element: '<body>', text: '…some words [here] after it…' } },
  };
  fs.writeFileSync(path.join(dir, '.lab/comments/x.json'), JSON.stringify({ page: '/x', comments }));
  const lab = await start(dir);
  const got = Object.fromEntries((await lab.list('/x')).map((c) => [c.id, c]));
  assert.equal(got.t1.resolved, true, 'a thread keeps its state');
  assert.equal(got.t1.resolvedBy, 'agent');
  assert.equal(got.t1.v, 2);
  assert.equal('resolved' in got.r1, false, 'a reply has no resolved state');
  assert.equal(got.r1.intent, 'done', "the agent's Done, read from its words");
  assert.equal(got.r2.intent, 'working');
  assert.equal(got.r3.intent, undefined, "a person's words never become an intent");
  assert.equal(got.r4.intent, 'done', 'an answer saved in v1 without one gets it too');
  assert.deepEqual([got.r1.suggest, got.r2.suggest, got.r4.suggest, got.r5.suggest], [{ text: 'Say where', state: 'kept' }, { text: 'Shorter', state: 'no' }, { text: 'Link it', state: 'undone' }, { text: 'Ask less' }], 'a rule offered, kept, refused or taken back is one field');
  for (const k of ['suggestDone', 'rule', 'ruleUndone', 'deliveredAt', 'deliveredTo', 'remindedAt']) assert.equal(Object.values(got).some((c) => k in c), false, `${k} is gone from the comments`);
  assert.equal(got.t1.handedAt, now, 'a thread still says when the agent got it');
  assert.deepEqual(got.w1.anchor.quote, { exact: 'here', prefix: 'some words ', suffix: ' after it' }, 'a word pin from before quotes has its word as a quote');
  await until(() => readJson(path.join(dir, '.lab/comments/x.json')).v === 2, 'the file written in the new shape once the lab is up');
  await until(() => fs.existsSync(path.join(dir, '.lab/state.json')), 'the marks saved beside the comments');
  assert.deepEqual(readJson(path.join(dir, '.lab/state.json')).handed, { t1: [now, 'sess-a', now], r3: [now, null] });
  // The marks still mean what they meant: nothing here is new to a wait.
  const server = readJson(path.join(dir, '.lab/server.json'));
  const wait = await fetch(lab.B + '/_lab/wait', { method: 'POST', headers: { 'content-type': 'application/json', origin: lab.B, 'x-lab-admin': server.agent, 'x-lab-agent': '1' }, body: JSON.stringify({ timeout: 1 }) });
  assert.match(await wait.text(), /this word/, 'the pin never handed over comes');
  assert.doesNotMatch(await (await fetch(lab.B + '/_lab/wait', { method: 'POST', headers: { 'content-type': 'application/json', origin: lab.B, 'x-lab-admin': server.agent, 'x-lab-agent': '1' }, body: JSON.stringify({ timeout: 1 }) })).text(), /Done: thanks|this word/, 'what was handed over before the move does not come again');
  await lab.stop();
});

test("a page's comments follow its file when it is renamed or moved, while the lab is stopped or running", async () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'pricing.html'), '<!doctype html><h1>Pricing</h1>');
  let lab = await start(dir);
  const { comment } = await lab.post({ page: '/pricing', name: 'Leo', text: 'cheaper', anchor });
  await until(() => readJson(path.join(dir, '.lab/comments/pricing.json')).fid, 'the page file says which file it is');
  assert.equal(readJson(path.join(dir, '.lab/comments/pricing.json')).file, 'pricing.html');
  await lab.stop();
  // Renamed while the lab is stopped.
  fs.mkdirSync(path.join(dir, 'plans'));
  fs.renameSync(path.join(dir, 'pricing.html'), path.join(dir, 'plans', 'prices.html'));
  lab = await start(dir);
  assert.deepEqual((await lab.list('/plans/prices')).map((c) => c.id), [comment.id], 'the comments are on the page under its new name');
  assert.equal((await lab.list('/pricing')).length, 0);
  await until(() => !fs.existsSync(path.join(dir, '.lab/comments/pricing.json')) && fs.existsSync(path.join(dir, '.lab/comments/plans_2fprices.json')), 'the store follows');
  // Renamed while it runs.
  fs.renameSync(path.join(dir, 'plans', 'prices.html'), path.join(dir, 'plans', 'tiers.html'));
  let moved = [];
  for (let i = 0; i < 60 && !moved.length; i++) {
    await sleep(100);
    moved = await lab.list('/plans/tiers');
  }
  assert.deepEqual(moved.map((c) => c.id), [comment.id], 'and again while the lab runs');
  // A copy is another file: nothing follows it, and deleting a page leaves its comments where they were.
  fs.copyFileSync(path.join(dir, 'plans', 'tiers.html'), path.join(dir, 'copy.html'));
  fs.rmSync(path.join(dir, 'plans', 'tiers.html'));
  await sleep(600);
  assert.equal((await lab.list('/copy')).length, 0);
  assert.equal((await lab.list('/plans/tiers')).length, 1);
  await lab.stop();
});

test("a page commented after the first one follows its file too: renamed, renamed again, moved into a folder, running or stopped", async () => {
  const dir = folder();
  for (const n of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, `${n}.html`), `<!doctype html><h1>${n}</h1>`);
  let lab = await start(dir);
  await lab.post({ page: '/two', name: 'Leo', text: 'on two', anchor });
  const { comment: one } = await lab.post({ page: '/one', name: 'Leo', text: 'on one', anchor });
  await lab.post({ page: '/one', name: 'Leo', text: 'reply', parent: one.id });
  const { comment: three } = await lab.post({ page: '/three', name: 'Leo', text: 'on three', anchor });
  const follows = async (page, n, gone) => {
    let got = [];
    for (let i = 0; i < 60 && got.length < n; i++) {
      await sleep(100);
      got = await lab.list(page);
    }
    assert.equal(got.length, n, `${n} comments followed the file to ${page}`);
    assert.equal((await lab.list(gone)).length, 0, `${gone} has none left`);
  };
  // Running: renamed at once, though /one was not the first page commented.
  fs.renameSync(path.join(dir, 'one.html'), path.join(dir, 'renamed.html'));
  await follows('/renamed', 2, '/one');
  // And again (a chain).
  fs.renameSync(path.join(dir, 'renamed.html'), path.join(dir, 'again.html'));
  await follows('/again', 2, '/renamed');
  // Stopped: renamed and moved into a folder, then started.
  await lab.stop();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.renameSync(path.join(dir, 'again.html'), path.join(dir, 'sub', 'again.html'));
  fs.renameSync(path.join(dir, 'three.html'), path.join(dir, 'third.html'));
  lab = await start(dir);
  await follows('/sub/again', 2, '/again');
  await follows('/third', 1, '/three');
  assert.deepEqual((await lab.list('/third')).map((c) => c.id), [three.id]);
  assert.equal((await lab.list('/two')).length, 1, 'a page that did not move keeps its comment');
  await lab.stop();
});

test('a done thread is archived a month after it was resolved, not after its last message', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const comments = {
    late: { id: 'late', parent: null, name: 'Leo', text: 'old ask', createdAt: ago(90), resolved: true, resolvedAt: ago(3), anchor }, // resolved 3 days ago: stays
    early: { id: 'early', parent: null, name: 'Leo', text: 'old ask', createdAt: ago(90), resolved: true, resolvedAt: ago(60), anchor }, // resolved 60 days ago: archived
  };
  fs.writeFileSync(path.join(dir, '.lab/comments/k.json'), JSON.stringify({ page: '/k', comments }));
  const lab = await start(dir);
  assert.deepEqual((await lab.list('/k')).map((x) => x.id), ['late']);
  assert.deepEqual(Object.keys(readJson(path.join(dir, '.lab/archive/k.json')).comments), ['early']);
  await lab.stop();
});

test('state.json: a damaged one is put aside, not read as empty and written over; saves go whole', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab'));
  fs.writeFileSync(path.join(dir, '.lab/state.json'), '{"reads":{"leo":{"/index":["a"');
  const lab = await start(dir);
  const names = () => fs.readdirSync(path.join(dir, '.lab'));
  const broken = names().find((n) => n.startsWith('state.json.broken-'));
  assert.ok(broken, names().join(' '));
  assert.equal(fs.readFileSync(path.join(dir, '.lab', broken), 'utf8'), '{"reads":{"leo":{"/index":["a"', 'kept as it was');
  const c = (await lab.post({ page: '/index', name: 'Leo', text: 'mark me', anchor })).comment;
  await fetch(lab.B + '/_lab/api/reads', { method: 'POST', headers: { 'content-type': 'application/json', origin: lab.B }, body: JSON.stringify({ name: 'Leo', page: '/index', ids: [c.id] }) });
  await until(() => fs.existsSync(path.join(dir, '.lab/state.json')) && readJson(path.join(dir, '.lab/state.json')).reads?.leo, 'read marks saved');
  assert.deepEqual(readJson(path.join(dir, '.lab/state.json')).reads, { leo: { '/index': [c.id] } });
  assert.ok(!names().some((n) => n.endsWith('.tmp')), 'no half-written file left');
  await lab.stop();
});

test('the state files of before 19 Nov go into state.json and are removed; .lab gets its own .gitignore', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab'));
  const at = Date.now();
  fs.writeFileSync(path.join(dir, '.lab/name'), 'Old topic\n');
  fs.writeFileSync(path.join(dir, '.lab/reads.json'), JSON.stringify({ leo: { '/index': ['a'] } }));
  fs.writeFileSync(path.join(dir, '.lab/archived.json'), JSON.stringify({ '/old': '2026-11-18T10:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, '.lab/claims.json'), JSON.stringify({ '/index': at }));
  fs.writeFileSync(path.join(dir, '.lab/opened.json'), JSON.stringify({ '/index': '2026-11-18T10:00:00.000Z' }));
  const lab = await start(dir);
  await until(() => fs.existsSync(path.join(dir, '.lab/state.json')), 'state.json written at start');
  const state = readJson(path.join(dir, '.lab/state.json'));
  assert.equal(state.name, 'Old topic');
  assert.deepEqual(state.reads, { leo: { '/index': ['a'] } });
  assert.deepEqual(state.archived, { '/old': '2026-11-18T10:00:00.000Z' });
  assert.deepEqual(state.claims, { '/index': at });
  for (const f of ['name', 'reads.json', 'archived.json', 'claims.json', 'opened.json']) assert.ok(!fs.existsSync(path.join(dir, '.lab', f)), `${f} removed`);
  assert.equal(fs.readFileSync(path.join(dir, '.lab/.gitignore'), 'utf8'), '*\n');
  await lab.stop();
});

// A question with choices and the pick on it are only added fields: a page file with them loads as it was written,
// version 2, with nothing to upgrade, and is not rewritten into another shape.
test('choices and a pick load unchanged, v stays 2', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  const now = new Date().toISOString();
  const comments = {
    t1: { v: 2, id: 't1', parent: null, name: 'Leo', text: 'tone?', createdAt: now, resolved: false, anchor: { ...anchor, kind: 'text', quote: { exact: 'here', prefix: 'some words ', suffix: ' after it' } } },
    q1: { v: 2, id: 'q1', parent: 't1', name: 'Claude', text: 'Which?', createdAt: now, anchor: null, session: { agent: 'claude' }, intent: 'question', choices: ['here', 'there', 'over there'], recommend: 1 },
    p1: { v: 2, id: 'p1', parent: 't1', to: 'q1', name: 'Leo', text: 'Picked B: there', createdAt: now, anchor: null, from: 'this computer', picked: { of: 'q1', n: 1 } },
  };
  fs.writeFileSync(path.join(dir, '.lab/comments/x.json'), JSON.stringify({ page: '/x', comments }));
  const lab = await start(dir);
  const got = Object.fromEntries((await lab.list('/x')).map((c) => [c.id, c]));
  assert.deepEqual([got.q1.choices, got.q1.recommend, got.q1.intent, got.q1.v], [['here', 'there', 'over there'], 1, 'question', 2]);
  assert.deepEqual([got.p1.picked, got.p1.to, got.p1.v], [{ of: 'q1', n: 1 }, 'q1', 2]);
  assert.equal(got.t1.v, 2);
  await lab.stop();
  const saved = readJson(path.join(dir, '.lab/comments/x.json')).comments;
  assert.deepEqual(saved.q1.choices, ['here', 'there', 'over there'], 'still there when the file is written again');
  assert.deepEqual(saved.p1.picked, { of: 'q1', n: 1 });
});

// A write that fails (a full disk, a folder gone read-only) is played here by a folder standing where the lab's
// temporary file goes: the write throws, as it would with no space left.
test('a save that fails is tried again until it works, and the comment is there after a restart', async () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'a.html'), '<!doctype html><h1>A</h1>');
  const lab = await start(dir, { LAB_SAVE_RETRY_MS: '200' });
  const file = path.join(dir, '.lab/comments/a.json');
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  fs.mkdirSync(file + '.tmp');
  const { comment } = await lab.post({ page: '/a', name: 'Leo', text: 'kept through a failed save', anchor });
  assert.ok(comment?.id, 'the comment is taken');
  await until(() => /could not save comments/.test(lab.log()), 'the lab says the save failed');
  await lab.post({ page: '/index', name: 'Leo', text: 'another page saves meanwhile', anchor });
  await until(() => fs.existsSync(path.join(dir, '.lab/comments/index.json')), 'the other page is written');
  assert.ok(!fs.existsSync(file), 'not written yet');
  fs.rmdirSync(file + '.tmp'); // the disk has room again
  await until(() => fs.existsSync(file), 'the failed page is written by the retry, with no new comment to trigger it');
  await lab.stop();
  const again = await start(dir);
  assert.deepEqual((await again.list('/a')).map((c) => c.text), ['kept through a failed save']);
  await again.stop();
});

test('a wait while server.json cannot be written is answered, and the lab keeps running', async () => {
  const dir = folder();
  const lab = await start(dir);
  fs.mkdirSync(path.join(dir, '.lab/server.json.tmp'));
  const res = await fetch(lab.B + '/_lab/wait', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': lab.agent(), 'x-lab-agent': '1' }, body: JSON.stringify({ timeout: 1, pages: null }) });
  assert.equal(res.status, 204, 'the wait runs out as usual');
  await sleep(300);
  assert.ok(lab.alive(), 'the lab is still running');
  assert.equal((await fetch(lab.B + '/')).status, 200);
  assert.match(lab.log(), /could not write/);
  fs.rmdirSync(path.join(dir, '.lab/server.json.tmp'));
  await lab.stop();
});

test("a renamed page takes its board along (its of, the frames that are the page, its pins) and what people had read stays read", async () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'pricing.html'), '<!doctype html><h1>Pricing</h1>');
  const lab = await start(dir);
  const own = { 'content-type': 'application/json', origin: lab.B };
  const put = (name, body) => fetch(`${lab.B}/_lab/api/board?name=${name}&page=/pricing`, { method: 'PUT', headers: own, body: JSON.stringify(body) });
  const board = async (name) => (await fetch(`${lab.B}/_lab/api/board?name=${name}`)).json();
  assert.equal((await put('pb', { frames: [{ id: 'a', src: '/pricing', w: 1440, h: 900 }, { id: 'b', src: '/pricing', w: 390, h: 844, label: 'phone' }, { id: 'c', src: '/cart', w: 800, h: 600 }], of: '/pricing#hero' })).status, 200);
  const { comment } = await lab.post({ page: '/pricing', name: 'Leo', text: 'tighter on the phone', anchor: { kind: 'board', board: 'pb', frame: 'b', fx: 10, fy: 20, bx: 10, by: 20, selector: '', x: 0, y: 0, docX: 0, docY: 0, width: 1000 } });
  await fetch(`${lab.B}/_lab/api/reads`, { method: 'POST', headers: own, body: JSON.stringify({ name: 'Leo', page: '/pricing', ids: [comment.id] }) });
  await lab.post({ page: '/pricing', name: 'Leo', text: 'warm', anchor }); // (the page's file must say which file it is)
  await until(() => readJson(path.join(dir, '.lab/comments/pricing.json')).fid, 'the page file says which file it is');
  await fetch(`${lab.B}/_lab/pages`).catch(() => {}); // opens the page list
  assert.equal((await board('pb')).home, '/pricing', 'the board lives on its page');
  fs.mkdirSync(path.join(dir, 'plans'));
  fs.renameSync(path.join(dir, 'pricing.html'), path.join(dir, 'plans', 'prices.html'));
  let moved = [];
  for (let i = 0; i < 60 && !moved.length; i++) {
    await sleep(100);
    moved = await lab.list('/plans/prices');
  }
  assert.ok(moved.some((c) => c.id === comment.id), 'its pins went with it');
  const now = await board('pb');
  assert.equal(now.of, '/plans/prices#hero', 'the board is about the page under its new name (the #hero kept)');
  assert.deepEqual(now.frames.map((f) => f.src), ['/plans/prices', '/plans/prices', '/cart'], 'the frames that were the page are the page again; another page stays');
  assert.equal(now.home, '/plans/prices', 'it opens over its page, with its pins');
  const readsOf = async (page) => (await (await fetch(`${lab.B}/_lab/api/reads?name=Leo&page=${encodeURIComponent(page)}`)).json()).ids || [];
  assert.ok((await readsOf('/plans/prices')).includes(comment.id), 'what was read is read on the new page');
  assert.deepEqual(await readsOf('/pricing'), [], 'and nothing is left under the old name');
  const stateFile = path.join(dir, '.lab/state.json');
  await until(() => fs.existsSync(stateFile) && readJson(stateFile).reads?.leo?.['/plans/prices']?.includes(comment.id) && !readJson(stateFile).reads.leo['/pricing'], 'the state says so too (saved, the old key dropped)');
  await lab.stop();
});
