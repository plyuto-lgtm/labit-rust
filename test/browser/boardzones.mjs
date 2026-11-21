// An area (drag) or a drawing (hold D and drag) on a board's frame keeps its shape: stored in the frame's own px (its corner, its
// size as shares of the frame), drawn again over the frame after a reload, and told to the agent as where on the frame, not as an
// element of the board's own boxes. Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardzones-');
const PORT = claimPort(8500, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>some words</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=zones`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/pricing', w: 1440, h: 900 }, { id: 'b', src: '/pricing', w: 820, h: 600 }] }) });
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/_board/zones`)).json()).comments || [];
const widget = 'document.querySelector("*") && [...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const open = async () => {
        await p.goto(`${B}/_lab/board/zones`);
        await p.waitForFunction(() => window.__labBoard?.box?.('a') && [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 8000 });
        await sleep(1500);
      };
      const rect = (id) => p.evaluate((i) => { const r = window.__labBoard.box(i).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
      const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(150); } return false; };
      const text = async () => (await fetch(`${B}/_lab/agent/_board/zones`)).text();
      await open();
      const fa = await rect('a');
      // an area: from a quarter to three quarters of frame a
      await withAlt(p, async () => {
        await p.mouse.move(fa.x + fa.w * 0.25, fa.y + fa.h * 0.25);
        await p.mouse.down();
        await p.mouse.move(fa.x + fa.w * 0.5, fa.y + fa.h * 0.5, { steps: 6 });
        await p.mouse.move(fa.x + fa.w * 0.75, fa.y + fa.h * 0.75, { steps: 6 });
        await p.mouse.up();
      });
      await until(async () => (await p.locator('textarea').count()) > 0);
      await p.keyboard.type('this area');
      await p.keyboard.press('Enter');
      const area = await until(async () => (await comments()).find((c) => c.text === 'this area'));
      const a = area?.anchor || {};
      check(eng, 'an area on a frame is stored in the frame: its corner in the frame\'s px, its size as shares of it', a.kind === 'board' && a.frame === 'a' && Math.abs(a.zw - 0.5) < 0.03 && Math.abs(a.zh - 0.5) < 0.03 && Math.abs(a.fx - 360) < 12 && Math.abs(a.fy - 225) < 12 && a.fw === 1440 && a.fh === 900, JSON.stringify(a));
      const t = await text();
      check(eng, 'the agent reads where on the frame, in its px, and no element of the board', /area on frame a: 3[4-7]\d–10[5-9]\d px across, 2[0-4]\d–6[5-9]\d px down, of the frame's 1440×900/.test(t) && !/area on element/.test(t), t.split('\n').filter((l) => /area|type:/.test(l)).join(' | '));
      // a reload: the outline is over the frame again (the pin's card open)
      await open();
      await p.evaluate((r) => { const pin = new Function(`return ${r}`)().querySelector('button.pin'); pin?.click(); }, widget);
      await sleep(900);
      const z = await p.evaluate((r) => { const e = new Function(`return ${r}`)().querySelector('.zone'); const b = e?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }, widget);
      const fa2 = await rect('a');
      check(eng, 'after a reload the area is drawn over the frame at a quarter to three quarters of it', Boolean(z) && Math.abs(z.x - (fa2.x + fa2.w * 0.25)) < 8 && Math.abs(z.w - fa2.w * 0.5) < 10 && Math.abs(z.y - (fa2.y + fa2.h * 0.25)) < 8 && Math.abs(z.h - fa2.h * 0.5) < 10, JSON.stringify([z, fa2]));
      await p.keyboard.press('Escape');
      // a drawing on frame b: a ring
      await sleep(300);
      const fb = await rect('b');
      const ring = Array.from({ length: 22 }, (_, i) => [fb.x + fb.w * 0.5 + fb.w * 0.25 * Math.cos((i / 20) * 2 * Math.PI), fb.y + fb.h * 0.5 + fb.h * 0.25 * Math.sin((i / 20) * 2 * Math.PI)]);
      await p.keyboard.down('d');
      await p.mouse.move(...ring[0]);
      await p.mouse.down();
      for (const q of ring.slice(1, 12)) await p.mouse.move(...q, { steps: 4 });
      // the lines show as they are drawn, over the board (Leo, 21 Nov: "its not visible until i finish drawing")
      const live = await p.evaluate(([x, y]) => {
        const r = document.querySelector('[data-lab-comments]').shadowRoot;
        const svg = r.querySelector('svg.ink.live, .ink.live');
        const paths = svg ? svg.querySelectorAll('path').length : 0;
        let top = document.elementFromPoint(x, y);
        for (let i = 0; i < 3 && top?.shadowRoot; i++) top = top.shadowRoot.elementFromPoint(x, y) || top;
        const box = svg?.getBoundingClientRect();
        return { paths, box: box && [box.x, box.y, box.width, box.height], vis: svg && getComputedStyle(svg).visibility, op: svg && getComputedStyle(svg).opacity, host: getComputedStyle(document.querySelector('[data-lab-comments]')).zIndex };
      }, ring[6]);
      check(eng, 'a drawing on a board shows its lines while it is drawn', live.paths > 0 && live.vis !== 'hidden' && live.op !== '0', JSON.stringify(live));
      for (const q of ring.slice(12)) await p.mouse.move(...q, { steps: 4 });
      await p.mouse.up();
      await p.keyboard.up('d');
      // sent by itself, with what it reads as (no box: Leo, 21 Nov)
      const draw = await until(async () => (await comments()).find((c) => c.anchor?.ink));
      const d = draw?.anchor || {};
      check(eng, 'a drawing on a frame keeps its lines and sits on that frame', d.frame === 'b' && Boolean(d.ink?.pts?.length) && d.zw > 0.2 && d.zw < 0.7 && d.fw === 820, JSON.stringify({ frame: d.frame, zw: d.zw, fw: d.fw, ink: Boolean(d.ink) }));
      const t2 = await text();
      check(eng, 'the agent reads its lines in the frame\'s px', /type: drawing, \d+×\d+ px on frame b/.test(t2) && /lines \(px from the area's top left\): M/.test(t2) && /area on frame b:/.test(t2), t2.split('\n').filter((l) => /drawing|lines|area on/.test(l)).join(' | ').slice(0, 300));
      await open();
      const inks = await until(async () => p.evaluate((r) => new Function(`return ${r}`)().querySelectorAll('.pin.ink svg path, svg.ink path').length, widget));
      check(eng, 'after a reload the drawing is drawn again', Boolean(inks));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
