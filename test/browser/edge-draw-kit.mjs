// Shared by the edge-draw*.mjs files (edge cases of drawing pins, pens and ink on words): one lab on its own folder
// and port, the widget's root, a stroke with the mouse, a real pen through Chrome's devtools, and what the agent and
// the store got. Not a test itself: run edge-draw1.mjs … edge-draw4.mjs, one at a time.
//   NODE_PATH=<node_modules with playwright> ENGINES=chromium node test/browser/edge-draw1.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const pw = (() => {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  console.log(`playwright is not installed: ${process.env.CI ? 'failed (CI)' : 'skipped'}`);
  process.exit(process.env.CI ? 1 : 0);
})();

const LAB = fileURLToPath(new URL('../../local.mjs', import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const engines = (process.env.ENGINES || 'webkit,chromium').split(',');

let failed = 0;
export const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
};
// Said, not judged: what happens today where no one answer is plainly right.
export const note = (eng, name, detail = '') => console.log(`note ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
// Known and not fixed yet (said in the PR that added these tests): passes as a check once it works, a note till then.
export const known = (eng, name, ok, detail = '') => (ok ? check(eng, name, true, detail) : note(eng, `known, not fixed yet: ${name}`, detail));
export const done = () => {
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
};

// One lab: pages is { name: html }, settings go into labit.json beside the port.
export async function lab(pages, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-edraw-'));
  const port = 8600 + Math.floor(Math.random() * 300);
  for (const [n, html] of Object.entries(pages)) fs.writeFileSync(path.join(dir, `${n}.html`), html);
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ port, ...settings }));
  const env = { ...process.env, PORT: '', XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-cfg-')), LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-home-')), LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1' };
  const server = spawn(process.execPath, [LAB, '--new', '--no-open'], { cwd: dir, env, stdio: 'ignore' });
  const B = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(B + '/');
      break;
    } catch {
      await sleep(100);
    }
  }
  const admin = () => JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8')).agent;
  const call = (body, agent) =>
    fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': admin(), ...(agent ? { 'x-lab-agent': '1' } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
  return {
    B, dir, call,
    // The agent's text for a page, and the page's comments as the store holds them.
    agent: async (page) => (await fetch(`${B}/_lab/agent/${page}`)).text(),
    comments: async (page) => (await (await fetch(`${B}/_lab/api/comments?page=/${page}`)).json()).comments,
    stop: () => (server.kill(), fs.rmSync(dir, { recursive: true, force: true })),
  };
}

export const root = 'document.querySelector("*") && [...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
export const has = (p, sel) => p.evaluate(([r, s]) => Boolean(new Function(`return ${r}`)()?.querySelector(s)), [root, sel]);
export const until = (p, sel, ms = 4000) => p.waitForFunction(([r, s]) => Boolean(new Function(`return ${r}`)()?.querySelector(s)), [root, sel], { timeout: ms }).catch(() => {});
export const gone = (p, sel, ms = 4000) => p.waitForFunction(([r, s]) => !new Function(`return ${r}`)()?.querySelector(s), [root, sel], { timeout: ms }).catch(() => {});
export const go = async (p, B, page) => {
  await p.goto(`${B}/${page}`);
  await p.waitForFunction(new Function(`return Boolean(${root})`), null, { timeout: 8000 }).catch(() => {});
  await sleep(150);
};

// What the widget shows of a drawing: the box, the live lines, the draft's lines (one click line, .hit, each: a line with
// pen widths is drawn as a path a segment), sent drawings, and what is stuck.
export const look = (p) =>
  p.evaluate((r) => {
    const R = new Function(`return ${r}`)();
    if (!R) return null;
    const ta = R.querySelector('.float textarea');
    const rect = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const draft = [...R.querySelectorAll('svg.ink:not(.live)')].filter((s) => !s.closest('.pin'));
    return {
      box: Boolean(ta), typed: ta?.value ?? '',
      live: R.querySelectorAll('svg.ink.live').length, liveD: R.querySelector('svg.ink.live path')?.getAttribute('d') || '',
      draftInk: draft.length, draftAt: rect(draft[0]), draftStrokes: draft[0] ? draft[0].querySelectorAll('path.hit').length : 0,
      zone: R.querySelectorAll('.zone.draft').length, zoneAt: rect(R.querySelector('.zone.draft')), draftPin: R.querySelectorAll('.pin.draft').length,
      pinsAt: [...R.querySelectorAll('.pin:not(.draft):not(.ink)')].map(rect),
      inkPins: R.querySelectorAll('.pin.ink').length, pins: R.querySelectorAll('.pin:not(.draft)').length,
      inkAt: [...R.querySelectorAll('.pin.ink svg.ink')].map(rect),
      dragging: document.documentElement.classList.contains('lab-dragging'),
      hideDone: localStorage.getItem('lab-hide-done') || '', card: Boolean(R.querySelector('.card')),
    };
  }, root);

export const box = (p, id) => p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: r.width, h: r.height }; }, id);
// Where some of an element's words are: from letter a to letter b of its first text.
export const letters = (p, id, a = 0, b = 5) =>
  p.evaluate(([i, a, b]) => {
    const t = [...document.getElementById(i).childNodes].find((n) => n.nodeType === 3);
    const r = document.createRange();
    r.setStart(t, a);
    r.setEnd(t, b);
    const q = r.getBoundingClientRect();
    return { l: q.left, r: q.right, t: q.top, b: q.bottom, mid: (q.top + q.bottom) / 2, text: String(r) };
  }, [id, a, b]);

// One stroke with the mouse through the points, in small steps.
export const stroke = async (p, pts, steps = 6) => {
  await p.mouse.move(...pts[0]);
  await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(...q, { steps });
  await p.mouse.up();
};
// One more drawing sent on the page than `was` (a drawing is sent by itself a second after its last stroke, with no box:
// Leo, 21 Nov: "just draw maybe and send dont open comment to send it, just send").
export const sentAfter = (p, was, ms = 5000) => p.waitForFunction(([r, k]) => (new Function(`return ${r}`)()?.querySelectorAll('.pin.ink').length || 0) > k, [root, was], { timeout: ms }).then(() => true, () => false);
// Hold D, draw the strokes, let D go: the drawing is sent as it is. sent: it was.
export const drawn = async (p, strokes, steps = 6) => {
  const was = (await look(p)).inkPins;
  await p.keyboard.down('d');
  for (const s of strokes) await stroke(p, s, steps);
  await p.keyboard.up('d');
  const sent = await sentAfter(p, was);
  return { ...(await look(p)), sent };
};
// An open box (a plain area or pin) sent with these words; a drawing sends itself, so with no box only the undo card
// it leaves is let go.
export const send = async (p, words = 'look here') => {
  if ((await look(p)).box) {
    const before = (await look(p)).pins;
    await p.keyboard.type(words);
    await p.keyboard.press('Enter');
    await p.waitForFunction(([r, n]) => (new Function(`return ${r}`)()?.querySelectorAll('.pin:not(.draft)').length || 0) > n, [root, before], { timeout: 4000 }).catch(() => {});
  }
  await p.keyboard.press('Escape');
  await sleep(250);
};
// The lines of the agent's text that say what a drawing is.
export const said = (text) => text.split('\n').filter((l) => /^(drawn|type|arrow|at|text in area|lines)/.test(l)).map((l) => (l.length > 150 ? l.slice(0, 150) + '…' : l)).join(' | ');
export const mark = (text) => (text.match(/^drawn: (.*)$/m) || [])[1] || '';

// (By default it runs a little past its start, as a hand does: a loop that ends on the very pixel it began is its own case.)
export const ring = (cx, cy, rx, ry, from = 0, to = 372, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = ((from + ((to - from) * i) / n) * Math.PI) / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });

// A real pen (trusted pointer events of type "pen") through Chrome's devtools; Safari's engine has no such door, so
// there the same events are made in the page (isTrusted false).
export async function penFor(eng, ctx, p) {
  if (eng === 'chromium') {
    const cdp = await ctx.newCDPSession(p);
    const pen = (type, x, y, o = {}) =>
      cdp.send('Input.dispatchMouseEvent', { type: type === 'down' ? 'mousePressed' : type === 'up' ? 'mouseReleased' : 'mouseMoved', x, y, button: type === 'move' && !o.held ? 'none' : 'left', buttons: type === 'up' || (type === 'move' && o.hover) ? 0 : 1, clickCount: type === 'move' ? 0 : 1, pointerType: 'pen', force: o.force ?? 0.5, tiltX: o.tiltX ?? 20, tiltY: o.tiltY ?? 10 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: 40 + i, radiusX: 30, radiusY: 30, force: 1 })) });
    return { trusted: true, pen, touch: { start: (x, y) => touch('touchStart', [[x, y]]), move: (x, y) => touch('touchMove', [[x, y]]), end: () => touch('touchEnd', []), cancel: () => touch('touchCancel', []) } };
  }
  const fire = (t, x, y, o) =>
    p.evaluate(([t, x, y, o]) => {
      const e = new PointerEvent(t, { pointerType: o.kind, pointerId: o.id, isPrimary: true, clientX: x, clientY: y, button: t === 'pointermove' ? -1 : 0, buttons: t === 'pointerup' || o.hover ? 0 : 1, pressure: o.force ?? 0.5, tiltX: o.tiltX ?? 20, tiltY: o.tiltY ?? 10, width: o.kind === 'touch' ? 60 : 1, height: o.kind === 'touch' ? 60 : 1, bubbles: true, cancelable: true, composed: true });
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(e);
    }, [t, x, y, o]);
  let at = [0, 0];
  return {
    trusted: false,
    pen: (type, x, y, o = {}) => fire(type === 'down' ? 'pointerdown' : type === 'up' ? 'pointerup' : 'pointermove', x, y, { kind: 'pen', id: 7, ...o }),
    touch: {
      start: (x, y) => ((at = [x, y]), fire('pointerdown', x, y, { kind: 'touch', id: 9 })),
      move: (x, y) => ((at = [x, y]), fire('pointermove', x, y, { kind: 'touch', id: 9 })),
      end: () => fire('pointerup', ...at, { kind: 'touch', id: 9 }),
      cancel: () => fire('pointercancel', ...at, { kind: 'touch', id: 9 }),
    },
  };
}

// Each engine in turn, one browser at a time.
export async function eachEngine(context, fn) {
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, ...context });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'leo'), localStorage.setItem('lab-on', '1')));
      const p = await ctx.newPage();
      await fn({ eng, browser, ctx, p });
      await ctx.close();
    } catch (e) {
      check(eng, 'the file ran to its end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' / '));
    } finally {
      await browser.close();
    }
  }
}
