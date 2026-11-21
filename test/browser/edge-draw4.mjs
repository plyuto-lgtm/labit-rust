// Edge cases of drawing with a pen (D held on the keyboard, the pen drags), on a touch screen as an iPad with a
// Pencil and a keyboard is: no pressure, a pen lying nearly flat, a pen that only hovers, two quick strokes, and a
// palm that lands on the glass while the pen draws (a brush, and a rest of most of a second).
// In Chrome's engine the pen and the palm are real (trusted) pointer events, sent through its devtools; Safari's
// engine has no such door, so there the same pointer events are made in the page (isTrusted false).
// Run: NODE_PATH=… ENGINES=chromium node test/browser/edge-draw4.mjs   (also ENGINES=webkit)
import { box, check, done, eachEngine, go, lab, look, mark, note, penFor, ring, said, send, sleep, until, sentAfter } from './edge-draw-kit.mjs';

const PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>p</title><style>body{margin:40px;font:20px/1.5 sans-serif} h1{margin:0 0 80px} p{width:600px;margin:0 0 60px}</style><h1 id="h">Pricing</h1><p id="a">Plans start small and grow with you</p><p id="b">Cancel any time from your account</p><p id="c">Questions go to the team</p><div style="height:900px"></div>';
const NAMES = ['pen', 'soft', 'flat', 'hover', 'two', 'palm', 'rest'];
const L = await lab(Object.fromEntries(NAMES.map((n) => [n, PAGE])));
const short = (o) => JSON.stringify(o).slice(0, 360);

try {
  await eachEngine({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }, async ({ eng, ctx, p }) => {
    const how = eng === 'chromium' ? 'a real pen' : 'a pen made in the page';
    const inks = async (page) => (await L.comments(page)).filter((x) => x.anchor?.ink);
    const open = async (page) => {
      await go(p, L.B, page);
      await sleep(300);
      await p.evaluate(() => { window.__pe = []; for (const k of ['pointerdown', 'pointercancel']) addEventListener(k, (e) => window.__pe.push({ k, type: e.pointerType, trusted: e.isTrusted, pressure: +e.pressure.toFixed(2), tiltX: e.tiltX, tiltY: e.tiltY }), true); });
      return penFor(eng, ctx, p);
    };
    const seen = () => p.evaluate(() => window.__pe);
    // One pen stroke through the points, about a frame apart.
    const penStroke = async (pen, pts, o = {}, during) => {
      await pen('down', ...pts[0], o);
      for (let i = 1; i < pts.length; i++) {
        await pen('move', ...pts[i], { ...o, held: true });
        await sleep(12);
        if (during) await during(i);
      }
      await pen('up', ...pts[pts.length - 1], o);
    };
    const around = async (id, rx = 70, ry = 26) => { const a = await box(p, id); return ring(a.l + 60, a.cy, rx, ry, 0, 372, 30); };

    // 1. The plain case, to stand the others on: D held, the pen draws a loop.
    let { pen, touch, trusted } = await open('pen');
    await p.keyboard.down('d');
    await penStroke(pen, await around('a'));
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    const p1 = await look(p);
    const s1 = (await seen())[0];
    const penText = await L.agent('pen');
    check(eng, `${how} with D held draws: seen as a pen${trusted ? ' (trusted)' : ''}, sent with its lines, the agent reads a loop round the words`, s1?.type === 'pen' && s1.trusted === trusted && p1.inkPins >= 1 && /type: drawing/.test(penText) && /drawn: (circled|box)/.test(penText) && /Plans start/.test(penText), `${short(s1)} ${said(penText)}`);

    // 2. A pen that reports no pressure at all (some do, some styluses always).
    ({ pen, touch, trusted } = await open('soft'));
    await p.keyboard.down('d');
    await penStroke(pen, await around('a'), { force: 0 });
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    const p2 = await look(p);
    const s2 = (await seen())[0];
    check(eng, `${how} with pressure 0 still draws`, s2?.type === 'pen' && s2.pressure === 0 && p2.inkPins >= 1 && p2.inkAt.at(-1).r - p2.inkAt.at(-1).l > 120, short({ seen: s2, draft: p2.inkAt.at(-1) }));
    await p.keyboard.press('Escape');

    // 3. A pen lying nearly flat (tilt 90 and -90).
    ({ pen, touch, trusted } = await open('flat'));
    await p.keyboard.down('d');
    await penStroke(pen, await around('a'), { tiltX: 90, tiltY: -90 });
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    const p3 = await look(p);
    const s3 = (await seen())[0];
    const want = await box(p, 'a');
    // (Safari's engine drops the tilt of a pointer event made in the page: there only the drawing is checked.)
    check(eng, `${how} tilted flat (90, -90) draws the same loop, where the tip was`, s3?.type === 'pen' && (Math.abs(s3.tiltX) === 90 || !trusted) && p3.inkPins >= 1 && Math.abs(p3.inkAt.at(-1).l - (want.l + 60 - 70)) < 5 && Math.abs(p3.inkAt.at(-1).t - (want.cy - 26)) < 5, short({ seen: s3, draft: p3.inkAt.at(-1) }));
    await p.keyboard.press('Escape');

    // 4. A pen that only hovers over the glass (moves, no press) with D held.
    ({ pen, touch, trusted } = await open('hover'));
    const h0 = await look(p);
    await p.keyboard.down('d');
    for (const q of await around('a')) { await pen('move', ...q, { hover: true }); await sleep(8); }
    await sleep(200);
    const h1 = await look(p);
    await p.keyboard.up('d');
    await sleep(1300);
    const h2 = await look(p);
    check(eng, `${how} hovering (no press) with D held draws nothing and opens nothing`, !h1.live && !h1.dragging && !h2.box && !h2.draftInk, short({ live: h1.live, dragging: h1.dragging, box: h2.box, doneFlipped: h0.hideDone !== h2.hideDone }));
    await p.keyboard.press('d'); // done pins back as they were (D alone flips them, as it should)

    // 5. Two quick pen strokes, D held: one drawing, an X.
    ({ pen, touch, trusted } = await open('two'));
    const a5 = await box(p, 'a');
    await p.keyboard.down('d');
    await penStroke(pen, [[a5.l + 10, a5.t - 10], [a5.l + 75, a5.cy], [a5.l + 140, a5.b + 10]]);
    await penStroke(pen, [[a5.l + 140, a5.t - 10], [a5.l + 75, a5.cy], [a5.l + 10, a5.b + 10]]);
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    const p5 = await look(p);
    const two = await L.agent('two');
    check(eng, `two quick strokes with ${how}, D held: one drawing, read as an X over the words`, p5.inkPins >= 1 && (await inks('two')).length === 1 && /drawn: X drawn over it/.test(two) && /Plans/.test(two), said(two));

    // 6. The palm brushes the glass while the pen draws: it lands 400 px away, slides, lifts.
    ({ pen, touch, trusted } = await open('palm'));
    const a6 = await box(p, 'a');
    const pts6 = ring(a6.l + 100, a6.cy, 90, 28, 0, 372, 36);
    const palm = [700, a6.cy + 260];
    await p.keyboard.down('d');
    await penStroke(pen, pts6, {}, async (i) => {
      if (i === 10) await touch.start(...palm);
      if (i === 13) await touch.move(palm[0] + 6, palm[1] + 10);
      if (i === 16) await touch.move(palm[0] + 10, palm[1] + 22);
      if (i === 19) await touch.end();
    });
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    const p6 = await look(p);
    const ev6 = await seen();
    const wide = p6.inkAt.at(-1) ? p6.inkAt.at(-1).r - p6.inkAt.at(-1).l : 0;
    const wantL = Math.round(a6.l + 10);
    const wantR = Math.round(a6.l + 190);
    check(eng, `a palm that brushes the glass while ${how} draws: the drawing is the pen's whole loop and nothing of the palm's`, p6.inkPins >= 1 && Math.abs(p6.inkAt.at(-1).l - wantL) < 6 && Math.abs(p6.inkAt.at(-1).r - wantR) < 6 && p6.inkAt.at(-1).b < palm[1] - 100, short({ want: { l: wantL, r: wantR, b: Math.round(a6.cy + 28) }, draft: p6.inkAt.at(-1), wide, palmAt: palm, pointers: ev6.map((e) => `${e.k}:${e.type}`).join(',') }));
    const palmText = await L.agent('palm');
    check(eng, 'sent, that drawing reads as the loop it was (circled, with its words only), not as a mark that reaches the palm', /drawn: (circled|box)/.test(palmText) && /Plans start/.test(palmText) && !/Questions/.test(palmText), said(palmText));
    await p.keyboard.press('Escape');

    // 7. The palm rests on the glass for most of a second while the pen draws, and lifts before the pen does
    //    (a finger held still pins, on a phone). The pen goes on for the rest of its loop.
    ({ pen, touch, trusted } = await open('rest'));
    const a7 = await box(p, 'a');
    const pts7 = ring(a7.l + 100, a7.cy, 90, 28, 0, 372, 100);
    await p.keyboard.down('d');
    const t0 = Date.now();
    let rested = 0;
    await penStroke(pen, pts7, {}, async (i) => {
      if (i === 5) (await touch.start(700, a7.cy + 260), (rested = Date.now()));
      if (i === 58) (await touch.end(), (rested = Date.now() - rested));
    });
    const mid7 = await look(p);
    await p.keyboard.up('d');
    await sentAfter(p, 0); // sent by itself (no box)
    await send(p); // its undo card let go: the pin drawn as it rests
    await sleep(300);
    const p7 = await look(p);
    const tall = p7.inkAt.at(-1) ? p7.inkAt.at(-1).b - p7.inkAt.at(-1).t : 0;
    check(eng, `a palm resting ${rested} ms while ${how} draws: no pin is made under the palm, and what is sent is the drawing`, p7.inkPins >= 1 && p7.draftPin === 0 && !mid7.box, short({ beforeDUp: { box: mid7.box, draftPin: mid7.draftPin, live: mid7.live }, after: { sent: p7.inkPins, draftInk: p7.draftInk, draftPin: p7.draftPin }, pointers: (await seen()).map((e) => `${e.k}:${e.type}`).join(','), strokeMs: Date.now() - t0 }));
    check(eng, 'the palm lifting does not end the pen\'s stroke: the loop is whole (56 px tall), not cut where the palm left', tall >= 52, `the loop is 180×56; the draft is ${p7.inkAt.at(-1) ? `${p7.inkAt.at(-1).r - p7.inkAt.at(-1).l}×${tall}` : 'none'}`);
    await p.keyboard.press('Escape');
    note(eng, 'how the pen was made', trusted ? 'trusted pen and touch events through Chrome\'s devtools (Input.dispatchMouseEvent pointerType pen, Input.dispatchTouchEvent)' : 'PointerEvents of type pen and touch dispatched in the page (isTrusted false): Safari\'s engine has no other door');
    void mark;
  });
} finally {
  L.stop();
}
done();
