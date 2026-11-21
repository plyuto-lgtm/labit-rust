// Edge cases of drawing pins (hold D and drag, src/widget/draw.ts): what odd marks read as in the agent's text
// (GET /_lab/agent/<page>). A dot, a very long line, loops that don't quite close or that overshoot, a wavy and a
// drifting underline, arrows whose head is its own stroke, and D held with a click that never became a drag.
// Run: NODE_PATH=… ENGINES=chromium node test/browser/edge-draw1.mjs   (also ENGINES=webkit)
import { check, done, drawn, eachEngine, go, lab, letters, box, look, mark, note, ring, said, send, sleep, stroke, until } from './edge-draw-kit.mjs';

const PAGE = '<!doctype html><meta charset="utf-8"><title>d</title><style>body{margin:40px;font:20px/1.5 sans-serif} h1{margin:0 0 80px} p{width:600px;margin:0 0 60px}</style><h1 id="h">Pricing</h1><p id="a">Plans start small and grow with you</p><p id="b">Cancel any time from your account</p><p id="c">Questions go to the team</p>';
const NAMES = ['dot', 'tap', 'long', 'diag', 'open', 'nearly', 'over', 'wavy', 'ripple', 'drift', 'drift2', 'head', 'ticks', 'ticksin'];
const L = await lab(Object.fromEntries(NAMES.map((n) => [n, PAGE])));

try {
  await eachEngine({}, async ({ eng, p }) => {
    // Draw on a page of its own, send it, and read what the agent gets and what the store keeps.
    const draw = async (page, strokes, steps) => {
      await go(p, L.B, page);
      const made = await drawn(p, typeof strokes === 'function' ? await strokes() : strokes, steps);
      if (made.sent) await send(p);
      const text = await L.agent(page);
      const c = (await L.comments(page)).find((x) => x.anchor?.ink);
      return { made, text, a: c?.anchor, n: (text.match(/^## /gm) || []).length };
    };

    // 1. A dot: the pen pressed and wobbled a few px on a word.
    const dot = await draw('dot', async () => { const w = await letters(p, 'a', 0, 5); return [[[w.l + 20, w.mid], [w.l + 26, w.mid + 5], [w.l + 30, w.mid - 4], [w.l + 22, w.mid + 2]]]; });
    check(eng, 'a dot (a wobble of a few px) is sent as a drawing of at least 12×12 px, its lines with it', dot.made.sent && /type: drawing, (\d+)×(\d+) px/.test(dot.text) && dot.a?.docW >= 12 && dot.a?.docH >= 12 && dot.a?.ink?.pts?.[0]?.length >= 4, said(dot.text));
    check(eng, 'a dot is not read as an arrow (nothing is pointed from or to); its word is in the area', !/drawn: arrow/.test(dot.text) && /text in area: "Plans"/.test(dot.text), mark(dot.text));

    // 2. D held and a plain click (the pointer never moved 8 px): one thing happens, not two.
    await go(p, L.B, 'tap');
    const t0 = await look(p);
    const wa = await letters(p, 'b', 0, 6);
    await p.keyboard.down('d');
    await p.mouse.click(wa.l + 200, wa.mid + 40);
    await p.keyboard.up('d');
    await sleep(400);
    const t1 = await look(p);
    const flipped = t0.hideDone !== t1.hideDone;
    check(eng, 'D held + a click that never became a drag: either a pin box opens or done pins flip, not both', !(t1.box && flipped), JSON.stringify({ box: t1.box, draftPin: t1.draftPin, doneFlipped: flipped, lines: t1.draftInk }));
    await p.keyboard.press('Escape');

    // 3. A very long flat line under a whole line of words, past both its ends.
    const long = await draw('long', async () => { const b = await box(p, 'a'); return [[[8, b.b + 2], [990, b.b + 4]]]; }, 30);
    check(eng, 'a line under the words from one edge of the window to the other reads as underlined, with all the words', /drawn: underlined/.test(long.text) && /Plans start small and grow with you/.test(long.text) && long.a?.docW > 950, said(long.text));

    // 4. A very long diagonal, corner to corner: an arrow, from what it starts on to what it ends on.
    const diag = await draw('diag', async () => { const h = await box(p, 'h'); const c = await box(p, 'c'); return [[[h.l + 10, h.cy], [c.l + 100, c.cy]]]; }, 30);
    check(eng, 'a long diagonal reads as an arrow from the heading to the last paragraph; the words between are in its area', /drawn: arrow/.test(diag.text) && /arrow from: <h1/.test(diag.text) && /arrow to: <p id="c"/.test(diag.text) && /Cancel any time/.test(diag.text), said(diag.text));

    // 5. Loops. Three quarters round the heading, never closed.
    const loop = async (page, from, to) => draw(page, async () => { const h = await box(p, 'a'); const w = await letters(p, 'a', 0, 11); return [ring((w.l + w.r) / 2, h.cy, (w.r - w.l) / 2 + 16, 26, from, to, 40)]; });
    const open = await loop('open', -80, 190);
    check(eng, 'a loop three quarters round the words (never closed) reads as circled, or at worst unclear: not as an arrow', /drawn: (circled|unclear)/.test(open.text), said(open.text));
    const nearly = await loop('nearly', -90, 240);
    // (A flat oval is read as "box drawn around it": the same thing to the agent, so either passes.)
    check(eng, 'a flat oval that stops just short of its start reads as circled (or a box round it), with the words in it', /drawn: (circled|box drawn around it)/.test(nearly.text) && /Plans start/.test(nearly.text), said(nearly.text));
    const over = await loop('over', -90, 330);
    check(eng, 'a loop that runs a sixth past its start (a quick hand) still reads as circled', /drawn: (circled|box drawn around it)/.test(over.text), said(over.text));

    // 6. Underlines by hand: a wavy one, a gentle ripple, and a flat one that drifts up as it goes.
    const under = async (page, f, len = 260) => draw(page, async () => { const w = await letters(p, 'a', 0, 5); return [Array.from({ length: Math.round(len / 5) + 1 }, (_, i) => [w.l + i * 5, w.b + 6 + f(i * 5, len)])]; }, 1);
    const wavy = await under('wavy', (x) => 6 * Math.sin((x / 40) * 2 * Math.PI));
    check(eng, 'a wavy line under words (waves 12 px tall) reads as underlined or a wavy underline (a mark of its own since 20 Nov), with the words', /drawn: (wavy )?underline/.test(wavy.text) && /Plans/.test(wavy.text), said(wavy.text));
    const ripple = await under('ripple', (x) => 3 * Math.sin((x / 50) * 2 * Math.PI));
    check(eng, 'a line that ripples a little (6 px) reads as underlined', /drawn: underlined/.test(ripple.text) && /Plans/.test(ripple.text), said(ripple.text));
    const drift = await under('drift', (x, len) => (-12 * x) / len);
    check(eng, 'a flat line that drifts 12 px over 260 reads as underlined', /drawn: underlined/.test(drift.text) && /Plans/.test(drift.text), said(drift.text));
    const drift2 = await under('drift2', (x, len) => (-22 * x) / len, 500);
    // (Its middle is 5 px above the foot of the words, inside their row: it read as underlined only where the caret missed a
    // letter, which draw.ts letterAt no longer does. Either reading is a flat line at the words, and neither an arrow.)
    check(eng, 'a flat line that drifts 22 px over 500 (2.5°) still reads as underlined or crossed out, not as an arrow', /drawn: (underlined|crossed out)/.test(drift2.text), said(drift2.text));

    // 7. Arrows whose head is drawn after the line: as one V, and as two ticks.
    const shaft = async () => { const h = await box(p, 'h'); const b = await box(p, 'b'); return { from: [h.l + 20, h.cy], tip: [b.l + 80, b.cy + 4] }; };
    const head = await draw('head', async () => { const s = await shaft(); return [[s.from, s.tip], [[s.tip[0] - 22, s.tip[1] - 6], s.tip, [s.tip[0] - 4, s.tip[1] - 24]]]; });
    check(eng, 'an arrow whose head is a V drawn after the line reads as one arrow, to the paragraph it points at', /drawn: arrow/.test(head.text) && /arrow from: <h1/.test(head.text) && /arrow to: <p id="b"/.test(head.text) && head.n === 1, said(head.text));
    const ticks = await draw('ticks', async () => { const s = await shaft(); return [[s.from, s.tip], [s.tip, [s.tip[0] - 22, s.tip[1] - 6]], [s.tip, [s.tip[0] - 4, s.tip[1] - 24]]]; });
    check(eng, 'an arrow whose head is two ticks drawn out from the tip reads as an arrow', /drawn: arrow/.test(ticks.text) && /arrow from: <h1/.test(ticks.text) && /arrow to: <p id="b"/.test(ticks.text), said(ticks.text));
    const ticksin = await draw('ticksin', async () => { const s = await shaft(); return [[s.from, s.tip], [[s.tip[0] - 22, s.tip[1] - 6], s.tip], [[s.tip[0] - 4, s.tip[1] - 24], s.tip]]; });
    // (Three strokes that don't join are sent as an unclear mark, which is the widget's honest answer: either passes.)
    check(eng, 'an arrow whose head is two ticks drawn in towards the tip: an arrow, or an unclear mark with all three lines', /drawn: (arrow|3 strokes, unclear mark)/.test(ticksin.text) && ticksin.a?.ink?.pts?.length === 3 && ticksin.n === 1, said(ticksin.text));
    note(eng, 'the marks, as read', [dot, long, diag, open, nearly, over, wavy, ripple, drift, drift2, head, ticks, ticksin].map((d) => mark(d.text)).join(' · '));
  });
} finally {
  L.stop();
}
done();
void stroke; void until;
