// A page's board view at half height (src/board/overlay.ts), and the board's canvas. The page scrolls under the view
// and the board's pins stay put, frame by frame (they are held to the screen, not put back after each scroll step;
// Leo, 19 Nov: "when on half board scrolling pins flickering weirdly"). Dragging the view's edge keeps what is on the
// screen where it is: nothing is fitted again mid-drag, no snapping back and forth near the top ("when moving size of
// boards its sometimes flickering"). Past the board's edge a pan just stops ("remove weird bounce"). The canvas is a
// grid of dots that goes with the camera. Not part of `npm test`.
// Run: node test/browser/boardhalf.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardhalf-');
const PORT = claimPort(8360, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'canvas.html'), '<!doctype html><meta charset="utf-8"><title>Canvas</title><h1>Canvas</h1><p id="one">one</p><div style="height:900px"></div><p id="two">two</p><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 820, h: 600, x: 500, y: 0 }] }) });
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'zz-half'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const root = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
      const pins = () => p.evaluate(`[...${root}.querySelectorAll('.pin:not(.draft)')].length`);
      const note = async (x, y, words) => {
        const n = await pins();
        await sleep(200);
        await withAlt(p, () => p.mouse.click(x, y));
        await sleep(400);
        await p.keyboard.type(words);
        await p.keyboard.press('Enter');
        await p.waitForFunction(`[...${root}.querySelectorAll('.pin:not(.draft)')].length > ${n}`, null, { timeout: 4000 });
        await sleep(3600); // its card, open 3 s for undo, has closed
      };
      // a pin of the page itself (on "two", further down), then the board over the page and a pin on frame b
      await p.goto(B + '/canvas');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(800);
      if (!(await pins())) {
        await p.evaluate(() => scrollTo(0, 700));
        await sleep(300);
        const two = await p.evaluate(() => { const r = document.getElementById('two').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
        await note(two.x, two.y, 'on the page');
      }
      await p.goto(B + '/canvas#board=pricing');
      await p.reload(); // the address only gained its #board: the page is read again, and opens it
      await p.waitForFunction(() => window.__labBoard && document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]'), null, { timeout: 8000 });
      await sleep(1200);
      const rect = (sel) => p.evaluate((s) => { const r = (s.startsWith('#lab-board') ? document.querySelector('[data-lab-board-view]').shadowRoot : document).querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; }, sel);
      const b0 = await rect('#lab-board .f[data-id="b"]');
      if ((await pins()) < 2) await note(b0.x + b0.w / 2, b0.y + b0.h / 2, 'on the board');
      // What is seen of the pins, each frame while fn runs: [board pin x, y, its position, page pin shown, page pin y, camera z, frame b's x, y]
      const watch = async (fn, ms = 500) => {
        await p.evaluate(`(() => {
          const r = ${root};
          const all = [...r.querySelectorAll('.pin:not(.draft)')];
          const board = all.find((q) => q.style.position === 'fixed');
          const page = all.find((q) => q.style.position !== 'fixed');
          const f = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]');
          window.__seen = [];
          const tick = () => {
            if (!window.__seen) return;
            const q = board.getBoundingClientRect();
            const g = f.getBoundingClientRect();
            const v = document.querySelector('[data-lab-board-view]').getBoundingClientRect();
            window.__seen.push([q.x, q.bottom, getComputedStyle(board).visibility, page ? getComputedStyle(page).visibility : '', page ? page.getBoundingClientRect().bottom : 0, window.__labBoard.camera().z, g.x, g.y, v.top, scrollY]);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })()`);
        await fn();
        await sleep(ms);
        return p.evaluate(() => { const s = window.__seen; window.__seen = null; return s; });
      };
      const spread = (rows, i) => Math.max(...rows.map((r) => r[i])) - Math.min(...rows.map((r) => r[i]));

      // ----- the canvas: dots that go with the camera
      const dots = () => p.evaluate(() => { const d = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .dots'); const s = d && getComputedStyle(d); return d ? { img: s.backgroundImage, size: parseFloat(s.backgroundSize), pos: s.backgroundPosition, z: window.__labBoard.camera().z, kids: d.children.length } : null; });
      const d0 = await dots();
      check(eng, 'the canvas is a grid of dots: one background, sized by the zoom', Boolean(d0) && /radial-gradient/.test(d0.img) && d0.kids === 0 && Math.abs(d0.size - 32 * d0.z) < 0.5, JSON.stringify(d0));

      // ----- half (as a board opens): the page scrolls under the view, the board's pins stay put in every frame
      check(eng, 'the board opened at half the window', Math.abs((await rect('[data-lab-board-view]')).h - 400) < 2);
      await p.evaluate(() => scrollTo(0, document.getElementById('two').getBoundingClientRect().top + scrollY - 650)); // the page pin starts under the view
      await sleep(400);
      await p.mouse.move(600, 150); // over the page, above the view
      const scrolls = await watch(async () => {
        for (let i = 0; i < 12; i++) {
          await p.mouse.wheel(0, 60);
          await sleep(30);
        }
      });
      check(eng, 'half view: the page scrolled under it', spread(scrolls, 9) > 300, String(spread(scrolls, 9)));
      check(eng, 'half view: the board pin never moved or blinked while the page scrolled', spread(scrolls, 0) < 0.5 && spread(scrolls, 1) < 0.5 && scrolls.every((r) => r[2] === 'visible'), JSON.stringify([spread(scrolls, 0), spread(scrolls, 1), [...new Set(scrolls.map((r) => r[2]))]]));
      // the page's own pin: hidden once it is under the view, seen above it; never over the board
      const top = scrolls[0][8];
      const under = scrolls.filter((r) => r[4] > top + 30 && r[4] < 790);
      const above = scrolls.filter((r) => r[4] < top - 2);
      check(eng, 'half view: the page pin is hidden while it is under the view and shown once it is above it, in each frame', under.length > 0 && above.length > 0 && under.every((r) => r[3] === 'hidden') && above.every((r) => r[3] === 'visible'), JSON.stringify(scrolls.filter((r, i) => i % 5 === 0).map((r) => [r[3], Math.round(r[4]), Math.round(top)])));
      // ----- half: panning the board moves the pin with its frame, in the same frame
      await p.mouse.move(600, 600);
      const pans = await watch(async () => {
        for (let i = 0; i < 10; i++) {
          await p.mouse.wheel(12, 0);
          await sleep(30);
        }
      });
      const off = pans.map((r) => [r[0] - r[6], r[1] - r[7]]);
      check(eng, 'half view: a pan takes the pin along with its frame, never a frame behind', spread(pans, 6) > 20 && Math.max(...off.map((o) => Math.abs(o[0] - off[0][0]))) < 0.6 && Math.max(...off.map((o) => Math.abs(o[1] - off[0][1]))) < 0.6, JSON.stringify([spread(pans, 6), off[0], off[off.length - 1]]));

      // ----- the view's edge dragged: what is on the screen stays where it is, nothing is fitted again mid-drag
      const g = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('.bv-grip').getBoundingClientRect(); return { x: r.x + r.width / 3, y: r.y + r.height / 2 }; });
      const drag = await watch(async () => {
        await p.mouse.move(g.x, g.y);
        await p.mouse.down();
        for (let y = g.y; y > 20; y -= 12) {
          await p.mouse.move(g.x, y);
          await sleep(16);
        }
        // at the top: back and forth round where it used to snap to full
        for (const y of [18, 30, 20, 34, 22, 40]) {
          await p.mouse.move(g.x, y);
          await sleep(30);
        }
      }, 60);
      const held = drag.slice(2);
      const tops = held.map((r) => r[8]);
      const jumps = tops.slice(1).map((t, i) => Math.abs(t - tops[i]));
      // The board's zoom and place in the view are kept: the frames and the pin go with the view's top edge (Leo, 21 Nov:
      // "closing/opening board drawer should not move zoom/position inside board").
      const inView = (i) => held.map((r) => [r[i] - r[8]]);
      check(eng, 'dragging the edge: the zoom is not fitted again and the frames and the pin keep their place in the view', spread(held, 5) < 1e-9 && spread(held, 6) < 0.6 && spread(inView(7), 0) < 0.6 && spread(held, 0) < 0.6 && spread(inView(1), 0) < 0.6, JSON.stringify([spread(held, 5), spread(held, 6), spread(inView(7), 0), spread(held, 0), spread(inView(1), 0)]));
      check(eng, 'dragging the edge: it follows the pointer, no jump to full and back near the top', spread(held, 8) > 300 && Math.max(...jumps) < 40, JSON.stringify([spread(held, 8), Math.max(...jumps)]));
      await p.mouse.move(g.x, 10);
      await p.mouse.up();
      await sleep(500);
      const full = await rect('[data-lab-board-view]');
      check(eng, 'let go near the top, the view is full', Math.abs(full.h - 800) < 1, String(full.h));

      // ----- past the board's edge a pan just stops
      await p.keyboard.press('Shift+Digit2');
      await sleep(300);
      await p.mouse.move(600, 400);
      for (let i = 0; i < 6; i++) await p.mouse.wheel(3000, 0);
      await sleep(100);
      const edge = await rect('#lab-board .world');
      const past = await watch(async () => {
        for (let i = 0; i < 8; i++) {
          await p.mouse.wheel(900, 0);
          await sleep(20);
        }
      }, 700);
      const now = await rect('#lab-board .world');
      check(eng, 'past the edge a pan just stops: nothing gives way, nothing springs back', spread(past, 6) < 0.5 && Math.abs(now.x - edge.x) < 0.5, JSON.stringify([spread(past, 6), edge.x, now.x]));
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
