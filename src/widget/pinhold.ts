// Part of the comment widget (src/comments.js bundles it).
//
// Pins the browser holds: a pin on an element that moves on its own (sticky, fixed, transformed or animated, see moves)
// is tied to that element with CSS anchor positioning, so the browser keeps it on its spot: on a sticky header, on a
// parent that slides, on a board's frame under its camera. No script runs for that. The script still
// finds the spot (anchoring.ts, position) when the pins are drawn or the page changes size, and writes it here as an
// offset from the element's corner: on words, in a gap between two blocks, on an area or a share of the element alike.
//
// Two things make it reach the page:
// - the pin is fixed: an absolute pin's containing block is the widget's own host, which no element of the page is in;
// - its rule is in the page's style sheet, by ::part: anchor names given in the page are not seen from the shadow root.
// A pin on still content is placed in the page by the script, as is a pin on an element the page anchors to itself (its anchor-name would win over ours) or one inside an open
// dialog, popover or full screen (the top layer is laid out after the pin, so it can't be its anchor). An element whose
// anchor attribute a live patch took away parks its pins off screen (anchor()'s fallback) until they are placed again.
// A pin inside a box that cuts off what overflows it (a box that scrolls, a carousel) is placed by the script too: the
// browser hides a held pin only once its whole element is cut off, so a pin low on a tall element would float outside
// its box; the script hides it by its spot (anchoring.ts, clippedAt). A box that covers the whole screen (a board's)
// cuts nothing the screen doesn't.
let sheet: HTMLStyleElement | null = null;
const names = new WeakMap<Element, string>(); // an element's anchor name, kept while it lives
const rules = new Map<HTMLElement, string>(); // a held pin and its rule
const spots = new Map<HTMLElement, { name: string; node: Element }>(); // a held pin's element and its anchor name
const boxes = new Map<HTMLElement, string>(); // a card tied to the element its held pin is on, and its rule
let count = 0;
let dirty = false;
// What an element is, read once per placing of the pins (newPass): whether a box cuts it off, it sits in the top layer,
// or the page gives it an anchor name of its own. Read before any pin is written, so placing many pins lays out once.
let pass = 0;
const seen = new WeakMap<Element, { pass: number; no: boolean; moves: boolean }>();
/** A new placing of the pins: what was read about their elements is read again. */
export const newPass = () => void pass++;
const cutOff = (node: Element) => {
  for (let el = node.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (getComputedStyle(el).overflow === 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.left > 0.5 || r.top > 0.5 || r.right < innerWidth - 0.5 || r.bottom < innerHeight - 0.5) return true;
  }
  return false;
};
// The element moves on its own while the page scrolls or stands still: it, or a box around it, is sticky or fixed, or
// transformed or animated (a board's frames under its camera, a carousel, a header that slides). Only such a pin is
// held: a pin on still content is placed in the page by the script and scrolls with it for free, where a held one is
// laid out again at every scroll step (Leo, 20 Nov, measured: 0 vs 320 ms of layout for 40 pins over one scroll).
const moves = (node: Element) => {
  for (let el: Element | null = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.position === 'sticky' || s.position === 'fixed') return true;
    if (s.transform !== 'none' || s.translate !== 'none' || s.scale !== 'none' || s.rotate !== 'none') return true;
    if (s.animationName !== 'none' && el.getAnimations().length) return true;
  }
  return false;
};
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const inTopLayer = (node: Element) => {
  try {
    return Boolean(node.closest('dialog[open], :popover-open, :fullscreen'));
  } catch {
    return true;
  }
};

const nameOf = (node: Element) => {
  let name = names.get(node);
  if (!name) names.set(node, (name = `lab${(++count).toString(36)}`));
  return name;
};
// What holdPin needs to know about an element, read once a pass. Reading a style after the pins were written lays the
// page out again, so readPins reads them all first, before any pin is written.
const readNode = (node: Element) => {
  let read = seen.get(node);
  if (read?.pass !== pass) {
    const name = nameOf(node);
    const own = (getComputedStyle(node) as CSSStyleDeclaration & { anchorName?: string }).anchorName;
    seen.set(node, (read = { pass, no: Boolean(own && own !== 'none' && own !== `--${name}`) || inTopLayer(node) || cutOff(node), moves: moves(node) }));
  }
  return read;
};
/** Reads what holdPin needs about these elements, all at once: called before the pins are written (comments.js). */
export const readPins = (nodes: (Element | null | undefined)[]) => {
  for (const n of nodes) if (n && !/^(html|body|main)$/.test(n.localName)) readNode(n);
};

/** Ties a pin to node, its spot at (left, top) in page coordinates. False, and the pin let go, when the script places it.
 *  share: the spot as a share of node's box instead (a board's frame, which the board's camera scales: anchor() reads the
 *  box as the camera shows it, so a share stays on the same point of the frame through any pan and zoom). */
export function holdPin(pin: HTMLElement, on: boolean, node: Element | null, left: number, top: number, share?: { x: number; y: number }): boolean {
  // The page itself, or a big container placed by a share of its size, keeps the script's place (anchoring.ts, spotOf).
  if (!on || !node || /^(html|body|main)$/.test(node.localName) || pin.classList.contains('dragging')) {
    letPin(pin);
    return false;
  }
  const name = nameOf(node);
  const read = readNode(node);
  if (read.no || (!share && !read.moves)) {
    letPin(pin);
    return false;
  }
  if (node.getAttribute('data-lab-anchor') !== name) node.setAttribute('data-lab-anchor', name); // put back after a live patch
  const part = pin.getAttribute('part') || `lp${(++count).toString(36)}`;
  pin.setAttribute('part', part);
  const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
  // Only an offset needs the element's box: a share doesn't, and reading a box after the last pin was written lays the
  // page out again, once per pin (600 pins on a board: 17 s in Chrome).
  const r = share ? null : node.getBoundingClientRect();
  const at = !r
    ? `left:anchor(${pct(share!.x)}, -10000px)!important;top:anchor(${pct(share!.y)}, -10000px)!important`
    : `left:calc(anchor(left, -10000px) + ${px(left - scrollX - r.left)})!important;top:calc(anchor(top, -10000px) + ${px(top - scrollY - r.top)})!important`;
  const rule =
    `[data-lab-anchor="${name}"]{anchor-name:--${name}}` +
    `[data-lab-comments]::part(${part}){position:fixed!important;position-anchor:--${name};position-visibility:anchors-visible;${at}}`;
  if (rules.get(pin) !== rule) {
    rules.set(pin, rule);
    dirty = true;
  }
  spots.set(pin, { name, node });
  return true;
}

/** Ties a card to the element its pin is held on (not to the pin: anchor positioning reads a held pin's place from before
 *  the browser follows a scroll, so a card on the pin would trail by the scroll). The element, or null when the pin isn't
 *  held. Where on it: the card's --lab-cx / --lab-cy / --lab-ay (thread.ts tieToPin). */
export function holdBox(node: HTMLElement, pin: HTMLElement | null | undefined): Element | null {
  const at = pin && rules.has(pin) ? spots.get(pin) : null;
  if (!at) {
    letBox(node);
    return null;
  }
  const part = `${pin!.getAttribute('part')}-card`; // its pin's: a card drawn again keeps its rule, the sheet unwritten
  node.setAttribute('part', part);
  const rule =
    `[data-lab-comments]::part(${part}){position:fixed;position-anchor:--${at.name};` +
    'left:max(12px,calc(anchor(left, -10000px) + var(--lab-cx)));top:calc(anchor(top, -10000px) + var(--lab-cy))}';
  if (boxes.get(node) !== rule) {
    boxes.set(node, rule);
    dirty = true;
  }
  return at.node;
}

/** The card is placed another way again (in the margin, a sheet, untied). */
export function letBox(node: HTMLElement) {
  if (!boxes.delete(node)) return;
  node.removeAttribute('part');
  dirty = true;
}

/** The script places this pin again (it is dragged, or it can't be held). */
export function letPin(pin: HTMLElement) {
  spots.delete(pin);
  if (!rules.delete(pin)) return;
  pin.removeAttribute('part');
  dirty = true;
  flushPins();
}

/** Whether the browser holds this pin: a scroll needs nothing from the script for it. */
export const heldPin = (pin?: HTMLElement) => Boolean(pin && rules.has(pin));

/** Writes the rules once the pins are drawn; pins gone from the page let go of theirs. */
export function flushPins() {
  for (const map of [rules, boxes])
    for (const node of map.keys()) {
      if (node.isConnected) continue;
      map.delete(node);
      dirty = true;
    }
  for (const pin of spots.keys()) if (!pin.isConnected) spots.delete(pin); // and the elements they were on, let go
  if (!dirty) return;
  dirty = false;
  if (!sheet) sheet = Object.assign(document.createElement('style'), { id: 'lab-pinhold' });
  if (!sheet.isConnected) document.head.append(sheet);
  sheet.textContent = [...rules.values(), ...boxes.values()].join('');
}
