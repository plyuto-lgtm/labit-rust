// The widget's live connection in real browsers (WebKit and Chrome's engine): one stream, kept in the background (a
// comment shows there at once), opened again when it goes quiet (no beat for 40 s), a bye when the page goes away (a
// listening agent hears the page closed); and 8 tabs of one lab sharing one stream, handed to another tab when the
// one holding it leaves, every tab getting each comment without a reload.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/connection.mjs (needs playwright;
// NODE_PATH can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-conn-');
const PORT = String(claimPort(5960, 30));
const B = `http://localhost:${PORT}`;
// A 1 s grace: once every page is gone, a listening agent's wait ends after a second.
const env = labEnv({ LAB_CLOSE_GRACE: '1' }, { settings: false });
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>c</title><h1 id="t">Connection</h1><p>text</p>');
const server = startLab(DIR, env, { root: '.', port: PORT });
await labUp(B);
const until = async (ok, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await ok()) return true;
  return false;
};
// Every EventSource the page makes, and whether it was closed.
const trackStreams = () => {
  const ES = window.EventSource;
  window.__streams = [];
  window.EventSource = class extends ES {
    constructor(...a) {
      super(...a);
      window.__streams.push(this);
    }
  };
};
const setHidden = (hidden) => {
  for (const [k, v] of [['hidden', hidden], ['visibilityState', hidden ? 'hidden' : 'visible']]) Object.defineProperty(document, k, { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
};
const post = (text) =>
  fetch(B + '/_lab/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { selector: '#t', x: 0.2, y: 0.5, docX: 0.2, docY: 20, width: 1000, element: '<h1 id="t">' } }),
  }).then((r) => r.json());

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      // ---- one tab: its stream through the background, front, a stall and leaving ----
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      await ctx.addInitScript(trackStreams);
      const p = await ctx.newPage();
      const seen = { live: 0, state: 0 };
      p.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname === '/_lab/live') seen.live++;
        if (u.pathname === '/_lab/state') seen.state++;
      });
      await p.clock.install();
      await p.goto(B + '/');
      await until(() => p.evaluate(() => window.__streams.length === 1 && window.__streams[0].readyState === 1));
      await sleep(250);
      const streams = () => p.evaluate(() => window.__streams.map((s) => s.readyState)); // 0 connecting, 1 open, 2 closed
      check(eng, 'one live stream, open', JSON.stringify(await streams()) === '[1]' && seen.live === 1, `${JSON.stringify(await streams())}, ${seen.live} requests`);

      await p.evaluate(setHidden, true);
      await p.clock.runFor(90000);
      await sleep(250);
      check(eng, 'in the background the stream stays open, no polling', JSON.stringify(await streams()) === '[1]' && seen.state === 0, `${JSON.stringify(await streams())}, ${seen.state} polls`);
      const pinsOf = (t) => t.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelectorAll('.pin').length ?? -1);
      const hiddenBefore = await pinsOf(p);
      await post(`while hidden in ${eng}`);
      check(eng, 'a comment made while it is in the background shows there at once', await until(async () => (await pinsOf(p)) === hiddenBefore + 1, 4000));
      await p.evaluate(setHidden, false);
      await sleep(250);
      check(eng, 'back in front: the same stream, no reconnect', JSON.stringify(await streams()) === '[1]' && seen.live === 1, JSON.stringify(await streams()));

      // The server's beat comes every 15 s of real time; 46 s of page time with none looks like a stalled connection.
      await p.clock.runFor(46000);
      await until(async () => (await streams()).length === 2 && (await streams())[1] === 1);
      const st = await streams();
      check(eng, 'a stream quiet for 40 s is replaced, never two open at once', st.length === 2 && st.filter((x) => x === 1).length === 1, JSON.stringify(st));

      // Leaving says bye, so the lab stops counting the tab and a listening agent's wait ends after the grace.
      // (Checked by what it does: Playwright doesn't report Chrome's last request from a page being left.)
      const agentWait = (s) => new Promise((r) => execFile(process.execPath, [LAB, 'wait', '--timeout', s], { cwd: DIR, env }, (e, out) => r(out)));
      await agentWait('1'); // comments made so far are handed over now, so this wait has nothing waiting for it
      const listening = agentWait('15');
      await sleep(800);
      const t0 = Date.now();
      await p.goto('about:blank');
      const ended = await listening;
      check(eng, 'leaving the page says bye: a listening agent hears the page closed', /page was closed/.test(ended) && Date.now() - t0 < 6000, `${ended.trim()} after ${Date.now() - t0} ms`);
      await ctx.close();

      // ---- a comment made after the page read its list and before the stream's first message ----
      const ctx3 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx3.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      const p3 = await ctx3.newPage();
      let letGo;
      const held = new Promise((r) => (letGo = r));
      let streamAsked = false;
      await p3.route('**/_lab/live**', async (route) => {
        streamAsked = true;
        await held;
        await route.continue().catch(() => {});
      });
      await p3.goto(B + '/');
      await until(() => streamAsked);
      const gotList = await until(async () => (await pinsOf(p3)) >= 0);
      await sleep(300); // the list is in; the stream has not said anything yet
      const listed = await pinsOf(p3);
      await post(`while the stream connected in ${eng}`);
      letGo();
      check(eng, 'a comment made before the stream first speaks still shows, no reload', gotList && (await until(async () => (await pinsOf(p3)) === listed + 1, 5000)), `pins ${listed} → ${await pinsOf(p3)}`);
      await ctx3.close();

      // ---- a reply shows once when the stream brings it before the POST's answer does ----
      const ctx4 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx4.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      const p4 = await ctx4.newPage();
      await p4.route('**/_lab/api/comments', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const res = await route.fetch(); // the lab has saved and told the stream by the time the page hears
        await sleep(300);
        await route.fulfill({ response: res });
      });
      await p4.goto(B + '/');
      const inShadow = (fn, arg) => p4.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot, a), [`return (${fn})(r, a)`, arg]);
      await until(() => inShadow((r) => r && r.querySelectorAll('button.pin').length > 0));
      await inShadow((r) => r.querySelector('button.pin').click());
      await until(() => inShadow((r) => Boolean(r.querySelector('.card textarea'))));
      await inShadow((r) => r.querySelector('.card textarea').focus());
      await p4.keyboard.type(`said once in ${eng}`);
      await p4.keyboard.press('Enter');
      await sleep(1800);
      const bubbles = await inShadow((r, a) => [...r.querySelectorAll('.card .msg')].filter((m) => m.textContent.includes(a)).length, `said once in ${eng}`);
      check(eng, 'a reply the stream brought before the POST answered shows once', bubbles === 1, `${bubbles} bubbles`);
      await ctx4.close();

      // ---- two "changes since" answers reaching the page the wrong way round (wifi): the newer state stays ----
      // Another client resolves a pin, then opens it again. The page asks twice (once per message); the first answer comes
      // late, the second at once. The pin is open in the lab and must be shown open, not resolved by the late, older answer.
      const ctx5 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx5.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      const p5 = await ctx5.newPage();
      let asked = 0;
      await p5.route('**/_lab/api/changes?*', async (route) => {
        const res = await route.fetch();
        if (++asked === 1) await sleep(600);
        await route.fulfill({ response: res }).catch(() => {});
      });
      const key = /data-admin="([^"]*)"/.exec(await fetch(B + '/').then((r) => r.text()))?.[1] ?? '';
      const act = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
      const { comment: flip } = await post(`resolved then reopened in ${eng}`);
      await p5.goto(B + '/');
      await until(async () => (await pinsOf(p5)) > 0);
      await sleep(1500); // the page has settled: its stream has said its first message
      // A resolved pin is gone from the page, or stays with "done" in its label (a thread being read keeps its pin).
      const openPins = (t) => t.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelectorAll('button.pin:not([aria-label*=", done"])').length ?? -1);
      const shown0 = await openPins(p5);
      asked = 0;
      await act({ action: 'resolve', id: flip.id });
      await sleep(150);
      await act({ action: 'reopen', id: flip.id });
      await until(async () => asked >= 2, 3000);
      await sleep(1500); // the late first answer has come by now
      check(eng, 'changes answers arriving the wrong way round: the pin reopened last is shown open', asked >= 2 && (await openPins(p5)) === shown0, `asked ${asked}, open pins ${shown0} → ${await openPins(p5)}`);
      await p5.goto('about:blank'); // left, not just shut (as with the 8 tabs below)
      await sleep(300);
      await ctx5.close();

      // ---- eight tabs of one lab: one stream for all, handed over when its tab goes ----
      const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx2.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      await ctx2.addInitScript(trackStreams);
      const tabs = [];
      let loads = 0;
      for (let i = 0; i < 8; i++) {
        const t = await ctx2.newPage();
        t.on('load', () => loads++);
        await t.goto(B + '/');
        tabs.push(t);
      }
      const open = async (list) => (await Promise.all(list.map((t) => t.evaluate(() => window.__streams.filter((s) => s.readyState === 1).length)))).reduce((a, b) => a + b, 0);
      await until(async () => (await open(tabs)) === 1, 1500);
      check(eng, '8 tabs share one open stream', (await open(tabs)) === 1, `${await open(tabs)} open`);
      let before = await Promise.all(tabs.map(pinsOf));
      await post(`to all 8 in ${eng}`);
      const all8 = await until(async () => (await Promise.all(tabs.map(pinsOf))).every((n, i) => n === before[i] + 1), 5000);
      check(eng, 'a new comment shows in all 8, no reload', all8 && loads === 8, `pins ${before} → ${await Promise.all(tabs.map(pinsOf))}, loads ${loads}`);

      const holder = (await Promise.all(tabs.map((t) => t.evaluate(() => window.__streams.some((s) => s.readyState === 1))))).indexOf(true);
      await tabs[holder].goto('about:blank');
      const rest = tabs.filter((_, i) => i !== holder);
      check(eng, 'the tab with the stream leaves: another opens it within 2 s', await until(async () => (await open(rest)) === 1, 2000), `${await open(rest)} open`);
      for (const t of rest) await t.evaluate(setHidden, true);
      before = await Promise.all(rest.map(pinsOf));
      await post(`to the other 7 in ${eng}`);
      const all7 = await until(async () => (await Promise.all(rest.map(pinsOf))).every((n, i) => n === before[i] + 1), 5000);
      check(eng, 'and all 7 left, every one in the background, still get the next comment', all7, `pins ${before} → ${await Promise.all(rest.map(pinsOf))}`);
      // Left, not just shut: closing a browser context fires no pagehide, so the tabs would never say bye and would count
      // as open for the next engine's checks.
      for (const t of rest) await t.goto('about:blank');
      await ctx2.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
