// Board pins the browser holds: a pin on a frame is tied to the frame's box by its share of it (pinhold.ts),
// so the board's camera carries it. Through a pan and a zoom it stays on its spot of the frame and the same size, with no
// redraw by the widget; it follows its frame when the frame is moved, and is placed again when a frame is resized. In a
// browser without anchor positioning board pins are the script's, as before, and must still be on their spot.
// Run: node test/browser/nativeboard.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-nativeboard-');
const PORT = claimPort(8430, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'checkout.html'), '<!doctype html><meta charset="utf-8"><title>Checkout</title><h1>Checkout</h1>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const put = (name, frames, extra = {}) => fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames, ...extra }) }).then((r) => r.json());
await put('pins', [{ id: 'a', src: '/pricing', w: 390, h: 844 }, { id: 'b', src: '/pricing', w: 820, h: 600 }]);
try {
  for (const eng of engines()) {
    // Each engine starts from the same board (the one before moved and resized frame a); its rev is the lab's now.
    if (eng !== engines()[0]) {
      const cur = await (await fetch(`${B}/_lab/api/board?name=pins`)).json();
      await fetch(`${B}/_lab/api/board?name=pins`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ ...cur, frames: [{ id: 'a', src: '/pricing', w: 390, h: 844 }, { id: 'b', src: '/pricing', w: 820, h: 600 }] }) });
    }
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/_lab/board/pins');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(2000);
      const hides = await p.evaluate(() => CSS.supports('anchor-name: --a')); // the board's box covers the screen: its pins are held wherever anchor positioning is
      const sh = (fn) => p.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot), fn);
      const rect = (id) => p.evaluate((i) => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }, id);
      const a = await rect('a');
      await withAlt(p, () => p.mouse.click(a.x + 100, a.y + 150));
      await p.waitForFunction(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot; return Boolean(r.querySelector('textarea')); }, null, { timeout: 4000 }).catch(() => {});
      await p.keyboard.type('too tight here');
      await p.keyboard.press('Enter');
      let saved;
      for (let i = 0; i < 30 && !saved; i++) { await sleep(150); saved = (await (await fetch(`${B}/_lab/api/comments?page=/_board/pins`)).json()).comments?.[0]; }
      const an = saved?.anchor;
      await sleep(600);
      const pinAt = () => sh('const b = r.querySelector("button.pin"); const q = b.getBoundingClientRect(); return { x: q.x, y: q.y + q.height, w: q.width, held: getComputedStyle(b).position === "fixed" }');
      const spot = (fr) => ({ x: fr.x + an.fx * (fr.w / 390), y: fr.y + an.fy * (fr.w / 390) });
      const on = (pp, fr) => Math.abs(pp.x - spot(fr).x) < 3 && Math.abs(pp.y - spot(fr).y) < 3;
      const p1 = await pinAt();
      check(eng, hides ? 'a board pin on a frame is held by the browser, on its spot' : 'a board pin is placed by the script here (no anchor positioning), on its spot', p1.held === hides && on(p1, a), JSON.stringify({ p1, want: spot(a) }));
      // Pan: Space + drag on the empty board (Space held). No redraw by the widget while the camera moves, and the pin stays on its spot.
      await p.evaluate(() => {
        window.labMeasured = 0;
        for (const [proto, fn] of [[Element.prototype, 'getBoundingClientRect'], [Range.prototype, 'getClientRects']]) {
          const was = proto[fn];
          proto[fn] = function (...x) { if (this.closest?.('#lab-board') === null || this instanceof Range) window.labMeasured++; return was.apply(this, x); };
        }
      });
      await p.mouse.move(1100, 700);
      await p.keyboard.down('Space'); // a plain drag is labit's; Space + drag pans (Leo, 19 Nov)
      await p.mouse.down();
      await p.mouse.move(950, 600, { steps: 12 });
      await p.mouse.up();
      await p.keyboard.up('Space');
      await sleep(400);
      const measured = await p.evaluate(() => window.labMeasured);
      const a2 = await rect('a');
      const p2 = await pinAt();
      check(eng, 'a pan: the pin stays on its spot of the frame, still held', a2.x < a.x - 50 && on(p2, a2) && p2.held === hides, JSON.stringify({ moved: [a.x, a2.x], p2, want: spot(a2) }));
      if (hides) check(eng, '…and the widget measured nothing while the camera moved', measured === 0, `${measured} measurements`);
      // Zoom to 100%: on its spot and the same size on screen.
      await p.keyboard.press('Shift+Digit2');
      await sleep(800);
      const a3 = await rect('a');
      const p3 = await pinAt();
      check(eng, 'a zoom: the pin stays on its spot, the same size on screen, still held', Math.abs(a3.w / a2.w - 1) > 0.05 && on(p3, a3) && Math.abs(p3.w - p1.w) < 1 && p3.held === hides, JSON.stringify({ zoom: [a2.w, a3.w], p3, want: spot(a3), w: p1.w }));
      // The frame moves in the board file: the pin goes with it.
      const now = await (await fetch(`${B}/_lab/api/board?name=pins`)).json();
      await fetch(`${B}/_lab/api/board?name=pins`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ ...now, frames: now.frames.map((f) => (f.id === 'a' ? { ...f, x: f.x + 80, auto: false } : f)) }) });
      await sleep(1800);
      const a4 = await rect('a');
      const p4 = await pinAt();
      check(eng, 'the frame is moved: the pin goes with it', a4.x > a3.x + 10 && on(p4, a4) && p4.held === hides, JSON.stringify({ moved: [a3.x, a4.x], p4, want: spot(a4) }));
      // The frame is resized in the board file: the pin is placed again on its point (fx stays in px from the corner).
      const now5 = await (await fetch(`${B}/_lab/api/board?name=pins`)).json();
      await fetch(`${B}/_lab/api/board?name=pins`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ ...now5, frames: now5.frames.map((f) => (f.id === 'a' ? { ...f, w: 820, h: 1180, auto: false } : f)) }) });
      // The board reads its file again on the lab's word that it changed (the live stream); said here directly, so this
      // checks what follows: the board draws the frame anew and tells the widget the layout changed.
      await p.evaluate(() => dispatchEvent(new CustomEvent('lab-state', { detail: { boards: 1e6, boardNames: ['pins'] } })));
      await p.waitForFunction((w) => Math.abs(document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect().width - w) > 20, a4.w, { timeout: 8000 }).catch(() => {});
      await sleep(400);
      const a5 = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
      const p5 = await pinAt();
      const want5 = { x: a5.x + an.fx * (a5.w / 820), y: a5.y + an.fy * (a5.w / 820) };
      check(eng, 'the frame is resized: the pin is placed again on its point', Math.abs(p5.x - want5.x) < 3 && Math.abs(p5.y - want5.y) < 3, JSON.stringify({ p5, want5, w: a5.w }));
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
