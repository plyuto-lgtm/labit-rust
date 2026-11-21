// The board page in real browsers (WebKit and Chrome's engine): frames on one canvas, panned and zoomed, live pages in
// them, selecting and entering one, the board file followed, phones too. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/board.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-board-');
const PORT = claimPort(8080, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'checkout.html'), '<!doctype html><meta charset="utf-8"><title>Checkout</title><h1>Checkout</h1>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const put = (name, frames, extra = {}) => fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames, ...extra }) }).then((r) => r.json());
const grid = (n) => Array.from({ length: n }, (_, i) => ({ id: 'f' + i, src: '/pricing', w: 300, h: 300, x: (i % 5) * 340, y: Math.floor(i / 5) * 340 }));
await put('ten', grid(10));
await put('three', [{ id: 'a', src: '/pricing', w: 390, h: 844 }, { id: 'b', src: '/pricing', w: 820, h: 1180 }, { id: 'c', src: '/checkout', w: 390, h: 844 }]); // no page: a board about a page opens over it (boardhome.mjs)
await put('two', [{ id: 'a', src: '/pricing', w: 300, h: 300, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 300, h: 300, x: 500, y: 0 }]);
await put('wide', [{ id: 'a', src: '/pricing', w: 1000, h: 700, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 1000, h: 700, x: 4000, y: 3000 }]);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const p = await ctx.newPage();
      const cam = () => p.evaluate(() => __labBoard.camera());
      const bw = (ms = 2500) => sleep(ms);
      // ----- ten frames: the cap, and the widget in them draws nothing
      await p.goto(B + '/_lab/board/ten');
      await bw(4000);
      const ten = await p.evaluate(() => ({ live: __labBoard.live().length, cards: document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f').length, scroll: [scrollX, scrollY], hosts: document.querySelectorAll('[data-lab-comments]').length, bodyOverflow: getComputedStyle(document.body).overflow }));
      check(eng, 'ten frames: all ten are on the board, at most 8 are alive', ten.cards === 10 && ten.live === 8, JSON.stringify(ten));
      check(eng, 'the board page has one widget (its own), none in the frames', ten.hosts === 1, String(ten.hosts));
      const inner = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]').shadowRoot.querySelectorAll('iframe')].map((f) => f.contentDocument?.querySelectorAll('[data-lab-comments]').length));
      check(eng, 'no frame has a widget in it', inner.every((n) => n === 0), JSON.stringify(inner));
      const titleCard = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f')].map((f) => f.querySelector('.c')?.textContent).filter(Boolean));
      check(eng, 'a frame not alive is a title card: label, size, no count', titleCard.length === 2 && titleCard.every((t) => /\/pricing/.test(t) && /300 × 300/.test(t) && !/comment|pin|\d+ open/i.test(t)), JSON.stringify(titleCard));
      // ----- inputs
      const c0 = await cam();
      await p.mouse.move(600, 400);
      await p.mouse.wheel(0, 300);
      await sleep(200);
      const c1 = await cam();
      check(eng, 'a wheel pans the board, never the page', c1.y < c0.y + 0.001 && (await p.evaluate(() => scrollY)) === 0 && c1.z === c0.z, JSON.stringify([c0, c1]));
      await p.keyboard.press('Shift+Digit2');
      await sleep(200);
      check(eng, 'Shift+2 goes to 100%', (await cam()).z === 1);
      await p.keyboard.press('Shift+Digit1');
      await sleep(200);
      const fit = await cam();
      check(eng, 'Shift+1 fits everything again', fit.z < 1 && Math.abs(fit.z - c0.z) < 0.01, JSON.stringify(fit));
      // zoom about the cursor: the world point under it stays under it
      const box = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board').getBoundingClientRect(); return [r.x, r.y]; }); // under the view's bar
      const under = (c, x, y) => [(x - box[0]) / c.z - c.x, (y - box[1]) / c.z - c.y];
      const before = under(await cam(), 700, 300);
      await p.keyboard.down('Control');
      await p.mouse.move(700, 300);
      await p.mouse.wheel(0, -20);
      await p.keyboard.up('Control');
      await sleep(200);
      const z1 = await cam();
      const after = under(z1, 700, 300);
      check(eng, 'Ctrl + wheel zooms about the cursor', z1.z > fit.z && Math.abs(before[0] - after[0]) < 0.5 && Math.abs(before[1] - after[1]) < 0.5, JSON.stringify([fit.z, z1.z, before, after]));
      check(eng, 'a pinch never zooms the page (no gesture reached it)', (await p.evaluate(() => visualViewport.scale)) === 1);
      // ----- Tab, enter with Enter, leave (focus goes back to the board); frames are never selected
      await p.keyboard.press('Shift+Digit1');
      await sleep(200);
      await p.keyboard.press('Tab');
      await sleep(400);
      const tabbed = await p.evaluate(() => ({ at: __labBoard.selected(), ring: document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f.sel').length }));
      check(eng, 'Tab moves the camera to a frame and draws no selection ring', Boolean(tabbed.at) && tabbed.ring === 0, JSON.stringify(tabbed));
      const lab = await p.locator('#lab-board .f[data-id="f0"] .t').boundingBox();
      await p.mouse.click(lab.x + 8, lab.y + lab.height / 2);
      await sleep(400);
      const clicked = await p.evaluate(() => ({ entered: __labBoard.entered(), ring: document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f.sel').length, chips: document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .t u').length }));
      check(eng, 'a click on the frame\'s label opens nothing: no ring, no size list', clicked.entered === '' && clicked.ring === 0 && clicked.chips === 0, JSON.stringify(clicked));
      await p.keyboard.press('Enter');
      await sleep(400);
      const inFrame = await p.evaluate(() => ({ entered: __labBoard.entered(), pe: getComputedStyle(__labBoard.frame('f0')).pointerEvents, focus: document.querySelector('[data-lab-board-view]').shadowRoot.activeElement === __labBoard.frame('f0') }));
      check(eng, 'Enter on the frame Tab moved to gives the page in the frame the pointer and the focus', inFrame.entered === 'f0' && inFrame.pe === 'auto' && inFrame.focus, JSON.stringify(inFrame));
      await p.keyboard.press('Escape');
      await sleep(250);
      const out = await p.evaluate(() => ({ entered: __labBoard.entered(), pe: getComputedStyle(__labBoard.frame('f0')).pointerEvents, body: document.activeElement === document.body, sel: __labBoard.selected() }));
      check(eng, 'Esc in a frame leaves it: the board has the focus again', out.entered === '' && out.pe === 'none' && out.body, JSON.stringify(out));
      await p.keyboard.press('Shift+Digit2'); // the board hears keys after leaving: this would go to the frame otherwise
      await sleep(150);
      check(eng, 'after leaving, board keys work again (Shift+2)', (await cam()).z === 1);
      // ----- finite edges
      await p.keyboard.press('Shift+Digit1');
      for (let i = 0; i < 10; i++) await p.mouse.wheel(-4000, -4000);
      await sleep(300);
      const edge = await cam();
      check(eng, 'panning stops at the edge: some of the board stays in view', (await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .world').getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; })), JSON.stringify(edge));
      // ----- two boards, one with frames far apart
      await p.goto(B + '/_lab/board/wide');
      await bw(2500);
      const w = await p.evaluate(() => ({ cam: __labBoard.camera(), live: __labBoard.live() }));
      check(eng, 'frames far apart: fit shows both, the small ones are still readable titles or live', w.cam.z < 0.3 && w.live.length <= 2, JSON.stringify(w));
      // ----- save a frame's page: the board does not reload, the frame follows
      await p.goto(B + '/_lab/board/three');
      await bw(2500);
      await p.evaluate(() => (window.__same = 1));
      fs.writeFileSync(path.join(DIR, 'pricing.html'), fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8').replace('Pricing one', 'Pricing two'));
      await sleep(2500);
      const saved = await p.evaluate(() => ({ same: window.__same === 1, text: [...document.querySelector('[data-lab-board-view]').shadowRoot.querySelectorAll('iframe')].map((f) => f.contentDocument?.querySelector('h1')?.textContent) }));
      check(eng, 'a save does not reload the board; frames of that page follow', saved.same && saved.text.some((t) => t === 'Pricing two'), JSON.stringify(saved));
      // ----- the board file changes: the board follows
      await put('three', [{ id: 'a', src: '/pricing', w: 390, h: 844 }, { id: 'b', src: '/pricing', w: 820, h: 1180 }, { id: 'c', src: '/checkout', w: 390, h: 844 }, { id: 'd', src: '/checkout', w: 820, h: 1180 }], { rev: (await (await fetch(`${B}/_lab/api/board?name=three`)).json()).rev });
      await sleep(2500);
      check(eng, 'a frame added to the board file shows up', (await p.evaluate(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f').length)) === 4);
      // ----- a board that does not exist
      await p.goto(B + '/_lab/board/nothere');
      await sleep(1200);
      check(eng, 'a board that does not exist says so', /no board called nothere/i.test(await p.evaluate(() => document.body.textContent + (document.querySelector('[data-lab-board-view]')?.shadowRoot?.textContent || ''))));
      // ----- the board's own address is the one board: the view a page's board link opens, over an empty page
      await p.goto(B + '/_lab/board/three');
      await bw(1500);
      await p.mouse.move(600, 400);
      await p.mouse.wheel(30, 40);
      await sleep(900);
      const alone = await p.evaluate(() => { const v = document.querySelector('[data-lab-board-view="three"]'); const r = v?.getBoundingClientRect(); return { view: Boolean(v), whole: Boolean(r) && r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === innerHeight, inView: Boolean(v?.shadowRoot?.querySelector('#lab-board .world')), name: v?.shadowRoot?.querySelector('.bv-name')?.textContent, half: Boolean(v?.shadowRoot?.querySelector('.bv-size, .bv-grip')), close: Boolean(v?.shadowRoot?.querySelector('.bv-close')), title: document.title, hash: location.hash, entries: history.length }; });
      check(eng, 'the board page is the board view over the whole window, named, with no half and no close (nothing is under it)', alone.view && alone.whole && alone.inView && alone.name === 'board three' && !alone.half && !alone.close && alone.title === 'board three', JSON.stringify(alone));
      check(eng, 'the board page keeps its camera in the address (a reload comes back there)', /^#-?\d+,-?\d+,[\d.]+$/.test(alone.hash), alone.hash);
      const backs = [];
      for (const how of ['button', 'Shift+KeyB', 'Escape']) {
        await p.goto(B + '/_lab/board/three?of=%2Fcheckout');
        await bw(1200);
        const label = await p.evaluate(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('.bv-close')?.textContent);
        if (how === 'button') await p.click('[data-lab-board-view] .bv-close');
        else await p.keyboard.press(how);
        await p.waitForURL(B + '/checkout', { timeout: 4000 }).catch(() => {});
        backs.push([how, label, new URL(p.url()).pathname]);
      }
      check(eng, 'a board page that names its page (?of=) goes back to it: "‹ back", ⇧B, Esc on an empty board', backs.every(([, label, at]) => label === '‹ back' && at === '/checkout'), JSON.stringify(backs));
      // ----- the pointer: the plain one on a board, the page's pin with ⌥ held (between the frames and on them), the hand with Space, the label's own
      await p.goto(B + '/pricing');
      await sleep(2500);
      const curAt = async (x, y) => { await p.mouse.move(x - 3, y - 3); await p.mouse.move(x, y); await sleep(120); return p.evaluate(([x, y]) => { let e = document.elementFromPoint(x, y); for (let i = 0; i < 3 && e?.shadowRoot && e.matches('[data-lab-board-view]'); i++) e = e.shadowRoot.elementFromPoint(x, y) || e; return { cursor: getComputedStyle(e).cursor, cls: e.className || e.id }; }, [x, y]); };
      const onPage = await curAt(600, 300);
      await p.goto(B + '/_lab/board/two');
      await bw(3500);
      const [f0, f1] = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f')].map((f) => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      const gap = await curAt((f0.x + f0.w + f1.x) / 2, f0.y + f0.h / 2);
      const empty = await curAt(600, 760);
      const onFrame = await curAt(f0.x + f0.w / 2, f0.y + f0.h / 2);
      const drawn = () => p.evaluate(() => [...document.querySelectorAll('*')].map((n) => n.shadowRoot?.querySelector('.ptr')).find(Boolean)?.classList.contains('show'));
      check(eng, 'a page in comment mode hides the system pointer (the drawn pin shows)', onPage.cursor === 'none', JSON.stringify(onPage));
      // Leo, 21 Nov: "regular cursor to operate on boards opt to call comment".
      check(eng, 'a board: the plain pointer between the frames, on the empty canvas and on a frame', [gap, empty, onFrame].every((c) => c.cursor === 'default'), JSON.stringify([gap, empty, onFrame]));
      check(eng, 'no drawn pin on the board without ⌥', (await drawn()) !== true);
      await p.keyboard.down('Alt');
      const altGap = await curAt((f0.x + f0.w + f1.x) / 2, f0.y + f0.h / 2);
      const altEmpty = await curAt(600, 760);
      const altFrame = await curAt(f0.x + f0.w / 2, f0.y + f0.h / 2);
      check(eng, '⌥ held: the page\'s pin pointer between the frames, on the empty canvas and on a frame', [altGap, altEmpty, altFrame].every((c) => c.cursor === onPage.cursor), JSON.stringify([altGap, altEmpty, altFrame]));
      check(eng, '⌥ held: the drawn pin shows on the board', (await drawn()) === true);
      await p.keyboard.up('Alt');
      const label = await curAt(f0.x + 10, f0.y - 8);
      check(eng, 'the frame label is plain text: no hand', label.cursor !== 'pointer', JSON.stringify(label));
      await p.mouse.move(600, 760);
      await p.keyboard.down('Space');
      await sleep(200);
      const space = await curAt(600, 760);
      const spaceFrame = await curAt(f0.x + f0.w / 2, f0.y + f0.h / 2);
      await p.keyboard.up('Space');
      await sleep(200);
      const released = await curAt(600, 760);
      check(eng, 'Space held: the hand over the canvas and the frames; let go: the plain pointer again', space.cursor === 'grab' && spaceFrame.cursor === 'grab' && released.cursor === 'default', JSON.stringify([space, spaceFrame, released]));
      await ctx.close();
      // ----- a phone: first view is every frame at a phone's width, side by side, live; no page zoom
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const q = await ph.newPage();
      await q.goto(B + '/_lab/board/three');
      await sleep(2500);
      const first = await q.evaluate(() => ({ cam: __labBoard.camera(), live: __labBoard.live(), vv: visualViewport.scale }));
      const widths = await q.evaluate(() => [...document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelectorAll('#lab-board .f')].map((f) => f.offsetWidth));
      check(eng, 'phone: the first view is every frame, 390 wide, the ones in view alive', widths.length > 1 && widths.every((w) => w === 390) && first.live.length >= 1 && first.cam.z < 0.9 && first.vv === 1, JSON.stringify({ ...first, widths }));
      await ph.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
