// One board, one set of comments: a board about a page opens over that page, also from its old address (/_lab/board/<name>)
// and from a link on another page; a pin made there is the page's comment and is drawn by the board's view on the page;
// a pin left on the old address before is moved to the page. Not part of `npm test`.
// Run: node test/browser/boardhome.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardhome-');
const PORT = claimPort(8330, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'cart.html'), '<!doctype html><meta charset="utf-8"><title>Cart</title><h1>Cart</h1><a id="go" href="/_lab/board/shop">the shop board</a>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
fs.mkdirSync(path.join(DIR, '.lab/boards'), { recursive: true });
fs.mkdirSync(path.join(DIR, '.lab/comments'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.lab/boards/shop.json'), JSON.stringify({ v: 1, name: 'shop', rev: 1, of: '/pricing', frames: [{ id: 'a', src: '/pricing', w: 390, h: 844, state: 'live' }, { id: 'b', src: '/pricing', w: 820, h: 600, state: 'live' }] }));
// A pin from before: left on the board's own address.
fs.writeFileSync(path.join(DIR, '.lab/comments/_5fboard_2fshop.json'), JSON.stringify({ page: '/_board/shop', comments: { old1: { id: 'old1', name: 'leo', text: 'from the old address', createdAt: '2026-11-18T10:00:00.000Z', num: 1, anchor: { kind: 'board', board: 'shop', frame: 'b', fx: 100, fy: 100, bx: 0, by: 0 } } } }));
const server = startLab(DIR, labEnv());
await labUp(B);
const stored = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${page}`)).json()).comments || [];
const pins = (p) => p.evaluate(() => [...document.querySelectorAll('*')].reduce((n, e) => n + (e.shadowRoot?.querySelectorAll('button.pin').length || 0), 0));
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      // The board's own address goes to the page, the board open over it.
      await p.goto(B + '/_lab/board/shop');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      await sleep(1000);
      const at = await p.evaluate(() => ({ path: location.pathname, hash: location.hash, own: document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('.bv-grip') !== null }));
      check(eng, 'the old address ends on the page with the board open over it (#board=shop, the half-view bar)', at.path === '/pricing' && at.hash === '#board=shop' && at.own, JSON.stringify(at));
      check(eng, 'the pin left on the old address is drawn there (it is the page\'s now)', (await stored('/pricing')).some((c) => c.id === 'old1') && (await pins(p)) === 1, String(await pins(p)));
      // A tap on frame a makes a pin: the page's comment, not the old address's.
      const a = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect(); return { x: r.x, y: r.y }; });
      await withAlt(p, () => p.mouse.click(a.x + 60, a.y + 80));
      await sleep(400);
      await p.keyboard.type('one set of pins');
      await p.keyboard.press('Enter');
      let made;
      for (let i = 0; i < 30 && !made; i++) { await sleep(150); made = (await stored('/pricing')).find((c) => c.text === 'one set of pins'); }
      check(eng, 'a pin made on the board is stored on the page with the board anchor', made?.anchor?.kind === 'board' && made.anchor.board === 'shop' && made.anchor.frame === 'a', JSON.stringify(made?.anchor));
      check(eng, 'nothing is stored under the board\'s own address', (await stored('/_board/shop')).length === 0);
      await sleep(500);
      check(eng, 'the board\'s view draws both pins', (await pins(p)) === 2, String(await pins(p)));
      // A reload opens the board again with both.
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      await sleep(1000);
      check(eng, 'after a reload the page opens the board with both pins', (await pins(p)) === 2, String(await pins(p)));
      // From another page: the link goes to the board's page (no board over the cart, no third set of pins).
      const q = await ctx.newPage();
      q.on('pageerror', (e) => console.log('pageerror', e.message));
      await q.goto(B + '/cart');
      await q.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(600);
      await q.click('#go');
      await q.waitForFunction(() => location.pathname === '/pricing' && document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      await sleep(800);
      check(eng, 'a link to the board on another page opens it over the board\'s page', q.url().endsWith('/pricing#board=shop'), q.url());
      await q.goBack();
      await sleep(1200);
      check(eng, 'back from there is the page it came from, not a loop', new URL(q.url()).pathname === '/cart' && !(await q.evaluate(() => Boolean(document.querySelector('[data-lab-board-view]')))), q.url());
      check(eng, 'still one set of comments', (await stored('/cart')).length === 0 && (await stored('/pricing')).length === 2);
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
