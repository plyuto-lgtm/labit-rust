// A GPUI app (Rust) shown as a mirror page behind --proxy: a pin on one of its boxes tells the agent the component, the file
// and line that drew it and where the component is used, keeps `[data-lab]` as its selector, and follows the box when the
// mirror rebuilds its boxes for a new frame. Real browsers, a real lab, a static fixture of the mirror's DOM.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/gpui.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = fs.realpathSync(tmp('labit-gpui-'));
const PORT = claimPort(8180, 10);
const APP = claimPort(8190, 10);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
// The mirror's DOM as the contract has it: nested boxes, positions relative to the parent, a text box inside.
const TREE = (dx) => `<div class="g" data-lab="k3f9a2c" data-gpui-src="bridge/crates/ui/src/inspector_tabs.rs:88" data-gpui-component="InspectorTabs" data-gpui-used-at="bridge/crates/ui/examples/common/pages/inspector.rs:231" data-gpui-id="it-default" style="position:absolute;left:${40 + dx}px;top:60px;width:300px;height:120px"><div class="g" data-lab="k5d01b7" data-gpui-src="bridge/crates/ui/src/inspector_tabs.rs:97" data-gpui-component="InspectorTabs" data-gpui-used-at="bridge/crates/ui/examples/common/pages/inspector.rs:231" style="position:absolute;left:10px;top:10px;width:120px;height:40px"><span class="t" data-lab="k77b1" data-gpui-src="bridge/crates/ui/src/inspector_tabs.rs:101" data-gpui-component="InspectorTabs" data-gpui-used-at="bridge/crates/ui/examples/common/pages/inspector.rs:231" style="position:absolute;left:0;top:0;width:60px;height:20px;color:transparent">MIDI</span></div></div>`;
const app = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') return void res.writeHead(404).end('no');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html data-gpui><meta charset="utf-8"><title>mirror</title><style>body{margin:0;background:#222}.g,.t{box-sizing:border-box;pointer-events:auto}.g{outline:1px solid #456}</style>
<div id="gpui-mirror" data-gpui-frame="1" style="position:relative;width:500px;height:300px;background:#345"><div id="gpui-tree" style="position:absolute;inset:0">${TREE(0)}</div></div>
<script>window.rebuild = (dx) => { const t = document.getElementById('gpui-tree'); t.innerHTML = ${JSON.stringify('')} + (${TREE.toString()})(dx); };</script>`);
});
await new Promise((done) => app.listen(APP, done));
const server = startLab(DIR, labEnv(), { args: ['--proxy', String(APP)] });
await labUp(B);
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/mirror`)).json()).comments;

try {
  for (const eng of engines('chromium')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'tester');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(`${B}/mirror`);
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')) && document.readyState === 'complete', null, { timeout: 8000 });
      await sleep(600);
      // The first box that is under the click: the tab's text box (inside a box inside the InspectorTabs box).
      const b = await p.locator('[data-lab="k77b1"]').boundingBox();
      await p.mouse.click(b.x + 20, b.y + 10);
      await p.waitForFunction(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('.float textarea'), null, { timeout: 5000 });
      await p.keyboard.insertText('gpui pin');
      await p.keyboard.press('Enter');
      let c = null;
      for (let i = 0; i < 30 && !c; i++) (c = (await comments()).find((x) => x.text === 'gpui pin')), c || (await sleep(100));
      const a = c?.anchor || {};
      check(eng, 'the pin names the component with the box\'s id', /^InspectorTabs/.test(a.component || ''), JSON.stringify(a.component));
      check(eng, 'written at is the Rust file and line', /^bridge\/crates\/ui\/src\/inspector_tabs\.rs:\d+$/.test(a.source || ''), a.source);
      check(eng, 'used at is where the component is used', a.usedAt === 'bridge/crates/ui/examples/common/pages/inspector.rs:231', a.usedAt);
      check(eng, 'the selector is the box\'s data-lab, not a path of nth-of-type', /^\[data-lab="k[0-9a-f]+"\]$/.test(a.selector || ''), a.selector);
      const text = await (await fetch(`${B}/_lab/agent/mirror`)).text();
      check(eng, 'the agent reads component, written at and used at', /^component: InspectorTabs/m.test(text) && /^written at: bridge\/.*\.rs:\d+/m.test(text) && /^component used at: bridge\/.*inspector\.rs:231/m.test(text) && /Drawn by GPUI/.test(text), text.split('\n').filter((l) => /component|written/.test(l)).join(' | '));

      // The mirror draws a new frame: its boxes are new nodes, the same keys, 80 px to the right.
      const pinX = () => p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot; return r.querySelector('button.pin')?.getBoundingClientRect().left ?? null; });
      const [x0, old] = [await pinX(), await p.evaluate(() => document.querySelector('[data-lab="k77b1"]'))];
      await p.evaluate(() => { window.__old = document.querySelector('[data-lab="k77b1"]'); window.rebuild(80); });
      await sleep(800);
      const x1 = await pinX();
      check(eng, 'the boxes are new nodes', await p.evaluate(() => window.__old !== document.querySelector('[data-lab="k77b1"]') && !window.__old.isConnected));
      check(eng, 'the pin followed its box 80 px to the right after the rebuild', x0 !== null && x1 !== null && Math.abs(x1 - x0 - 80) < 2, `${x0} -> ${x1}`);

      await p.goto('about:blank');
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  finish();
} finally {
  server.kill();
  app.close();
}
