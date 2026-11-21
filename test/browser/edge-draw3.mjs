// Edge cases of drawing pins (hold D and drag): where the drawing is. Off the window's edge, the page scrolled in the
// middle of a stroke and between two strokes, far down a long page, on and across a link and a button, into and out of
// an iframe, on a fixed header, and on a zoomed page.
// Run: NODE_PATH=… ENGINES=chromium node test/browser/edge-draw3.mjs   (also ENGINES=webkit)
import { box, check, done, drawn, eachEngine, go, lab, letters, look, mark, note, ring, said, send, sleep, stroke, until, known, sentAfter } from './edge-draw-kit.mjs';

const css = 'body{margin:40px;font:20px/1.5 sans-serif} h1{margin:0 0 80px} p{width:600px;margin:0 0 60px}';
const head = (extra = '') => `<!doctype html><meta charset="utf-8"><title>d</title><style>${css}${extra}</style>`;
const PAGE = `${head()}<h1 id="h">Pricing</h1><p id="a">Plans start small and grow with you</p><p id="b">Cancel any time from your account</p><p id="c">Questions go to the team</p>`;
const rows = Array.from({ length: 40 }, (_, i) => `<p id="r${i}" style="margin:0;height:100px">row ${i} of the long page</p>`).join('');
const LONG = `${head()}<div id="rows">${rows}</div>`;
const LINK = `${head()}<h1 id="h">Pricing</h1><p id="a">Read <a id="lk" href="#followed">the full terms and conditions</a> before you <button id="bt" onclick="window.__clicks=(window.__clicks||0)+1" style="font:inherit">Sign up now</button> today</p><p id="b">Cancel any time from your account</p>`;
const FRAME = `${head()}<h1 id="h">Pricing</h1><p id="a">Plans start small and grow with you</p><iframe id="f" style="width:500px;height:200px;border:1px solid #999" srcdoc="<body style='font:20px sans-serif'><p>Inside the frame there are words</p>"></iframe><p id="b">Cancel any time from your account</p>`;
const FIXED = `${head('#top{position:fixed;top:0;left:0;right:0;height:60px;background:#eee;font:20px/60px sans-serif;padding:0 40px} #rows{margin-top:80px}')}<div id="top"><span id="m1">Menu</span> · <span id="m2">Docs and guides</span> · <span id="m3">Pricing</span></div><div id="rows">${rows}</div>`;
const ZOOMHTML = PAGE.replace('<style>', '<style>html{zoom:1.5}');
const ZOOMDIV = PAGE.replace('<h1', '<div style="zoom:1.5"><h1') + '</div>';
const L = await lab({ edge: PAGE, fold: PAGE, mid: LONG, between: LONG, deep: LONG, onlink: LINK, across: LINK, frame: FRAME, inframe: FRAME, fixed: FIXED, zoom: PAGE, zoomdiv: ZOOMDIV, zoomhtml: ZOOMHTML });
const short = (o) => JSON.stringify(o).slice(0, 360);
const near = (a, b, by = 6) => Math.abs(a - b) <= by;

try {
  await eachEngine({}, async ({ eng, p, browser }) => {
    const inks = async (page) => (await L.comments(page)).filter((x) => x.anchor?.ink);
    // What the page itself saw of the pointer (the browser may clip what is off the window).
    const watch = () => p.evaluate(() => { window.__seen = { l: 1e9, r: -1e9, t: 1e9, b: -1e9, up: 0 }; for (const k of ['pointerdown', 'pointermove', 'pointerup']) addEventListener(k, (e) => { const s = window.__seen; s.l = Math.min(s.l, e.clientX); s.r = Math.max(s.r, e.clientX); s.t = Math.min(s.t, e.clientY); s.b = Math.max(s.b, e.clientY); if (k === 'pointerup') s.up++; }, true); });
    const seen = () => p.evaluate(() => window.__seen);

    // 1. A loop round the heading that runs off the window's left edge.
    await go(p, L.B, 'edge');
    await watch();
    const h = await box(p, 'h');
    const e1 = await drawn(p, [ring(60, h.cy, 100, 40)]);
    const s1 = await seen();
    if (e1.sent) await send(p);
    const e1At = (await look(p)).inkAt[0];
    check(eng, 'a loop that runs off the left edge of the window: it is sent, the lines cover what the pointer did, nothing is stuck', e1.inkPins >= 1 && !e1.dragging && Boolean(e1At) && near(e1At.l, Math.max(0, Math.round(s1.l)), 3) && near(e1At.r - e1At.l, Math.round(s1.r - s1.l), 3), short({ pointerSeen: s1, sent: e1At })); // held to the page's left edge, its size kept
    const edge = await L.agent('edge');
    const eA = (await inks('edge'))[0]?.anchor;
    check(eng, 'sent, it is still a loop round the heading for the agent, every point inside the area (0–1000)', /drawn: (circled|box)/.test(edge) && /Pricing/.test(edge) && (eA?.ink.pts.flat() || [-1]).every((v) => v >= 0 && v <= 1000), said(edge));

    // 2. A stroke that leaves the window at the bottom and is let go out there.
    await go(p, L.B, 'fold');
    await watch();
    const c = await box(p, 'c');
    await p.keyboard.down('d');
    await p.mouse.move(c.l + 20, c.cy);
    await p.mouse.down();
    await p.mouse.move(c.l + 60, 600, { steps: 8 });
    await p.mouse.move(c.l + 80, 760, { steps: 8 });
    await p.mouse.up();
    await p.keyboard.up('d');
    await sentAfter(p, 0);
    const f1 = await look(p);
    const s2 = await seen();
    check(eng, 'a stroke let go below the window\'s bottom edge: the lift is seen, it is sent, nothing is left dragging', f1.inkPins >= 1 && !f1.dragging && !f1.live, short({ pointerSeen: s2, draft: f1.inkAt.at(-1), dragging: f1.dragging, live: f1.live }));
    await p.keyboard.press('Escape');
    await p.mouse.move(300, 300);
    await sleep(100);

    // 3. The page scrolled (the wheel) in the middle of a stroke: 200 px, the pointer held still.
    await go(p, L.B, 'mid');
    const yOf = (d) => (d.match(/^M(-?\d+) (-?\d+)/) || []).slice(1).map(Number);
    await p.keyboard.down('d');
    await p.mouse.move(100, 300);
    await p.mouse.down();
    await p.mouse.move(300, 302, { steps: 10 });
    const m0 = await look(p);
    await p.mouse.wheel(0, 200);
    await sleep(300);
    await p.mouse.move(310, 303, { steps: 2 });
    const m1 = await look(p);
    const sc = await p.evaluate(() => scrollY);
    await p.mouse.move(500, 302, { steps: 10 });
    await p.mouse.up();
    await p.keyboard.up('d');
    await sentAfter(p, 0);
    const m2 = await look(p);
    check(eng, 'the page scrolled 200 px mid-stroke: the part already drawn stays on the words it was drawn on (it scrolls with the page)', sc === 200 && near(yOf(m0.liveD)[1], 300, 3) && near(yOf(m1.liveD)[1], 300, 3), `scrolled ${sc}; the stroke began at page y ${yOf(m0.liveD)[1]}, after the scroll its start is drawn at page y ${yOf(m1.liveD)[1]}`);
    // On the page the pen went along y 300, then (the page having moved under it) along y 500: 200 px tall.
    check(eng, 'the page scrolled mid-stroke: the drawing\'s area covers both places the pen was on the page (about 200 px tall)', m2.inkPins >= 1 && m2.inkAt.at(-1) && m2.inkAt.at(-1).b - m2.inkAt.at(-1).t > 180, short({ draft: m2.inkAt.at(-1), tall: m2.inkAt.at(-1) ? m2.inkAt.at(-1).b - m2.inkAt.at(-1).t : 0 }));
    await p.keyboard.press('Escape');

    // 4. Two strokes of one drawing, the page scrolled between them: an underline under row 2, another under row 4.
    await go(p, L.B, 'between');
    const r2 = await letters(p, 'r2', 0, 5);
    await p.keyboard.down('d');
    await stroke(p, [[r2.l, r2.b + 3], [r2.l + 180, r2.b + 4]]);
    await p.mouse.wheel(0, 200);
    await sleep(250);
    const r4 = await letters(p, 'r4', 0, 5);
    await stroke(p, [[r4.l, r4.b + 3], [r4.l + 180, r4.b + 4]]);
    await p.keyboard.up('d');
    await sentAfter(p, 0);
    const b1 = await look(p);
    if (b1.sent) await send(p);
    const between = await L.agent('between');
    known(eng, 'two strokes with a scroll between them (under row 2, then under row 4): the area holds both rows, 200 px apart', b1.inkPins >= 1 && b1.inkAt.at(-1).b - b1.inkAt.at(-1).t > 180 && /row 2/.test(between) && /row 4/.test(between), `${short({ draft: b1.inkAt.at(-1), sameSpotOnScreen: near(r2.b, r4.b, 2) })} ${said(between)}`);

    // 5. Far down a long page: the drawing is where it was drawn, and stays on its words as the page scrolls.
    await go(p, L.B, 'deep');
    await p.evaluate(() => scrollTo(0, 2600));
    await sleep(200);
    const w = await letters(p, 'r29', 0, 6);
    const want = { l: w.l - 14, r: w.r + 14, t: w.mid - 24, b: w.mid + 24 };
    await drawn(p, [ring((w.l + w.r) / 2, w.mid, (w.r - w.l) / 2 + 14, 24)]);
    await send(p);
    const d1 = (await look(p)).inkAt[0];
    await p.evaluate(() => scrollTo(0, 2500));
    await sleep(400);
    const d2 = (await look(p)).inkAt[0];
    const deep = await L.agent('deep');
    check(eng, 'a loop drawn 2600 px down a long page is sent where it was drawn, reads as circled with its row, and scrolls with it', Boolean(d1 && d2) && near(d1.l, want.l) && near(d1.t, want.t) && near(d1.r, want.r) && near(d1.b, want.b) && near(d2.t - d1.t, 100, 3) && /drawn: (circled|box)/.test(deep) && /row 29/.test(deep), `${short({ want, sent: d1, after100: d2 })} ${mark(deep)}`);

    // 6. A stroke that starts on a link's own words (D held says "draw").
    await go(p, L.B, 'onlink');
    const k0 = await look(p);
    const lk = await box(p, 'lk');
    await p.keyboard.down('d');
    await stroke(p, [[lk.l + 6, lk.cy], [lk.l + 60, lk.b + 30], [lk.l + 200, lk.b + 34]]);
    await p.keyboard.up('d');
    await sentAfter(p, 0);
    const k1 = await look(p);
    const hash1 = await p.evaluate(() => location.hash);
    check(eng, 'D held, a stroke that starts on a link\'s words: it draws (and is sent), the link is not followed', k1.inkPins >= 1 && hash1 === '', short({ sent: k1.inkPins, draftInk: k1.draftInk, hash: hash1 }));
    check(eng, 'D held, a stroke that starts on a link: whatever it does, letting D go does not also show or hide done pins', k0.hideDone === k1.hideDone, `lab-hide-done "${k0.hideDone}" -> "${k1.hideDone}"`);
    await p.keyboard.press('Escape');

    // 7. A stroke from plain words, across the link, ending on the button.
    await go(p, L.B, 'across');
    const lk2 = await box(p, 'lk');
    const bt = await box(p, 'bt');
    const a7 = await box(p, 'a');
    const x1 = await drawn(p, [[[a7.l + 4, lk2.b + 2], [lk2.cx, lk2.b + 3], [bt.cx, bt.b - 4]]]);
    const st = await p.evaluate(() => ({ hash: location.hash, clicks: window.__clicks || 0 }));
    if (x1.sent) await send(p);
    const across = await L.agent('across');
    check(eng, 'a stroke that starts on plain words, runs under a link and is let go on a button: a drawing, the link not followed, the button not pressed', x1.inkPins >= 1 && st.hash === '' && st.clicks === 0 && /type: drawing/.test(across) && /full terms/.test(across), `${short(st)} ${said(across)}`);

    // 8. A stroke that starts above an iframe and is let go inside it.
    await go(p, L.B, 'frame');
    await sleep(300);
    const fr = await box(p, 'f');
    const a8 = await box(p, 'a');
    await p.keyboard.down('d');
    await p.mouse.move(a8.l + 30, a8.cy);
    await p.mouse.down();
    await p.mouse.move(a8.l + 60, fr.t - 6, { steps: 6 });
    await p.mouse.move(a8.l + 120, fr.t + 80, { steps: 10 });
    await p.mouse.up();
    await p.keyboard.up('d');
    await sentAfter(p, 0);
    const f8 = await look(p);
    check(eng, 'a stroke from the page into an iframe, let go inside it: the stroke follows the pointer into the frame, it is sent, nothing is left dragging', f8.inkPins >= 1 && !f8.dragging && !f8.live && f8.inkAt.at(-1).b > fr.t + 60, short({ frameTop: Math.round(fr.t), draft: f8.inkAt.at(-1), dragging: f8.dragging, live: f8.live }));
    await p.keyboard.press('Escape');
    await p.keyboard.up('d');

    // 9. A stroke that starts inside the iframe (the frame has no widget): nothing, and D is not left "held".
    await go(p, L.B, 'inframe');
    await sleep(300);
    const fr9 = await box(p, 'f');
    const a9 = await box(p, 'a');
    await p.keyboard.down('d');
    await stroke(p, [[fr9.l + 40, fr9.t + 40], [fr9.l + 200, fr9.t + 120]]);
    await p.keyboard.up('d');
    await sleep(1300);
    const i1 = await look(p);
    await p.mouse.click(a9.r + 200, a9.cy + 40); // back on the page (a click outside anything)
    await p.keyboard.press('Escape');
    await sleep(200);
    await stroke(p, [[a9.l, a9.t - 10], [a9.l + 200, a9.b + 10]]);
    await until(p, '.float textarea', 2000);
    const i2 = await look(p);
    check(eng, 'D held, a stroke begun inside an iframe: no half drawing on the page; D is not left held after (the next plain drag marks a box)', !i1.live && !i1.dragging && i2.box && i2.zone === 1 && i2.draftInk === 0 && i2.live === 0, short({ afterFrame: { box: i1.box, live: i1.live, draftInk: i1.draftInk }, plainDrag: { box: i2.box, zone: i2.zone, draftInk: i2.draftInk, live: i2.live } }));
    await p.keyboard.press('Escape');

    // 10. A loop round words in a fixed header, the page scrolled under it.
    await go(p, L.B, 'fixed');
    await p.evaluate(() => scrollTo(0, 300));
    await sleep(200);
    const m = await box(p, 'm2');
    const wantF = { l: m.l - 12, r: m.r + 12, t: m.cy - 22, b: m.cy + 22 };
    await drawn(p, [ring(m.cx, m.cy, m.w / 2 + 12, 22)]);
    await send(p);
    const x0 = (await look(p)).inkAt[0];
    await p.mouse.move(500, 400);
    await p.mouse.wheel(0, 600);
    await sleep(1600); // past the widget's one-second look at the page
    const x2 = (await look(p)).inkAt[0];
    const fixed = await L.agent('fixed');
    check(eng, 'a loop round words in a fixed header: sent where it was drawn, the header\'s words in it, none of the rows that were under the header', Boolean(x0) && near(x0.l, wantF.l) && near(x0.t, wantF.t) && near(x0.b, wantF.b) && /Docs and guides/.test(fixed) && !/text in area: "[^"]*row \d/.test(fixed), `${short({ want: wantF, sent: x0 })} ${said(fixed)}`);
    // The same spot marked as a plain area (no D), to tell a drawing's own fault from any area's.
    await p.evaluate(() => scrollTo(0, 300));
    await sleep(300);
    const m3 = await box(p, 'm3');
    await stroke(p, [[m3.l - 8, m3.t + 8], [m3.r + 8, m3.b - 8]]);
    await until(p, '.float textarea', 2000);
    await send(p, 'plain area');
    const pa = (await look(p)).pinsAt[0];
    await p.mouse.move(500, 400);
    await p.mouse.wheel(0, 600);
    await sleep(1600);
    const pb = (await look(p)).pinsAt[0];
    // And a plain pin on a word of the header (a click).
    await p.evaluate(() => scrollTo(0, 300));
    await sleep(300);
    const mw = await box(p, 'm1');
    await p.mouse.click(mw.cx, mw.cy);
    await until(p, '.float textarea', 2000);
    await send(p, 'plain pin');
    const idx = (await look(p)).pinsAt.length - 1;
    const qa = (await look(p)).pinsAt[idx];
    await p.mouse.move(500, 400);
    await p.mouse.wheel(0, 600);
    await sleep(1600);
    const qb = (await look(p)).pinsAt.find((r) => qa && r.l === qa.l) || (await look(p)).pinsAt[idx];
    const sel = (await L.comments('fixed')).map((x) => `${x.anchor.ink ? 'drawing' : 'area'}: ${x.anchor.selector}`).join('; ');
    known(eng, 'the page scrolled 600 px more: the drawing stays on the fixed header, it does not scroll away with the rows', Boolean(x0 && x2) && near(x2.t, x0.t, 4) && near(x2.l, x0.l, 4), `${short({ before: x0, after: x2 })}; a plain area's pin on the same header ${pa && pb ? (near(pa.t, pb.t, 4) ? 'stays' : `scrolls away too (${pa.t} -> ${pb.t})`) : 'was not made'}; a plain pin on a header word ${qa && qb ? (near(qa.t, qb.t, 4) ? 'stays' : `scrolls away (${qa.t} -> ${qb.t})`) : 'was not made'}; anchored on ${sel}`);

    // 11. Zoomed pages: the browser's own zoom at 150 % (a 667 px wide window at 1.5 device px per px), the content
    //     zoomed in the page's CSS (a wrapper with zoom: 1.5), and the whole page (html { zoom: 1.5 }).
    const onZoom = async (q, page, name) => {
      await go(q, L.B, page);
      const z = await letters(q, 'a', 0, 11);
      const want = { l: Math.round(z.l - 16), r: Math.round(z.r + 16), t: Math.round(z.mid - 30), b: Math.round(z.mid + 30) };
      const at = (r) => Boolean(r) && near(r.l, want.l, 8) && near(r.t, want.t, 8) && near(r.r, want.r, 8) && near(r.b, want.b, 8);
      const z1 = await drawn(q, [ring((z.l + z.r) / 2, z.mid, (z.r - z.l) / 2 + 16, 30)]);
      if (z1.sent) await send(q);
      const z2 = (await look(q)).inkAt[0];
      const text = await L.agent(page);
      // A plain area over the same words, to tell a drawing's own fault from any area's.
      await stroke(q, [[want.l, want.t], [want.r, want.b]]);
      await until(q, '.float textarea', 2000);
      const plain = (await look(q)).zoneAt;
      await q.keyboard.press('Escape');
      (name.includes('(html)') ? known : check)(eng, `${name}: the sent drawing's lines are where the pointer drew them`, z1.inkPins >= 1 && at(z2), `${short({ want, draft: z1.inkAt.at(-1), sent: z2 })}; a plain area there is ${at(plain) ? 'in place' : `off too (${short(plain)})`}`);
      check(eng, `${name}: it reads as circled, with the words in it`, /drawn: (circled|box)/.test(text) && /Plans start/.test(text), said(text));
    };
    const zctx = await browser.newContext({ viewport: { width: 667, height: 467 }, deviceScaleFactor: 1.5 });
    await zctx.addInitScript(() => (localStorage.setItem('lab-name', 'leo'), localStorage.setItem('lab-on', '1')));
    await onZoom(await zctx.newPage(), 'zoom', 'the browser zoomed to 150 %');
    await zctx.close();
    await onZoom(p, 'zoomdiv', 'the content zoomed 1.5× in the page\'s CSS (a wrapper)');
    await onZoom(p, 'zoomhtml', 'the whole page zoomed 1.5× in its CSS (html)');
  });
} finally {
  L.stop();
}
done();
