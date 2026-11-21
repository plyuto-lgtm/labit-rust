// Where an open comment card goes on a computer (thread.ts spot), in WebKit and Chromium. Leo, 21 Nov: "opening new pin should
// open it in position i can read comment, sometimes its not in that position", "scrolling slightly moving comment dialog here
// and there", and on a board the card covered its pin or was cut off by the screen's edge. The card opens where the pin and
// the whole card (its reply box too) are in the window, beside the pin and never over it, in one order (below, above, right,
// left); scrolling a little moves it with its pin by exactly the pin's movement and never turns it over.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/cardplace.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-cardplace-');
const PORT = claimPort(8500, 30);
const B = `http://localhost:${PORT}`;
const words = 'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly figures. ';
const IDS = [5, 15, 25, 35]; // far enough apart that one pin is in the window at a time
fs.writeFileSync(
  path.join(DIR, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>p</title><style>body{margin:0;font:17px/1.6 Georgia,serif}main{max-width:640px;margin:0 auto;padding:20px 16px 900px}</style><main>${Array.from({ length: 45 }, (_, i) => `<p id="p${i}">Paragraph ${i}. ${words.repeat(2)}</p>`).join('')}</main>`,
);
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing</h1><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json()).then((j) => j.comment);
// A thread of five messages on each: a card as tall as they come (it scrolls inside, the reply box stays).
for (const i of IDS) {
  const c = await post({ name: 'Sam', text: `a thread on p${i}`, anchor: { selector: `#p${i}`, x: 0.5, y: 0.5, docX: 300, docY: 400, width: 600 } });
  for (let k = 0; k < 5; k++) await post({ name: k % 2 ? 'Ann' : 'Sam', text: `reply number ${k} with some words to wrap around the card a bit more than once`, parent: c.id });
}
await fetch(`${B}/_lab/api/board?name=cp`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/pricing', w: 390, h: 844 }] }) });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const sh = (fn) => p.evaluate((f) => new Function('r', `return (${f})(r)`)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot), fn.toString());
      const ready = async (url) => {
        await p.goto(B + url);
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 8000 });
        await sleep(1500);
      };
      // The pin in the window, the open card and its reply box, as the window shows them.
      const look = () =>
        sh((r) => {
          const box = (n) => n && { l: n.left, t: n.top, r: n.right, b: n.bottom };
          const pins = [...r.querySelectorAll('button.pin:not(.draft)')].map((b) => box(b.getBoundingClientRect())).filter((q) => q.b > 0 && q.t < innerHeight);
          const card = r.querySelector('.card:not(.out)');
          return { pins, card: box(card?.getBoundingClientRect()), reply: box(card?.querySelector('textarea')?.getBoundingClientRect()), vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
        });
      const inside = (q, s) => q && q.l >= 11 && q.r <= s.vw - 11 && q.t >= 7 && q.b <= s.vh - 7;
      const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
      const side = (c, q) => (c.t >= q.b - 2 ? 'below' : c.b <= q.t + 2 ? 'above' : c.l >= q.r - 2 ? 'right' : c.r <= q.l + 2 ? 'left' : 'over');
      // Opens thread p<id> with its words at `at` px from the window's top (a pin on a page is at its words).
      const openAt = async (id, at) => {
        await p.evaluate(([i, y]) => { const r = document.querySelector(`#p${i}`).getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - y); }, [id, at]);
        await sleep(500);
        const pin = (await look()).pins[0];
        await p.mouse.click((pin.l + pin.r) / 2, (pin.t + pin.b) / 2);
        await sleep(900);
        return look();
      };
      const close = async () => (await p.keyboard.press('Escape'), await sleep(500));

      await ready('/');
      for (const [name, id, at] of [['near the window\'s bottom edge', 5, 740], ['near its top edge', 15, 40], ['in the middle (too low for the card below it, too high above it)', 25, 400], ['on the bottom edge, 3 px from it', 35, 790]]) {
        const s = await openAt(id, at);
        const q = s.pins[0];
        check(eng, `pin ${name}: the whole card and its reply box are in the window`, inside(s.card, s) && inside(s.reply, s), JSON.stringify(s));
        check(eng, `pin ${name}: the pin is in sight and the card is not over it`, q && inside(q, { ...s, vh: s.vh + 8 }) && apart(q, s.card), JSON.stringify([q, s.card]));
        const first = side(s.card, q);
        await close();
        const again = await openAt(id, at);
        check(eng, `pin ${name}: opened again it goes to the same place (${first})`, Math.abs(again.card.l - s.card.l) < 1 && Math.abs(again.card.t - s.card.t) < 1, JSON.stringify([s.card, again.card]));
        await close();
      }

      // A small scroll moves the card with its pin by exactly the pin's movement, one step at a time, and never turns it over.
      for (const [id, at] of [[5, 740], [15, 40], [25, 400]]) {
        const s = await openAt(id, at);
        const first = side(s.card, s.pins[0]);
        const rel = (x) => [x.card.l - x.pins[0].l, x.card.t - x.pins[0].t];
        const start = rel(s);
        let worst = 0;
        let turned = false;
        for (const d of [3, 3, 3, 3, 3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 3, 3, 3, 3, 3]) {
          await p.mouse.wheel(0, d);
          await sleep(70);
          const n = await look();
          worst = Math.max(worst, Math.abs(rel(n)[0] - start[0]), Math.abs(rel(n)[1] - start[1]));
          if (side(n.card, n.pins[0]) !== first) turned = true;
        }
        check(eng, `pin at ${at}px: ±3 px of scrolling moves the card exactly with its pin (worst drift ${worst.toFixed(2)} px)`, worst < 0.6, JSON.stringify([start, worst]));
        check(eng, `pin at ${at}px: a small scroll never turns the card over (${first})`, !turned);
        await close();
      }
      // Scrolled on, the card stays with its pin (off the window with it), not held to its edge.
      {
        const s = await openAt(15, 40);
        await p.mouse.wheel(0, 300);
        await sleep(300);
        const n = await look();
        check(eng, 'scrolled 300 px, the card went up by 300 px with its pin, past the window\'s top, not stuck to it', n.card.t < 0 && Math.abs(n.card.t - (s.card.t - 300)) < 1, JSON.stringify([s.card, n.card]));
        await close();
      }

      // A narrower window: no room at the sides, the card below or above the pin, whole.
      await p.setViewportSize({ width: 560, height: 700 });
      await sleep(400);
      for (const [id, at] of [[5, 640], [15, 60]]) {
        const s = await openAt(id, at);
        check(eng, `in a 560 px window, pin at ${at}px: the whole card and its reply box are in the window`, inside(s.card, s) && inside(s.reply, s), JSON.stringify(s));
        check(eng, `in a 560 px window, pin at ${at}px: the card is not over its pin`, apart(s.pins[0], s.card), JSON.stringify([s.pins[0], s.card]));
        await close();
      }
      await p.setViewportSize({ width: 1200, height: 800 });

      // A board: a pin near the screen's bottom, one near its top and one in the middle; the card is whole and off its pin.
      await ready('/_lab/board/cp');
      const frame = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const spots = [[frame.x + 100, Math.min(frame.y + frame.h - 20, 770)], [frame.x + 40, Math.max(frame.y + 30, 60)], [frame.x + 160, 400]];
      for (const [x, y] of spots) {
        await withAlt(p, () => p.mouse.click(x, y));
        await sleep(500);
        if (await sh((r) => Boolean(r.querySelector('.float textarea')))) {
          await p.keyboard.type(`a pin at ${Math.round(y)}`);
          await p.keyboard.press('Enter');
          await sleep(700);
        }
        await p.keyboard.press('Escape');
        await sleep(300);
      }
      // Five replies on each, so a card is as tall as they come.
      const board = (await (await fetch(`${B}/_lab/api/comments?page=/_board/cp`)).json()).comments.filter((c) => !c.parent);
      for (const c of board) for (let k = 0; k < 5; k++) await post({ page: '/_board/cp', name: k % 2 ? 'Ann' : 'Sam', text: `reply number ${k} with some words to wrap around the card a bit more than once`, parent: c.id });
      await ready('/_lab/board/cp');
      const pins = await sh((r) => [...r.querySelectorAll('button.pin:not(.draft)')].map((b) => { const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; }));
      check(eng, 'three pins on the board', pins.length === 3, JSON.stringify(pins));
      for (const [x, y] of pins) {
        await p.mouse.click(x, y);
        await sleep(900);
        const s = await look();
        const q = s.pins.find((b) => Math.abs((b.l + b.r) / 2 - x) < 3 && Math.abs((b.t + b.b) / 2 - y) < 3);
        check(eng, `board pin at ${Math.round(y)}px: the whole card and its reply box are in the window`, inside(s.card, s) && inside(s.reply, s), JSON.stringify(s));
        check(eng, `board pin at ${Math.round(y)}px: the card is not over its pin`, Boolean(q) && apart(q, s.card), JSON.stringify([q, s.card]));
        await close();
      }
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
