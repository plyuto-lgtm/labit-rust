// The actions row of a new comment in real browsers (WebKit and Chrome's engine): the actions of labit.json, in order, as
// many chips as fit on one line, the rest not shown (no "…" list, nothing to edit on the page), numbered for ⌥ + 1…4;
// a click on a chip, or ⌥ + 1, sends the comment with the chip's prompt as its action.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/quickrow.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const dir = fs.realpathSync(tmp('labit-quickrow-'));
const port = claimPort(7800, 100);
const ACTIONS = Array.from({ length: 12 }, (_, i) => ({ name: `act${String(i + 1).padStart(2, '0')}xx`.slice(0, 7), prompt: `Prompt number ${i + 1}.` }));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>q</title><h1 id="h">Hello there</h1><p>text</p>');
fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ port, actions: ACTIONS }));
const server = startLab(dir, labEnv());
const B = `http://localhost:${port}`;
await labUp(B);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 700, height: 600 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'zz'), localStorage.setItem('lab-on', '1'), localStorage.setItem('lab-hint-seen', '1')));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await sleep(1200);
      await p.click('#h');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float .quick'), null, { timeout: 10000 });
      await sleep(600);
      const row = await p.evaluate(() => {
        const q = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.float .quick');
        const kids = [...q.children];
        return { names: kids.map((b) => b.textContent), ns: kids.map((b) => b.getAttribute('data-n')), dots: kids.some((b) => b.getAttribute('data-k') === '…'), menu: Boolean(q.parentElement.querySelector('.acts')), over: q.scrollWidth > q.clientWidth + 1 };
      });
      const want = ACTIONS.map((a) => a.name);
      // +board is labit's own, never left out for room: last on the line, after the actions that fit.
      const acts = row.names.slice(0, -1);
      check(eng, 'some of the 12 fit, in order, the rest are left out', acts.length > 0 && acts.length < 12 && acts.every((n, i) => n === want[i]) && row.names.at(-1) === '+board', JSON.stringify(row.names));
      check(eng, 'no "…" button and no list', !row.dots && !row.menu, JSON.stringify(row));
      check(eng, 'the line does not overflow', !row.over);
      check(eng, 'the chips are numbered for ⌥ + 1…4', row.ns.every((n, i) => n === String(i + 1)), JSON.stringify(row.ns));
      await p.click('textarea >> nth=0', { force: true }).catch(() => {});
      const sent = p.waitForRequest((r) => r.url().endsWith('/_lab/api/comments') && r.method() === 'POST');
      await p.keyboard.down('Alt');
      await p.keyboard.press('Digit2');
      await p.keyboard.up('Alt');
      const body = (await sent).postDataJSON();
      check(eng, '⌥ + 2 sends the second action with its prompt', body.text === want[1] && body.anchor.act === ACTIONS[1].prompt, JSON.stringify({ t: body.text, a: body.anchor.act }));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
finish();
