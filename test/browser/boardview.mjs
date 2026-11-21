// A board in the page that links it (src/board/overlay.ts): a click on the board's link opens it over the same page (no
// navigation, #board=<name>), a pin on frame b is the page's comment with the board's anchor, the view keeps its size
// per page, and closing it (‹ close, Esc, back) leaves the page scrolled where it was. Not part of `npm test`.
// Run: node test/browser/boardview.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardview-');
const PORT = claimPort(8300, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'canvas.html'), '<!doctype html><meta charset="utf-8"><title>Canvas</title><h1>Canvas</h1><div style="height:1500px"></div><section><h2>Pins in scrolling boxes</h2><a class="pr-row" id="go" href="/_lab/board/pricing?of=%2Fcanvas">open the board</a></section><div style="height:2000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 844, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 820, h: 600, x: 500, y: 0 }] }) });
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      // The pin is not stored: its POST is read and aborted.
      const posts = [];
      await ctx.route('**/_lab/api/comments**', (r) => {
        if (r.request().method() !== 'POST') return r.continue();
        posts.push(r.request().postDataJSON());
        return r.abort();
      });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/canvas');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(600);
      await p.evaluate(() => document.getElementById('go').scrollIntoView({ block: 'center' }));
      await sleep(300);
      const y0 = await p.evaluate(() => scrollY);
      const url0 = p.url();
      // A click on the page's own link follows it (the page is in comment mode, but a link keeps its click).
      await p.click('#go');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]'), null, { timeout: 6000 });
      await sleep(800);
      const st = await p.evaluate(() => ({ path: location.pathname, hash: location.hash, view: Boolean(document.querySelector('[data-lab-board-view]')), pills: [...document.querySelectorAll('*')].filter((n) => n.shadowRoot?.querySelector('.scrim')).length }));
      check(eng, 'the link opens the board over the same page, one widget', st.path === '/canvas' && st.hash === '#board=pricing' && st.view && st.pills === 1, JSON.stringify(st));
      // a tap on frame b pins
      const b = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
      await withAlt(p, () => p.mouse.click(b.x + 60, b.y + 80));
      await sleep(400);
      await p.keyboard.type('frame b note');
      await p.keyboard.press('Enter');
      for (let i = 0; i < 30 && !posts.length; i++) await sleep(100);
      const sent = posts[0];
      check(eng, 'a pin on frame b posts to the page with the board anchor', sent?.page === '/canvas' && sent.anchor?.kind === 'board' && sent.anchor.board === 'pricing' && sent.anchor.frame === 'b' && Math.abs(sent.anchor.fx - 60 / (b.w / 820)) < 3, JSON.stringify(sent));
      await sleep(300);
      // resize: half, kept for this page across a reload
      await p.keyboard.press('Escape'); // the draft (if any) goes first
      await sleep(200);
      const viewH = () => p.evaluate(() => document.querySelector('[data-lab-board-view]').getBoundingClientRect().height);
      const h0 = await viewH();
      check(eng, 'a board opens at half the window (Leo, 21 Nov: "open boards half not full by default")', Math.abs(h0 - 400) < 4, String(h0));
      await p.click('[data-lab-board-view] .bv-size');
      await sleep(400);
      const hFull = await viewH();
      await p.click('[data-lab-board-view] .bv-size');
      await sleep(400);
      const h1 = await viewH();
      check(eng, 'full / half makes the view the whole window, then half of it', Math.abs(hFull - 800) < 4 && Math.abs(h1 - 400) < 4, String([hFull, h1]));
      // the grip on its edge: dragged up to 70%
      const g = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('.bv-grip').getBoundingClientRect(); return { x: r.x + r.width / 3, y: r.y + r.height / 2 }; });
      await p.mouse.move(g.x, g.y);
      await p.mouse.down();
      await p.mouse.move(g.x, 240, { steps: 5 });
      await p.mouse.up();
      await sleep(300);
      const h2 = await p.evaluate(() => document.querySelector('[data-lab-board-view]').getBoundingClientRect().height);
      check(eng, 'the grip resizes it', Math.abs(h2 - 560) < 6, String(h2));
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 6000 });
      await sleep(500);
      const h3 = await p.evaluate(() => document.querySelector('[data-lab-board-view]').getBoundingClientRect().height);
      check(eng, 'a reload opens it again at the size kept for the page', Math.abs(h3 - h2) < 6, `${h3} vs ${h2}`);
      await p.click('[data-lab-board-view] .bv-size'); // back to full
      await sleep(200);
      await p.click('[data-lab-board-view] .bv-close');
      await sleep(400);
      // a reload put the page at its scroll anew: close from here, then open from the link again
      const y1 = await p.evaluate(() => scrollY);
      check(eng, 'close takes it away and the address loses #board', await p.evaluate(() => !document.querySelector('[data-lab-board-view]') && !location.hash));
      await p.evaluate(() => document.getElementById('go').scrollIntoView({ block: 'center' }));
      await sleep(200);
      const y2 = await p.evaluate(() => scrollY);
      await p.click('#go');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 6000 });
      await sleep(500);
      await p.mouse.wheel(0, 600); // over the board: pans it, never the page
      await sleep(400);
      const camLeft = await p.evaluate(() => window.__labBoard.camera());
      await p.keyboard.press('Escape');
      await sleep(500);
      const after = await p.evaluate(() => ({ y: scrollY, view: Boolean(document.querySelector('[data-lab-board-view]')), hash: location.hash }));
      check(eng, 'Esc closes it and the page is where it was scrolled', !after.view && !after.hash && Math.abs(after.y - y2) < 2 && p.url() === url0, JSON.stringify({ ...after, y2, y1, y0 }));
      await p.click('#go');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 6000 });
      await sleep(600);
      const camBack = await p.evaluate(() => window.__labBoard.camera());
      check(eng, 'opened again, the board is at the zoom and place it was left at (Leo, 21 Nov: "closing/opening board drawer should not move zoom/position inside board")', Math.abs(camBack.z - camLeft.z) < 1e-3 && Math.abs(camBack.x - camLeft.x) < 1.5 && Math.abs(camBack.y - camLeft.y) < 1.5, JSON.stringify([camLeft, camBack]));
      await p.goBack();
      await sleep(500);
      const back = await p.evaluate(() => ({ y: scrollY, view: Boolean(document.querySelector('[data-lab-board-view]')), path: location.pathname }));
      check(eng, 'back closes it, same page, same scroll', !back.view && back.path === '/canvas' && Math.abs(back.y - y2) < 2, JSON.stringify(back));
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
