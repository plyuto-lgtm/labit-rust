// A board as a section of the page (<lab-board name>, written by +board): it shows only on the page its board is about,
// and only when the lab can give it the board. A board that is gone, or a copy of the tag on another page, shows nothing,
// and outside the lab the tag is an empty element (Leo, 21 Nov: "no stray board on pages without access to them").
// Not part of `npm test`. Run: node test/browser/boardsection.mjs (needs playwright).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardsection-');
const PORT = claimPort(8360, 30);
const B = `http://localhost:${PORT}`;
const page = (title, name) => `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>Words</p>\n<lab-board name="${name}"></lab-board>\n<p id="after">After</p>`;
fs.writeFileSync(path.join(DIR, 'a.html'), page('Page a', 'pin-aaaaaaaaaaaa'));
fs.writeFileSync(path.join(DIR, 'b.html'), page('Page b', 'pin-bbbbbbbbbbbb')); // no such board
fs.writeFileSync(path.join(DIR, 'c.html'), page('Page c', 'pin-aaaaaaaaaaaa')); // a's board, the tag copied here
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
fs.mkdirSync(path.join(DIR, '.lab/boards'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.lab/boards/pin-aaaaaaaaaaaa.json'), JSON.stringify({ v: 1, name: 'pin-aaaaaaaaaaaa', rev: 1, of: '/a#pin-aaaaaaaaaaaa', frames: [{ id: 'a', src: '/a', w: 390, h: 844, state: 'live' }] }));
const server = startLab(DIR, labEnv());
await labUp(B);
// The section's height and what it says (its shadow's words).
const seen = (p) => p.evaluate(() => {
  const n = document.querySelector('lab-board');
  return { h: Math.round(n.getBoundingClientRect().height), text: n.shadowRoot?.querySelector('div')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) || '' };
});
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/a');
      await p.waitForFunction(() => document.querySelector('lab-board')?.shadowRoot?.querySelector('.box'), null, { timeout: 8000 });
      const a = await seen(p);
      check(eng, 'on its own page the board shows as a section', a.h > 30 && /Board/.test(a.text), JSON.stringify(a));
      for (const [at, why] of [['/b', 'a board that is gone shows nothing'], ['/c', 'the tag copied onto another page shows nothing']]) {
        await p.goto(B + at);
        await p.waitForFunction(() => document.querySelector('lab-board')?.shadowRoot, null, { timeout: 8000 });
        await sleep(800);
        const s = await seen(p);
        check(eng, why, s.h === 0 && !/Board|not found/.test(s.text), JSON.stringify(s));
      }
      // Outside the lab (the file opened as it is, or deployed): no widget, an empty element.
      await p.goto(pathToFileURL(path.join(DIR, 'a.html')).href);
      await sleep(300);
      const f = await seen(p);
      check(eng, 'outside the lab the tag shows nothing', f.h === 0 && !f.text, JSON.stringify(f));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
