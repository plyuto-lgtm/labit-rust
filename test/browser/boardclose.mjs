// A click outside closes what is open on a board, as it does on a page (Leo, 19 Nov: "clicking outside comment should
// work here same as on page", "same with chat"): an open thread, a new comment's box and the chat close on a click on
// the empty canvas or on a frame (a board is always in comment mode, like a page); that click only closes (it starts no
// comment); a pan or a drag is no click and closes nothing; a press inside an entered frame closes too.
// On the board page and in a page's board view. Not part of `npm test`.
// Run: node test/browser/boardclose.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardclose-');
const PORT = claimPort(8330, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'canvas.html'), '<!doctype html><meta charset="utf-8"><title>Canvas</title><h1>Canvas</h1><a id="go" href="/_lab/board/pricing?of=%2Fcanvas">open the board</a>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 820, h: 600, x: 500, y: 0 }] }) });
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      for (const [where, url] of [['board page', `${B}/_lab/board/pricing?of=%2Fcanvas`], ['board view', `${B}/canvas#board=pricing`]]) {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'zz-close'); localStorage.setItem('lab-on', '1'); localStorage.setItem('lab-board-size:/canvas', '1'); }); // full: the canvas above the frames is the board's
        const p = await ctx.newPage();
        p.on('pageerror', (e) => console.log('pageerror', e.message));
        await p.goto(url);
        await p.waitForFunction(() => window.__labBoard && window.__labBoardWidget && document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]'), null, { timeout: 8000 });
        await sleep(1200);
        const look = () => p.evaluate(() => {
          const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
          const chat = r?.querySelector('.chatwin');
          return { card: Boolean(r?.querySelector('.card:not(.out)')), draft: Boolean(r?.querySelector('.float:not(.out)')), chat: Boolean(chat && !chat.hidden && chat.offsetHeight), pins: r?.querySelectorAll('.pin:not(.draft)').length || 0, sel: window.__labBoard.selected(), cam: window.__labBoard.camera() };
        });
        const rect = (id) => p.evaluate((i) => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
        const pinAt = () => p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.pin:not(.draft)').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const a = await rect('a');
        const b = await rect('b');
        const empty = { x: b.x + b.w * 0.7, y: a.y - 60 }; // the canvas above frame b, clear of the open card
        // a pin on frame a (an ⌥-click, words, Enter)
        if (!(await look()).pins) {
          await withAlt(p, () => p.mouse.click(a.x + 40, a.y + a.h / 4));
          await sleep(400);
          await p.keyboard.type('a note');
          await p.keyboard.press('Enter');
          await p.waitForFunction(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.pin:not(.draft)'), null, { timeout: 4000 });
          // while its card offers undo, a click on the canvas only closes it: the pin stays, no new comment begins
          await sleep(300);
          const u0 = await look();
          await p.mouse.click(empty.x, empty.y);
          await sleep(400);
          const u1 = await look();
          // A sent pin's undo card is #248's (not merged): without it the click starts a new comment, which goes.
          if (u0.card) check(eng, `${where}: while a sent pin offers undo, a click on the canvas only closes its card`, !u1.card && !u1.draft && u1.pins === u0.pins, JSON.stringify([u0, u1]));
          else if (u1.draft) await p.keyboard.press('Escape');
          await sleep(3000);
        }
        const open = async () => { const at = await pinAt(); await p.mouse.click(at.x, at.y); await sleep(350); };
        {
          const m = 'comment mode';
          // ----- an open thread: a click on the empty canvas closes it, and only that
          await open();
          const s0 = await look();
          await p.mouse.click(empty.x, empty.y);
          await sleep(400);
          let s = await look();
          check(eng, `${where}, ${m}: a click on the empty canvas closes the open thread, and only that`, s0.card && !s.card && !s.draft && s.sel === s0.sel, JSON.stringify([s0, s]));
          // ----- on a frame: the same (nothing selected by it, no comment begun)
          await open();
          await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
          await sleep(400);
          s = await look();
          check(eng, `${where}, ${m}: a click on a frame closes it too, selecting nothing and starting no comment`, !s.card && !s.draft && s.sel === s0.sel, JSON.stringify(s));
          // ----- a pan is no click: two fingers on the trackpad (the wheel) move the board and close nothing; nor does a
          // drag (a drag draws an area, as on a page)
          await open();
          const c0 = (await look()).cam;
          await p.mouse.move(empty.x, empty.y);
          await p.mouse.wheel(40, 30);
          await sleep(300);
          s = await look();
          const ok = s.card && (s.cam.x !== c0.x || s.cam.y !== c0.y);
          check(eng, `${where}, ${m}: a pan closes nothing`, ok, JSON.stringify([c0, s]));
          await p.keyboard.press('Escape');
          await sleep(250);
          await p.keyboard.press('Shift+Digit1');
          await sleep(350);
          // ----- the chat
          await p.keyboard.press('KeyT'); // the chat (C is comment mode)
          await sleep(450);
          const c1 = await look();
          await p.mouse.click(empty.x, empty.y);
          await sleep(450);
          s = await look();
          check(eng, `${where}, ${m}: a click on the canvas closes the chat, and only that`, c1.chat && !s.chat && !s.draft && s.sel === c1.sel, JSON.stringify([c1, s]));
        }
        // ----- a new comment's box (⌥-click): the next click outside only closes it
        await withAlt(p, () => p.mouse.click(b.x + b.w / 3, b.y + b.h / 3));
        await sleep(400);
        const d0 = await look();
        await p.mouse.click(empty.x, empty.y);
        await sleep(400);
        let s = await look();
        check(eng, `${where}: a click outside a new comment's box closes it and starts no other`, d0.draft && !s.draft && !s.card, JSON.stringify([d0, s]));
        // ----- an entered frame: a press inside its page closes the open thread
        await p.evaluate((i) => { for (let n = 0; n < 9 && __labBoard.selected() !== i; n++) __labBoard.key({ key: 'Tab', code: 'Tab' }); __labBoard.key({ key: 'Enter', code: 'Enter' }); }, 'b'); // Tab to it, Enter opens it (a click on its label does not)
        await p.evaluate(() => __labBoard.key({ key: '!', code: 'Digit1', shiftKey: true })); // Tab moved the camera to it: all in view again
        await sleep(900);
        const bNow = await rect('b');
        await open();
        const e0 = await look();
        await p.mouse.click(bNow.x + bNow.w / 2, bNow.y + bNow.h / 2 + 40);
        await sleep(450);
        s = await look();
        check(eng, `${where}: a press inside an entered frame closes the open thread`, e0.card && !s.card && (await p.evaluate(() => window.__labBoard.entered())) === 'b', JSON.stringify([e0, s]));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
