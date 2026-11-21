// What a pin tells the agent about its spot, and how it finds it again: the widget's own mark is not the page's attribute,
// an element inside an open web component keeps its pin (found again, not "moved") on an unchanged page, a click while a
// saved change fades in lands on the element and not on the page, errors after a client-side navigation are listed under
// their own route, and text cut at a length never leaves half an emoji. Real browsers, a real lab.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/pincontext.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-pincontext-');
const PORT = claimPort(8100, 30);
const B = `http://localhost:${PORT}`;
const page = (name, body, head = '') => fs.writeFileSync(path.join(DIR, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{margin:20px;font:16px/1.4 sans-serif}${head}</style>${body}`);

// Each engine gets pages of its own (the pins of one are not in the way of the other's clicks).
const pages = (n) => {
  // A sticky bar: the widget holds the pin on it with its own attribute (src/widget/pinhold.ts).
  page(`sticky${n}`, '<h1>Sticky</h1><div id="bar" data-t="s1" class="stuck" style="position:sticky;top:10px;background:#eee;padding:10px">Sticky bar words</div><div style="height:2500px">spacer</div>');
  // A web component with an open shadow root, after a paragraph straight under <body> (the path of the one inside would lead there).
  page(`shadow${n}`, '<p>A light paragraph</p><x-card></x-card><script>customElements.define("x-card", class extends HTMLElement { connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = "<h3>Inside heading</h3><p id=\\"in\\" data-t=\\"w1\\">Words inside the web component</p><p data-t=\\"w2\\">Second paragraph inside</p>"; } });</script>');
  // A page that is patched in place under a cross-fade of a second (slower than the widget's own, so a click lands inside it).
  fade(n, 'Below.');
  // An emoji across the place a value (60) and the words (80) are cut.
  // An Astro dev page: the served HTML has data-astro-source-file / -loc on its elements, and the dev toolbar takes them off once
  // the page is up (astro 7.4.13, dev-toolbar/apps/audit/annotations.js), also off an element added later. Its file is in the project.
  const eng = n.slice(1);
  const at = (loc) => `data-astro-source-file="/home/me/site/src/pages/${eng}.astro" data-astro-source-loc="${loc}"`;
  fs.mkdirSync(path.join(DIR, 'src/pages'), { recursive: true });
  fs.writeFileSync(path.join(DIR, `src/pages/${eng}.astro`), ['---', '---', '<main>', '  <h1>Astro page</h1>', '  <p>First astro paragraph words</p>', '  <p>Second astro paragraph words</p>', '</main>', ''].join('\n'));
  page(`astro${n}`, `<h1 ${at('4:3')}>Astro page</h1><p ${at('5:3')}>First astro paragraph words</p><p ${at('6:3')} id="second">Second astro paragraph words</p><div id="more"></div><script>
    const strip = () => document.querySelectorAll('[data-astro-source-file]').forEach((e) => { e.removeAttribute('data-astro-source-file'); e.removeAttribute('data-astro-source-loc'); });
    addEventListener('load', () => setTimeout(strip, 300));
    setTimeout(() => { more.innerHTML = '<p id="late" ${at('5:3')}>First astro paragraph words</p>'; setTimeout(strip, 200); }, 1500);
  </script>`);
  page(`emoji${n}`, `<h1>Emoji</h1><p id="e" data-note="${'a'.repeat(59)}😀 tail">${'x'.repeat(79)}😀 and more words after</p>`);
};
const fade = (n, below) => page(`fade${n}`, `<h1>Fade</h1><button id="go" style="position:absolute;left:30px;top:80px;width:240px;height:40px">Target button</button><p style="margin-top:160px">${below}</p>`, '::view-transition-group(root){animation-duration:1s}');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
// An app behind --proxy that goes to another route by itself (history.pushState) and throws on each. (Only there is the page
// a pin is on, and the page its errors are listed on, the address and not the file the lab served.)
const DIR2 = fs.realpathSync(tmp('labit-pincontext-app-'));
const PORT2 = claimPort(8140, 10);
const APP = claimPort(8160, 10);
const B2 = `http://localhost:${PORT2}`;
fs.writeFileSync(path.join(DIR2, 'labit.json'), JSON.stringify({ port: PORT2 }));
const app = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') return void res.writeHead(404).end('no');
  const eng = req.url.split(/[/?]/)[1].split('-')[0];
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>app</title><h1>Routes</h1><script>setTimeout(() => { throw new Error("first route boom"); }, 100); setTimeout(() => history.pushState(null, "", "/${eng}-two"), 300); setTimeout(() => { throw new Error("second route boom"); }, 700);</script>`);
});
await new Promise((done) => app.listen(APP, done));

const server = startLab(DIR, labEnv());
const server2 = startLab(DIR2, labEnv(), { args: ['--proxy', String(APP)] });
await labUp(B);
await labUp(B2);
const comments = async (name) => (await (await fetch(`${B}/_lab/api/comments?page=/${name}`)).json()).comments;
const agent = async (name) => (await fetch(`${B}/_lab/agent/${name}`)).text();
const broken = (s) => /�|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const n = `-${eng}`;
      pages(n);
      const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'tester');
        localStorage.setItem('lab-on', '1');
        // Says when a view transition starts and what a click finds under it.
        const start = document.startViewTransition?.bind(document);
        if (start) {
          document.startViewTransition = (cb) => ((window.__vt = Date.now()), start(cb));
          addEventListener('mousedown', (e) => (window.__hits = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.localName)), true);
        }
      });
      const p = await ctx.newPage();
      const ready = () => p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')) && document.readyState === 'complete', null, { timeout: 8000 }).then(() => sleep(400));
      const root = () => p.evaluateHandle(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot);
      // A click on the page, the words typed, Enter: the comment as the lab saved it (null when none arrived).
      const pin = async (name, x, y, text) => {
        await p.mouse.click(x, y);
        await p.waitForFunction(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('.float textarea'), null, { timeout: 5000 }).catch(() => {});
        await p.keyboard.insertText(text);
        await p.keyboard.press('Enter');
        for (let i = 0; i < 30; i++) {
          const c = (await comments(name)).find((x) => x.text === text);
          if (c) return c;
          await sleep(100);
        }
        return null;
      };
      const centre = async (sel) => {
        const b = await p.locator(sel).boundingBox();
        return [b.x + b.width / 2, b.y + b.height / 2];
      };

      // 1. The widget's own data-lab-anchor stays out of the element line.
      await p.goto(`${B}/sticky${n}`);
      await ready();
      const stick = await pin(`sticky${n}`, ...(await centre('#bar')), 'sticky pin');
      await sleep(800);
      check(eng, 'the widget holds the pin on the sticky bar with its own mark (the check below means something)', await p.evaluate(() => document.querySelector('#bar').hasAttribute('data-lab-anchor')));
      const line = (await agent(`sticky${n}`)).split('\n').find((l) => l.startsWith('element:')) || '';
      check(eng, 'the agent\'s element line has the page\'s own attributes (data-t, class)', /data-t="s1"/.test(line) && /class="stuck"/.test(line), line);
      check(eng, 'no data-lab-anchor in the saved element or the agent\'s line', !/data-lab/.test(line) && !/data-lab/.test(stick?.anchor?.element || ''), `${line} | ${stick?.anchor?.element}`);

      // 2. A pin inside an open web component is found again, not moved or gone, on a page nobody changed.
      await p.goto(`${B}/shadow${n}`);
      await ready();
      const inner = await p.evaluate(() => { const b = document.querySelector('x-card').shadowRoot.querySelector('#in').getBoundingClientRect(); return [b.x + 30, b.y + b.height / 2]; });
      const sh = await pin(`shadow${n}`, ...inner, 'shadow pin');
      check(eng, 'a pin in a web component: its selector goes through the host, and it has a fingerprint', /x-card.* >>> .*#in/.test(sh?.anchor?.selector || '') && Boolean(sh?.anchor?.fp), `${sh?.anchor?.selector} fp=${Boolean(sh?.anchor?.fp)}`);
      const unchanged = async (when) => {
        await sleep(4500); // the widget looks again for its pins 3 s after the page loaded and tells the lab what it did not find
        const r = await root();
        const state = await r.evaluate((s) => ({ moved: !s.querySelector('.moved-btn')?.hidden, pins: s.querySelectorAll('button.pin:not(.moved)').length }));
        const text = await agent(`shadow${n}`);
        const c = (await comments(`shadow${n}`)).find((x) => x.text === 'shadow pin');
        check(eng, `${when}: a pin inside a web component is not listed as moved`, !state.moved && state.pins >= 1, JSON.stringify(state));
        check(eng, `${when}: the agent is not told its spot changed or is gone`, !/changed the spot|spot is gone|may have moved/i.test(text) && !c?.moved && !c?.movedAt && !c?.anchor?.gone, text.split('\n').filter((l) => /spot|moved|gone/i.test(l)).join(' | '));
      };
      await unchanged('4.5 s after the pin was made');
      await p.reload();
      await ready();
      await unchanged('after a reload');

      // 3. A click while a saved change cross-fades in lands on the element, not on the page.
      await p.goto(`${B}/fade${n}`);
      await ready();
      await sleep(600);
      fade(n, 'Below, changed.');
      const began = await p.waitForFunction(() => window.__vt || !document.startViewTransition, null, { timeout: 6000 }).then(() => p.evaluate(() => Boolean(window.__vt))).catch(() => false);
      if (!began) check(eng, 'a saved change is patched in with a view transition (this engine does not: skipped)', !(await p.evaluate(() => Boolean(document.startViewTransition))));
      else {
        const fadePin = await pin(`fade${n}`, ...(await centre('#go')), 'fade pin');
        const hits = await p.evaluate(() => window.__hits || []);
        check(eng, 'the click came while the browser hit nothing but <html> (the cross-fade was on)', hits.length === 1 && hits[0] === 'html', JSON.stringify(hits));
        check(eng, 'the pin is on the button, not on the page', Boolean(fadePin) && fadePin.anchor.selector !== 'body' && /^<button/.test(fadePin.anchor.element || ''), `${fadePin?.anchor?.selector} ${fadePin?.anchor?.element}`);
      }

      // 4. Errors after a client-side navigation are listed under their own route.
      await p.goto(`${B2}/${eng}-one`);
      await ready();
      await sleep(2800);
      const listed = async (route) => ((await (await fetch(`${B2}/_lab/agent/${route}`)).text()).match(/^Page errors .*$/m) || [''])[0];
      const [one, two] = [await listed(`${eng}-one`), await listed(`${eng}-two`)];
      check(eng, 'the route the page loaded as lists its own error, and not the other\'s', /first route boom/.test(one) && !/second route boom/.test(one), one);
      check(eng, 'the route the app went to lists its own error, and not the first\'s', /second route boom/.test(two) && !/first route boom/.test(two), two);

      // 5. Text cut at a length never leaves half an emoji.
      await p.goto(`${B}/emoji${n}`);
      await ready();
      const em = await pin(`emoji${n}`, ...(await centre('#e')), 'emoji pin');
      const text = await agent(`emoji${n}`);
      check(eng, 'an attribute value cut at 60 and the words cut at 80 hold no half an emoji', Boolean(em) && !broken(em.anchor.element) && !broken(em.anchor.text || '') && !broken(text), JSON.stringify([em?.anchor?.element?.slice(-30), em?.anchor?.text?.slice(-6)]));
      check(eng, 'the words kept are the ones before the emoji', Boolean(em) && em.anchor.element.includes(`data-note="${'a'.repeat(59)}"`) && em.anchor.text === 'x'.repeat(79), `${em?.anchor?.text?.length}`);

      // 6. Astro's dev toolbar takes data-astro-source-* off the elements after load: a pin still names the source, and the
      // agent's text checks the line against the file when it is read (what moved is said, nothing is guessed).
      await p.goto(`${B}/astro${n}`);
      await ready();
      await p.waitForFunction(() => document.querySelector('#late') && !document.querySelector('[data-astro-source-file]'), null, { timeout: 8000 }).catch(() => {});
      const gone = await p.evaluate(() => !document.querySelector('[data-astro-source-file], [data-astro-source-loc]'));
      check(eng, 'the toolbar mimic took the source attributes off every element, also the one added later (the checks below mean something)', gone);
      const file = `src/pages/${eng}.astro`;
      const written = async () => (await agent(`astro${n}`)).match(/^written at: .*$/gm) || [];
      const astro = await pin(`astro${n}`, ...(await centre('#second')), 'astro pin');
      check(eng, 'a pin on an Astro element names its file and line after the toolbar took the attributes off', astro?.anchor?.source === `${file}:6:3`, JSON.stringify(astro?.anchor?.source));
      const late = await pin(`astro${n}`, ...(await centre('#late')), 'astro late pin');
      check(eng, 'also an element added after the page loaded (its attributes taken off a moment later)', late?.anchor?.source === `${file}:5:3`, JSON.stringify(late?.anchor?.source));
      const body = (lines, second = true) => ['---', '---', ...lines, '<main>', '  <h1>Astro page</h1>', '  <p>First astro paragraph words</p>', ...(second ? ['  <p>Second astro paragraph words</p>'] : []), '</main>', ''].join('\n');
      const now = await written();
      check(eng, 'the agent\'s text has both lines, checked against the file: right now, said as they are', now.length === 2 && now[0] === `written at: ${file}:6:3` && now[1] === `written at: ${file}:5:3`, JSON.stringify(now));
      fs.writeFileSync(path.join(DIR, file), body(['// one', '// two']));
      const moved = await written();
      check(eng, 'two lines put above: the text names the line each is on now, and the line the pin recorded', moved[0]?.startsWith(`written at: ${file}:8 (the pin recorded line 6,`) && moved[1]?.startsWith(`written at: ${file}:7 (the pin recorded line 5,`), JSON.stringify(moved));
      fs.writeFileSync(path.join(DIR, file), body([], false));
      const gonel = await written();
      check(eng, 'the element taken out of the file: no line is named, it says it was not found again', gonel[0]?.startsWith(`written at: ${file} (the pin recorded line 6;`) && /not found again/.test(gonel[0]) && gonel[1] === `written at: ${file}:5:3`, JSON.stringify(gonel));
      await p.goto('about:blank');
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  finish();
} finally {
  server.kill();
  server2.kill();
  app.close();
}
