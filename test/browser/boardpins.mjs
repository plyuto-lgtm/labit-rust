// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardpins-');
const PORT = claimPort(8260, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'checkout.html'), '<!doctype html><meta charset="utf-8"><title>Checkout</title><h1>Checkout</h1>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const put = (name, frames, extra = {}) => fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames, ...extra }) }).then((r) => r.json());
await put('pins', [{ id: 'a', src: '/pricing', w: 390, h: 844 }, { id: 'b', src: '/pricing', w: 820, h: 600 }]); // no page: it keeps its own address and pins (a board about a page: boardhome.mjs)
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/_lab/board/pins');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(2000);
      const sh = (fn) => p.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot), fn);
      const rect = (id) => p.evaluate((i) => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }, id);
      const a = await rect('a');
      // an ⌥-click on frame a, 100 px right and 150 px down of its corner (screen px)
      await withAlt(p, () => p.mouse.click(a.x + 100, a.y + 150));
      await p.waitForFunction(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot; return Boolean(r.querySelector('textarea')); }, null, { timeout: 4000 }).catch(() => {});
      check(eng, 'an ⌥-click opens the new-comment box on the board', await sh('return Boolean(r.querySelector("textarea"))'));
      await p.keyboard.type('too tight here');
      await p.keyboard.press('Enter');
      let saved;
      for (let i = 0; i < 30 && !saved; i++) { await sleep(150); saved = (await (await fetch(`${B}/_lab/api/comments?page=/_board/pins`)).json()).comments?.[0]; }
      const an = saved?.anchor;
      check(eng, 'the pin is stored under the board key with kind board, its frame and px from its corner', an?.kind === 'board' && an.frame === 'a' && Math.abs(an.fx - 100 / (a.w / 390)) < 2 && an.board === 'pins', JSON.stringify(an));
      // the pin's tip is its lower left corner: its middle sits half its size up and right of the spot
      const text = await (await fetch(`${B}/_lab/agent/_board/pins`)).text();
      check(eng, 'the agent reads it as on the board, near that frame', /near: frame a/.test(text) && /on: the board/.test(text), text.slice(0, 200));
      const pinAt = () => sh('const b = r.querySelector("button.pin"); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2 - q.width / 2, y: q.y + q.height / 2 + q.height / 2, w: q.width }');
      await sleep(500);
      const p1 = await pinAt();
      check(eng, 'the pin sits where the tap was', Math.abs(p1.x - (a.x + 100)) < 14 && Math.abs(p1.y - (a.y + 150)) < 14, JSON.stringify([p1, a]));
      // zoom: the pin stays on its spot and stays the same size
      await p.keyboard.press('Shift+Digit2');
      await sleep(700);
      const a2 = await rect('a');
      const p2 = await pinAt();
      const want = { x: a2.x + an.fx * (a2.w / 390), y: a2.y + an.fy * (a2.w / 390) };
      check(eng, 'at 100% the pin is still on its spot, the same size on screen', Math.abs(p2.x - want.x) < 14 && Math.abs(p2.y - want.y) < 14 && Math.abs(p2.w - p1.w) < 1, JSON.stringify([p2, want, p1.w]));
      // it follows its frame when the frame moves
      await p.keyboard.press('Shift+Digit1');
      await sleep(500);
      const a3 = await rect('a');
      await p.mouse.click(a3.x + 20, a3.y + 20); // a plain click only lets the sent pin's undo card go; close a box if one opened
      await sleep(300);
      if (await sh("return Boolean(r.querySelector('.float textarea'))")) await p.keyboard.press('Escape'); // Esc on an empty board would leave it
      await sleep(200);
      // The frame moves in the board file (another writer, or the agent): the board follows it, and the pin with it.
      const now = await (await fetch(`${B}/_lab/api/board?name=pins`)).json();
      await fetch(`${B}/_lab/api/board?name=pins`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ ...now, frames: now.frames.map((f) => (f.id === 'a' ? { ...f, x: f.x + 80, auto: false } : f)) }) });
      await sleep(1800);
      const a4 = await rect('a');
      const p3 = await pinAt();
      const want4 = { x: a4.x + an.fx * (a4.w / 390), y: a4.y + an.fy * (a4.w / 390) };
      check(eng, 'a pin follows its frame when the frame is moved', a4.x > a3.x + 10 && Math.abs(p3.x - want4.x) < 14 && Math.abs(p3.y - want4.y) < 14, JSON.stringify([a3.x, a4.x, p3, want4]));
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
