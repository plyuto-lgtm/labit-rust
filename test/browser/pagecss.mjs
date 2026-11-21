// The widget against a hostile page: a page's own CSS (a * rule, !important, a transform on <body>, zoom, html font-size)
// can't change how the widget looks or where its pins stand (Leo, 20 Nov: "sometimes its own styles can be changed or
// broken by changes on that lab"). Each page here breaks one way a page can reach in; the same pin and its open card are
// measured on a calm page and on each of them. The board view (a board's own box over the page) is held to the same. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/pagecss.mjs (needs playwright; NODE_PATH can point at one).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-pagecss-');
const PORT = claimPort(10400, 30);
const B = `http://localhost:${PORT}`;
const BODY = '<h1 id="t">A hostile page</h1><p id="a" style="margin:40px 0 400px">A paragraph to drop a pin on, with some words.</p><div id="d"><span>x</span></div>';

// What each page does to the page itself; the widget has to stay the same.
const LOOK = {
  // Words: every inherited property a page can set on * or div, and the root's font size (rem).
  type: 'html{font-size:40px}*{font-style:italic;text-transform:uppercase;letter-spacing:5px;word-spacing:10px;text-indent:30px;text-align:center;line-height:3;font-family:serif;color:red;font-size:2rem;white-space:pre;direction:rtl;text-shadow:2px 2px red;font-variant:small-caps;font-weight:900;visibility:visible;cursor:wait}',
  typeimportant: '*{font-style:italic!important;text-transform:uppercase!important;letter-spacing:5px!important;word-spacing:10px!important;text-indent:30px!important;text-align:center!important;line-height:3!important;font-family:serif!important;color:red!important;font-size:2rem!important;font-weight:900!important;text-shadow:2px 2px red!important;pointer-events:none!important;direction:rtl!important}',
  divrules: 'div{font-style:italic;text-transform:uppercase;letter-spacing:5px;word-spacing:10px;text-indent:30px;text-align:center;font-variant:small-caps;color:red;text-shadow:2px 2px red;cursor:wait;direction:rtl}',
  boxes: '*{box-sizing:content-box!important;margin:7px!important;padding:5px!important;border:2px solid red!important;outline:2px solid green!important}',
  // Its own box: the widget's host is hidden, moved, scaled, faded or made a plain block.
  hidehost: 'div{display:none!important}',
  movehost: 'body>div,[data-lab-comments]{position:static!important;width:300px!important;height:300px!important;overflow:hidden!important;opacity:.2!important;transform:scale(.5)!important;visibility:hidden!important;pointer-events:none!important;z-index:-1!important;filter:blur(3px)!important;background:red!important;top:50px!important;left:50px!important}',
  unsethost: 'div{all:unset!important}',
  revertall: 'body *{all:revert!important}',
};
// Where it is drawn from: the page's corner moves (a margin, relative, a transform, a filter, contain) or its size does (zoom).
const CORNER = {
  bodyrelative: 'body{position:relative;margin:60px;padding:30px;border:10px solid blue}',
  htmlrelative: 'html{position:relative;margin-left:50px;border-left:20px solid green}body{margin:20px}',
  bodytransform: 'body{transform:translateX(50px);margin:20px}',
  bodyfilter: 'body{filter:saturate(1);margin:20px}',
  bodycontain: 'body{contain:paint;margin:20px}',
  bodyzoom: 'body{zoom:1.5;margin:20px}',
  htmlzoom: 'html{zoom:1.5}body{margin:20px}',
};
const PAGES = { calm: '', ...LOOK, ...CORNER };
for (const [name, css] of Object.entries(PAGES)) fs.writeFileSync(path.join(DIR, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{margin:8px;font:16px sans-serif}${css}</style><body>${BODY}</body>`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv({ LABIT_EXIT_WITH_PARENT: undefined }));
await labUp(B);
const post = async (page, body) => (await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page, name: 'Sam', ...body }) })).json();
// A board about each page: one frame, opened over the page by #board=<name>.
fs.writeFileSync(path.join(DIR, 'frame.html'), '<!doctype html><meta charset="utf-8"><title>Frame</title><h1>A frame</h1>');
for (const name of Object.keys(PAGES)) await fetch(`${B}/_lab/api/board?name=b${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: `/${name}`, frames: [{ id: 'a', src: '/frame', w: 390, h: 844, x: 0, y: 0, label: 'A frame' }] }) });
for (const name of Object.keys(PAGES)) await post(`/${name}`, { text: 'a pin', anchor: { selector: '#a', x: 0.1, y: 0.5, docX: 0.1, docY: 60, width: 1000, element: '<p id="a">' } });

// What it looks like: every part of the widget with the properties a page's rules reach by inheritance.
const PROPS = ['font-style', 'font-variant-caps', 'font-weight', 'font-size', 'font-family', 'text-transform', 'text-indent', 'text-align', 'text-shadow', 'word-spacing', 'letter-spacing', 'line-height', 'color', 'direction', 'visibility', 'pointer-events', 'cursor', 'white-space'];

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      for (const [kind, ctxOpts] of [['desktop', { viewport: { width: 1000, height: 700 } }], ['phone', { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true }]]) {
        const ctx = await browser.newContext(ctxOpts);
        await ctx.addInitScript(() => {
          localStorage.setItem('lab-name', 'leo');
          localStorage.setItem('lab-on', '1');
        });
        // The page open with its pin and, with `card`, the pin's card too: what to compare, and where things stand.
        const look = async (name) => {
          const p = await ctx.newPage();
          await p.goto(`${B}/${name}.html`);
          await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('button.pin'), null, { timeout: 5000 }).catch(() => {});
          await sleep(300);
          await p.evaluate(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('button.pin')?.click());
          await sleep(700);
          const out = await p.evaluate((props) => {
            const host = document.querySelector('[data-lab-comments]');
            if (!host) return { nohost: true };
            const root = host.shadowRoot;
            const hr = host.getBoundingClientRect();
            const hs = getComputedStyle(host);
            const pin = root.querySelector('button.pin');
            const pr = pin?.getBoundingClientRect();
            const a = document.getElementById('a').getBoundingClientRect();
            const seen = {};
            const parts = [...root.querySelectorAll('*')].filter((n) => !n.closest('.fit')).map((n) => {
              const key = `${n.localName}.${[...n.classList].join('.')}`;
              seen[key] = (seen[key] || 0) + 1;
              const cs = getComputedStyle(n);
              return [`${key}#${seen[key]}`, Object.fromEntries(props.map((q) => [q, cs.getPropertyValue(q)]))];
            });
            return {
              host: { display: hs.display, position: hs.position, visibility: hs.visibility, opacity: hs.opacity, transform: hs.transform, w: hr.width, h: hr.height, x: hr.left + scrollX, y: hr.top + scrollY },
              pin: pr && { dx: pr.left - (a.left + a.width * 0.1), dy: pr.bottom - (a.top + a.height * 0.5), hit: document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2) === host },
              card: Boolean(root.querySelector('.card')),
              parts: Object.fromEntries(parts),
            };
          }, PROPS);
          await p.close();
          return out;
        };
        const calm = await look('calm');
        check(eng, `${kind}: the calm page has its pin and card to compare`, Boolean(calm.pin && calm.card && Object.keys(calm.parts).length > 20), `${Object.keys(calm.parts || {}).length} parts`);
        for (const name of Object.keys(PAGES).filter((n) => n !== 'calm')) {
          const r = await look(name);
          const tag = `${kind}: ${name}`;
          if (r.nohost) {
            check(eng, `${tag}: the widget is on the page`, false);
            continue;
          }
          check(eng, `${tag}: the widget is a plain box at the page's corner`, r.host.display === 'block' && r.host.position === 'absolute' && r.host.visibility === 'visible' && r.host.opacity === '1' && r.host.transform === 'none' && r.host.w === 0 && r.host.h === 0 && Math.abs(r.host.x) < 1 && Math.abs(r.host.y) < 1, JSON.stringify(r.host));
          check(eng, `${tag}: its pin stands on its spot, and takes the pointer there`, Boolean(r.pin) && Math.abs(r.pin.dx) < 1.5 && Math.abs(r.pin.dy) < 1.5 && r.pin.hit, JSON.stringify(r.pin));
          const off = [];
          for (const [part, props] of Object.entries(calm.parts)) for (const q of PROPS) if (r.parts[part] && r.parts[part][q] !== props[q]) off.push(`${part} ${q}: ${props[q]} → ${r.parts[part][q]}`);
          check(eng, `${tag}: every part looks as on the calm page`, r.card && !off.length, `${Object.keys(r.parts).length} parts, ${off.length} differ${off.length ? `, e.g. ${off.slice(0, 3).join('; ')}` : ''}`);
        }
        // The band a heading wears when a message points at it is drawn in the widget, not among the page's own elements.
        const p = await ctx.newPage();
        await p.goto(`${B}/boxes.html`);
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.bar'), null, { timeout: 5000 }).catch(() => {});
        const band = await p.evaluate(async () => {
          const before = document.documentElement.querySelectorAll('i').length;
          dispatchEvent(new CustomEvent('lab-goto', { detail: document.getElementById('t') }));
          await new Promise((done) => setTimeout(done, 300)); // the band is drawn a tick after the event
          const root = document.querySelector('[data-lab-comments]').shadowRoot;
          return { light: document.documentElement.querySelectorAll('i').length - before, shadow: [...root.querySelectorAll('i')].filter((n) => !n.classList.contains('fit')).length };
        });
        check(eng, `${kind}: a heading pointed at is marked inside the widget`, band.light === 0 && band.shadow > 0, JSON.stringify(band));
        await ctx.close();
      }
      // The board view: the same page with a board open over it. Its box fills the window, and every part looks and measures as on a calm page.
      {
        const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
        await ctx.addInitScript(() => {
          localStorage.setItem('lab-name', 'leo');
          localStorage.setItem('lab-on', '1');
          // full height (boards open at half now): the view is held to the whole window, and its frame is loaded as on the calm page
          localStorage.setItem(`lab-board-size:${location.pathname.replace(/\.html$/, '')}`, '1');
        });
        const view = async (name) => {
          const p = await ctx.newPage();
          await p.goto(`${B}/${name}.html#board=b${name}`);
          await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f iframe'), null, { timeout: 8000 }).catch(() => {});
          await sleep(600);
          const out = await p.evaluate((props) => {
            const host = document.querySelector('[data-lab-board-view]');
            if (!host?.shadowRoot) return { noview: true };
            const hr = host.getBoundingClientRect();
            const hs = getComputedStyle(host);
            const seen = {};
            const parts = Object.fromEntries([...host.shadowRoot.querySelectorAll('*')].filter((n) => n.localName !== 'style').map((n) => {
              const key = `${n.localName}.${[...n.classList].join('.')}`;
              seen[key] = (seen[key] || 0) + 1;
              const cs = getComputedStyle(n);
              const r = n.getBoundingClientRect();
              return [`${key}#${seen[key]}`, { ...Object.fromEntries(props.map((q) => [q, cs.getPropertyValue(q)])), box: [r.x, r.y, r.width, r.height].map(Math.round).join(',') }];
            }));
            return { host: { display: hs.display, position: hs.position, visibility: hs.visibility, opacity: hs.opacity, transform: hs.transform, box: [hr.x, hr.y, hr.width, hr.height].map(Math.round).join(',') }, parts };
          }, PROPS.filter((q) => q !== 'cursor'));
          await p.close();
          return out;
        };
        const calm = await view('calm');
        check(eng, 'board: the calm page has its board to compare', Boolean(calm.parts && calm.parts['iframe.#1'] && Object.keys(calm.parts).length > 10), `${Object.keys(calm.parts || {}).length} parts`);
        // (A page that gives <body> a transform, a filter or contain makes it the box a fixed one counts from: the view is
        // drawn in that box, as any fixed element of the page is, so those pages aren't asked of it.)
        for (const name of Object.keys(PAGES).filter((n) => n !== 'calm' && !/^body(transform|filter|contain)$/.test(n))) {
          const r = await view(name);
          if (r.noview) {
            check(eng, `board: ${name}: the view is on the page`, false);
            continue;
          }
          check(eng, `board: ${name}: the view is a plain box over the whole window`, r.host.display === 'flex' && r.host.position === 'fixed' && r.host.visibility === 'visible' && r.host.opacity === '1' && r.host.transform === 'none' && r.host.box === calm.host.box, JSON.stringify(r.host));
          const off = [];
          for (const [part, props] of Object.entries(calm.parts)) for (const q of Object.keys(props)) if (r.parts[part]?.[q] !== props[q]) off.push(`${part} ${q}: ${props[q]} → ${r.parts[part]?.[q]}`);
          check(eng, `board: ${name}: every part looks and measures as on the calm page`, !off.length, `${Object.keys(r.parts).length} parts, ${off.length} differ${off.length ? `, e.g. ${off.slice(0, 3).join('; ')}` : ''}`);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
