// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
//
// Drag to mark: a mouse or a pen drags an area (or, holding D, a drawing) instead of a point; the ink at the end of a
// drag; and the words selected with Shift + drag, offered as a comment on them.
import { inkAnchor, liveInk } from './ink.ts';
import { cut, openingTag, short, wholeWords, zoneAnchor, zoneEl, anchorAt } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
let S: any; // the widget's state (W.S), read once at startup
// One write per frame, position by transform: the frame follows the pointer without forcing layout in between.
// The least an area is, each way. A flat drag drew a hairline as wide as the window, which reads as a line
// across the page rather than as something being marked. The saved area grows to the same (see endDrag).
const ZONE_MIN = 12;
const paintZone = () => {
  S.zoneFrame = 0;
  if (!S.drag?.active || !S.liveZone) return;
  const span = (a, b) => {
    const size = Math.max(Math.abs(b - a), ZONE_MIN);
    return { start: (a + b) / 2 - size / 2, size };
  };
  const across = span(S.drag.x0, S.drag.x1);
  const down = span(S.drag.y0, S.drag.y1);
  S.liveZone.style.transform = `translate3d(${across.start + scrollX}px, ${down.start + scrollY}px, 0)`;
  S.liveZone.style.width = `${across.size}px`;
  S.liveZone.style.height = `${down.size}px`;
};
// An open new-comment box with nothing typed in it doesn't block drawing an area (a stray click had opened one, and
// every drag after it silently did nothing until it was closed); one with words in it does, so they aren't lost.
export const draftHasText = () => Boolean(S.draft) && [...(W.root.querySelectorAll('.float textarea') as NodeListOf<HTMLTextAreaElement>)].some((t) => t.value.trim());
export function startDrag(e) {
  // An open card doesn't block a new area: it closes once the area is drawn (a plain click still just closes it).
  if ((!S.on && !e.altKey) || draftHasText() || e.button !== 0 || e.pointerType === 'touch' || e.metaKey || e.ctrlKey || (e.shiftKey && !S.shiftUp && !S.dKey)) return;
  // Holding D, a press on an earlier drawing's line draws a new one instead of opening it.
  if (e.composedPath().includes(W.host) && !(S.dKey && e.composedPath().some((n) => n instanceof Element && n.matches('.ink .hit')))) return;
  // Holding D, a press on a link or a button draws too: circling a broken button is the point (sims, 20 Nov).
  if (!e.altKey && !S.dKey && W.control(e.target)) return;
  if (W.isOff(e)) return;
  if (S.drag) return; // one pointer at a time: a palm on the glass while the pen draws is not a second stroke
  S.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, ink: S.dKey, id: e.pointerId };
  if (S.dKey) clearTimeout(S.inkTimer); // another stroke of the same drawing
}
export const endDrag = (e) => {
  if (!S.drag || e.pointerId !== S.drag.id) return; // another pointer lifting or cancelled (a palm) doesn't end the stroke
  const d = S.drag;
  S.drag = null;
  document.documentElement.classList.remove('lab-dragging');
  cancelAnimationFrame(S.zoneFrame);
  S.zoneFrame = 0;
  S.liveZone?.remove();
  S.liveZone = null;
  if (d.active && d.ink && e.type === 'pointercancel' && S.inking) {
    S.afterDrag = true; // nor is a click that may follow it
    setTimeout(() => (S.afterDrag = false), 0);
    S.drew = true;
    S.inking.strokes.pop(); // a cancelled stroke (the system took the pointer) is not part of the drawing
    if (S.inking.strokes.length) S.inking.paint();
    else {
      S.inking.svg.remove();
      S.inking = null;
    }
    return;
  }
  if (!d.active || e.type === 'pointercancel') return;
  // The click that follows this pointerup belongs to the drag, not a new pin.
  S.afterDrag = true;
  setTimeout(() => (S.afterDrag = false), 0);
  getSelection?.()?.removeAllRanges();
  // A stroke of a drawing: more may follow while D is held. It is done when D is let go, or a second after the last.
  if (d.ink) {
    S.drew = true;
    // Shift held as the pen lifts: a stroke that runs about straight becomes a straight line, flat, upright or at 45°
    // (Leo's pick S1, 20 Nov); a rough box or loop a clean rectangle or ellipse (S2). Anything else stays as drawn.
    const st = S.inking?.strokes.at(-1);
    if (e.shiftKey && st?.length > 1) {
      const [a, b] = [st[0], st.at(-1)];
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const run = st.reduce((n, p, i) => (i ? n + Math.hypot(p.x - st[i - 1].x, p.y - st[i - 1].y) : 0), 0);
      if (chord > 12 && run < chord * 1.35) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
        const w = st.reduce((n, p) => n + (p.w || 3), 0) / st.length;
        st.splice(0, st.length, { x: a.x, y: a.y, w }, { x: a.x + chord * Math.cos(ang), y: a.y + chord * Math.sin(ang), w });
        S.inking.paint();
      } else {
        // A rough box or loop comes out neat: a rectangle or an ellipse (Leo's pick S2). The reading part is loaded
        // with D, so this lands well before the drawing is read, a second later.
        const ink = S.inking;
        W.part('draw').then(({ neaten }) => {
          const neat = neaten?.(st);
          if (!neat || !ink.strokes.includes(st)) return;
          st.splice(0, st.length, ...neat);
          ink.paint();
        }).catch(() => {});
      }
    }
    clearTimeout(S.inkTimer);
    S.inkTimer = setTimeout(endInk, 1000);
    return;
  }
  // A thin drag (a line of text, a small icon) still makes an area: it keeps the size it was drawn at,
  // ZONE_MIN each way around its middle, instead of silently doing nothing.
  for (const [a, b] of [['x0', 'x1'], ['y0', 'y1']]) {
    if (Math.abs(d[b] - d[a]) >= ZONE_MIN) continue;
    const mid = (d[a] + d[b]) / 2;
    d[a] = mid - ZONE_MIN / 2;
    d[b] = mid + ZONE_MIN / 2;
  }
  W.showAgain();
  S.openId = null;
  W.begin(zoneAnchor(d));
};
// What a drawing sent with no words says: its mark, without the guess in brackets.
export const inkSaid = (mark = '') => mark.replace(/\s*\(likely:.*\)$/, '') || 'drawing';
async function endInk() {
  clearTimeout(S.inkTimer);
  const ink = S.inking;
  S.inking = null;
  if (!ink) return;
  const { readInk } = await W.part('draw').catch(() => ({ readInk: null }));
  ink.svg.remove();
  S.lastInk = ink.strokes; // a stroke drawn while its box is open, empty, joins it (above)
  if (!readInk) return;
  W.showAgain();
  S.openId = null;
  // An arrow's ends are named with the card or section they are in: "Shared availability" is in two plans (sims, 20 Nov).
  const block = (e) => e.parentElement?.closest('article, section, li, tr, figure, [id]');
  const here = ink.strokes.map((q) => q.map((p) => ({ ...p, x: p.x - scrollX, y: p.y - scrollY }))); // page → window, as the reader looks
  const read = readInk(here, (e) => e && short(`${openingTag(e)} "${short(e.textContent, 40)}"${block(e) ? ` in ${openingTag(block(e))} "${short(block(e).textContent, 30)}"` : ''}`, 200));
  // Sent as it is, what it reads as its words, with no box to send it from (Leo, 21 Nov: "just draw maybe and send dont
  // open comment to send it, just send"); words are added in its thread after.
  void W.sendDrawing(inkAnchor(read, ZONE_MIN));
}
// Selecting words. Computers: Shift + drag (or Shift + double or triple click) selects words; a plain drag marks an area
// wherever it starts, a click pins, and the page's text can't be selected without Shift (it shows the I-beam cursor,
// html.lab-shift-cur). Letting go opens the comment card on the words, the cursor in its box. Phones: holding a finger
// still pins (hold-to-comment); a selection made the phone's way is the page's own.
// The words selected, as an anchor: pinned at their end, quoting exactly them (a few words either side to find them
// again), not just the word under the pin.
const selectionAnchor = () => {
  const sel = getSelection?.();
  const range = sel?.rangeCount && sel.getRangeAt(0).cloneRange(); // a copy: moving the selection's own range would take the cursor from a box being typed in
  if (!range || W.host.contains(range.commonAncestorContainer)) return;
  // A double-click takes the word's space with it (Chrome): the quote, and the words each side of it, are read from
  // the words alone, or the quote would not be found again.
  const trim = (node: Node, i: number, step: number) => {
    while (node.nodeType === 3 && /\s/.test((node as Text).data[step < 0 ? i - 1 : i] ?? 'x')) i += step;
    return i;
  };
  range.setEnd(range.endContainer, trim(range.endContainer, range.endOffset, -1));
  range.setStart(range.startContainer, trim(range.startContainer, range.startOffset, 1));
  wholeWords(range); // a drag that starts or ends inside a word takes the whole word (anchoring.ts)
  const exact = String(range).replace(/\s+/g, ' ').trim();
  if (!exact) return;
  // The pin sits on the last selected letter (where the selection ended), when that's in the same element as its
  // first; a selection over several items keeps it on the first, so the pin finds its place again.
  const rects = range.getClientRects();
  const first = rects[0] || range.getBoundingClientRect();
  const last = rects[rects.length - 1] || first;
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  const anchor = startEl && (startEl === endEl || startEl.contains(endEl))
    ? anchorAt(Math.max(last.left, last.right - 2), last.top + last.height / 2, false, endEl)
    : anchorAt(first.left + 2, first.top + first.height / 2, false, startEl);
  const at = range.commonAncestorContainer;
  const block = ((at.nodeType === 1 ? at : at.parentElement) as Element | null)?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, blockquote, pre, section, article, div') || document.body;
  const side = (a: [Node, number], b: [Node, number]) => {
    const r = document.createRange();
    r.setStart(...a);
    r.setEnd(...b);
    return String(r).replace(/\s+/g, ' ');
  };
  anchor.kind = 'text';
  anchor.quote = {
    exact: short(exact, 300),
    prefix: cut(side([block, 0], [range.startContainer, range.startOffset]).replace(/^\s+/, ''), -40),
    suffix: cut(side([range.endContainer, range.endOffset], [block, block.childNodes.length]).replace(/\s+$/, ''), 40),
  };
  sel.removeAllRanges();
  return anchor;
};
// Computers, a drag over words let go: the comment card opens at once on the words, the cursor in its box.
export const offerSelection = () => {
  const got = selectionAnchor();
  if (!got) return; // a double-click's first mouse-up asks again, after the second one took the selection: keep that dialog
  if (S.draft) {
    // an empty box a click, or the first click of a double-click, opened gives way
    S.draft = null;
    W.keepSpot(null);
  }
  W.showAgain();
  S.openId = null;
  W.begin(got);
};
export function bindDrag(w: unknown) {
  W = w;
  S = W.S;
  // Drag (mouse or pen) to mark an area instead of a point. Touch keeps scrolling.
  S.drag = null;
  S.afterDrag = false;
  S.liveZone = null;
  S.zoneFrame = 0;
  document.addEventListener('pointerdown', (e) => !e.altKey && startDrag(e), true); // Option presses are taken earlier (see optionPress)
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!S.drag || e.pointerId !== S.drag.id) return; // another pointer (a palm) moving
      S.drag.x1 = e.clientX;
      S.drag.y1 = e.clientY;
      if (!S.drag.active && Math.hypot(S.drag.x1 - S.drag.x0, S.drag.y1 - S.drag.y0) > 8) {
        S.drag.active = true;
        getSelection?.()?.removeAllRanges();
        document.documentElement.classList.add('lab-dragging');
        if (S.drag.ink) {
          if (!S.inking && S.draft?.anchor?.ink && S.lastInk && !draftHasText()) {
            W.layer.append((S.inking = liveInk()).svg);
            S.inking.strokes.push(...S.lastInk.map((q) => q.map((p) => ({ ...p }))));
            S.draft = null;
            W.keepSpot(null);
            W.render();
          }
          if (!S.inking) W.layer.append((S.inking = liveInk()).svg);
          S.inking.strokes.push([{ x: S.drag.x0 + scrollX, y: S.drag.y0 + scrollY }]);
          // Held by the page till the pen lifts: a stroke run into a frame, or off the window, still ends here.
          try {
            document.documentElement.setPointerCapture(e.pointerId);
          } catch {}
        } else W.layer.append((S.liveZone = zoneEl('draft live')));
      }
      if (!S.drag.active) return;
      e.preventDefault();
      if (S.drag.ink) {
        const st = S.inking.strokes.at(-1);
        const q = st.at(-1);
        const now = e.timeStamp;
        const x = e.clientX + scrollX;
        const y = e.clientY + scrollY;
        const speed = q ? Math.hypot(x - q.x, y - q.y) / Math.max(1, now - (S.inkT || now - 16)) : 0; // px a ms
        S.inkT = now;
        // A pen's pressure sets the width; a mouse or finger draws thinner the faster it moves (Leo's pick 4, 20 Nov).
        const want = e.pointerType === 'pen' && e.pressure > 0 ? 1.5 + e.pressure * 4 : Math.max(1.6, Math.min(5, 5 - speed * 1.8));
        st.push({ x, y, w: q?.w ? (q.w + want) / 2 : want });
        return void S.inking.paint();
      }
      S.zoneFrame ||= requestAnimationFrame(paintZone);
    },
    true,
  );
  S.dKey = false;
  S.inking = null;
  // D let go: the drawing is done, or, when nothing was drawn, done pins show or hide (KEYS.done).
  addEventListener('keyup', (e) => {
    if (!S.dKey || W.actionOf(e) !== 'done') return;
    S.dKey = false;
    if (S.inking && !S.drag) endInk();
    else if (!S.drew && !S.drag && !S.dShift) W.toggleDone(); // the pen still down: it's a drawing, done pins stay as they are; ⇧D alone does nothing here
  }, true);
  addEventListener('blur', () => (S.dKey = false));
  // The drawing's box is open and focused, nothing typed yet: D pressed again types a "d" there. If a stroke starts
  // while it is still held, it was D held to draw on: the "d" goes and the stroke joins the drawing (edge tests, 20 Nov).
  addEventListener('keydown', (e) => {
    if (S.dKey || e.repeat || e.metaKey || e.ctrlKey || e.altKey || W.actionOf(e) !== 'done' || !S.draft?.anchor?.ink) return;
    const ta = e.composedPath()[0];
    if (ta instanceof HTMLTextAreaElement && !ta.value.trim()) S.dMaybe = ta;
  }, true);
  addEventListener('keyup', (e) => W.actionOf(e) === 'done' && (S.dMaybe = null), true);
  addEventListener('pointerdown', (e) => { // on the window: before the document's press that starts the stroke
    if (!S.dMaybe || e.button !== 0) return;
    if (S.dMaybe.value.trim().toLowerCase() === 'd') S.dMaybe.value = '';
    S.dMaybe.blur();
    S.dMaybe = null;
    S.dKey = true;
    S.drew = false;
  }, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  // Don't let images and videos start a native drag while comments are on: a press there marks an area.
  document.addEventListener(
    'dragstart',
    (e) => {
      const media = S.on && e.target instanceof Element && e.target.closest('img, video') && !e.composedPath().includes(W.host);
      if (S.drag || media) e.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!S.afterDrag) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
