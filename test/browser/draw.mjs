// Drawing pins (hold D and drag, src/widget/draw.ts and ink.ts) in real browsers (WebKit and Chrome's engine): what each
// mark reads as in the agent's text, strokes joining into one drawing, the drawing as its own pin (its line opens it), a
// plain drag still a box, and D tapped alone still showing or hiding done pins. Not part of `npm test`; CI runs it in the
// `browser` job. Run: node test/browser/draw.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-draw-');
const PORT = claimPort(7960, 30);
const B = `http://localhost:${PORT}`;
const PAGE = '<!doctype html><meta charset="utf-8"><title>d</title><style>body{margin:40px;font:20px/1.5 sans-serif} h1{margin:0 0 80px} p{width:600px;margin:0 0 60px}</style><h1 id="h">Pricing</h1><p id="a">Plans start small and grow with you</p><p id="b">Cancel any time from your account</p>';
for (const n of ['circle', 'x', 'arrow', 'under', 'strike', 'box', 'caret', 'side', 'scribble']) fs.writeFileSync(path.join(DIR, `${n}.html`), PAGE);
// Lines whose letters are wide: a line through them must read as crossed out wherever along the letter it passes (the
// caret stands at the nearer edge, so on a letter's far half it is the next letter's: draw.ts letterAt reads both).
const WIDE = { cjk: '这是一个很长的中文句子用来测试笔画的位置', emoji: 'ab 🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧🎧 cd', wide: 'WWWWWWWWWWWWWWWWWWWW MMMMMMMMMMMMMMMMMMMM' };
for (const [n, t] of Object.entries(WIDE)) fs.writeFileSync(path.join(DIR, `${n}.html`), PAGE.replace(/<p id="a">.*?<\/p>/, `<p id="a">${t}</p>`));
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const root = 'document.querySelector("*") && [...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
const has = (p, sel) => p.evaluate(([r, s]) => Boolean(new Function(`return ${r}`)()?.querySelector(s)), [root, sel]);
const inks = (p) => p.evaluate((r) => new Function(`return ${r}`)()?.querySelectorAll('.pin.ink').length || 0, root);
// One more drawing on the page than there were (it is sent by itself, a second after the last stroke).
const sent = (p, was, ms = 5000) => p.waitForFunction(([r, k]) => (new Function(`return ${r}`)()?.querySelectorAll('.pin.ink').length || 0) > k, [root, was], { timeout: ms }).catch(() => {});
const until = (p, sel, ms = 4000) => p.waitForFunction(([r, s]) => Boolean(new Function(`return ${r}`)()?.querySelector(s)), [root, sel], { timeout: ms }).catch(() => {});
// The middle and edges of an element, in window pixels.
const box = (p, id) => p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; }, id);
// The words of an element's text, each one's middle (for underlining and striking them).
const words = (p, id) => p.evaluate((i) => {
  const t = document.getElementById(i).firstChild;
  const r = document.createRange();
  r.setStart(t, 0);
  r.setEnd(t, 5);
  const b = r.getBoundingClientRect();
  return { l: b.left, r: b.right + 120, top: b.top, bottom: b.bottom, mid: (b.top + b.bottom) / 2 };
}, id);
// One stroke through the points, as a pen would: small steps.
const stroke = async (p, pts) => {
  await p.mouse.move(...pts[0]);
  await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 6 });
  await p.mouse.up();
};
// Hold D, draw the strokes, let D go: the drawing is sent as it is, no box (Leo, 21 Nov: "just draw maybe and send dont
// open comment to send it, just send"). Read what the agent gets.
const draw = async (p, page, strokes) => {
  const was = await inks(p);
  await p.keyboard.down('d');
  for (const s of strokes) await stroke(p, s);
  await p.keyboard.up('d');
  await sent(p, was);
  const open = await has(p, '.float textarea');
  const lines = await has(p, 'svg.ink path');
  const draftPin = await has(p, '.pin.draft');
  const text = await (await fetch(`${B}/_lab/agent/${page}`)).text();
  return { open, lines, draftPin, text };
};
const ring = (cx, cy, rx, ry) => Array.from({ length: 22 }, (_, i) => [cx + rx * Math.cos((i / 20) * 2 * Math.PI), cy + ry * Math.sin((i / 20) * 2 * Math.PI)]);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'leo'), localStorage.setItem('lab-on', '1')));
      const p = await ctx.newPage();
      const go = async (page) => {
        await p.goto(`${B}/${page}`);
        await p.waitForFunction(new Function(`return Boolean(${root})`), null, { timeout: 8000 }).catch(() => {});
      };

      await go('circle');
      const h = await box(p, 'h');
      const circle = await draw(p, 'circle', [ring(h.cx, h.cy, (h.r - h.l) / 2 + 30, 40)].map((s) => s.map(([x, y]) => [Math.max(4, x), y])));
      check(eng, 'D held + a drag draws: sent as it is, no comment box, its lines, no draft pin', !circle.open && circle.lines && !circle.draftPin, JSON.stringify(circle).slice(0, 200));
      check(eng, 'a loop reads as circled, with the words inside it', /type: drawing/.test(circle.text) && /drawn: circled/.test(circle.text) && /Pricing/.test(circle.text) && /lines \(px from the area's top left\): M\d/.test(circle.text), circle.text.split('\n').filter((l) => /drawn|type|text in|lines/.test(l)).join(' | '));
      check(eng, 'the drawing is the pin: its lines, no marker face', await p.evaluate((r) => { const pin = new Function(`return ${r}`)().querySelector('.pin.ink'); return Boolean(pin?.querySelector('path.hit')) && getComputedStyle(pin).backgroundColor === 'rgba(0, 0, 0, 0)'; }, root));
      // Clicking the line opens it (once the sent pin's undo card has gone: Esc lets it go).
      await p.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
      const hit = await p.evaluate((r) => { const b = new Function(`return ${r}`)().querySelector('.pin.ink path.hit').getBoundingClientRect(); return [b.left + b.width / 2, b.top + 1]; }, root);
      const pts = ring(h.cx, h.cy, (h.r - h.l) / 2 + 30, 40);
      await p.mouse.click(Math.max(4, pts[5][0]), pts[5][1]);
      await until(p, '.card');
      check(eng, 'clicking the line opens its comment', await has(p, '.card'), JSON.stringify(hit));

      await go('x');
      const a = await box(p, 'a');
      const x = await draw(p, 'x', [[[a.l + 10, a.t - 10], [a.l + 140, a.b + 10]], [[a.l + 140, a.t - 10], [a.l + 10, a.b + 10]]]);
      check(eng, 'two crossing strokes while D is held make one drawing: an X', /drawn: X drawn over it/.test(x.text) && (x.text.match(/^## /gm) || []).length === 1, x.text.split('\n').find((l) => l.startsWith('drawn')));

      await go('arrow');
      const hh = await box(p, 'h');
      const b = await box(p, 'b');
      const arrow = await draw(p, 'arrow', [[[hh.l + 20, hh.cy], [hh.l + 120, (hh.cy + b.cy) / 2], [b.l + 60, b.cy]]]);
      check(eng, 'an arrow says what it starts on and what it points at', /drawn: arrow/.test(arrow.text) && /arrow from: <h1/.test(arrow.text) && /arrow to: <p id="b"/.test(arrow.text), arrow.text.split('\n').filter((l) => /drawn|arrow/.test(l)).join(' | '));

      await go('under');
      const w = await words(p, 'a');
      const under = await draw(p, 'under', [[[w.l, w.bottom + 2], [w.r, w.bottom + 3]]]);
      check(eng, 'a flat line under words reads as underlined, with those words', /drawn: underlined/.test(under.text) && /Plans/.test(under.text), under.text.split('\n').filter((l) => /drawn|text in/.test(l)).join(' | '));

      await go('strike');
      const ws = await words(p, 'a');
      const strike = await draw(p, 'strike', [[[ws.l, ws.mid], [ws.r, ws.mid + 1]]]);
      check(eng, 'a flat line through words reads as crossed out', /drawn: crossed out/.test(strike.text) && /Plans/.test(strike.text), strike.text.split('\n').filter((l) => /drawn|text in/.test(l)).join(' | '));

      // The same line drawn again over the first (its 28 px hit area is above the words): still crossed out.
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      const again = (await draw(p, 'strike', [[[ws.l, ws.mid], [ws.r, ws.mid + 1]]])).text.split('\n## ').at(-1); // the newest drawing on the page
      check(eng, 'a line drawn over an earlier drawing through the same words still reads as crossed out', /drawn: crossed out/.test(again), again.split('\n').filter((l) => /drawn|text in/.test(l)).join(' | '));

      // A line through wide letters (CJK, emoji, capitals), a hand's wobble in it, passing 3.5 px before a letter's right edge
      // (the caret then stands at the next letter, more than 3 px away): crossed out, and on that paragraph.
      for (const n of Object.keys(WIDE)) {
        await go(n);
        const [rx, my] = await p.evaluate(([k, len]) => {
          const t = document.getElementById('a').firstChild;
          const r = document.createRange();
          r.setStart(t, k);
          r.setEnd(t, k + len);
          const b = r.getBoundingClientRect();
          return [b.right, (b.top + b.bottom) / 2];
        }, n === 'emoji' ? [9, 2] : [6, 1]);
        const wobble = [-75, -45, -15, 15, 45, 75].map((dx, k) => [rx - 3.5 + dx, my + (k % 2 ? 1.5 : -1.5)]);
        const wide = (await draw(p, n, [wobble])).text.split('\n## ').at(-1); // the newest drawing on the page
        check(eng, `a wobbly line through ${n} letters reads as crossed out, on their paragraph`, /drawn: crossed out/.test(wide) && /element: <p id="a"/.test(wide), wide.split('\n').filter((l) => /drawn|element:/.test(l)).join(' | '));
      }

      await go('box');
      const bb = await box(p, 'b');
      const sq = await draw(p, 'box', [[[bb.l - 10, bb.t - 10], [bb.l + 300, bb.t - 10], [bb.l + 300, bb.b + 10], [bb.l - 10, bb.b + 10], [bb.l - 10, bb.t - 8]]]);
      check(eng, 'a drawn box reads as a box', /drawn: box drawn around it/.test(sq.text), sq.text.split('\n').find((l) => l.startsWith('drawn')));

      await go('caret');
      const wc = await words(p, 'a');
      const caret = await draw(p, 'caret', [[[wc.l + 40, wc.bottom + 22], [wc.l + 52, wc.bottom - 2], [wc.l + 64, wc.bottom + 22]]]);
      check(eng, 'a caret reads as insert here', /drawn: caret \(insert here\)/.test(caret.text), caret.text.split('\n').find((l) => l.startsWith('drawn')));

      await go('side');
      const sa = await box(p, 'a');
      const side = await draw(p, 'side', [[[sa.l - 16, sa.t - 4], [sa.l - 15, sa.b + 4]]]);
      check(eng, 'a line down the side reads as about this block', /drawn: side line/.test(side.text) && /Plans start/.test(side.text), side.text.split('\n').filter((l) => /drawn|text in/.test(l)).join(' | '));

      await go('scribble');
      const sc = await box(p, 'b');
      const zig = Array.from({ length: 8 }, (_, i) => [sc.l + 20 + i * 30, i % 2 ? sc.b : sc.t]);
      const scribble = await draw(p, 'scribble', [zig]);
      check(eng, 'a zigzag reads as scribbled over', /drawn: scribbled over/.test(scribble.text), scribble.text.split('\n').find((l) => l.startsWith('drawn')));

      // Shift held with D: a line drawn about straight comes out straight, snapped flat (Leo's pick S1, 20 Nov).
      await go('scribble');
      const sh = await box(p, 'b');
      let wasInk = await inks(p);
      await p.keyboard.down('d');
      await p.keyboard.down('Shift'); // held only for the stroke: Shift+Enter would be a new line, not send
      await stroke(p, Array.from({ length: 9 }, (_, i) => [sh.l + 10 + i * 30, sh.b + 4 + (i % 2 ? 3 : -2) + i * 1.2]));
      await p.keyboard.up('Shift');
      await p.keyboard.up('d');
      await sent(p, wasInk);
      await p.waitForTimeout(300);
      const flatText = await (await fetch(`${B}/_lab/agent/scribble`)).text();
      const kept = [...flatText.matchAll(/^lines \(px[^:]*: (.*)$/gm)].at(-1)?.[1] || ''; // the newest drawing on the page
      const ys = [...kept.matchAll(/[ML](-?\d+) (-?\d+)/g)].map((m) => Number(m[2]));
      check(eng, 'Shift held with D: a wobbly, slightly rising line comes out as one straight flat line', ys.length === 2 && ys[0] === ys[1], kept);

      // Shift held with D: a rough box comes out a clean rectangle (Leo's pick S2, 20 Nov). On the caret page, so its
      // lines don't sit where the plain drag below starts.
      await go('caret');
      const bx = await box(p, 'b');
      wasInk = await inks(p);
      await p.keyboard.down('d');
      await p.keyboard.down('Shift');
      await stroke(p, [[bx.l - 8, bx.t - 6], [bx.l + 90, bx.t - 2], [bx.l + 200, bx.t - 9], [bx.l + 204, bx.b + 4], [bx.l + 100, bx.b + 9], [bx.l - 6, bx.b + 5], [bx.l - 9, bx.t - 1]]);
      await p.keyboard.up('Shift');
      await p.keyboard.up('d');
      await sent(p, wasInk);
      await p.waitForTimeout(300);
      const boxText = await (await fetch(`${B}/_lab/agent/caret`)).text();
      const boxLine = [...boxText.matchAll(/^lines \(px[^:]*: (.*)$/gm)].at(-1)?.[1] || '';
      const corners = [...boxLine.matchAll(/[ML](-?\d+) (-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const square = corners.length === 5 && corners[0][1] === corners[1][1] && corners[1][0] === corners[2][0] && corners[2][1] === corners[3][1];
      check(eng, 'Shift held with D: a rough box comes out as a clean rectangle, read as a box', square && /drawn: box drawn around it/.test(boxText.split('## ').at(-1)), boxLine);

      // A plain drag, no D: today's box.
      await go('scribble');
      await stroke(p, [[sc.l, sc.t - 20], [sc.l + 200, sc.b + 20]]);
      await until(p, '.float textarea');
      check(eng, 'a drag without D still marks a box (no lines)', (await has(p, '.float textarea')) && (await has(p, '.zone.draft')) && !(await has(p, 'svg.ink.live')));
      await p.keyboard.press('Escape');

      // D tapped alone shows or hides done pins, as before (on release).
      const hidden = () => p.evaluate(() => localStorage.getItem('lab-hide-done'));
      const before = await hidden();
      await p.keyboard.press('d');
      await p.waitForTimeout(100);
      const after = await hidden();
      check(eng, 'D tapped alone still shows or hides done pins', (before === '1') !== (after === '1'), `${before} -> ${after}`);
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
