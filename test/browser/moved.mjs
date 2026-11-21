// Pins whose spot is gone from the page, in real browsers (WebKit and Chrome's engine): off the page, counted in the ⋯
// menu ("moved · N"), opened from there to drop on a new spot or close, and closed on their own when the agent is done.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/moved.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-moved-');
const PORT = claimPort(7940, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>m</title><h1 id="t">Moved</h1><p id="a" style="margin:40px 0">A paragraph to drop a pin on.</p><p id="b">Another one.</p><details id="dd"><summary>More</summary><p id="h">Words in a closed details.</p></details>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const env = labEnv({ LABIT_EXIT_WITH_PARENT: undefined });
const server = startLab(DIR, env);
await labUp(B);
const post = async (body) => (await (await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) })).json()).comment;
const gone = (text) => post({ text, anchor: { selector: '#nope', x: 0.5, y: 0.5, docX: 0.6, docY: 300, width: 1000, element: '<p id="nope">' } });
const list = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;

try {
  const keep = await post({ text: 'stays', anchor: { selector: '#a', x: 0.1, y: 0.5, docX: 0.1, docY: 60, width: 1000, element: '<p id="a">' } });
  const lost = await gone('lost one');
  // Its words were rewritten where it stood: shown in place as a guess (unsure look, a line on its card). Another sits in a closed details: hidden, not lost.
  const rewritten = await post({ text: 'rewritten one', anchor: { selector: '#b', x: 0.5, y: 0.5, docX: 0.3, docY: 200, width: 1000, element: '<p id="b">', text: 'Another thing.' } });
  const hidden = await post({ text: 'in a closed details', anchor: { selector: '#h', x: 0.5, y: 0.5, docX: 0.3, docY: 120, width: 1000, element: '<p id="h">', text: 'Words in a closed details.' } });
  const done = await gone('lost and done');
  await post({ parent: done.id, text: 'and more' });
  execFileSync(process.execPath, [LAB, 'reply', done.id, 'Done: it is fixed'], { cwd: DIR, env: { ...env, PORT: String(PORT) }, stdio: 'pipe' });

  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await sleep(1800);
      const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
      const state = () => shadow(() => { return { pins: r.querySelectorAll('button.pin').length, moved: r.querySelector('.moved-btn').textContent, shown: !r.querySelector('.moved-btn').hidden }; });
      let s = await state();
      check(eng, 'a pin whose spot is gone is not drawn on the page', s.pins === 3, JSON.stringify(s)); // stays, rewritten, hidden
      check(eng, 'the ⋯ menu counts it, and only it: a pin in a closed details is hidden, not moved', s.shown && s.moved === 'moved · 1', JSON.stringify(s));
      const look = await shadow(() => {
        const pins = [...r.querySelectorAll('button.pin')];
        return { unsure: pins.filter((b) => b.classList.contains('unsure')).length, hiddenPins: pins.filter((b) => b.style.visibility === 'hidden').length, marks: r.querySelectorAll('.lostmark').length };
      });
      // A lost pin leaves nothing where it stood (Leo, 21 Nov, of the dashed mark: "no need this"): the ⋯ menu has it.
      check(eng, 'a guess wears the unsure look; a closed-details pin is hidden; a lost pin leaves no mark', look.unsure === 1 && look.hiddenPins === 1 && look.marks === 0, JSON.stringify(look));
      const unsureLine = await shadow(() => {
        r.querySelector('button.pin.unsure').click();
        return new Promise((res) => setTimeout(() => res(r.querySelector('.card .spotnote')?.textContent || ''), 500));
      });
      check(eng, 'the card of a guess says why in one line', /changed|unsure/.test(unsureLine), unsureLine);
      await p.keyboard.press('Escape');
      await sleep(300);
      const c = (await list()).find((x) => x.id === done.id);
      check(eng, 'the agent finishing it closed it on its own', c.resolved === true, String(c.resolved));

      // Open it from the menu: it shows, on the left edge, and drops on a new spot by dragging.
      await shadow(() => { r.querySelector('.more').click(); r.querySelector('.moved-btn').click(); return new Promise((res) => setTimeout(res, 500)); });
      const at = await shadow(() => { const b = r.querySelector('button.pin.moved'); if (!b) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
      check(eng, 'opened from the menu it shows on the page', Boolean(at), JSON.stringify(at));
      const lostLine = await shadow(() => { return r.querySelector('.card .spotnote')?.textContent || ''; });
      check(eng, 'its card says its spot is gone', lostLine === 'its spot is gone', lostLine);
      const target = await p.locator('#b').boundingBox();
      await p.mouse.move(at[0], at[1]);
      await p.mouse.down();
      await p.mouse.move(at[0] + 30, at[1] + 10, { steps: 4 });
      await p.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 8 });
      await p.mouse.up();
      await sleep(900);
      const moved = (await list()).find((x) => x.id === lost.id);
      check(eng, 'dropping it saves a new spot', moved.anchor.selector !== '#nope' && Boolean(moved.movedAt), moved.anchor.selector);
      await p.keyboard.press('Escape');
      await sleep(300);
      s = await state();
      check(eng, 'after the drop it is back on the page and the count is gone', s.pins === 4 && !s.shown, JSON.stringify(s));
      await p.goto('about:blank');
      await ctx.close();
      // Back as it was for the next engine (moving another's pin takes the lab's admin key).
      const admin = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
      await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': admin, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/index', action: 'move', id: lost.id, anchor: { selector: '#nope', x: 0.5, y: 0.5, docX: 0.6, docY: 300, width: 1000, element: '<p id="nope">' } }) });
    } finally {
      await browser.close();
    }
  }
  void keep;
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
