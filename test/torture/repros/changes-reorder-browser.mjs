// Repro (agent-sync "device-shows-old-state ... held=answers-held"): two "changes since" answers reach the page in the
// reverse order they were made in, and the page keeps the OLDER one (src/comments.js loadChanges applies every answer
// in arrival order, no version check). A phone on wifi: the first /changes answer is held DELAY ms, the second is not.
// One browser (the page), one pin; another client resolves it, then reopens it, one moment apart. The lab ends with the
// pin OPEN; the page ends showing it resolved (its pin is gone from the page) = BUG.
// Variant "post": the page's OWN resolve POST answer is held while another client reopens it: the held answer
// is applied to the object the page held at click time (already replaced by the delta) = PASS.
// Usage: node changes-reorder-browser.mjs [delayMs] [first|post]   (ENGINES=chromium,webkit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from '../../browser/port.mjs';
process.env.NODE_PATH = [process.env.NODE_PATH, fileURLToPath(new URL('../../../../.labit-pw-scratch/node_modules', import.meta.url))].filter(Boolean).join(path.delimiter);
const { playwright, engines, tmp, labEnv, startLab, labUp, sleep } = await import('../../browser/harness.mjs');

const DELAY = Number(process.argv[2] ?? process.env.DELAY ?? 400);
const MODE = process.argv[3] ?? process.env.MODE ?? 'first';
const pw = playwright();
let bug = false;
for (const eng of engines()) {
  const dir = tmp('labit-reorder-');
  const port = claimPort(23000, 1800);
  const B = `http://localhost:${port}`;
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p</title><body style="margin:40px"><p id="a">first line</p></body>');
  const server = startLab(dir, labEnv({ LAB_SETTLE_MS: '0' }, { settings: false }), { root: '.', port });
  let browser;
  try {
    await labUp(B);
    // This computer's key (data-admin on the page, sent as x-lab-admin): what makes a client the owner.
    const key = /data-admin="([^"]*)"/.exec(await fetch(B + '/').then((r) => r.text()))?.[1] ?? '';
    const api = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
    const { comment } = await api({ name: 'Leo', text: 'the pin', anchor: { selector: '#a', x: 0.2, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<p id="a">' } });
    browser = await pw[eng].launch();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'Leo'));
    const p = await ctx.newPage();
    let n = 0;
    const log = [];
    if (MODE === 'first') {
      // The first "changes since" the page asks is answered late; the second at once.
      await p.route('**/_lab/api/changes?*', async (route) => {
        const k = ++n; log.push(`changes #${k} asked ${route.request().url().split('?')[1]}`);
        const res = await route.fetch();
        if (k === 1) await sleep(DELAY);
        log.push(`body ${(await res.text()).slice(0,150).replace(/\s+/g,' ')} `); log.push(`changes #${k} answered ${k === 1 ? `+${DELAY}ms` : 'at once'}`);
        await route.fulfill({ response: res });
      });
    } else {
      await p.route('**/_lab/api/comments', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const res = await route.fetch();
        await sleep(DELAY);
        await route.fulfill({ response: res });
      });
    }
    const shadow = async (fn) => p.evaluate(([f]) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot), [fn.toString().replace(/^[^{]*{|}$/g, '')]);
    const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await shadow(fn).catch(() => false)) return true; await sleep(100); } return false; };
    // A resolved pin is gone from the page, or stays with "done" in its label (a thread being read keeps its pin).
    const pins = () => shadow(() => { return [...r.querySelectorAll('button.pin')].filter((b) => !/, done/.test(b.getAttribute('aria-label') || '')).length; });
    await p.goto(B + '/');
    await until(() => { return !!r && r.querySelectorAll('button.pin').length > 0; });
    await sleep(1500); // the page has settled: its live stream has said its first message
    if (MODE === 'first') {
      await api({ action: 'resolve', id: comment.id }); // lab: resolved; the page asks changes #1 (held)
      await sleep(Number(process.env.GAP ?? 150));
      await api({ action: 'reopen', id: comment.id }); // lab: open again; the page asks changes #2 (at once)
    } else {
      await shadow(() => { r.querySelector('button.pin').click(); });
      await until(() => { return !![...r.querySelectorAll('.card .btn')].find((b) => b.textContent === 'resolve'); });
      await shadow(() => { [...r.querySelectorAll('.card .btn')].find((b) => b.textContent === 'resolve').click(); }); // POST held DELAY ms
      await sleep(100);
      await api({ action: 'reopen', id: comment.id });
    }
    await sleep(DELAY + 1500);
    const lab = (await fetch(B + '/_lab/api/comments?page=/index').then((r) => r.json())).comments.find((c) => c.id === comment.id);
    const shown = await pins();
    const bad = !!lab.resolved !== (shown === 0);
    bug ||= bad;
    console.log(`${bad ? 'BUG ' : 'PASS'} ${eng} ${MODE} delay=${DELAY}ms: the lab says resolved=${!!lab.resolved}, the page shows ${shown} pin(s) (${shown ? 'open' : 'resolved'}) ${log.join('; ')}`);
  } finally {
    await browser?.close();
    server.kill();
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(bug ? 'BUG' : 'PASS');
process.exit(0);
