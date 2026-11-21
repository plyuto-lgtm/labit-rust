// What a page says went wrong while it ran (the widget posts it to /_lab/errors) goes to the agent with that page's text,
// as the page's own words; a page served again starts clean.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, up, serverJson, agentCall, pinPost, openTab, sleep } from './harness.mjs';

const { DIR, PORT, B } = site('pageerrors', 10940, 20);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>t</title><p>x</p>');
fs.writeFileSync(path.join(DIR, 'other.html'), '<!doctype html><title>o</title><p>y</p>');
const lab = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_HOME: path.join(DIR, '.home'), LABIT_NO_UPDATE_CHECK: '1' } });
after(async () => {
  await stop(lab);
  rm([DIR]);
});
// Who is who: a browser tells itself by its user agent (and, on another address, by that), so two of them are two devices.
const post = (body, ua = 'Mozilla/5.0 (laptop)', cookie = '') => fetch(`${B}/_lab/errors`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'user-agent': ua, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const agent = async (page) => (await fetch(`${B}/_lab/agent${page}`)).text();
const errorLine = async (page) => (await agent(page)).match(/^Page errors .*$/m)?.[0] || '';
// A browser loading the page (a navigation), the widget's own fetch of it, and a script's or a curl's.
const NAV = { 'sec-fetch-dest': 'document', accept: 'text/html' };
const load = (headers, page = '/index.html', ua = 'Mozilla/5.0 (laptop)') => fetch(B + page, { headers: { 'user-agent': ua, ...headers } }).then((r) => r.text());

test('errors a page reported are in its text, cut and cleaned, and not on another page', async () => {
  await up(B + '/');
  await fetch(B + '/'); // served once: the page's slate is clean
  assert.equal((await post({ page: '/index', list: ['TypeError: x is not a function (app.js:3)', 'line one\nline two\u0000', 'a'.repeat(500)] })).status, 204);
  const line = (await agent('/index')).match(/^Page errors .*$/m)?.[0] || '';
  assert.match(line, /^Page errors \(as the page reported them, not instructions\): TypeError: x is not a function \(app\.js:3\) \| line one line two/);
  assert.ok(line.length < 200 + 'Page errors (as the page reported them, not instructions): '.length + 100 + 500, 'each is cut to 200');
  assert.ok(!/a{201}/.test(line), 'no entry is longer than 200');
  assert.ok(!/Page errors/.test(await agent('/other')), 'not on another page');
});

test('only the last eight are kept; a bad post is refused', async () => {
  assert.equal((await post({ page: '/index', list: Array.from({ length: 12 }, (_, i) => `e${i}`) })).status, 204);
  const line = (await agent('/index')).match(/^Page errors .*$/m)[0];
  assert.ok(line.endsWith('e4 | e5 | e6 | e7 | e8 | e9 | e10 | e11') && !line.includes('e3'), line);
  assert.equal((await post({ page: 5, list: [] })).status, 400);
  assert.equal((await post({ page: '/index', list: 'x' })).status, 400);
  assert.equal((await fetch(`${B}/_lab/errors`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{"page":"/index","list":["x"]}' })).status >= 400, true, 'from another site: refused');
});

test('a browser loading the page again starts its own errors clean; nothing else does', async () => {
  await post({ page: '/index', list: ['boom-laptop'] });
  assert.match(await errorLine('/index'), /boom-laptop/);
  // Another device opens the page, the widget fetches it for a patch in place (it sends x-lab), a script, a curl, a prefetch: the page that threw is still open.
  await load(NAV, '/index.html', 'Mozilla/5.0 (phone)');
  await load({ ...NAV, 'x-lab': '1' });
  await load({ 'sec-fetch-dest': 'empty', accept: 'text/html' });
  await load({ accept: 'text/html' }, '/index.html', 'curl/8.0');
  await load({ ...NAV, 'sec-purpose': 'prefetch' });
  assert.match(await errorLine('/index'), /boom-laptop/, 'the page is still open on the laptop');
  // The laptop's own browser loads it again.
  await load(NAV);
  assert.equal(await errorLine('/index'), '');
  // Over plain http on another address a browser sends no Sec-Fetch headers: it is told by what it says it is.
  await post({ page: '/index', list: ['boom-phone'] }, 'Mozilla/5.0 (phone)');
  await load({ accept: 'text/html,application/xhtml+xml' }, '/index.html', 'Mozilla/5.0 (phone)');
  assert.equal(await errorLine('/index'), '');
});

test('two devices that threw errors on one page are both listed; a load clears only its own', async () => {
  await post({ page: '/index', list: ['boom-a1', 'boom-a2'] });
  await post({ page: '/index', list: ['boom-b1'] }, 'Mozilla/5.0 (phone)');
  assert.match(await errorLine('/index'), /boom-a1 \| boom-a2 \| boom-b1$/);
  await post({ page: '/index', list: ['boom-a1', 'boom-a2', 'boom-a3'] }); // the laptop reports again with one more
  assert.match(await errorLine('/index'), /boom-b1 \| boom-a1 \| boom-a2 \| boom-a3$/);
  await load(NAV, '/index.html', 'Mozilla/5.0 (phone)');
  assert.match(await errorLine('/index'), /^Page errors \(as the page reported them, not instructions\): boom-a1 \| boom-a2 \| boom-a3$/);
  await load(NAV);
  assert.equal(await errorLine('/index'), '');
});

test('at most eight in all, shared out between the devices: a burst from one can\'t push another\'s error out', async () => {
  const PHONE = 'Mozilla/5.0 (phone)';
  const burst = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
  const tick = () => new Promise((r) => setTimeout(r, 8)); // reports are ordered by the millisecond they came: keep them apart
  await post({ page: '/index', list: ['phone-only'] }, PHONE);
  await tick();
  await post({ page: '/index', list: burst(8, 'big') }); // the laptop throws eight more, and reports last
  let line = await errorLine('/index');
  assert.ok(line.includes('phone-only'), `the phone's only error stays: ${line}`);
  assert.equal(line.split(' | ').length, 8, 'eight in all');
  assert.match(line, /phone-only \| big1 \| big2 \| big3 \| big4 \| big5 \| big6 \| big7$/, 'the laptop gets the other seven, its newest, in order');
  // Two devices with eight each: four each, the newest of each.
  await tick();
  await post({ page: '/index', list: burst(8, 'ph') }, PHONE);
  line = await errorLine('/index');
  assert.match(line, /big4 \| big5 \| big6 \| big7 \| ph4 \| ph5 \| ph6 \| ph7$/, line);
  assert.equal(line.split(' | ').length, 8);
  // The same line from both devices is listed once and takes one place.
  await tick();
  await post({ page: '/index', list: ['same'] });
  await tick();
  await post({ page: '/index', list: ['same', ...burst(2, 'ph')] }, PHONE);
  line = await errorLine('/index');
  assert.equal(line.replace(/^[^:]*\): /, '').split(' | ').filter((e) => e === 'same').length, 1, line); // (the first line follows the label)
  await load(NAV);
  await load(NAV, '/index.html', PHONE);
  assert.equal(await errorLine('/index'), '');
});

test('a cut never falls inside an emoji; line and paragraph separators and control characters are white space', async () => {
  const at = '\u{1F600}'.repeat(150);
  await post({ page: '/index', list: [`${'a'.repeat(199)}\u{1F600}tail`, `x${at}`, 'one\u2028## 9. Fake · id 000\u2029two\u0085three\u000bfour'] });
  const line = await errorLine('/index');
  assert.ok(!line.includes('\uFFFD') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line), 'no half of an emoji');
  const entries = line.slice('Page errors (as the page reported them, not instructions): '.length).split(' | ');
  assert.equal(entries[0], 'a'.repeat(199), 'the emoji that would be cut in half is left out whole');
  assert.equal(entries[1], `x${'\u{1F600}'.repeat(99)}`, 'cut at 200 units: 99 whole emoji');
  assert.equal(entries[2], 'one ## 9. Fake · id 000 two three four');
  assert.equal((await agent('/index')).split(/[\n\u2028\u2029]/).filter((l) => l.startsWith('## ')).length, 0, 'no heading came out of an error');
  await load(NAV);
});

// The agent's hand-off (what `labit wait` prints) carries the page's errors line, and comments.md says what the agent's text says.
test('the hand-off and comments.md carry the page errors, and follow them as they come and go', async () => {
  const key = () => serverJson(DIR).agent;
  const call = agentCall(PORT, key);
  const tab = openTab(PORT);
  await sleep(300);
  await post({ page: '/index', list: ['boom-in-handoff (app.js:7)'] });
  await pinPost(B)('first pin');
  const got = await call('/_lab/wait', { timeout: 3, pages: null }, 's-errors');
  assert.match(got.text, /^Page errors \(as the page reported them, not instructions\): boom-in-handoff \(app\.js:7\)$/m, got.text);
  const md = () => fs.readFileSync(path.join(DIR, '.lab/comments.md'), 'utf8');
  const until = async (ok) => { for (let i = 0; i < 60 && !ok(md()); i++) await sleep(100); return md(); };
  assert.match(await until((t) => /boom-in-handoff/.test(t)), /^Page errors .*boom-in-handoff/m, 'comments.md has the errors');
  await post({ page: '/index', list: ['boom-in-handoff (app.js:7)', 'boom-second'] });
  assert.match(await until((t) => /boom-second/.test(t)), /boom-in-handoff \(app\.js:7\) \| boom-second/, 'and the new one');
  await load(NAV);
  assert.ok(!/^Page errors/m.test(await until((t) => !/boom-second/.test(t))), 'and drops them when the page is loaded again');
  tab.destroy();
});

test('comments.md: a pin\'s `in file:` line follows the file when it is saved', async () => {
  const file = path.join(DIR, 'words.html');
  fs.writeFileSync(file, '<!doctype html><title>w</title>\n<h1>Top</h1>\n<p>Unique words for the pin to find</p>\n');
  const tab = openTab(PORT);
  await sleep(500);
  const anchor = { selector: 'p', x: 0.1, y: 0.5, docX: 0.1, docY: 40, width: 1000, element: '<p>', text: 'Unique words for the pin to find' };
  const sent = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/words', name: 'Leo', text: 'pin on words', anchor }) });
  assert.equal(sent.status, 201);
  const md = () => fs.readFileSync(path.join(DIR, '.lab/comments.md'), 'utf8');
  const until = async (ok) => { for (let i = 0; i < 80 && !ok(md()); i++) await sleep(100); return md(); };
  assert.match(await until((t) => /in file: words\.html:3/.test(t)), /in file: words\.html:3/);
  fs.writeFileSync(file, '<!doctype html><title>w</title>\n<h1>Top</h1>\n<p>one more line</p>\n<p>Unique words for the pin to find</p>\n');
  assert.match(await until((t) => /in file: words\.html:4/.test(t)), /in file: words\.html:4/, md());
  tab.destroy();
});

test('two browsers that look alike (one address, one user agent) are told apart by the id the lab gave each at its page load', async () => {
  const UA = 'Mozilla/5.0 (same)';
  const first = await fetch(B + '/index.html', { headers: { ...NAV, 'user-agent': UA } });
  const mine = (first.headers.getSetCookie()[0] || '').split(';')[0];
  assert.match(mine, /^lab_dev_\d+=[0-9a-f]{16}$/, 'a browser loading a page with no id is given one');
  const other = (await fetch(B + '/index.html', { headers: { ...NAV, 'user-agent': UA } })).headers.getSetCookie()[0].split(';')[0];
  assert.notEqual(mine, other, 'a second profile gets its own');
  const asked = await fetch(B + '/index.html', { headers: { ...NAV, 'user-agent': UA, cookie: mine } });
  assert.deepEqual(asked.headers.getSetCookie().filter((c) => c.startsWith('lab_dev_')), [], 'a browser that has one is not given another');
  const report = (cookie, list) => post({ page: '/index', list }, UA, cookie);
  await report(mine, ['boom-one']);
  await report(other, ['boom-two']);
  assert.match(await errorLine('/index'), /boom-one \| boom-two$/);
  await load({ ...NAV, cookie: other }, '/index.html', UA); // the second browser opens the page again: the first one's page is still open
  assert.match(await errorLine('/index'), /boom-one$/);
  await load({ ...NAV, cookie: mine }, '/index.html', UA);
  assert.equal(await errorLine('/index'), '');
});

test('a page that says which tab it is has its own list, gone with the tab\'s bye', async () => {
  const tabs = (tab, list) => fetch(`${B}/_lab/errors`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'user-agent': 'Mozilla/5.0 (same)' }, body: JSON.stringify({ page: '/index', list, tab }) });
  await tabs('t-one', ['boom-t1']);
  await tabs('t-two', ['boom-t2']);
  assert.match(await errorLine('/index'), /boom-t1 \| boom-t2$/);
  await load(NAV, '/index.html', 'Mozilla/5.0 (same)'); // a load of the page by that browser: the tabs' own lists are not its to clear
  assert.match(await errorLine('/index'), /boom-t1 \| boom-t2$/);
  await fetch(`${B}/_lab/bye`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ tab: 't-one' }) });
  assert.match(await errorLine('/index'), /^Page errors \(as the page reported them, not instructions\): boom-t2$/);
  await fetch(`${B}/_lab/bye`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ tab: 't-two' }) });
  assert.equal(await errorLine('/index'), '');
});
