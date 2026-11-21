// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import * as move from './sheetmove.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindSheets(w: unknown) {
  W = w;
}

// A sheet follows the finger like a native one: from the handle and the header, from any part that doesn't scroll,
// and from a list or the messages when they're already at the top and the finger pulls down (any other drag there
// scrolls them natively; overscroll-behavior keeps the page behind still). Up past where it sits it stretches a
// little and springs back. Let go fast, or past a third of its height, and it carries on down and away at the
// finger's speed; else it springs back, the dimmed page fading with it. Text boxes stay the browser's.
const grabArea = (t) => Boolean(t.closest?.('.handle, .tabs'));

const scrollerIn = (e, node) =>
  e.composedPath().find((n) => n instanceof HTMLElement && node.contains(n) && (n.localName === 'textarea' || /auto|scroll/.test(getComputedStyle(n).overflowY)));

// How long a sheet's transition takes to be over, with a frame or two of slack, before its inline style is cleared.
const settled = () => W.ms('slow') + W.ms('quick') / 3;

// The motion's rules (sheetmove.ts, the board drawer's too), with this widget's token lengths.
const glide = (dist: number, speed: number, cap = 1e9): [number, string] => move.glide(dist, speed, W.ms('slow'), W.ms('quick'), cap, 'var(--_ease-settle)');
const carry = (dist: number, speed: number, cap: number) => move.carry(dist, speed, cap, W.ms('quick'));
let leaveBar = ''; // how the bar rises as the last leave() goes (slideAway)

const OFF = 96; // how far past the screen's bottom a leaving sheet's top edge goes: the shadow above that edge (28 px) and Safari's see-through bar can't show it
// The screen's bottom for a leaving sheet: Safari paints the page under its see-through bar below innerHeight (a sheet cut off
// there, 21 Nov simulator), so it goes to the whole screen's.
const floor = () => Math.max(innerHeight, screen.height || 0);
const HELD = ['top', 'bottom', 'height', 'max-height', 'transform', 'transition', 'animation', 'pointer-events', 'opacity', 'transform-origin', 'box-shadow'];

// Where the last touch went down: the sheet it opens grows out of there, as iOS 27's do from the button you tapped.
let tap = { x: 0, y: 0, at: -1e9 };
export function fromTap(node: HTMLElement, at?: { x: number; y: number } | null) {
  const p = at || (performance.now() - tap.at < 1500 ? tap : null);
  if (!p) return node.style.removeProperty('--lab-from'); // no tap (a key, a link): from the bottom middle
  node.style.setProperty('--lab-from', `${Math.round(p.x - node.offsetLeft)}px ${Math.round(p.y - node.offsetTop)}px`);
}

// Phones, sending with the keyboard up: the box being sent is about to be drawn away, which would drop the keyboard at
// once, and Safari moves its fixed things ~300 px as the keyboard lets go: the card vanished mid-screen instead of
// leaving (iOS 27 simulator, 16 Nov). A hidden field holds the keyboard (and so the screen) still until the card has gone.
let keeper: HTMLInputElement | null = null;
export function holdKeyboard() {
  if (!W.coarse || !W.host.hasAttribute('data-kb') || W.still.matches) return;
  // The comment box's settings, so the keyboard stays exactly as it was (no suggestion row appearing: a relayout).
  keeper ??= W.el('input', { 'aria-hidden': 'true', tabindex: '-1', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', writingsuggestions: 'false',
    style: 'position:fixed;top:0;left:-200px;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none' }) as HTMLInputElement;
  if (!keeper.isConnected) W.root.append(keeper);
  keeper.focus({ preventScroll: true });
}

// Phones: the open sheet leaves, and the keyboard (if it's up) goes at the same moment, as a native sheet's does. It
// used to slide behind the keyboard and vanish there, and the keyboard stayed alone for 0.6 s; after sending, the sheet
// rode the keyboard halfway down and vanished mid-screen (iOS 27 simulator, 16 Nov). Its box is held where it is (the
// keyboard going would otherwise resize and move it on the way).
// Closed by a tap, a swipe or a send it slides down and away and never shrinks (a tap used to shrink it to 30 % over its
// pill and fade, like iOS 27's share sheet; its shadow smeared there and the pill came up under it, Leo 21 Nov). After a
// swipe (ms: the longest it may take) it goes at the finger's speed, steady, never fading (easing out, its last part crept
// under Safari's see-through bottom bar, Leo 16 Nov); a tap takes the base duration. After a send the new pin pops in with
// one green ring as it goes (.pin.arrive). Lab option 5, Leo 17 Nov.
// Returns how long it takes; let go of it with letGo().
// After a swipe (ms: the longest it may take) it goes on at `speed` px/ms, the finger's (see carry).
export function leave(node: HTMLElement, ms = 0, sent = false, speed = 0) {
  let dur = ms || W.ms('base');
  let ease = 'var(--_ease-in)';
  let moved = 0; // a finger may have it part way down already
  try { moved = new DOMMatrixReadOnly(getComputedStyle(node).transform).m42 || 0; } catch {}
  const r = node.getBoundingClientRect();
  const top = r.top - moved;
  const way = Math.max(r.height, floor() - top) + OFF - moved; // to under the screen's bottom, and past its shadow and Safari's see-through bar
  if (ms) [dur, ease] = carry(way, speed, ms);
  // The bar comes up with the sheet: after a swipe at the same pace (the sheet's way left and its speed, in whole ways
  // and ways per ms, are the bar's too), settling where the sheet is gone; after a tap softly, from rest. The standard
  // curve was steep at the start (half the bar's way in the first frame).
  const [bms, bease] = glide(ms ? way : 1, ms ? speed : 0, dur);
  leaveBar = `${bms}ms ${bease}`;
  const fade = getComputedStyle(W.scrim).opacity;
  for (const [k, v] of [['top', `${top}px`], ['bottom', 'auto'], ['height', `${r.height}px`], ['max-height', 'none'], ['animation', 'none'],
    ['transition', 'none'], ['transform', `translateY(${moved}px)`], ['pointer-events', 'none']]) node.style.setProperty(k, v, 'important');
  W.host.setAttribute('data-leaving', '');
  W.scrim.style.transition = 'none';
  W.scrim.style.opacity = fade;
  // The keyboard goes now, with the sheet; after a send, once the card has gone (see holdKeyboard).
  // …and the page starts back to where it was with it (backFromReveal).
  const letKeysGo = () => ((W.root.activeElement as HTMLElement | null)?.blur(), node.classList.contains('float') && backFromReveal());
  if (sent) setTimeout(letKeysGo, dur);
  else letKeysGo();
  // A comment dropped unsent: its pin goes now, not when the sheet has finished sliding away (it stood there alone for
  // 0.3 s; Leo, 21 Nov: "if not placed comment it dissappears with delay").
  if (!sent && node.classList.contains('float')) (W.root.querySelector('.pin.draft') as HTMLElement | null)?.style.setProperty('opacity', '0');
  // Back into its pin where the pin is now (the page scrolled it into view after the tap); the list and the chat back
  // to where they were tapped open.
  const pin = sent ? null : W.root.querySelector(node.classList.contains('card') ? '.pin.open' : node.classList.contains('float') ? '.pin.draft' : 'none');
  const p = pin?.getBoundingClientRect();
  if (p) fromTap(node, { x: p.left + p.width / 2, y: p.top + p.height / 2 });
  void node.offsetHeight;
  const down = () => {
    node.style.setProperty('transition', `transform ${dur}ms ${ease}, box-shadow ${ms ? 0 : W.ms('quick')}ms var(--_ease-out)`, 'important');
    node.style.setProperty('transform', `translateY(${Math.max(r.height, floor() - top) + OFF}px)`, 'important');
    // The soft shadow fades off on the way, instead of lingering above the top edge and popping off with the sheet (Leo, 21 Nov:
    // "chat top shadow i dont like when disappearing"); the hairline stays.
    node.style.setProperty('box-shadow', '0 0 0 .5px color-mix(in srgb, var(--_fg) 10%, transparent), 0 0 8px transparent', 'important');
  };
  // After a send, from the next frame: drawing the sent pin took ~100 ms, which ate the start of the move (iOS 27 simulator).
  if (sent) requestAnimationFrame(() => requestAnimationFrame(down));
  else down(); // a tap too goes down and away, as a swipe does: it used to shrink to 30 % over the pill, its shadow smeared there (Leo, 21 Nov: "still some shadow when drawer hiding")
  W.scrim.style.transition = `opacity ${dur}ms ${ease}`;
  W.scrim.style.opacity = '0';
  return sent ? dur + W.ms('quick') / 3 : dur; // after a send it starts a frame or two late (see down)
}
// Runs `fn` once the sheet's slide has ended, not when its time is up: a render in the same moment can start the slide
// late, and a sheet taken away on a timer popped off half way down (iOS 27 simulator, 21 Nov: tap-close at 565 px).
// The timer stays as the fallback (nothing slid, or the event never came).
export function afterLeave(node: HTMLElement, dur: number, fn: () => void) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    clearTimeout(t);
    node.removeEventListener('transitionend', on);
    fn();
  };
  const on = (e: TransitionEvent) => e.target === node && e.propertyName === 'transform' && go();
  const t = setTimeout(go, dur + 400);
  node.addEventListener('transitionend', on);
}
export function letGo(node: HTMLElement) {
  for (const k of HELD) node.style.removeProperty(k);
  W.host.removeAttribute('data-leaving');
  W.scrim.style.opacity = W.scrim.style.transition = '';
}

// Phones: a sheet slides down and away (see leave), then it closes.
export function slideAway(node, close, ms = 0, speed = 0) {
  if (!W.coarse || !node) return close();
  if (W.still.matches) { // reduced motion: no slide, the sheet fades out (styles.css, --_t-calm)
    const d = W.ms('calm');
    node.style.setProperty('transition', `opacity ${d}ms var(--_ease-in)`, 'important');
    node.style.setProperty('opacity', '0', 'important');
    node.style.setProperty('pointer-events', 'none', 'important');
    return void setTimeout(() => (close(), HELD.forEach((k) => node.style.removeProperty(k))), d);
  }
  const dur = leave(node, ms, false, speed);
  W.bar.style.transition = `transform ${leaveBar}, opacity ${dur}ms var(--_ease-out)`;
  W.host.style.setProperty('--lab-p', '1'); // the bar comes up as the sheet goes down
  afterLeave(node, dur, () => {
    close();
    letGo(node);
    W.bar.style.transition = '';
    W.host.style.removeProperty('--lab-p');
  });
}

// A new comment's pin stays in sight: a pin the sheet would cover once the keyboard is up comes up into the middle of
// what's free above it (a pin low on the page went under the sheet: you couldn't see what you were commenting on, 16 Nov).
// One move, in the frames the keyboard and the sheet rise in (Leo, 21 Nov, on his phone: "pin placement opening keyboard
// and shifting everything not very smooth": the page glided first, under the finger, and the keyboard came after or in
// the middle of it). The page has to be scrolled before the cursor goes in: scrolled after, iOS pans the screen instead of
// the page and the sheet is thrown about (its top went 331, 182, 234, 197, 267: iOS 27 simulator); scrolled in the lift
// itself, just before the focus, iOS never took the scroll and the keyboard came up over the sheet. So, as the pin appears
// under the finger (the hold): the page is put at its new place in one step and drawn where it was (shifted back by as
// much, --lab-shift on the page's own blocks and on the pins), and when the keyboard starts up that shift runs out, as
// the sheet's own rise does. Nothing is scrolled while the keyboard is there, and nothing is seen to move before it.
let gen = 0; // each shift is the last one's end
const shifted = (px: number, ms: number) => {
  const de = document.documentElement;
  gen++;
  de.style.setProperty('--lab-shift-t', `${ms}ms`);
  de.style.setProperty('--lab-shift-e', getComputedStyle(W.host).getPropertyValue('--_ease-settle').trim() || 'ease');
  de.style.setProperty('--lab-shift', `${px}px`);
  de.classList.add('lab-moved'); // (not lab-shift: that is the Shift key's)
  W.host.setAttribute('data-shift', '');
};
const unshifted = () => {
  const de = document.documentElement;
  gen++;
  de.classList.remove('lab-moved');
  for (const k of ['--lab-shift', '--lab-shift-t', '--lab-shift-e']) de.style.removeProperty(k);
  W.host.removeAttribute('data-shift');
  for (const n of document.querySelectorAll('[data-lab-still]')) n.removeAttribute('data-lab-still');
};
const keysUp = () => Boolean(W.vv && innerHeight - W.vv.height > 60);
let landing: (() => void) | null = null; // the page's way back, still to be finished (backFromReveal)
let letGoShift: (() => void) | null = null; // lets the shift run out (the keyboard is coming, or did not come)
/** The finger has lifted and the cursor is in the box: should no keyboard come, the page takes its new place anyway. */
export const liftedDraft = () => letGoShift && setTimeout(letGoShift, 450);
/** glide: the box takes the cursor by itself (no hold, no lift to wait for): the page glides there, as it always did. */
export function revealDraft(glide = false) {
  const float: HTMLElement | null = W.root.querySelector('.float:not(.out)');
  const pin: HTMLElement | null = W.root.querySelector('.pin.draft');
  if (!W.coarse || !float || !pin || !W.vv || W.S.revealed) return;
  if (pin.style.position === 'fixed') return; // a board's pin is held to the screen: scrolling the page under the board moves nothing but the page (the board's camera brings the pin up, overlay.ts)
  landing?.();
  const up = innerHeight - W.vv.height;
  const keys = up > 60 ? up : W.S.kbSeen || Math.round(innerHeight * 0.42); // the keyboard it will have
  const sheetTop = innerHeight - keys - float.offsetHeight - 8; // where it comes to rest, not where it is growing now
  const p = pin.getBoundingClientRect();
  const free = 56; // below the status bar
  if (!(p.top < free || p.bottom > sheetTop - 16)) return;
  const from = scrollY;
  const to = Math.max(0, from + (p.top + p.bottom) / 2 - (free + sheetTop) / 2);
  W.S.revealed = { from, to }; // where you were: the page goes back there once the comment is sent or dropped (backFromReveal)
  if (glide) return scrollPageTo(to);
  roomFor(to);
  scrollTo({ top: to, behavior: 'instant' });
  const by = scrollY - from;
  if (W.still.matches || Math.abs(by) < 2) return;
  // What the page itself holds to the screen (a bar of its own, at the top of body) is not shifted: it did not scroll.
  for (const n of Array.from(document.body.children)) if (n !== W.host && /fixed|sticky/.test(getComputedStyle(n).position)) n.setAttribute('data-lab-still', '');
  shifted(by, 0);
  void document.body.offsetHeight; // drawn where it was, before anything is let go
  const mine = gen;
  const go = () => {
    if (letGoShift !== go) return;
    letGoShift = null;
    W.vv.removeEventListener('resize', keys2);
    if (gen !== mine) return; // sent or dropped already
    shifted(0, W.ms('slow'));
    const end = gen;
    setTimeout(() => gen === end && unshifted(), W.ms('slow') + 60);
  };
  const keys2 = () => keysUp() && go();
  letGoShift = go;
  W.vv.addEventListener('resize', keys2);
  if (keysUp()) go(); // it is up already (a new comment while another field had it)
}

// A new comment's sheet is going (sent, dropped, swiped away): the page goes back to where it was before revealDraft moved
// it, as the keyboard goes down, the same way round: its blocks slide back first (the scroll stays, nothing is scrolled
// while a keyboard is there), and once the keyboard has gone the page is put there in one step, drawn as it already is.
export function backFromReveal() {
  const r = W.S.revealed;
  W.S.revealed = null;
  // 320: the keyboard's pan moves the page too (about 300 px, 21 Nov simulator: it was left 382 down from 425); a sheet holds the page still
  // otherwise, so what moved it is that pan, not a hand.
  if (!(r && W.coarse && Math.abs(scrollY - r.to) < 320)) return;
  const by = scrollY - r.from;
  if (W.still.matches || Math.abs(by) < 2) return scrollPageTo(r.from);
  shifted(by, W.ms('slow'));
  const mine = gen;
  const at = performance.now() + W.ms('slow') + 30;
  let landed = false;
  const land = (now = false) => {
    if (landed || (!now && (keysUp() || performance.now() < at))) return;
    landed = true;
    landing = null;
    clearTimeout(t1);
    clearTimeout(t2);
    W.vv?.removeEventListener('resize', check);
    scrollTo({ top: r.from, behavior: 'instant' });
    if (gen === mine) unshifted();
  };
  const check = () => land();
  landing = () => land(true);
  const t1 = setTimeout(check, W.ms('slow') + 40);
  const t2 = setTimeout(() => land(true), 1500);
  W.vv?.addEventListener('resize', check);
}

// Scrolls the page to top (smoothly, unless motion is reduced). A spot near the page's end can't scroll up into the
// part a phone's sheet leaves free above it: the page gets room below its end while the sheet is open (--lab-room).
export function scrollPageTo(top: number) {
  if (W.coarse) roomFor(top);
  const to = Math.max(0, top);
  cancelAnimationFrame(glideId);
  if (W.still.matches || Math.abs(to - scrollY) < 2) return scrollTo({ top: to, behavior: 'auto' });
  // Its own glide, ease in and out and longer for a longer way: the browser's smooth scroll took 0.28 s for 500 px, which
  // reads as a jump (Leo, 21 Nov: "scrolling position to pin can be smoother"). A touch or a wheel hands the page back.
  const from = scrollY;
  // Up to 0.9 s: at 0.56 s a pin 2700 px away went by at 237 px a frame, which is a jump too (iOS 27 simulator, 21 Nov).
  const ms = Math.min(900, 260 + Math.abs(to - from) * 0.4);
  const t0 = performance.now();
  const stop = () => (cancelAnimationFrame(glideId), removeEventListener('touchstart', stop), removeEventListener('wheel', stop));
  addEventListener('touchstart', stop, { passive: true });
  addEventListener('wheel', stop, { passive: true });
  const step = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    scrollTo({ top: from + (to - from) * (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2), behavior: 'instant' });
    if (k < 1) glideId = requestAnimationFrame(step);
    else stop();
  };
  glideId = requestAnimationFrame(step);
}
let glideId = 0;
// Room below the page's end, so that it can scroll to `top` on a phone. The page's own height is html's box when the page is
// shorter than the screen: scrollHeight is never less than the screen's height, so a short page read as tall as the screen,
// got 283 px of room where it needed 817, and could not scroll at all: the pin stayed under the sheet until the keyboard
// came, and then the screen jumped 283 px in one frame and the sheet went off the top and came back (iOS 27 simulator,
// 21 Nov; Leo: "pin placement opening keyboard and shifting everything not very smooth").
export function roomFor(top: number, lessOnly = false) {
  const de = document.documentElement;
  const had = parseFloat(de.style.getPropertyValue('--lab-room')) || 0;
  const own = (de.scrollHeight > innerHeight + 1 ? de.scrollHeight : de.offsetHeight) - had;
  const room = top <= 0 ? 0 : Math.max(0, Math.ceil(top + innerHeight - own));
  if (lessOnly && room >= had) return;
  de.style.setProperty('--lab-room', `${room}px`);
  de.classList.toggle('lab-room', room > 0);
}

 // CloseWatcher (not in TypeScript's DOM types yet)
export function backCloses() {
  const open = matchMedia('(pointer: coarse)').matches && W.host.hasAttribute('data-sheet');
  if (!open && W.S.backWatcher) {
    const w = W.S.backWatcher;
    W.S.backWatcher = null;
    w.destroy();
  }
  if (open && !W.S.backWatcher && 'CloseWatcher' in window) {
    try {
      const w = new (window as any).CloseWatcher();
      w.onclose = () => {
        if (W.S.backWatcher === w) W.S.backWatcher = null;
        W.closeOrNudge();
        backCloses(); // still open (it nudged): back closes it next time
      };
      W.S.backWatcher = w;
    } catch {}
  }
}

// The dimmed page under a sheet pulls the sheet too. The scrim lives as long as the page, a sheet is drawn again on every
// render: so the scrim's four touch listeners are added once, and hand each touch to the handlers of the sheet that is
// open when it begins (swipeDown fills `swipes`; a closed sheet's entry goes with its node).
type Swipe = { start: (e: TouchEvent) => void; move: (e: TouchEvent) => void; end: (e: TouchEvent) => void };
const swipes = new WeakMap<Element, Swipe>();
let pulling: Swipe | null = null; // the one the touch on the scrim began with, until it lifts
let scrimBound = false;
const bindScrim = () => {
  scrimBound = true;
  W.scrim.addEventListener('touchstart', (e) => (pulling = swipes.get(W.openSheet()) || null)?.start(e), { passive: true });
  W.scrim.addEventListener('touchmove', (e) => pulling?.move(e), { passive: false });
  for (const k of ['touchend', 'touchcancel'] as const)
    W.scrim.addEventListener(k, (e) => {
      pulling?.end(e);
      pulling = null;
    });
};

export function swipeDown(node, close, grows = false) {
  if (!W.coarse) return;
  if (!scrimBound) bindScrim();
  // A sheet that grows (the chat) has two heights, as iOS and Android sheets do: pull it up (or flick) to fill the
  // screen, pull it down from there to go back; from the lower one a pull down closes it as before.
  let raw = 0;
  // Right after its content scrolled (a fling up to the top), a pull down scrolls on instead of taking the sheet,
  // and for a moment after letting go of a drag a tap does nothing, so a sheet that springs back under the finger
  // doesn't press what lands there or pop the keyboard (Vaul's 100 ms and 200 ms).
  let scrolledAt = -1e9;
  let releasedAt = -1e9;
  node.addEventListener('scroll', () => (scrolledAt = performance.now()), { capture: true, passive: true });
  node.addEventListener('click', (e) => {
    if (performance.now() - releasedAt < 200) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  node.addEventListener('focusin', (e) => {
    if (performance.now() - releasedAt < 200 && e.target.localName === 'textarea') e.target.blur();
  });
  let x0 = 0;
  let y0 = 0;
  let dy = 0;
  let samples = []; // where the finger and the sheet were on the last moves: { t, y, d }
  let last = null;
  let mode = null; // 'drag' the sheet, 'hold' (sideways on a part that doesn't scroll), 'off' (the browser's)
  let box = null; // the scrolling part the touch began in
  let fromScrim = false; // the touch began on the dimmed page under the sheet: that pulls the sheet too
  const onStart = (e) => {
    fromScrim = e.currentTarget === W.scrim;
    const t = e.touches[0];
    x0 = t.clientX;
    y0 = t.clientY;
    dy = raw = 0;
    samples = [{ t: e.timeStamp, y: y0, d: 0 }];
    last = { y: y0, at: e.timeStamp };
    box = fromScrim ? null : scrollerIn(e, node);
    mode = e.touches.length > 1 || box?.localName === 'textarea' ? 'off' : null;
  };
  node.addEventListener('touchstart', onStart, { passive: true });
  // A move up or down that nothing in the sheet scrolls (short messages, a box already at its end) is the sheet's, not
  // the page's: Safari with the keyboard up pans the page under a sheet whatever its overflow says, and the pin it
  // belongs to left the screen (iOS 27 simulator, 20 Nov: 317 px after one swipe on a thread).
  const keep = (e, t) => {
    const up = t.clientY < last.y;
    const scrolls = e.composedPath().some((n) => n instanceof HTMLElement && node.contains(n) && /auto|scroll/.test(getComputedStyle(n).overflowY) && (up ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0));
    if (e.touches.length === 1 && e.cancelable && Math.abs(t.clientY - y0) > Math.abs(t.clientX - x0) && !scrolls) e.preventDefault();
  };
  const onMove = (e) => {
    if (fromScrim !== (e.currentTarget === W.scrim)) return;
    const t = e.touches[0];
    // Scrolling the messages up to their top and pulling on in the same move hands the sheet to the finger, as iOS
    // sheets do (it used to take a second swipe). Only while the browser still lets the move be taken over.
    if (mode === 'off' && box && box.localName !== 'textarea' && e.touches.length === 1 && e.cancelable && box.scrollTop <= 0 && t.clientY > last.y + 1) {
      mode = 'drag';
      y0 = t.clientY;
      samples = [{ t: e.timeStamp, y: y0, d: 0 }];
      last = { y: t.clientY, at: e.timeStamp };
    }
    if (mode === 'off') return void (keep(e, t), (last = { y: t.clientY, at: e.timeStamp }));
    if (mode === 'hold') return e.preventDefault();
    if (!mode) {
      const down = t.clientY - y0;
      const across = t.clientX - x0;
      if (!down && !across) return; // iOS sends moves for pressure changes too
      const sideways = Math.abs(across) > Math.abs(down);
      // The sheet's top quarter pulls it down too, messages and all, as does the dimmed page above it (Leo, 15 Nov);
      // below that a pull scrolls the messages until they reach their top.
      const nearTop = !sideways && down > 0 && y0 - node.getBoundingClientRect().top < node.offsetHeight * 0.25;
      if (fromScrim) mode = sideways ? 'hold' : 'drag';
      else if (grabArea(e.target)) mode = sideways && e.target.closest('.tabs') ? 'off' : 'drag'; // the list's tabs scroll sideways
      else if (nearTop && box?.localName !== 'textarea') mode = 'drag';
      else if (box) mode = !sideways && down > 0 && box.scrollTop <= 0 && performance.now() - scrolledAt > 100 ? 'drag' : 'off';
      else mode = sideways ? 'hold' : 'drag';
      if (mode === 'off') return keep(e, t);
      if (mode === 'hold') return e.preventDefault();
    }
    e.preventDefault();
    raw = (t.clientY - y0) * (W.vv?.scale || 1); // pinch-zoomed, the sheet is drawn 1/scale as big: it still keeps up with the finger
    // Up past where it sits: iOS's rubber band (UIScrollView's: offset = (1 − 1 / (pull × 0.55 / size + 1)) × size),
    // so it follows the finger, more and more slowly (it barely moved before: 100 px of pull gave 20 px, now ~50).
    const size = node.offsetHeight || 400;
    dy = raw >= 0 ? raw : -(1 - 1 / ((-raw * 0.55) / size + 1)) * size;
    samples.push({ t: e.timeStamp, y: t.clientY, d: dy });
    while (samples.length > 2 && e.timeStamp - samples[0].t > 200) samples.shift();
    last = { y: t.clientY, at: e.timeStamp };
    node.style.transition = W.scrim.style.transition = 'none';
    node.style.transform = `translateY(${dy}px)`;
    // How far it is on its way out (to the screen's bottom): the page undims and the bar comes up by that much, so
    // the dim is gone when the sheet is, not after the first 320 px (it was gone with two thirds of a thread still up).
    const way = Math.min(1, Math.max(0, dy / Math.max(100, innerHeight - (node.getBoundingClientRect().top - dy))));
    W.scrim.style.opacity = String(1 - way);
    W.bar.style.transition = 'none';
    W.host.style.setProperty('--lab-p', String(way));
  };
  node.addEventListener('touchmove', onMove, { passive: false });
  const end = (e) => {
    if (fromScrim !== (e.currentTarget === W.scrim)) return;
    const was = mode;
    mode = null;
    if (was === 'drag') W.S.sheetDraggedAt = performance.now();
    if (was !== 'drag') return;
    releasedAt = performance.now();
    // How fast the finger (v) and the sheet (vs, which a rubber band slows) were going over the last ~100 ms, px/ms, + down;
    // 0 if it held still before letting go.
    const lastMove = samples[samples.length - 1];
    const from = samples.find((q) => lastMove.t - q.t <= 100);
    const span = lastMove.t - from.t;
    const quick = e.timeStamp - lastMove.t > 80 || span < 8 ? 0 : 1;
    const v = quick * ((lastMove.y - from.y) / (span || 1));
    const vs = quick * ((lastMove.d - from.d) / (span || 1));
    const h = node.offsetHeight || innerHeight;
    // Springs to where it sits, or (full: the sheet's other height, played the same way) to the other one, starting at the
    // speed its top had toward it (`toward`, px/ms).
    const settle = (full?: boolean, toward = 0) => {
      let way = Math.abs(dy);
      if (full !== undefined) { // how far its top has to go: the change measured with nothing animating, then undone
        const top = node.getBoundingClientRect().top;
        node.style.transition = 'none';
        node.classList.toggle('full', full);
        way = Math.abs(node.getBoundingClientRect().top - dy - top);
        node.classList.toggle('full', !full);
        void node.offsetHeight;
      }
      const [ms, curve] = glide(way, Math.max(0, toward));
      node.style.transition = `transform ${ms}ms ${curve}, height ${ms}ms ${curve}`;
      if (full !== undefined) node.classList.toggle('full', full);
      W.scrim.style.transition = `opacity ${ms}ms var(--_ease-out)`;
      node.style.transform = W.scrim.style.opacity = '';
      W.bar.style.transition = '';
      W.host.style.removeProperty('--lab-p'); // springing back: the bar goes back down with it
      setTimeout(() => (node.style.transition = W.scrim.style.transition = ''), settled());
    };
    if (grows && !node.classList.contains('full') && (raw < -40 || v < -0.4)) return node.classList.contains('card') && (W.S.cardFull = true), settle(true, -vs);
    if (grows && node.classList.contains('full') && v < 1.2 && (raw > 60 || v > 0.4)) return node.classList.contains('card') && (W.S.cardFull = false), settle(false, vs);
    // Where it would come to rest if let go now, past half its height: it goes (move.goes, sheetmove.ts).
    // Off the screen's bottom at the sheet's own speed, in 300 ms at most (see leave); else back to where it sits (a
    // rubber band's stretch goes back the other way).
    if (move.goes(dy, v, h)) return slideAway(node, close, W.ms('slow'), Math.max(0, vs));
    settle(undefined, dy > 0 ? -vs : vs);
  };
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  swipes.set(node, { start: onStart, move: onMove, end });
}

export function startSheets() {
  if (W.coarse && W.vv) {
    const probe = W.el('i', { style: 'position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none' });
    // Safari 26 with the keyboard up shows the page in a strip above the keyboard, around its address pill, where it
    // draws nothing fixed: the sheet and its dimming stop above it. A block in the page itself (not fixed) covers it.
    const strip = W.el('i', { style: 'position:absolute;left:0;width:100vw;display:none;background:var(--_bg);z-index:3;pointer-events:none' });
    W.root.append(probe, strip);
    let fitted = '';
    const fit: (() => void) & { sheet?: HTMLElement | null; top?: number; done?: any; vh?: number; kbUp?: boolean } = () => {
      const zoomed = Math.abs(W.vv.scale - 1) > 0.01; // pinch-zoomed: that isn't a keyboard
      const r = probe.getBoundingClientRect();
      // iOS 26.0 can leave offsetTop at 24 px after the keyboard has gone. With nothing to type in focused there is no
      // keyboard and nothing panned (unzoomed), so an offset then is stale and counts as 0.
      const field = (W.root.activeElement || document.activeElement as HTMLElement | null);
      const typing = /^(textarea|input|select)$/.test(field?.localName || '') || Boolean(field?.isContentEditable);
      const top = zoomed || !typing ? 0 : W.vv.offsetTop;
      // The bottom of what the screen shows, where the probe's box is measured. WebKit (Safari, Chrome on iPhone)
      // measures boxes from the screen's top, so a page panned up for the keyboard puts the probe's top at -offsetTop;
      // Blink measures from the page's top (probe at 0). Adding the offset alone counted a pan twice on iPhones: the
      // keyboard came out 0 and a new comment sat behind the keyboard's bar (Leo, 16 Nov, "sometimes": only when Safari
      // pans instead of scrolling).
      const seen = (top ? top + r.top : 0) + W.vv.height;
      const kb = zoomed ? 0 : Math.max(0, Math.round(r.bottom - seen));
      const gap = zoomed ? 0 : Math.max(0, Math.round(seen - r.bottom));
      const vh = zoomed ? 0 : Math.round(W.vv.height);
      // Safari 26 doesn't count as "keyboard up" here (its fixed layer ends above the keyboard by itself): the sheet stays
      // a half sheet resting on that layer, which sits right, and the strip below it is covered.
      const sheet = W.host.hasAttribute('data-sheet');
      const key = `${kb} ${vh} ${gap} ${sheet} ${scrollY} ${Math.round(top)}`;
      if (key === fitted) {
        // Nothing to lay out again, but where the open sheet sits now is where the next keyboard slide starts from (it
        // was last read when the chat opened, hidden, at 0: the slide jumped to the screen's top first).
        const open = sheet ? W.openSheet() : null;
        if (open?.offsetHeight && !open.style.transform) Object.assign(fit, { sheet: open, top: open.offsetTop });
        return;
      }
      fitted = key;
      W.host.style.setProperty('--lab-kb', `${kb}px`);
      W.host.style.setProperty('--lab-top', `${Math.round(top)}px`);
      if (vh) W.host.style.setProperty('--lab-vh', `${vh}px`);
      else W.host.style.removeProperty('--lab-vh');
      W.host.toggleAttribute('data-kb', kb > 60);
      strip.style.display = sheet && gap ? 'block' : 'none';
      strip.style.top = `${Math.round(scrollY + r.bottom)}px`;
      strip.style.height = `${gap}px`;
      // The keyboard came or went: the open sheet moves from where it was to its new place instead of jumping there
      // (filling the screen above the keyboard, or resting on the screen's bottom again). Not while a finger drags it.
      // Its place as the browser reports it: on iOS 26 a fixed sheet's box is already where you see it (it rests on
      // the keyboard while Safari pans the page), so subtracting the pan put the slide's start 276 px off (15 Nov,
      // ?kbdebug on Leo's iPhone: the visible height jumps 686 → 410 → 686 in one step each way).
      const open = sheet ? W.openSheet() : null;
      // Its box, without any slide or opening growth in progress: the place it is going to, not passing through. (Read
      // mid-growth, a new comment's slide up with the keyboard started 266 px too high and it jumped, 16 Nov.)
      const keyboardMoved = Math.abs((fit.vh || vh) - vh) > 60 || fit.kbUp !== kb > 60;
      const sliding = open && open === fit.sheet && keyboardMoved && !open.style.transform && !W.still.matches;
      // Its own height change (the chat eases its height) jumps to the end first, so the place measured is where it
      // ends up: measured mid-change, the slide started 84 px too high (?kbdebug, 15 Nov).
      if (sliding) {
        open.style.transition = 'none';
        void open.offsetHeight;
      }
      const at = open ? open.offsetTop : null;
      if (sliding && Math.abs(fit.top - at) <= 8) open.style.transition = '';
      if (sliding && Math.abs(fit.top - at) > 8) {
        // Set at once, then eased away: an animate() call waits a frame to start, and that frame showed the sheet at
        // its new place before it jumped back to slide (the flicker a ?kbdebug run on Leo's iPhone showed, 15 Nov).
        open.style.transform = `translateY(${fit.top - at}px)`;
        void open.offsetHeight;
        open.style.transition = 'transform var(--_t-slow) var(--_ease-settle)';
        open.style.transform = '';
        clearTimeout(fit.done);
        fit.done = setTimeout(() => !open.style.transform && (open.style.transition = ''), settled());
      }
      Object.assign(fit, { vh, kbUp: kb > 60 }, open?.offsetHeight ? { sheet: open, top: at } : { sheet: null }); // a hidden one has no place yet
      if (kb > 60) W.S.kbSeen = kb; // the keyboard's height, for revealDraft before the next one comes up
    };
    W.S.refit = fit;
    // Pinch-zoomed: fixed things stay put on the page's unzoomed screen, so they came out magnified and partly off the
    // screen (Leo, 19 Nov: "on mobile zooms breaks our windows"). The bar, chat and list (.ui) and a thread's or new
    // comment's sheet are drawn at their usual size where the screen shows now (styles.css, data-zoom); pins stay on the page.
    const zoomFit = () => {
      const k = W.vv.scale;
      W.host.toggleAttribute('data-zoom', Math.abs(k - 1) > 0.01);
      const set = (n, v) => W.host.style.setProperty(`--lab-z${n}`, `${v}px`);
      set('x', W.vv.offsetLeft);
      set('y', W.vv.offsetTop);
      set('w', W.vv.width * k);
      set('h', W.vv.height * k);
      set('b', W.vv.offsetTop + W.vv.height - probe.getBoundingClientRect().height); // a sheet's bottom: the screen's
      W.host.style.setProperty('--lab-zk', String(1 / k));
    };
    W.vv.addEventListener('resize', zoomFit);
    W.vv.addEventListener('scroll', zoomFit);
    zoomFit();
    W.root.addEventListener('focusin', () => setTimeout(fit, 50));
    W.root.addEventListener('focusout', () => setTimeout(fit, 50));
    W.vv.addEventListener('resize', fit);
    W.vv.addEventListener('scroll', fit);
    addEventListener('pointerdown', (e) => (tap = { x: e.clientX, y: e.clientY, at: performance.now() }), { capture: true, passive: true });
    fit();
    // ?kbdebug on the page's address: every frame for 1.5 s after the keyboard is asked for or let go, where the open
    // sheet sits on the screen and what Safari reports, sent to the page's chat as "kb-log" 2 s after letting go. For
    // tuning the keyboard slide on a real phone (a simulator's keyboard doesn't move like one).
    // Only with ?kbdebug in the address; nothing runs otherwise.
    if (globalThis.__LAB_DEBUG__ !== false && /[?&]kbdebug\b/.test(location.search)) {
      let lines = [];
      let t0 = performance.now();
      let sendTimer: any = 0;
      const row = (what) => {
        const open = W.openSheet();
        const r = open?.getBoundingClientRect();
        lines.push(`${Math.round(performance.now() - t0)} ${what} h${Math.round(W.vv.height)} top${Math.round(W.vv.offsetTop)} in${innerHeight} kb${W.host.hasAttribute('data-kb') ? 1 : 0}` +
          (r ? ` sheet${Math.round(r.top)}/${Math.round(r.height)}${open.getAnimations().length ? ' anim' : ''}` : '') +
          // What is moving anywhere (the page, the pins, the dimming): for a flicker that isn't the keyboard.
          ` [${[...document.getAnimations(), ...W.root.getAnimations()].map((a) => (a as any).animationName || (a as any).transitionProperty || 'js').slice(0, 6).join(',')}]` +
          ` scrim${getComputedStyle(W.scrim).opacity.slice(0, 4)} scroll${Math.round(scrollY)}`);
      };
      const watch = (what) => {
        row(what);
        const end = performance.now() + 1500;
        let prev = '';
        const f = () => {
          const before = lines.length;
          row('f');
          const last = lines[lines.length - 1].replace(/^\d+ f /, '');
          if (last === prev) lines.length = before; // only frames where something moved
          prev = last;
          if (performance.now() < end) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      };
      W.root.addEventListener('focusin', () => ((t0 = performance.now()), watch('focus')));
      // Sent 2 s after the last thing that moved (a keyboard, Safari's address bar), so one run is one message.
      const sendSoon = () => {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(async () => {
          const text = lines.join('\n');
          lines = [];
          for (let i = 0; i < text.length; i += 1900) {
            await W.send({ name: 'kb-log', text: text.slice(i, i + 1900), anchor: { kind: 'page', selector: 'body', x: 0, y: 0, docX: 0, docY: 0, width: innerWidth } }).catch(() => {});
          }
        }, 2000);
      };
      W.root.addEventListener('focusout', () => {
        lines.push('--- let go');
        t0 = performance.now();
        watch('blur');
        sendSoon();
      });
      // The address bar growing or shrinking resizes the view too: each resize is followed for 1.5 s like a keyboard.
      W.vv.addEventListener('resize', () => {
        watch('resize');
        if (lines.length > 1) sendSoon();
      });
    }
  }
}
