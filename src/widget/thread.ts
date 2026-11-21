// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import { bindTrial, keptRow, onReshow, triesInPlace, tryRow, untry } from './trial.ts';
import { stickToEnd } from './stick.ts';
import { heldPin, holdBox, letBox } from './pinhold.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindThread(w: unknown) {
  W = w;
  bindThreadScroll();
  bindTrial(w);
}

// On a computer (comments.js passes the pin): the card or box is tied to its pin with CSS anchor positioning, so
// the browser keeps it with the pin through any scrolling (a held pin's sticky header too) and puts it above the pin, or
// in from the screen's right edge, when there is no room (@position-try). A card on a pin the browser holds is tied to
// that pin's element instead (pinhold.ts holdBox); one on a pin the script places, to the pin itself (styles.css
// .tied-*). Where it goes is the script's own numbers (want, page px), kept as offsets from what it is tied to, so a
// point's card, an area's and a drawing's work alike. Tied, it keeps no place of its own (the script's would win).
// Phones' sheets and a question's card in the margin are placed as before.
type Want = { cx: number; cy: number; ux?: number; uy?: number; ay: number };
let tieCount = 0;
const pinNames = new WeakMap<Element, string>();
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
// Where the browser put each tied card, as an offset from what it is tied to: once the page scrolls, the card is held
// at that offset with no fallbacks, so it goes off screen with its pin (the fallbacks and the screen's floor are for where
// it opens and when it grows; while scrolling they flipped it above and below its pin and pinned it to the screen's top).
// A card is the exception: its place is the script's own (spot, lay), kept as offsets from its pin whatever the page
// does, so scrolling can't move it relative to its pin; it is laid again only when its size or the window's changes.
type Tie = { to: Element; x: number; y: number; frozen: boolean; pin?: boolean; rel?: Want };
const rests = new Map<HTMLElement, Tie>();
let watching: ResizeObserver | null = null;
const rest = (node: HTMLElement) => {
  const at = rests.get(node);
  if (!at || at.frozen || at.rel || !node.isConnected) return at;
  // At the end of its opening motion (it moves the box a few px, and it may still be running): where it settles.
  const moving = node.getAnimations();
  const was = moving.map((m) => m.currentTime);
  moving.forEach((m) => (m.currentTime = Number(m.effect?.getComputedTiming().endTime)));
  const [a, b] = [at.to.getBoundingClientRect(), node.getBoundingClientRect()];
  moving.forEach((m, i) => (m.currentTime = was[i]));
  [at.x, at.y] = [b.left - a.left, b.top - a.top];
  return at;
};
const thaw = (node: HTMLElement) => {
  const at = rests.get(node);
  if (!at?.frozen) return;
  at.frozen = false;
  node.style.removeProperty('position-try-fallbacks');
  node.style.left = node.style.top = '';
};
const settled = (e: AnimationEvent) => e.target === e.currentTarget && rest(e.currentTarget as HTMLElement);
function followPin(node: HTMLElement, tie: Tie) {
  rests.set(node, tie);
  (watching ??= new ResizeObserver((es) => es.forEach((e) => lay(e.target as HTMLElement) || rest(e.target as HTMLElement)))).observe(node);
  node.addEventListener('animationstart', settled);
}
// Where a card goes, in the window's own px: want's cx / cy are its corner below its pin, ay its bottom above it. In
// this order: below, above, beside (right, then left) a pin that is a point; the first that has the card whole in the
// window (12 px in from the sides, 8 from the top and bottom, the reply box with it). The side it was on goes first,
// so the card stays where it is while it still fits and a small change never turns it over. Where none fits, below
// it, held inside the window while its pin is in sight.
type Side = 'below' | 'above' | 'right' | 'left';
let kept: [unknown, Side] | null = null;
function spot(want: Want, w: number, h: number): [number, number, Side] {
  const [vw, vh] = [document.documentElement.clientWidth, document.documentElement.clientHeight];
  const { cx, cy, ay } = want;
  const x = Math.max(12, Math.min(cx, vw - 12 - w));
  const y = Math.max(8, Math.min(cy - 46, vh - 8 - h)); // beside, its top a little above the pin's
  const at: Partial<Record<Side, [number, number]>> = { below: [x, cy], above: [x, ay - h] };
  if (Math.abs(ay - cy + 50) < 1) Object.assign(at, { right: [cx + 52, y], left: [cx + 4 - w, y] }); // a point's pin is 28 px wide, from cx + 14, 10 px off it
  const id = W.S.openId;
  const was = kept?.[0] === id && W.S.shown === id ? kept[1] : null; // a thread opened afresh starts from the order
  const whole = (s: Side | null) => {
    const p = s && at[s];
    return Boolean(p && p[0] >= 11.5 && p[0] + w <= vw - 11.5 && p[1] >= 7.5 && p[1] + h <= vh - 7.5);
  };
  const fits = [was, 'below', 'above', 'right', 'left'].find((s) => whole(s as Side | null)) as Side | undefined;
  const side = fits || was || 'below';
  if (id) kept = [id, side];
  const [l, t] = at[side] || at.below!;
  return [l, fits || cy < 0 || cy > vh ? t : Math.max(8, Math.min(t, vh - 8 - h)), side];
}
// The corner of what a card is tied to, in the window's px (tieToPin).
const cornerOf = (at: Tie) => {
  const r = at.pin && (at.to as HTMLElement).offsetParent ? (at.to as HTMLElement).offsetParent!.getBoundingClientRect() : at.to.getBoundingClientRect();
  return at.pin ? [r.left + (at.to as HTMLElement).offsetLeft, r.top + (at.to as HTMLElement).offsetTop] : [r.left, r.top];
};
// A card laid at its place: offsets from its pin, no fallbacks. False for a box that is not a card.
function lay(node: HTMLElement) {
  const at = rests.get(node);
  if (!at?.rel || !node.isConnected) return false;
  const [ax, ay] = cornerOf(at);
  const { cx, cy, ay: up } = at.rel;
  const [l, t, side] = spot({ cx: ax + cx, cy: ay + cy, ay: ay + up }, node.offsetWidth, node.offsetHeight);
  node.style.setProperty('position-try-fallbacks', 'none');
  node.style.left = `calc(anchor(left) + ${px(l - ax)})`;
  node.style.top = `calc(anchor(top) + ${px(t - ay)})`;
  node.style.transformOrigin = side === 'above' ? '14px 100%' : '';
  return true;
}
function bindThreadScroll() {
  addEventListener('resize', () => rests.forEach((at, n) => (at.rel ? lay(n) : (thaw(n), requestAnimationFrame(() => rest(n))))));
  addEventListener(
    'scroll',
    () =>
      rests.forEach((at, node) => {
        if (!node.isConnected) return rests.delete(node);
        if (at.frozen || at.rel) return;
        // Not measured yet (the page scrolled right after the card was drawn, as a reload putting the scroll back
        // does): measured now, or it would be held at no offset at all, on top of its pin.
        if (!at.x && !at.y) rest(node);
        at.frozen = true;
        node.style.setProperty('position-try-fallbacks', 'none');
        node.style.left = `calc(anchor(left) + ${px(at.x)})`;
        node.style.top = `calc(anchor(top) + ${px(at.y)})`;
      }),
    { capture: true, passive: true },
  );
}
export function tieToPin(node: HTMLElement, pin: HTMLElement | null | undefined, kind: 'card' | 'beside', want?: Want) {
  node.classList.remove('tied-card', 'tied-beside');
  node.removeAttribute('data-held'); // set below once the browser carries it with its pin (comments.js: no redraw for it)
  rests.delete(node);
  node.style.removeProperty('position-try-fallbacks'); // a scroll's hold (bindThreadScroll) ends with the tie
  if (!pin || !want) {
    letBox(node);
    return node.style.removeProperty('position-anchor');
  }
  // A thread open at the first draw (after a reload, or with a reply half written): its pin is new and not in the
  // layer yet, so it has no place to measure. It goes in now; the layer's redraw keeps it where it belongs.
  if (!pin.isConnected) W.layer.append(pin);
  let to: Element | null = kind === 'card' ? holdBox(node, pin) : null;
  if (to) node.style.removeProperty('position-anchor'); // tied by the page's rule now: an inline one would win
  if (!to) {
    let name = pinNames.get(pin);
    if (!name) pinNames.set(pin, (name = `--lab-pin${(++tieCount).toString(36)}`));
    pin.style.setProperty('anchor-name', name);
    node.style.setProperty('position-anchor', name);
    node.classList.add(`tied-${kind}`);
    to = pin;
  }
  node.setAttribute('data-held', '');
  // Its corner as anchor positioning reads it: a pin's layout box, not its rect (a pin still popping in is scaled).
  const r = to === pin && pin.offsetParent ? pin.offsetParent.getBoundingClientRect() : to.getBoundingClientRect();
  const [x, y] = to === pin ? [r.left + scrollX + pin.offsetLeft, r.top + scrollY + pin.offsetTop] : [r.left + scrollX, r.top + scrollY];
  const set = (k: string, v?: number) => (v === undefined ? node.style.removeProperty(k) : node.style.setProperty(k, px(v)));
  set('--lab-cx', want.cx - x);
  set('--lab-cy', want.cy - y);
  set('--lab-ux', want.ux === undefined ? undefined : want.ux - x);
  set('--lab-uy', want.uy === undefined ? undefined : want.uy - y);
  set('--lab-ay', want.ay - y);
  node.style.left = node.style.top = '';
  const rel = kind === 'card' ? { cx: want.cx - x, cy: want.cy - y, ay: want.ay - y } : undefined;
  followPin(node, { to, x: 0, y: 0, frozen: false, pin: to === pin, rel });
  lay(node);
}

// aboveY: where the card's bottom goes when it opens above (an area's: above the area, not its pin).
export function placeCard(card, left, top, pin?: HTMLElement | null, aboveY = top - 40) {
  if (card.parentNode !== W.layer) W.layer.append(card); // one already there stays (moving a card takes the cursor from its box)
  const want = { cx: left - 14, cy: top + 10, ay: aboveY };
  tieToPin(card, pin, 'card', want); // tied: laid by the browser's anchor (lay), at the place spot() gives
  if (pin) return;
  // On the page's own px (a board's card is held to the screen after this, comments.js onBoard).
  const [l, t, side] = spot({ cx: want.cx - scrollX, cy: want.cy - scrollY, ay: want.ay - scrollY }, card.offsetWidth, card.offsetHeight);
  card.style.left = `${l + scrollX}px`;
  card.style.top = `${t + scrollY}px`;
  card.style.transformOrigin = side === 'above' ? '14px 100%' : '';
}

// Draft composer sits to the right of its pin, like the pin is the avatar; below it when there is no room.
export function placeBeside(node, left, top, pin?: HTMLElement | null) {
  W.layer.append(node);
  const width = node.offsetWidth;
  const right = scrollX + document.documentElement.clientWidth - 12;
  const h = node.offsetHeight;
  const end = W.contentEnd();
  if (left + 36 + width <= right) {
    node.style.left = `${left + 36}px`;
    node.style.top = `${Math.min(top - 37, end - h - 8)}px`; // never past the page's end
  } else {
    node.style.left = `${Math.max(scrollX + 12, Math.min(left - 14, right - width))}px`;
    node.style.top = `${top + 10 + h > end ? Math.max(scrollY + 8, top - 40 - h) : top + 10}px`;
  }
  // Whole inside the screen (8 px in), where the script is the one placing it (no pin to tie it to).
  const low = scrollY + document.documentElement.clientHeight - 8 - h;
  node.style.top = `${Math.max(scrollY + 8, Math.min(parseFloat(node.style.top), low))}px`;
  tieToPin(node, pin, 'beside', { cx: left + 36, cy: top - 37, ux: left - 14, uy: top + 10, ay: top - 40 });
}

// `now` gives the thread the pin shows now: the pin is kept across redraws (src/comments.js, render), so it can't hold one.
export function grab(pin, now) {
  pin.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !pin.classList.contains('grab')) return;
    const c = now();
    const r = pin.getBoundingClientRect();
    const tip = { dx: e.clientX - r.left, dy: e.clientY - r.bottom };
    // A pin the browser holds keeps no place of its own (pinhold.ts): its tip, the lower left corner, is where it shows.
    const held = heldPin(pin);
    const start = { x: e.clientX, y: e.clientY, sx: scrollX, sy: scrollY, left: held ? r.left + scrollX : parseFloat(pin.style.left), top: held ? r.bottom + scrollY : parseFloat(pin.style.top) };
    let moving = false;
    let last = e;
    W.S.grabbing = true;
    pin.setPointerCapture(e.pointerId);
    // Page coordinates, so the pin stays under the pointer when the page scrolls mid-drag.
    const place = () => {
      pin.style.left = `${start.left + last.clientX - start.x + scrollX - start.sx}px`;
      pin.style.top = `${start.top + last.clientY - start.y + scrollY - start.sy}px`;
    };
    const move = (ev) => {
      last = ev;
      if (!moving && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moving = true;
      pin.classList.add('dragging');
      W.letPin(pin); // the browser no longer holds it (pinhold.ts): the drag places it
      place();
    };
    const scrolled = () => moving && place();
    addEventListener('scroll', scrolled, true);
    W.S.dropDrag = () => {
      removeEventListener('scroll', scrolled, true);
      W.S.dropDrag = null;
    };
    const up = async (ev) => {
      pin.removeEventListener('pointermove', move);
      pin.removeEventListener('pointerup', up);
      pin.removeEventListener('pointercancel', up);
      pin.removeEventListener('lostpointercapture', up);
      W.S.dropDrag?.();
      if (!W.S.grabbing) return; // already ended (the layer was redrawn mid-drag)
      W.S.grabbing = false;
      if (!moving) return;
      pin.dataset.dragged = '1'; // the click that follows is the drop, not an open
      setTimeout(() => delete pin.dataset.dragged, 0);
      const x = ev.clientX - tip.dx;
      const y = ev.clientY - tip.dy;
      const under = document.elementsFromPoint(x, y).find((n) => n !== W.host);
      const deep = under?.shadowRoot && under.matches('[data-lab-board-view]') ? under.shadowRoot.elementFromPoint(x, y) : under; // a board's view: what is under the point inside it
      if (ev.type === 'pointercancel' || x < 0 || y < 0 || x > innerWidth || y > innerHeight || deep?.closest(W.OFF)) return W.render();
      const before = c.anchor;
      c.anchor = W.anchorAt(x, y);
      W.render();
      try {
        const { comment } = await W.send({ action: 'move', id: c.id, anchor: c.anchor, edit: W.store.get(`lab-edit:${c.id}`) || undefined });
        Object.assign(c, comment);
      } catch {
        c.anchor = before; // not saved: back where it was
        W.render();
      }
    };
    pin.addEventListener('pointermove', move);
    pin.addEventListener('pointerup', up);
    pin.addEventListener('pointercancel', up);
    pin.addEventListener('lostpointercapture', up);
  });
}

// What a thread card does, kept as it is when a question with choices is in it (choices only add to it):
// - the thread's messages as chat bubbles (yours on the right), the time and ✓ ✓✓ in the corner, ✅ on a done answer,
//   the "new" line above the first unread one, and opening it marks them read (markSeen);
// - an answer to a later message quotes it (to), and a tap on the quote goes to it;
// - a rule the agent offered (--suggest-rule): "rule?" on your message, kept with a tap, undo on the answer;
// - resolve / reopen (admins and the thread's starter), delete with its in-card question (admins);
// - the reply box (composer) at the foot, its draft kept per thread, focused on a computer when opened by a click;
// - scroll keeping: at the newest it follows new messages and the keyboard; scrolled back, it stays put; sync() adds
//   replies that arrive in place, so the reply box keeps its focus;
// - keys: R reply, E resolve, Escape closes, Ctrl-D / W next new, 1 to 6 pick a choice of an open question (comments.js);
// - phones: the bottom sheet (drag by its handle, swipe down to close: sheets.ts), "new · N ›" to the next one.
// A question with choices adds its rows in its bubble (choicesEl, below); on quoted words the card opens in the margin
// (placeAsk) and the rows are tried in the page. Its rows: point to try, tap or 1 to 6 to answer (undo for 5 s).
// The reply box is not focused while a question is open, so the digits are keys; words typed there are an ordinary reply.
export function threadCard(c, fresh = new Set(), focus = false) {
  const asking = openAsk(c);
  const card = W.el('div', { class: `card${asking ? ' asking' : ''}` }); // phones: an open question's sheet is half the screen
  // The thread scrolls in .body; the step buttons and the reply box stay put in .foot (phones: the sheet's bottom).
  const body = W.el('div', { class: 'body' });
  const foot = W.el('div', { class: 'foot' });
  card.append(W.el('div', { class: 'handle' }), body, foot);
  // Written on a paused video: the moment, as a chip; clicked, the page pauses there again (comments.js).
  const chip = c.anchor?.moment && W.S.momentChip?.(c.anchor.moment, true);
  if (chip) card.insertBefore(chip, body);
  // Why its pin is not plainly on its spot, in one line.
  const why = { lost: 'its spot is gone', hidden: 'hidden right now: its spot is not shown', unsure: 'unsure: it may not be the spot it was made on', changed: 'its words changed: check it still fits' }[W.position(c.anchor || {}).why as string];
  if (why && !c.resolved) card.insertBefore(W.el('div', { class: 'spotnote' }, why), body);
  card.addEventListener('click', (e) => e.stopPropagation());
  // Messages as in the chat: bubbles (yours on the right), the time and ✓ ✓✓ in the corner, ✅ on a done answer, and
  // a "new" line above the first one you haven't read. The thread's number (as in the agent text) leads its time.
  body.classList.add('msgs');
  // At its newest it stays at its newest while it gets shorter (the keyboard coming up as you answer), as the chat does;
  // scrolled back to read, it stays put (Leo, 17 Nov: "when I'm answering, the messages scrolled up").
  const end = stickToEnd(body, !asking); // an open question starts at the question and its rows (on a half-height sheet, not at the newest)
  // Going to answer: the last message comes into view, so you write under what you're answering (Leo, 17 Nov).
  foot.addEventListener('focusin', (e) => (e.target as Element).localName === 'textarea' && end.pin());
  // A rule the agent offered on its own (--suggest-rule), from your reply about how it answered: on your own message,
  // where the words came from, "make it a rule" (Leo, 17 Nov). Leaving it is a no.
  const STAR = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5l1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z"/></svg>';
  const offerOn = (mine) => {
    const all = [c, ...W.repliesOf(c.id)];
    const ans = all.slice(all.indexOf(mine) + 1).find((x) => x.session);
    // On this computer only: the lab keeps a rule from nowhere else, so another device would get a button that says no.
    if (!W.S.isAdmin || !W.S.mac || !ans?.suggest || ans.suggest.state) return null;
    const b = W.el('button', { class: 'btn offer', type: 'button', title: ans.suggest.text });
    // The words where the time is, the star where the tick is, each in their size and colour (Leo, 17 Nov).
    b.append(W.el('span', { class: 'tm' }, 'rule?'));
    const star = W.el('span', { class: 'tick' });
    star.innerHTML = STAR;
    b.append(star);
    b.addEventListener('click', async () => {
      const r = await fetch('/_lab/rule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: W.S.page, id: ans.id, action: 'keep' }) }).catch(() => null);
      if (!r?.ok) return void (b.lastChild!.textContent = 'failed, try again');
      ans.suggest.state = 'kept';
      for (const n of card.querySelectorAll(`.msg[data-id="${mine.id}"] .offering`)) n.classList.remove('offering');
      card.querySelectorAll(`.msg[data-id="${mine.id}"] .offer`).forEach((n) => n.remove()); // and its invisible copy
      card.querySelector(`.msg[data-id="${ans.id}"]`)?.append(ruleLine(ans)); // the rule shows on the agent's answer
    });
    return b;
  };
  const ruleLine = (item) => {
    const line = W.el('span', { class: 'rule' });
    if (item.suggest.state === 'undone') return line.append(W.el('b', {}, 'rule removed')), line;
    const undo = W.el('button', { class: 'btn', type: 'button' }, 'undo');
    undo.addEventListener('click', async () => {
      const r = await fetch('/_lab/rule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: W.S.page, id: item.id }) }).catch(() => null);
      if (!r?.ok) return void (undo.textContent = 'failed, try again');
      item.suggest.state = 'undone';
      line.replaceWith(ruleLine(item));
    });
    line.append(W.el('b', {}, 'rule'), document.createTextNode(item.suggest.text), undo);
    return line;
  };
  const itemEl = (item) => {
    const box = W.el('div', { class: `item msg${W.mine(item) && !item.session ? ' mine' : ''}`, 'data-id': item.id, ...(W.agentOf(item) ? { 'data-agent': W.agentOf(item) } : {}) });
    box.append(W.nameLine(item.name));
    // An answer to a later message in the thread quotes it, as the chat does (Leo, 17 Nov: "show what you replied on").
    const to = item.to && [c, ...W.repliesOf(c.id)].find((x) => x.id === item.to); // the pin itself too: it may be the question
    if (to) {
      const q = W.el('span', { class: 'quote' });
      q.append(W.el('b', {}, String(to.name || '').replace(/\s*·\s*session\s+\S+$/i, '')), document.createTextNode(to.text.replace(/\s+/g, ' ').slice(0, 90)));
      q.addEventListener('click', () => card.querySelector(`.msg[data-id="${to.id}"]`)?.scrollIntoView({ block: 'center', behavior: W.still.matches ? 'auto' : 'smooth' }));
      box.append(q);
    }
    box.append(...W.readable(item.text));
    if (item.images) W.part('attach').then((m) => m.show(box.appendChild(W.el('div')), item)); // thumbnails, in the attach part (it builds the names from the id, never reads a path)
    if (item.session && Array.isArray(item.choices) && item.choices.length) {
      box.classList.add('asks');
      box.append(choicesEl(c, item, card));
    }
    if (item.session && /kept|undone/.test(item.suggest?.state)) box.append(ruleLine(item));
    const stamp = W.stampOf(item, c, item === c && !c.resolved ? `#${W.numberOf(c)} · ` : '');
    // The offer sits in your message's corner in place of the time and tick, so the bubble keeps its size (Leo, 17 Nov:
    // 57 + 60, then "it makes bigger row"). Kept or gone, the time comes back.
    const offer = !item.session && offerOn(item);
    if (offer) {
      stamp.classList.add('offering');
      stamp.prepend(offer);
    }
    W.stamped(box, stamp);
    return box;
  };
  const shown = new Set();
  const all = [c, ...W.repliesOf(c.id)];
  const firstNew = all.find((x) => fresh.has(x.id));
  // The agent's "on it" messages fold into one muted row ("2 updates ›") once an answer follows them; the latest stays
  // while there is no answer yet. A tap opens them in place (Leo, 20 Nov).
  const unfolded: Set<string> = (W.S.unfolded ||= new Set());
  for (const slot of W.foldStatus(all, () => c.id, unfolded)) {
    if (slot.fold) {
      // Open: its messages follow the row (drawn on the next render). A tap shows or hides them in place.
      let els: HTMLElement[] = [];
      const row = W.foldRow(slot, unfolded, (open) => {
        if (open) {
          els = slot.items.map((item) => itemEl(item));
          row.after(...els);
        } else {
          for (const n of els) n.remove();
          els = [];
        }
      });
      body.append(row);
      for (const item of slot.items) {
        shown.add(item.id);
        if (slot.open) els.push(body.appendChild(itemEl(item)));
      }
      continue;
    }
    const item = slot.m;
    if (item === firstNew && item !== c) body.append(W.el('div', { class: 'newline' }, 'new'));
    body.append(itemEl(item));
    shown.add(item.id);
  }
  card.sync = () => {
    // A new question with choices, or a pick (from another device): the card is drawn again, so the rows are right.
    if (W.repliesOf(c.id).some((r) => !shown.has(r.id) && (r.choices || r.picked))) return W.render();
    // A status, or an answer after statuses (they fold now): the card is drawn again so they fold, unless words are typed
    // in a box, which a redraw would take; then it is appended in place like any reply and folds on the next render.
    const written = [...card.querySelectorAll('textarea')].some((t) => (t as HTMLTextAreaElement).value.trim());
    if (!written && W.repliesOf(c.id).some((r) => !shown.has(r.id) && r.session && W.repliesOf(c.id).some((x) => W.isStatus(x)))) return W.render();
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
    for (const r of W.repliesOf(c.id)) {
      if (shown.has(r.id)) continue;
      const items = card.querySelectorAll('.item');
      const added = itemEl(r);
      added.classList.add('fresh');
      items[items.length - 1].after(added);
      shown.add(r.id);
      W.markSeen([r]);
    }
    if (atEnd) { // at the newest: the new one comes into view, and stays while its words settle
      body.scrollTop = body.scrollHeight;
      W.S.stayAtEnd?.(body);
    }
  };
  // Resolve: admins, and whoever started the thread (its key is kept in their browser). Delete: admins.
  const ownKey = W.store.get(`lab-edit:${c.id}`);
  let actions = null;
  if (W.S.isAdmin || ownKey) {
    actions = W.el('div', { class: 'row acts' });
    const resolve = W.el('button', { class: 'btn', type: 'button' }, c.resolved ? 'reopen' : 'resolve');
    const failed = (btn) => (btn.textContent = 'failed, try again');
    resolve.addEventListener('click', async () => {
      try {
        const closing = !c.resolved; // resolved: the thread is done, so its card closes (reopen keeps it open)
        const { comment } = await W.send({ action: c.resolved ? 'reopen' : 'resolve', id: c.id, ...(ownKey ? { edit: ownKey } : {}) });
        Object.assign(c, comment);
        // Resolving closes the comment at once, a quick fade where it is, not the slow slide down (Leo, 15 Nov).
        if (closing && W.S.openId === c.id) return (W.S.closeFast = true), (W.S.openId = null), W.render();
        W.render();
      } catch {
        failed(resolve);
      }
    });
    const del = W.el('button', { class: 'btn', type: 'button' }, 'delete');
    // Asked in the card itself, not the browser's dialog: the row swaps to the question, same height, nothing moves.
    const yes = W.el('button', { class: 'btn danger', type: 'button' }, 'delete');
    const no = W.el('button', { class: 'btn', type: 'button' }, 'cancel');
    let was = [resolve, del]; // the row as it was before the question (Do it, board and undo too)
    const back = () => {
      actions.replaceChildren(...was);
      del.focus();
    };
    del.addEventListener('click', () => {
      was = [...actions.children];
      actions.replaceChildren(W.el('span', { class: 'ask' }, W.repliesOf(c.id).length ? 'delete thread?' : 'delete comment?'), yes, no);
      no.focus();
    });
    no.addEventListener('click', back);
    actions.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && yes.isConnected) {
        e.stopPropagation();
        back();
      }
    });
    yes.addEventListener('click', async () => {
      try {
        await W.send({ action: 'delete', id: c.id }); // the API deletes the replies with it
      } catch {
        return failed(yes);
      }
      W.S.comments = W.S.comments.filter((x) => x.id !== c.id && x.parent !== c.id);
      W.S.openId = null;
      W.render();
    });
    // Undo (Leo, 19 Nov): for 3 s after this tab sent the thread (W.S.undo, src/comments.js), "undo" sits in the
    // resolve key's place, a line under it running out; a tap deletes the pin and opens its box again with the words.
    // The key keeps resolve's width (both words stacked, one hidden), so nothing moves when it turns back.
    const take = W.S.undo?.id === c.id ? W.S.undo : null;
    const left = take ? take.until - Date.now() : 0;
    let first = resolve;
    if (left > 0) {
      const undo = W.el('button', { class: 'btn undo', type: 'button', 'aria-label': 'undo: take this pin back' });
      const w = W.el('span', { class: 'w', style: `--undo-ms:${left}ms;--undo-from:${Math.min(1, left / W.UNDO_MS)}` });
      w.append(W.el('span', {}, 'undo'), W.el('span', { class: 'ghost', 'aria-hidden': 'true' }, 'resolve'));
      undo.append(w);
      undo.addEventListener('click', async () => {
        try {
          await W.takeBack(c);
        } catch {
          failed(undo);
        }
      });
      // Touched: the card stays open when the 3 s are up (untouched, it closes as a sent card always did).
      for (const ev of ['pointerdown', 'focusin', 'keydown']) card.addEventListener(ev, (e) => e.target !== undo && !undo.contains(e.target) && (take.touched = true));
      setTimeout(() => undo.isConnected && undo.replaceWith(resolve), left);
      first = undo;
    }
    // "Do it" on a pin the agent left itself (labit pin): hands it back to the agent's next wait as "<name> said: do it".
    const said = [c, ...W.repliesOf(c.id)].filter((m) => m.session).map((m) => m.createdAt).sort().pop() || '';
    const asked = W.repliesOf(c.id).some((r) => r.doit && !r.session && r.createdAt > said); // already told, and the agent has not answered since
    const doIt = c.session && !c.resolved ? W.el('button', { class: 'btn', type: 'button', ...(asked ? { disabled: '' } : {}) }, asked ? 'told' : 'Do it') : null;
    doIt?.addEventListener('click', async () => {
      const name = String(W.store.get('lab-name') || '').trim();
      if (!name) return void ((doIt.textContent = 'your name first'), W.S.openCard?.querySelector('textarea')?.focus({ preventScroll: true }));
      doIt.disabled = true;
      try {
        const { comment } = await W.send({ name, text: 'Do it', parent: c.id, doit: true });
        W.addComment(comment);
        W.markSeen([comment]);
        W.render();
      } catch {
        doIt.disabled = false;
        failed(doIt);
      }
    });
    actions.append(...(doIt ? [doIt] : []), first, ...(W.S.isAdmin ? [del] : []));
    body.append(actions);
  }
  // Phones: step through the threads from the sheet (J and K on a keyboard).
  if (W.coarse) {
    // As on a computer: no prev / next, just new · N (the bar's ne(w), which the sheet covers) to the next pin with
    // something new, top to bottom of the page, further down first.
    const topOf = (x) => W.position(x.anchor || {}).top;
    const here = topOf(c);
    const fresh = W.threads().filter((x) => !W.isPage(x) && x.id !== c.id && W.unread(x).length).map((x) => [x, topOf(x)]);
    fresh.sort((p, q) => (p[1] > here ? 0 : 1) - (q[1] > here ? 0 : 1) || p[1] - q[1]);
    const nav = W.el('div', { class: 'row nav' });
    if (fresh.length) {
      const b = W.el('button', { class: 'btn', type: 'button' }, `new · ${fresh.length} ›`);
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // an open keyboard stays open (see goTo)
      b.addEventListener('click', () => W.goTo(fresh[0][0]));
      nav.append(b);
    }
    // One row on phones: new on the left, reopen / delete on the right, at the top under the handle like a header, so
    // the reply box below stands alone as the chat's does (and the messages fade under it the same way).
    if (actions) nav.append(actions);
    if (nav.firstChild) card.insertBefore(nav, body);
  }
  foot.append(
    W.composer({
      placeholder: 'reply',
      autofocus: focus && !asking, // an open question: no focus in the box, so 1 to 6 pick its choices
      draftKey: `lab-typing:${W.S.page}:${c.id}`,
      attach: true,
      onSubmit: async (name, text, att) => {
        const { comment } = await W.send({ name, text, parent: c.id, ...att });
        W.addComment(comment);
        W.markSeen([comment]);
        // Writing in a done thread reopens it (the lab does the same): it shows as open at once, pin and buttons.
        if (c.resolved) {
          c.resolved = false;
          W.render();
          // The card is drawn again: keep it where you were, at the newest message, with the cursor in the box.
          const again = W.S.openCard?.querySelector('.body');
          if (again) { again.scrollTop = again.scrollHeight; W.S.stayAtEnd?.(again); }
          W.S.openCard?.querySelector('textarea')?.focus({ preventScroll: true });
          return { keep: true };
        }
        // Add the reply where it belongs instead of redrawing the card, so nothing on screen blinks
        // and the reply box keeps its focus for the next one.
        // (Unless the stream's copy of it was added already: sync, above, shows each reply once.)
        if (!shown.has(comment.id)) {
          shown.add(comment.id);
          const items = card.querySelectorAll('.item');
          const added = itemEl(comment);
          added.classList.add('fresh');
          items[items.length - 1].after(added);
        }
        body.scrollTop = body.scrollHeight; // the reply just sent is in view above the box
        W.S.stayAtEnd?.(body);
        return { keep: true };
      },
    }),
  );
  return card;
}

// ---------- a question with choices (labit reply --choice …) ----------
// V1 "plain list" (Leo, 18 Nov): no bubble, no letters, no tags. The question, then the versions as a plain list of rows
// (the page's own words "· now", a tick on the one shown). A tap on a row
// answers (20 Nov, no Keep) as a reply, "Picked B: …" (the letter is for the agent, who listed them), with
// picked: { of, n } (lib/schema.mjs), but only after 5 s: the card says "Picked B · undo" meanwhile, and the pick goes
// at once when the card closes (or the page is hidden). On a computer 1 to 6 pick that choice of the open thread card (the
// same as a tap, with its undo), and Enter picks the ticked row (the agent's recommend, or the one tried last), and the arrow keys move the tick (pointing tries a row; so do they), unless a
// text box or a button has the focus (comments.js, pickByKey, pickTicked). On a phone a touch that
// moved (a scroll) answers nothing.
// With quoted words on the page the rows are also tried in it (trial.ts). The page chat draws a question the same way
// (chat.ts), with no trying: its messages have no quoted words.
// The open question in a thread: the agent's last message with choices that nobody has picked on yet.
const pickOf = (c, ask) => W.repliesOf(c.id).filter((r) => r.picked?.of === ask.id).pop();
export function openAsk(c) {
  const asks = [c, ...W.repliesOf(c.id)].filter((r) => r.session && Array.isArray(r.choices) && r.choices.length); // the pin itself asks when the agent pinned it with --choice
  const ask = asks[asks.length - 1];
  return ask && !pickOf(c, ask) && !c.resolved ? ask : null;
}
const LETTER = (n: number) => String.fromCharCode(65 + n);

// The pick just tapped, waiting its 5 s (one at a time). ui draws it in the card that shows it now: 'wait' (undo on
// offer), 'sending', or 'off' (back to rows, with a note when it failed). The card may be drawn again meanwhile: the
// new rows read this and pick up where it was.
const PICK_MS = 5000;
type Pending = { ask: string; thread: string; chat: boolean; n: number; before: number; name: string; text: string; until: number; timer: ReturnType<typeof setTimeout>; sending: boolean; ui?: (state: 'wait' | 'sending' | 'off', note?: string) => void };
let pending: Pending | null = null;
// A pick that could not be sent, kept by question so the card, drawn again, offers it again ("failed, tap again").
const failedPick = new Map<string, number>();
function commitPick(p: Pending) {
  if (pending !== p || p.sending) return;
  clearTimeout(p.timer);
  p.sending = true;
  p.ui?.('sending');
  void (async () => {
    try {
      const { comment } = await W.send({ name: p.name, text: p.text, parent: p.ask, to: p.ask, picked: p.n });
      if (pending === p) pending = null;
      failedPick.delete(p.ask);
      untry(); // the agent writes the pick into the file; the page shows its own words till then
      W.addComment(comment);
      W.markSeen([comment]);
      W.render();
    } catch (err) {
      console.warn('labit: the pick could not be sent', err);
      if (pending === p) pending = null;
      failedPick.set(p.ask, p.n); // its card may be closed: it shows this when it opens again
      p.ui?.('off', 'failed, tap again');
    }
  })();
}
/** Before every redraw (comments.js render): a pick waiting its 5 s goes now when its card (or the chat) has closed. */
export function flushPick(openId: string | null, chatOpen: boolean) {
  if (!pending || pending.sending) return;
  if (!(pending.chat ? chatOpen : openId === pending.thread)) commitPick(pending);
}
// The page is going or hidden (a tab switch, the phone locked): the pick goes now, not after its 5 s (best effort).
addEventListener('pagehide', () => pending && commitPick(pending));
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && pending && commitPick(pending));
/** 1 to 6 on a computer: the choice's row of the open thread card's question, as a tap (the chat's rows have no keys, so 1 stays comment / pointer there). Whether it took the key. */
export function pickByKey(n: number): boolean {
  if (W.coarse) return false;
  const live = W.S.openCard && ([...W.S.openCard.querySelectorAll('.choices.live')].pop() as { pick?: (n: number) => boolean } | undefined);
  return Boolean(live?.pick?.(n - 1));
}

/** Enter on a computer: the ticked row of the open thread card's question, as a tap. False when no question is open or no row is ticked (the agent gave no pick), so Enter does what it did. */
export function pickTicked(): boolean {
  if (W.coarse) return false;
  const live = W.S.openCard && ([...W.S.openCard.querySelectorAll('.choices.live')].pop() as { ticked?: () => boolean } | undefined);
  return Boolean(live?.ticked?.());
}

/** ArrowDown / ArrowUp on a computer: the ticked row of the open thread card's question moves one row (tried in the page), stopping at the ends. Whether it took the key (an open question is there). */
export function moveTicked(dir: 1 | -1): boolean {
  if (W.coarse) return false;
  const live = W.S.openCard && ([...W.S.openCard.querySelectorAll('.choices.live')].pop() as { move?: (d: 1 | -1) => boolean } | undefined);
  return Boolean(live?.move?.(dir));
}

// The rows of a question, under it. Answered (or an older one): the rows as they were, the pick ticked. Open: rows to
// try; a tap answers. host: the card of the thread (its tie is drawn again as words change), or the chat.
export function choicesEl(c, ask, host, chat = false) {
  const box = W.el('div', { class: 'choices' });
  const list = W.el('div', { class: 'rows' });
  box.append(list);
  const pick = pickOf(c, ask);
  const live = !pick && openAsk(c) === ask;
  if (pick && pending?.ask === ask.id && !pending.sending) {
    // answered from elsewhere
    clearTimeout(pending.timer);
    pending = null;
  }
  const inPlace = live && !chat && triesInPlace(c);
  const exact = c.anchor?.quote?.exact || '';
  // The quoted words as they are now: their own row ("· now") when trying in place, unless a choice is the same words.
  const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
  const nowIs = inPlace ? ask.choices.findIndex((t) => same(t, exact)) : -1;
  const rows: { n: number; el: HTMLButtonElement }[] = [];
  const row = (n: number, text: string, hint = '') => {
    const b = W.el('button', { class: 'choice', type: 'button', 'data-n': String(n), ...(n >= 0 ? { 'data-l': `${String.fromCharCode(97 + n)})` } : {}), ...(live ? {} : { disabled: '' }) }) as HTMLButtonElement; // a) b) c), as the agent lists them
    const now = inPlace && (n === -1 || n === nowIs);
    const words = W.el('span', { class: 'tx', dir: 'auto' }, text);
    const nw = now ? W.el('span', { class: 'nw' }, ' · now') : null;
    if (hint) {
      // A short description under the words, muted (labit reply --hint).
      const line = W.el('span', { class: 'ln' });
      line.append(words, ...(nw ? [nw] : []));
      const cx = W.el('span', { class: 'cx' });
      cx.append(line, W.el('span', { class: 'desc', dir: 'auto' }, hint));
      b.append(cx);
    } else b.append(words, ...(nw ? [nw] : []));
    if (now) b.classList.add('now');
    if (n >= 0 && n < 6 && !W.coarse && live) b.title = `press ${n + 1}`;
    if (pick && pick.picked.n === n) b.classList.add('picked');
    rows.push({ n, el: b });
    return b;
  };
  if (inPlace && nowIs < 0) list.append(row(-1, exact));
  const hints = Array.isArray(ask.hints) ? ask.hints : [];
  ask.choices.forEach((t, n) => list.append(row(n, t, typeof hints[n] === 'string' ? hints[n] : '')));
  // One line under the rows of an open question, always there (empty, unseen) so a note never makes the card taller.
  // An answered question has none (an old "kept as it was" pick keeps its line). A status: a screen reader says it.
  const note = W.el('span', { class: 'note idle', role: 'status' }, ' ');
  if (live || pick?.picked.n === -1) box.append(note);
  const say = (t?: string) => {
    note.classList.toggle('idle', !t);
    note.replaceChildren(t || ' ');
  };
  if (pick && pick.picked.n === -1) say(`kept as it was · ${pick.name}`);
  if (!live) return box;
  box.classList.add('live');

  // A tap answers (Leo, 20 Nov: "remove keep button answer right away"), 5 s later (undo until then). On a computer
  // pointing at a row still tries it in the page; the row shown at first is the page's own words, or the agent's pick.
  const back = keptRow(ask);
  const lost = failedPick.get(ask.id); // its pick could not be sent when this card was last open: offered again
  let cur = lost ?? back ?? (inPlace ? (nowIs >= 0 ? nowIs : -1) : ask.recommend ?? -1);
  const words = (n: number) => (n < 0 ? exact : ask.choices[n]);
  let shown = cur; // the row in the page: the one pointed at, else cur
  const show = (n: number) => {
    shown = n;
    return inPlace && tryRow(c, ask, n, n < 0 || n === nowIs ? null : words(n), host);
  };
  const select = (n: number) => {
    cur = n;
    for (const r of rows) {
      r.el.classList.toggle('on', r.n === n);
      r.el.setAttribute('aria-pressed', String(r.n === n));
    }
    show(n);
  };
  const label = (p: Pending) => (p.n < 0 ? 'Kept as is' : `Picked ${LETTER(p.n)}`);
  // The pick, waiting: its row ticked, the others still, "Picked B · undo" under them.
  const wait = (p: Pending) => {
    for (const r of rows) {
      r.el.setAttribute('aria-disabled', 'true'); // not `disabled`: a focused row keeps its focus
      r.el.classList.remove('on');
      r.el.classList.toggle('picked', r.n === p.n);
    }
    const left = Math.max(0, p.until - Date.now());
    const undo = W.el('button', { class: 'btn undo', type: 'button', 'aria-label': 'undo: take this pick back' });
    const w = W.el('span', { class: 'w', style: `--undo-ms:${left}ms;--undo-from:${Math.min(1, left / PICK_MS)}` });
    w.append(W.el('span', {}, 'undo'));
    undo.append(w);
    undo.addEventListener('click', () => {
      if (pending !== p || p.sending) return;
      clearTimeout(p.timer);
      pending = null;
      p.ui?.('off');
    });
    note.classList.remove('idle');
    note.replaceChildren(`${label(p)} · `, undo);
  };
  const ui = (p: Pending) => (state: 'wait' | 'sending' | 'off', msg?: string) => {
    if (state === 'wait') return wait(p);
    if (state === 'sending') return wait(p), note.replaceChildren(label(p)); // the word stays, no undo
    for (const r of rows) {
      r.el.removeAttribute('aria-disabled');
      r.el.classList.remove('picked');
    }
    select(p.before);
    say(msg);
  };
  const answer = (n: number) => {
    if (pending?.ask === ask.id) return; // waiting: undo first
    const prev = cur; // what undo goes back to
    const name = String(W.store.get('lab-name') || '').trim();
    select(n);
    if (!name) {
      say('your name first');
      return void host.querySelector('textarea')?.focus({ preventScroll: true });
    }
    failedPick.delete(ask.id);
    if (pending) commitPick(pending); // another question's pick still waiting: it goes now
    const text = n < 0 ? 'Keep as is: none of these.' : `Picked ${LETTER(n)}: ${ask.choices[n]}`;
    const p: Pending = { ask: ask.id, thread: c.id, chat, n, before: prev, name, text, until: Date.now() + PICK_MS, timer: 0 as unknown as ReturnType<typeof setTimeout>, sending: false };
    p.timer = setTimeout(() => commitPick(p), PICK_MS);
    p.ui = ui(p);
    pending = p;
    wait(p);
    (note.querySelector('.undo') as HTMLElement | null)?.focus({ preventScroll: true }); // the tapped row is greyed: focus goes to undo
  };
  for (const r of rows) {
    // A touch that moved more than 8 px was a scroll: it answers nothing.
    let down: { x: number; y: number } | null = null;
    r.el.addEventListener('pointerdown', (e) => (down = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }));
    r.el.addEventListener('pointercancel', () => (down = null));
    r.el.addEventListener('click', (e) => {
      const moved = Boolean(down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8);
      down = null;
      if (!moved) answer(r.n);
    });
    if (!W.coarse) r.el.addEventListener('pointerenter', () => show(r.n));
  }
  if (!W.coarse) list.addEventListener('pointerleave', () => show(cur));
  (box as unknown as { pick: (n: number) => boolean }).pick = (n) => {
    if (n < 0 || n >= ask.choices.length) return false;
    if (pending?.ask !== ask.id) answer(n); // a pick already waiting: the key is still taken (it is not "comment / pointer"), undo first
    return true;
  };
  (box as unknown as { ticked: () => boolean }).ticked = () => {
    if (cur < 0 || cur >= ask.choices.length) return false;
    if (pending?.ask !== ask.id) answer(cur); // a pick already waiting: Enter is still taken, undo first
    return true;
  };
  (box as unknown as { move: (d: 1 | -1) => boolean }).move = (d) => {
    if (pending?.ask === ask.id) return true; // a pick waiting: the arrows are still taken (no scroll), undo first
    const at = rows.findIndex((r) => r.n === cur);
    const next = at < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + d));
    if (next !== at) select(rows[next].n);
    return true;
  };
  select(cur);
  if (lost !== undefined) say('failed, tap again');
  // Drawn again while its pick waits (a live update): the rows show the wait, the countdown where it was.
  if (pending?.ask === ask.id) {
    pending.ui = ui(pending);
    select(pending.n);
    pending.ui(pending.sending ? 'sending' : 'wait');
  }
  // After a hot save the words may be gone (or be back): the card is drawn again so its rows and place match them.
  if (!chat) onReshow(() => box.isConnected && (triesInPlace(c) === inPlace ? show(shown) : W.render()));
  return box;
}
