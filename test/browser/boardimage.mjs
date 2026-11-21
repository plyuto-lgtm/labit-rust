// A picture put on a board in real browsers (WebKit and Chrome's engine): the "+ image" button, a paste with the pointer over
// the board, a paste into a comment box (left alone), a pin on the picture. Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';
import { png } from '../pictures.mjs';

const pw = playwright();
const DIR = tmp('labit-boardimage-');
const PORT = claimPort(8380, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const put = (name, frames) => fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames }) }).then((r) => r.json());
const frames = async (name) => (await (await fetch(`${B}/_lab/api/board?name=${name}`)).json()).frames;
try {
  for (const eng of engines()) {
    const name = `pics-${eng}`;
    await put(name, [{ id: 'a', src: '/pricing', w: 600, h: 400 }]);
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(`${B}/_lab/board/${name}`);
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      await sleep(1500);
      const rect = (id) => p.evaluate((i) => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"]`)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
      const shown = (id) => p.evaluate((i) => { const im = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"] img`); return im ? im.naturalWidth : -1; }, id);
      const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(150); } return false; };

      // "+ image": the file picker's input
      check(eng, 'a "+ image" button is in the corner cluster', await p.locator('.zm .zi').count() === 1);
      await p.locator('.zm input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png(64, 48) });
      const b = await until(async () => (await frames(name)).find((f) => f.id === 'b'));
      check(eng, 'a picked file is a new image frame with the picture in it', b?.kind === 'image' && b.iw === 64 && await until(async () => (await shown('b')) > 0), JSON.stringify(b));

      // a paste with the pointer over the board: the picture, drawn at 3000 × 2000, is sent smaller and lands under the pointer
      await p.mouse.move(700, 500);
      await sleep(200);
      const before = (await frames(name)).length;
      await p.evaluate(async () => {
        const cv = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 });
        const g = cv.getContext('2d');
        g.fillStyle = '#3a7'; g.fillRect(0, 0, 3000, 2000);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      const c = await until(async () => (await frames(name)).find((f) => f.id === 'c'));
      if (!c && !(await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.png', { type: 'image/png' })); return new ClipboardEvent('paste', { clipboardData: dt }).clipboardData?.items.length === 1; }))) console.log(`skip ${eng}   this engine drops clipboardData from a synthetic paste`);
      else {
        check(eng, 'a paste adds an image frame', before === 2 && c?.kind === 'image', JSON.stringify(c));
        check(eng, 'it is sent at 2400 px or less, never the 3000 it was drawn at', c && Math.max(c.iw, c.ih) <= 2400, JSON.stringify(c));
        check(eng, 'its centre is where the pointer was (the pointer on the board, in world px)', Boolean(c) && await until(async () => { const r = await rect('c'); return r && Math.abs(r.x + r.w / 2 - 700) < 6 && Math.abs(r.y + r.h / 2 - 500) < 6; }), JSON.stringify(await rect('c')));
        check(eng, 'and the picture shows', await until(async () => (await shown('c')) > 0));
      }

      // a pin on the picture is an ordinary board pin
      const r = await rect('c'); // on top of the frames it was pasted over
      await p.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('textarea')), null, { timeout: 4000 }).catch(() => {});
      const area = p.locator('textarea').first();
      check(eng, 'a click on the picture opens the comment box', await area.count() > 0);
      // a paste with focus in the comment box is the box's own: no frame is added
      const n1 = (await frames(name)).length;
      await area.focus();
      await p.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' }));
        (document.activeElement?.shadowRoot?.activeElement || document.activeElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await sleep(800);
      check(eng, 'a paste into the comment box adds no frame', (await frames(name)).length === n1);
      await p.locator('.atts .x').first().click({ timeout: 1500 }).catch(() => {}); // with comment pictures (attach.ts) the box takes the paste as an attachment: not a real picture here, so it goes
      await area.focus();
      await p.keyboard.type('crop here');
      await p.keyboard.press('Enter');
      let saved;
      for (let i = 0; i < 30 && !saved; i++) { await sleep(150); saved = (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments?.[0]; }
      check(eng, 'the pin on the picture is anchored to the picture, not the frame under it', saved?.anchor?.kind === 'board' && saved.anchor.frame === 'c', JSON.stringify(saved?.anchor));
      const sp = saved?.anchor;
      check(eng, 'and it says where on the file: the file, its size, and the spot as shares of it (centre click: half across, half down)', /^c\.(png|webp)$/.test(sp?.file || '') && sp.nw === 2400 && sp.nh === 1600 && Math.abs(sp.imgX - 0.5) < 0.03 && Math.abs(sp.imgY - 0.5) < 0.03, JSON.stringify(sp));

      // ⌥⌘V: the picture goes at the pointer and its own comment box opens on it (the keys held before the paste event carry the ⌥)
      await p.keyboard.press('Escape');
      await p.mouse.move(420, 300);
      await sleep(200);
      const pins0 = (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments?.length || 0;
      await p.keyboard.down('Alt');
      await p.evaluate(async () => {
        const cv = Object.assign(document.createElement('canvas'), { width: 600, height: 400 });
        cv.getContext('2d').fillRect(0, 0, 600, 400);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await until(async () => (await frames(name)).find((f) => f.id === 'd'));
      await p.keyboard.up('Alt');
      const boxOpen = await until(async () => (await p.locator('textarea').count()) > 0);
      check(eng, '⌥⌘V puts the picture down and opens its comment box', Boolean(boxOpen));
      await p.keyboard.type('this one');
      await p.keyboard.press('Enter');
      let alted;
      for (let i = 0; i < 30 && !alted; i++) { await sleep(150); alted = (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments?.find((x) => x.text === 'this one'); }
      check(eng, 'that comment is anchored to the new picture, near its centre', alted?.anchor?.frame === 'd' && Math.abs(alted.anchor.fx - 300) < 40 && Math.abs(alted.anchor.fy - 200) < 40, JSON.stringify(alted?.anchor));
      // a plain ⌘V never opens a box
      await p.keyboard.press('Escape');
      await p.mouse.move(900, 600);
      await sleep(200);
      await p.evaluate(async () => {
        const dt = new DataTransfer();
        const cv = Object.assign(document.createElement('canvas'), { width: 100, height: 100 });
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await until(async () => (await frames(name)).find((f) => f.id === 'e'));
      await sleep(600);
      check(eng, 'a plain paste opens no comment box', await p.locator('textarea').count() === 0);
      // ⌥-click on a picture frame comments on it as on any frame
      const rb = await rect('b');
      await p.keyboard.down('Alt');
      await p.mouse.click(rb.x + rb.w / 2, rb.y + rb.h / 2);
      await p.keyboard.up('Alt');
      check(eng, '⌥-click on a picture frame opens a comment box', Boolean(await until(async () => (await p.locator('textarea').count()) > 0)));
      void pins0;
      // an area dragged over the picture: its two corners on the file
      await p.keyboard.press('Escape');
      await p.mouse.move(5, 5);
      const rc = await rect('c');
      // (the part of c the pictures pasted over it, d and e, do not cover: 72%–83% across, 60%–72% down)
      await p.mouse.move(rc.x + rc.w * 0.72, rc.y + rc.h * 0.6);
      await p.mouse.down();
      await p.mouse.move(rc.x + rc.w * 0.78, rc.y + rc.h * 0.66, { steps: 6 });
      await p.mouse.move(rc.x + rc.w * 0.83, rc.y + rc.h * 0.72, { steps: 6 });
      await p.mouse.up();
      await until(async () => (await p.locator('textarea').count()) > 0);
      await p.keyboard.type('this part');
      await p.keyboard.press('Enter');
      let drawn;
      for (let i = 0; i < 30 && !drawn; i++) { await sleep(150); drawn = (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments?.find((x) => x.text === 'this part'); }
      const aa = drawn?.anchor;
      check(eng, 'an area on the picture says its corners on the file (72%–83% across, 60%–72% down)', Boolean(aa) && aa.frame === 'c' && Math.abs(aa.imgX - 0.72) < 0.04 && Math.abs(aa.imgX2 - 0.83) < 0.04 && Math.abs(aa.imgY - 0.6) < 0.04 && Math.abs(aa.imgY2 - 0.72) < 0.04, JSON.stringify(aa));
      check(eng, 'and the agent reads it as an area in the original, with the file path', Boolean(drawn) && /on: image "c\.(png|webp)" \(pasted onto this board: \.lab\/boards\/[^)]+\)\narea in original: 7\d%–8\d% across, 6\d%–7\d% down of 2400×1600 \(pixels 1[67]\d\d,9\d\d to 19\d\d,1[01]\d\d\)/.test(await (await fetch(`${B}/_lab/agent/_board/${name}`)).text()));
      // a wide banner sits in a 200 px tall frame with bars above and below: a point on a bar is held to the picture's edge
      await p.keyboard.press('Escape');
      await p.locator('.zm input[type=file]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: png(3000, 150) });
      const banner = await until(async () => (await frames(name)).find((f) => f.kind === 'image' && f.iw === 2400 && f.ih === 120));
      check(eng, 'a banner picture is drawn again at 2400 px and held to a 200 px tall frame', Boolean(banner) && banner.h === 200, JSON.stringify(banner));
      await until(async () => (await shown(banner?.id)) > 0);
      await p.keyboard.press('Shift+Digit1'); // fit all
      await sleep(600);
      const rbn = await rect(banner.id);
      await p.mouse.click(rbn.x + rbn.w / 2, rbn.y + 3); // on the bar above the picture
      await until(async () => (await p.locator('textarea').count()) > 0);
      await p.keyboard.type('bar');
      await p.keyboard.press('Enter');
      let onbar;
      for (let i = 0; i < 30 && !onbar; i++) { await sleep(150); onbar = (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments?.find((x) => x.text === 'bar'); }
      check(eng, 'a pin on the bar above the picture is held to its top edge (0% down) and halfway across', Boolean(onbar) && onbar.anchor.frame === banner.id && onbar.anchor.imgY === 0 && Math.abs(onbar.anchor.imgX - 0.5) < 0.03, JSON.stringify(onbar?.anchor));
      // a picture off the board and back (e, the last pasted, lies on top): Backspace with the pointer on it, ⌘Z, the × over its corner
      await p.keyboard.press('Escape');
      await p.keyboard.press('Shift+Digit1');
      await sleep(700);
      const bBefore = (await frames(name)).find((f) => f.id === 'e');
      const rb3 = await rect('e');
      await p.mouse.move(rb3.x + rb3.w / 2, rb3.y + rb3.h / 2);
      await sleep(250);
      await p.keyboard.press('Backspace');
      check(eng, 'Backspace with the pointer on a picture takes it off the board (archived)', Boolean(await until(async () => (await frames(name)).find((f) => f.id === 'e')?.state === 'archived')));
      check(eng, 'the picture is gone from the board, its file kept', Boolean(await until(async () => (await rect('e')) == null)) && (await fetch(`${B}/_lab/board/${name}/e`)).status === 200);
      check(eng, 'the agent reads the frame as archived', /\ne {2}pasted image [^\n]*archived/.test(await (await fetch(`${B}/_lab/agent/_board/${name}`)).text()));
      await p.keyboard.press('Control+z');
      const back = await until(async () => { const f = (await frames(name)).find((g) => g.id === 'e'); return f?.state === 'live' ? f : null; });
      check(eng, '⌘Z puts it back, in the same place', Boolean(back) && back.x === bBefore.x && back.y === bBefore.y && Boolean(await until(async () => (await rect('e')) != null)), JSON.stringify([bBefore, back]));
      await p.keyboard.press('Shift+Digit1');
      await sleep(600);
      const rc2 = await rect('d');
      await p.mouse.move(rc2.x + rc2.w / 2, rc2.y + rc2.h / 2);
      await sleep(250);
      await p.locator('.f[data-id="d"] .rm').click({ force: true });
      check(eng, 'the × over a picture takes it off too', Boolean(await until(async () => (await frames(name)).find((f) => f.id === 'd')?.state === 'archived')));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
