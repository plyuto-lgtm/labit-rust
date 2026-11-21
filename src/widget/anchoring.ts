// Where a pin points: the element, words, picture pixel, code line or video second under it, and how to find
// that spot again when the page changes. Part of the comment widget (src/comments.js bundles it).
import { GENERATED } from '../../lib/ids.ts';

/** Words a pin quotes, with what comes before and after so they can be found again. */
type Quote = {
  exact: string;
  prefix: string;
  suffix: string;
  /** In code: the whole line, its number in the block and on the page, and the block's label. */
  line?: string;
  lineNo?: number;
  pageLineNo?: number;
  lines?: number;
  label?: string;
};

/** Everything a pin remembers about its spot. Saved with the comment and read by agents. */
type Anchor = {
  selector: string;
  /** The nearest element with an id around the spot, so an agent knows the block a pin is on. */
  block?: string;
  /** Where in the element, as shares of its width and height. */
  x: number;
  y: number;
  /** Where on the page, and the window it was seen in. */
  docX: number;
  docY: number;
  width: number;
  height: number;
  dpr: number;
  /** The element's opening tag, and its height then. */
  element: string;
  eh: number;
  /** A pin in the empty margin beside the page's content sits on the content level with it: this many px beyond the spot x says (minus: left of it). */
  sx?: number;
  kind?: string;
  text?: string;
  inside?: string;
  section?: string;
  shadow?: string;
  component?: string;
  source?: string;
  looks?: string;
  rules?: string;
  box?: string;
  chosen?: string;
  cssText?: string;
  quote?: Quote;
  /** What proves its element is the one pinned (see fingerprint). */
  fp?: Fp;
  /** Pictures and video: the file, the pixel in its natural size, the second. */
  src?: string;
  alt?: string;
  file?: string;
  nw?: number;
  nh?: number;
  imgX?: number;
  imgY?: number;
  imgX2?: number;
  imgY2?: number;
  fx?: number;
  fy?: number;
  fw?: number;
  fh?: number;
  zw?: number;
  zh?: number;
  docW?: number;
  docH?: number;
  pinX?: number;
  pinY?: number;
  /** On a board: the frame a pin is on, in px from its top left. */
  frame?: string;
  time?: number;
  /** The page's videos and animations were paused when this was written. */
  paused?: boolean;
  /** Then: the moment showing, in ms. */
  atMs?: number;
  /** The page's motion ran at ¼ speed. */
  slow?: boolean;
  /** A data-lab-action button's words, and whether the agent confirms before doing it. */
  act?: string;
  confirm?: boolean;
  duration?: number;
  transform?: string;
  /** An area dragged out, and what was inside it. */
  zoneItems?: string[];
  zoneText?: string;
  /** A drawing (hold D and drag, draw.ts): what its lines read as, and the lines in 0–1000 of the area. */
  ink?: { mark: string; from?: string; to?: string; pts: number[][]; w?: number[][]; marks?: string[] };
  shownFor?: number;
  build?: string;
};

/** A rectangle on the page, in document pixels. */
type Box = { left: number; top: number; width: number; height: number };

/** Where a pin shows: its point, the area it marks (if any), and whether its spot changed. */
type Spot = { left: number; top: number; zone: Box | null; moved?: boolean; clipped?: boolean; hidden?: boolean };

type Deps = {
  host: HTMLElement;
  layer: HTMLElement;
  el: (tag: string, attrs?: Record<string, string>, text?: string) => HTMLElement;
};

// Set once by the widget at startup (bindAnchoring), so importing this module touches nothing.
let host: Deps['host'], layer: Deps['layer'], el: Deps['el'];
export function bindAnchoring(deps: Deps) {
  ({ host, layer, el } = deps);
  // Astro's dev toolbar takes data-astro-source-file and -loc off every element once the page is up: what they said is kept
  // here, from each removal as it happens (the old value comes with it). Until then (or with the toolbar off) they are read live.
  new MutationObserver((list) => {
    for (const m of list) if (m.oldValue !== null) astro.set(m.target, { ...astro.get(m.target), [m.attributeName]: m.oldValue });
  }).observe(document.documentElement, { attributes: true, subtree: true, attributeOldValue: true, attributeFilter: ASTRO });
}
const ASTRO = ['data-astro-source-file', 'data-astro-source-loc'];
const astro = new WeakMap<Node, Record<string, string | null>>();
// The nearest element up from `n` that Astro wrote its file and line on: "src/pages/index.astro:12:5".
const astroSource = (n: Element | null) => {
  for (; n; n = n.parentElement) {
    const [file, loc] = ASTRO.map((a) => n.getAttribute(a) ?? astro.get(n)?.[a]);
    if (file) return `${file.replace(/^.*\/src\//, 'src/')}:${loc || ''}`;
  }
  return '';
};

// A motion token (--_t-quick, -base, -slow, -loop, -hold, styles.css) in milliseconds, times `times`: for a timer or a
// Web Animation, which can't read a var(). It is 0 under reduced motion, as the CSS durations are (hold excepted).
export function ms(token: 'quick' | 'base' | 'slow' | 'loop' | 'hold' | 'calm', times = 1): number {
  const v = /^\s*(-?[\d.]+)(m?s)\s*$/.exec(getComputedStyle(host).getPropertyValue(`--_t-${token}`));
  return v ? parseFloat(v[1]) * (v[2] === 's' ? 1000 : 1) * times : 0;
}

// A motion curve (--_ease, -out, -in, -settle, -pop) for a Web Animation's `easing`, which can't read a var() either.
export const ease = (curve: '' | 'out' | 'in' | 'settle' | 'pop' = ''): string =>
  getComputedStyle(host).getPropertyValue(`--_ease${curve && `-${curve}`}`).trim() || 'linear';

// Ids and classes a framework or build makes up (lib/ids.ts) say nothing about which element it is.
const generated = (v) => GENERATED.test(v || '');
// Names a page gives an element for tests or for comments: the most lasting way to find it again.
const NAMED = ['data-testid', 'data-lab', 'data-comment-target'];

// A path to an element inside an open web component goes through its host: "host path >>> path inside its shadow root"
// (not CSS: query() below follows it).
const SHADOW = ' >>> ';
export function selectorFor(node) {
  const root = node.getRootNode?.();
  const scope: ParentNode = root instanceof ShadowRoot ? root : document;
  const parts = [];
  while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
    const name = NAMED.find((a) => node.getAttribute(a));
    const named = name && `[${name}="${CSS.escape(node.getAttribute(name))}"]`;
    if (named && scope.querySelectorAll(named).length === 1) {
      parts.unshift(named);
      break;
    }
    if (node.id && !generated(node.id) && scope.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const tag = node.localName;
    let index = 1;
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === tag) index++;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    node = node.parentElement;
  }
  if (scope !== document) return `${selectorFor((scope as ShadowRoot).host)}${SHADOW}${parts.join(' > ')}`;
  return parts.length ? (/^[#[]/.test(parts[0]) ? '' : 'body > ') + parts.join(' > ') : 'body';
}
// The element a selector leads to (the first), through the shadow roots it names. Throws on a selector that is not valid.
const query = (selector: string): Element | null => {
  let node: Element | null = null;
  for (const [i, part] of selector.split(SHADOW).entries()) if (!(node = (i ? node?.shadowRoot : document)?.querySelector(part) ?? null)) break;
  return node;
};

const docWidth = () => Math.max(document.documentElement.scrollWidth, 1);

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
// Text cut to n characters (from the end when n is negative) without splitting an emoji: a half of a surrogate pair, or a
// joiner with nothing after it, is dropped (it reached the agent as U+FFFD).
export const cut = (v: string, n: number): string =>
  v.length <= Math.abs(n) ? v : n < 0 ? v.slice(n).replace(/^(?:[\udc00-\udfff]|\u200d)+/, '') : v.slice(0, n).replace(/(?:[\ud800-\udbff]|\u200d)+$/, '');
export const short = (v, n) => cut((v || '').replace(/\s+/g, ' ').trim(), n);

// A source-file hint from a (possibly proxied, hashed or optimised) image URL: "hero-1" from
// /_astro/hero-1.Bx3kd9_Z.webp, /_image?href=..., /_vercel/image?url=..., /media/<id>/w800.webp.
function fileHint(url) {
  if (!url || url.startsWith('data:')) return '';
  try {
    const u = new URL(url, location.href);
    const inner = u.searchParams.get('href') || u.searchParams.get('url');
    if (inner && /\/_(image|vercel\/image|next\/image)/.test(u.pathname)) return fileHint(inner);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let name = parts.pop() || '';
    if (/^w?\d+(x\d+)?\.\w+$/i.test(name) && parts.length) name = parts.pop();
    return name.replace(/\.(avif|webp|jpe?g|png|gif|svg|mp4|webm|mov)$/i, '').replace(/[._-][A-Za-z0-9_-]{8}$/, '');
  } catch {
    return '';
  }
}

const mediaSrc = (m) => {
  const src = m.currentSrc || m.getAttribute('src') || '';
  if (src && !src.startsWith('data:')) return new URL(src, location.href).href;
  const lazy = m.dataset?.src || (m.getAttribute('srcset') || m.dataset?.srcset || '').split(/\s+/)[0];
  return lazy ? new URL(lazy, location.href).href : '';
};

// Where the click is inside the original image/video, taking object-fit and object-position into account.
function naturalSpot(m, rect, cx, cy, nw, nh) {
  if (!nw || !nh || !rect.width || !rect.height) return null;
  const cs = getComputedStyle(m);
  const fit = cs.objectFit || 'fill';
  const pos = (cs.objectPosition || '50% 50%').split(/\s+/).map((v) =>
    v.endsWith('%') ? parseFloat(v) / 100 : { left: 0, top: 0, right: 1, bottom: 1 }[v] ?? 0.5,
  );
  const sx = rect.width / nw;
  const sy = rect.height / nh;
  const scale = { cover: Math.max(sx, sy), contain: Math.min(sx, sy), none: 1, 'scale-down': Math.min(1, sx, sy) }[fit];
  const dw = nw * (scale ?? sx);
  const dh = nh * (scale ?? sy);
  const ox = (rect.width - dw) * (pos[0] ?? 0.5);
  const oy = (rect.height - dh) * (pos[1] ?? pos[0] ?? 0.5);
  return { fit, nw, nh, imgX: clamp01((cx - rect.left - ox) / dw), imgY: clamp01((cy - rect.top - oy) / dh) };
}

// The picture file's own size. With srcset, naturalWidth is the size in CSS pixels, not the file's: read the width
// descriptor of the candidate the browser picked ("photo-1600.jpg 1600w"), or scale by its density ("2x").
function fileSize(img) {
  let nw = img.naturalWidth;
  let nh = img.naturalHeight;
  const sets = [img.srcset, ...[...(img.closest('picture')?.querySelectorAll('source') || [])].map((s) => s.srcset)].filter(Boolean);
  for (const set of sets) {
    for (const part of set.split(/,\s+/)) {
      const [url, d = '1x'] = part.trim().split(/\s+/);
      let abs = '';
      try {
        abs = new URL(url, location.href).href;
      } catch {}
      if (!url || abs !== img.currentSrc || !nw) continue;
      const v = parseFloat(d);
      if (d.endsWith('w') && v) return { nw: Math.round(v), nh: Math.round((v * nh) / nw) };
      if (d.endsWith('x') && v) return { nw: Math.round(nw * v), nh: Math.round(nh * v) };
    }
  }
  return { nw, nh };
}

// Which component drew an element and where (React, Vue 3, Svelte dev builds): components.ts, its own file, which
// src/comments.js loads only on a page made with one of them and hands over here. Until then (and on any other page)
// nothing is read.
type Component = { component?: string; source?: string; usedAt?: string };
let componentAt: (el: any) => Component = () => ({});
export const readComponents = (read: typeof componentAt) => {
  componentAt = read;
};

// How the element looks: fill, text colour, size and weight, corners. A colour that a CSS variable on :root
// holds is named by it (the page's own tokens).
function looksOf(el) {
  const cs = getComputedStyle(el);
  const names = new Map();
  // A variable that isn't a colour (a radius, a gap) leaves the probe with its parent's colour, one no page uses:
  // those are skipped, so "--radius-sm" never names a text colour.
  const NONE = 'rgb(1, 2, 3)';
  const wrap = document.createElement('i');
  wrap.style.cssText = `display:none;color:${NONE}`;
  const probe = wrap.appendChild(document.createElement('i'));
  document.body.append(wrap);
  for (const prop of [...getComputedStyle(document.documentElement)].filter((p) => p.startsWith('--')).slice(0, 400)) {
    probe.style.color = '';
    probe.style.color = `var(${prop})`;
    const v = getComputedStyle(probe).color;
    if (v && v !== NONE && !names.has(v)) names.set(v, prop);
  }
  wrap.remove();
  const say = (v) => (names.has(v) ? `${names.get(v)} ${v}` : v);
  const out = [];
  if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor)) out.push(`fill ${say(cs.backgroundColor)}`);
  out.push(`text ${say(cs.color)} ${cs.fontSize}/${cs.fontWeight}`);
  if (parseFloat(cs.borderTopLeftRadius)) out.push(`radius ${cs.borderTopLeftRadius}`);
  return short(out.join(', '), 200);
}

// The style rules that reach the element (the last few, so the ones that win), each with the file and the media query
// it sits under: "bigger on phones" then goes to the right @media, not just the right class.
function rulesOf(el) {
  const out: string[] = [];
  const walk = (rules, file, media) => {
    for (const r of rules) {
      try {
        if (r.selectorText !== undefined) {
          if (!/lab-|data-lab/.test(r.selectorText) && el.matches(r.selectorText)) out.push(`${short(r.selectorText, 60)}${media} (${file})`);
        } else if (r.cssRules && !(r.media && !matchMedia(r.media.mediaText).matches)) walk(r.cssRules, file, r.media ? `${media} @media ${short(r.media.mediaText, 60)}` : media);
      } catch {}
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      const own = sheet.ownerNode as Element | null;
      const file = sheet.href ? sheet.href.replace(/[?#].*$/, '').replace(/^.*\//, '') : own?.getAttribute?.('data-vite-dev-id')?.replace(/^.*\//, '') || 'inline style';
      walk(sheet.cssRules, file, '');
    } catch {} // a stylesheet from another origin can't be read
  }
  return short(out.slice(-4).join('; '), 400);
}

// How big the element is and what is around it, in the words a fix is written in.
function boxOf(el) {
  const cs = getComputedStyle(el);
  const out = [`${Math.round(el.offsetWidth)}×${Math.round(el.offsetHeight)}`];
  const sides = (p) => [0, 1, 2, 3].map((i) => parseFloat(cs[`${p}${['Top', 'Right', 'Bottom', 'Left'][i]}`]) || 0);
  for (const p of ['padding', 'margin']) if (sides(p).some(Boolean)) out.push(`${p} ${sides(p).join(' ')}`);
  out.push(cs.display + (/flex|grid/.test(cs.display) && cs.gap !== 'normal' ? ` gap ${cs.gap}` : ''));
  if (cs.position !== 'static') out.push(cs.position);
  if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth) out.push(`content wider than it (${el.scrollWidth}px)`);
  return short(out.join(', '), 200);
}

// A point on an element turned, scaled or skewed by its own CSS transform, in the element's untransformed box.
function untransform(el, cx, cy) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return null;
  const m = new DOMMatrix(t);
  if (m.isIdentity) return null;
  const w = el.offsetWidth || el.getBoundingClientRect().width;
  const h = el.offsetHeight || el.getBoundingClientRect().height;
  const [ox, oy] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
  const at = (x, y) => m.transformPoint(new DOMPoint(x - ox, y - oy));
  const corners = [at(0, 0), at(w, 0), at(0, h), at(w, h)];
  const r = el.getBoundingClientRect();
  // Where the transform origin is on screen: the drawn box's top left, minus how far the corners reach.
  const origin = { x: r.left - Math.min(...corners.map((p) => p.x)), y: r.top - Math.min(...corners.map((p) => p.y)) };
  const q = m.inverse().transformPoint(new DOMPoint(cx - origin.x, cy - origin.y));
  return { rect: { left: 0, top: 0, width: w, height: h }, x: q.x + ox, y: q.y + oy };
}

// A picture inside an SVG (<image>): its file size, and preserveAspectRatio (default: fit inside, centred).
function svgImageSpot(el, anchor, cx, cy) {
  const r = el.getBoundingClientRect();
  const keep = (el.getAttribute('preserveAspectRatio') || 'xMidYMid meet').split(/\s+/);
  const fill = (iw, ih) => {
    if (!iw || !ih || !r.width || !r.height) return;
    let [dw, dh] = [r.width, r.height];
    if (keep[0] !== 'none') {
      const k = (keep[1] === 'slice' ? Math.max : Math.min)(r.width / iw, r.height / ih);
      [dw, dh] = [iw * k, ih * k];
    }
    const align = (v, room) => (v === 'Min' ? 0 : v === 'Max' ? room : room / 2);
    const ox = keep[0] === 'none' ? 0 : align(keep[0].slice(1, 4), r.width - dw);
    const oy = keep[0] === 'none' ? 0 : align(keep[0].slice(5, 8), r.height - dh);
    Object.assign(anchor, { nw: iw, nh: ih, imgX: clamp01((cx - r.left - ox) / dw), imgY: clamp01((cy - r.top - oy) / dh) });
  };
  const probe = new Image();
  probe.onload = () => fill(probe.naturalWidth, probe.naturalHeight);
  probe.src = anchor.src;
  if (probe.complete) fill(probe.naturalWidth, probe.naturalHeight);
}

// Where the click is inside a CSS background picture: its file size (loaded once, usually from the cache),
// background-size (cover, contain, auto, lengths) and background-position. Fills the anchor when known.
function backgroundSpot(n, url, anchor, cx, cy) {
  const r = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  // Layers are comma lists (a gradient on top of the photo is common): use the photo's own layer.
  const layers = (v) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
  const at = Math.max(0, layers(cs.backgroundImage).findIndex((l) => l.includes(url)));
  const pick = (v) => {
    const l = layers(v);
    return l[at % l.length];
  };
  const fill = (iw, ih) => {
    if (!iw || !ih || !r.width || !r.height) return;
    const size = pick(cs.backgroundSize);
    let dw = iw;
    let dh = ih;
    if (size === 'cover' || size === 'contain') {
      const k = (size === 'cover' ? Math.max : Math.min)(r.width / iw, r.height / ih);
      dw = iw * k;
      dh = ih * k;
    } else if (size !== 'auto' && size !== 'auto auto') {
      const [w, h = 'auto'] = size.split(/\s+/);
      const len = (v, of) => (v.endsWith('%') ? (parseFloat(v) / 100) * of : parseFloat(v));
      dw = w === 'auto' ? NaN : len(w, r.width);
      dh = h === 'auto' ? NaN : len(h, r.height);
      if (Number.isNaN(dw) && Number.isNaN(dh)) [dw, dh] = [iw, ih];
      else if (Number.isNaN(dw)) dw = (dh * iw) / ih;
      else if (Number.isNaN(dh)) dh = (dw * ih) / iw;
    }
    const [px = '50%', py = '50%'] = pick(cs.backgroundPosition).split(/\s+/);
    const off = (v, room) => (v.endsWith('%') ? (parseFloat(v) / 100) * room : parseFloat(v) || 0);
    const ox = off(px, r.width - dw);
    const oy = off(py, r.height - dh);
    Object.assign(anchor, { nw: iw, nh: ih, fit: `background ${size}`, imgX: clamp01((cx - r.left - ox) / dw), imgY: clamp01((cy - r.top - oy) / dh) });
  };
  const probe = new Image();
  probe.onload = () => fill(probe.naturalWidth, probe.naturalHeight);
  probe.src = url;
  if (probe.complete) fill(probe.naturalWidth, probe.naturalHeight);
}

// A click on empty space: the blocks just above and below it inside the element, by heading or first words.
function between(target, cy) {
  const kids = [...target.children].filter((k) => k !== host && k.getBoundingClientRect().height > 0);
  let above = null;
  let below = null;
  for (const k of kids) {
    const kr = k.getBoundingClientRect();
    if (kr.bottom <= cy) above = k;
    else if (kr.top >= cy && !below) below = k;
    else if (kr.top < cy && kr.bottom > cy) return null; // inside a block, not between two
  }
  const say = (k) => (k ? short(`${openingTag(k)} "${blockWords(k)}"`, 160) : undefined);
  return above || below ? { above: say(above), below: say(below) } : null;
}
// What a block is called there: its heading, else its first words.
const blockWords = (k) => short((k.matches('h1, h2, h3, h4, h5, h6') ? k : k.querySelector('h1, h2, h3, h4, h5, h6') || k).textContent, 60);
// A pin in the space between two blocks (gapAbove / gapBelow name them; none: the box's own top or end) stays between
// them: where it was put while that is still between them, else the nearest point that is. Among look-alikes the pair
// nearest to where it was put; next to the one that is left when the other is gone; null when both are.
function gapTop(anchor, node, rect) {
  const kids = [...node.children].filter((k) => k !== host && k.getBoundingClientRect().height > 0);
  const is = (k, said) => (said ? k && sameKind(k, said) && blockWords(k).startsWith((said.split('> "')[1] || '').replace(/"$/, '')) : !k);
  const put = rect.top + anchor.y * rect.height;
  let best = null;
  let near = Infinity;
  for (let i = 0; i <= kids.length; i++) {
    const [above, below] = [is(kids[i - 1], anchor.gapAbove), is(kids[i], anchor.gapBelow)];
    if (!above && !below) continue;
    // Past the last block (its neighbour above is gone, none below): the box's end, not a block that isn't there.
    const lo = above ? (kids[i - 1]?.getBoundingClientRect().bottom ?? rect.top) : (kids[i]?.getBoundingClientRect().top ?? rect.bottom) - 16;
    const hi = below ? (kids[i]?.getBoundingClientRect().top ?? rect.bottom) : lo + 16;
    const top = Math.min(Math.max(put, lo), Math.max(lo, hi));
    const far = Math.abs(top - put) + (above && below ? 0 : 1e6); // both neighbours beat one
    if (far < near) [best, near] = [top, far];
  }
  return best;
}

// Light or dark where the pin is: the first background colour behind it that isn't transparent.
function schemeAt(target) {
  for (let n = target; n; n = n.parentElement) {
    const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.5)) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return { scheme: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light', background: hex };
  }
  return { scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
}

// The word under the click plus ~40 characters either side, so an agent can grep the source.
function quoteAt(cx, cy, shadowRoots = []) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    // Open shadow roots under the click are passed in, so text inside a web component is found too.
    const p = shadowRoots.length ? document.caretPositionFromPoint(cx, cy, { shadowRoots }) : document.caretPositionFromPoint(cx, cy);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(cx, cy);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== 3 || !node.data.trim()) return null;
  // Only when the click is really on the text, not in empty space next to it.
  const range = document.createRange();
  range.selectNodeContents(node);
  const hit = [...range.getClientRects()].some((r) => cx >= r.left - 4 && cx <= r.right + 4 && cy >= r.top - 4 && cy <= r.bottom + 4);
  if (!hit) return null;
  const text = node.data;
  let a = offset;
  let b = offset;
  // Chinese, Japanese, Korean and Thai don't put spaces between words: ask the browser where the word is.
  const seg = /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(text) && typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(node.parentElement?.closest('[lang]')?.lang || undefined, { granularity: 'word' })
    : null;
  if (seg) {
    for (const w of seg.segment(text)) {
      if (offset >= w.index && offset <= w.index + w.segment.length && w.segment.trim()) {
        a = w.index;
        b = w.index + w.segment.length;
        if (offset < b) break;
      }
    }
  } else {
    while (a > 0 && /\S/.test(text[a - 1])) a--;
    while (b < text.length && /\S/.test(text[b])) b++;
  }
  const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, blockquote, a, button, label, span, div') || node.parentElement;
  const full = block?.textContent || text;
  const before = full.slice(0, full.indexOf(text) + a);
  const after = full.slice(full.indexOf(text) + b);
  const squash = (v) => v.replace(/\s+/g, ' ');
  const quote: Quote = {
    exact: short(text.slice(a, b), 80),
    prefix: cut(squash(before.slice(-80)).replace(/^\s+/, ''), -40),
    suffix: cut(squash(after.slice(0, 80)).replace(/\s+$/, ''), 40),
  };
  // Code (or any preformatted text): the whole line, its number in the block, and the block's label
  // (a figcaption, data-file, title or aria-label nearby), so an agent can open the file at that line.
  const pre = node.parentElement?.closest('pre, [data-file]') ||
    (getComputedStyle(node.parentElement).whiteSpace.startsWith('pre') ? node.parentElement : null);
  // A table of code with its own line numbers (one row per line) counts as a block too.
  const codeTable = !pre && node.parentElement?.closest('table[data-file], table[class*="code" i]');
  if (pre || codeTable) {
    const box = pre || codeTable;
    const r = document.createRange();
    r.setStart(box, 0);
    r.setEnd(node, offset);
    let upto = r.toString();
    let all = box.textContent;
    // Lines drawn as elements (a <br> or a row per line, no newline characters): count those instead.
    const breaks = [...box.querySelectorAll('br, tr')];
    // A code table counts its rows, whatever line breaks its markup has.
    if ((box.localName === 'table' || !all.includes('\n')) && breaks.length) {
      const ends = box.querySelectorAll('br').length ? [...box.querySelectorAll('br')] : [...box.querySelectorAll('tr')].slice(0, -1);
      const before = ends.filter((e) => e.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING && !e.contains(node)).length;
      const lineRange = document.createRange();
      if (before) lineRange.setStartAfter(ends[before - 1]);
      else lineRange.setStart(box, 0);
      if (ends[before]) lineRange.setEndBefore(ends[before]);
      else lineRange.setEnd(box, box.childNodes.length);
      // Rows are the lines themselves; with <br> a line is what lies between two of them.
      const row = box.querySelectorAll('br').length ? null : node.parentElement?.closest('tr');
      quote.line = short((row ? row.textContent : lineRange.toString()).trim(), 200);
      quote.lineNo = before + 1;
      quote.lines = ends.length + (box.querySelectorAll('br').length ? 0 : 1);
    } else {
      const from = upto.lastIndexOf('\n') + 1;
      const to = all.indexOf('\n', upto.length);
      quote.line = short(all.slice(from, to < 0 ? undefined : to).trim(), 200);
      quote.lineNo = upto.split('\n').length;
      quote.lines = all.replace(/\n$/, '').split('\n').length;
    }
    // The page's own line number, when it shows one (a number cell, or data-line on the row or cell).
    const row = node.parentElement?.closest('tr, [data-line], [data-line-number]');
    if (row) {
      const cell = row.matches('[data-line], [data-line-number]') ? row : row.querySelector('[data-line], [data-line-number]');
      const n = cell?.getAttribute('data-line') || cell?.getAttribute('data-line-number') || [...row.children].map((c) => c.textContent.trim()).find((t) => /^\d+$/.test(t));
      if (n && /^\d+$/.test(n)) quote.pageLineNo = Number(n);
    }
    // The block's label: data-file, a caption, or a title bar next to the block (Docusaurus, Expressive Code).
    let label = box.closest('[data-file]')?.getAttribute('data-file') || box.getAttribute('title') || box.getAttribute('aria-label') || '';
    for (let el = box.parentElement, i = 0; !label.trim() && el && el !== document.body && i < 3; el = el.parentElement, i++) {
      label = el.querySelector(':scope > figcaption, :scope > [class*="title" i]')?.textContent || '';
    }
    if (label.trim()) quote.label = short(label.trim(), 120);
  }
  return quote;
}

export function openingTag(node) {
  const attrs = [...node.attributes]
    .filter((a) => /^(id|class|alt|role|aria-label|href|data-(?!lab-(?!action))[\w-]+)$/.test(a.name))
    .map((a) => [a.name, a.name === 'class' ? a.value.split(/\s+/).filter((c) => c && !generated(c)).join(' ') : a.name === 'id' && generated(a.value) ? '' : a.value])
    .filter(([n, v]) => v || !/^(id|class)$/.test(n))
    .map(([n, v]) => `${n}="${short(v, 60)}"`);
  return cut(`<${node.localName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`, 200);
}
// Is this element the kind a pin was put on? Same tag and id, and at least one of its classes still there: pages
// add and drop state classes (offscreen, is-active, open), and an exact match of the tag moved those pins away.
function sameKind(node, tag) {
  if (!tag) return true;
  const want = /^<([\w-]+)/.exec(tag)?.[1];
  if (node.localName !== want) return false;
  // Made-up ids and classes don't count (a pin saved before they were left out of the tag still has them).
  const ownId = (v) => (generated(v) ? '' : v || '');
  const id = / id="([^"]*)"/.exec(tag)?.[1];
  if (ownId(id) !== ownId(short(node.id || '', 60))) return false;
  const classes = (/ class="([^"]*)"/.exec(tag)?.[1] || '').split(/\s+/).filter((c) => c && c !== '…' && !c.endsWith('…') && !generated(c));
  return !classes.length || classes.some((c) => node.classList.contains(c));
}

// words: the point is on the word under it (kind text, its quote: the words a Shift-drag quotes). A click or an area is
// only a point, never a quote, so nothing is highlighted (Leo 18 Nov: "pin pointing on word highlighting word").
// onto: the element the caller knows is there (selected words' own). Chrome now and then finds nothing but <html>
// under a point for the moment after a double-click selects a word, and the pin went on <body>, its words not found.
export function anchorAt(clickX, clickY, words = false, onto = null) {
  let [clientX, clientY] = [clickX, clickY];
  const board = (window as unknown as { __labBoard?: { anchor?: (x: number, y: number) => Anchor; contains?: (x: number, y: number) => boolean } }).__labBoard;
  if (board?.anchor && (!board.contains || board.contains(clientX, clientY))) return board.anchor(clientX, clientY); // on a board (its page, or a page's board view): the board says what is there
  let stack = document.elementsFromPoint(clientX, clientY).filter((n) => n !== host && n !== document.documentElement);
  // ...and when the point is on something else (scrolled away, under the bar), the element the caller names wins.
  if (onto && !(stack[0] && (stack[0] === onto || onto.contains(stack[0])))) stack = [onto];
  // A click in the empty margin beside the content (a centred column's left or right): on the content level with it,
  // that many px out, so it follows that line when the page changes or the window is resized.
  let aside = 0;
  if (!onto && (!stack[0] || stack[0] === document.body)) {
    const side = sideOf(clientX, clientY);
    if (side) [aside, clientX, stack] = [clientX - side.x, side.x, side.stack];
  }
  // Inside open web components: follow the click into each shadow root.
  const shadowRoots = [];
  let shadowHost = null;
  for (let top = stack[0]; top?.shadowRoot && !host.contains(top) && shadowRoots.length < 5; top = stack[0]) {
    shadowHost ||= top;
    shadowRoots.push(top.shadowRoot);
    const inner = top.shadowRoot.elementsFromPoint(clientX, clientY).filter((n) => n !== top);
    if (!inner.length) break;
    stack = [...inner, ...stack];
  }
  // data-comment-target: a click anywhere inside snaps to that element (same attribute as Claude artifacts).
  const target = stack[0]?.closest('[data-comment-target]') || stack[0] || document.body;
  const rect = target.getBoundingClientRect();
  const anchor: Anchor = {
    selector: selectorFor(target),
    x: rect.width ? (clientX - rect.left) / rect.width : 0,
    y: rect.height ? (clientY - rect.top) / rect.height : 0,
    docX: (clickX + scrollX) / docWidth(),
    docY: clientY + scrollY,
    width: innerWidth,
    height: innerHeight,
    dpr: Math.round((devicePixelRatio || 1) * 100) / 100,
    element: openingTag(target),
    eh: Math.round(rect.height), // its height then: a pin on a big container can tell if the page grew under it
  };
  const own = short(target.textContent, 200);
  if (own && target !== document.body && (target.textContent || '').length < 400) anchor.text = short(own, 80);
  Object.assign(anchor, around(target));
  if (shadowHost) anchor.shadow = openingTag(shadowHost);
  for (const [k, v] of Object.entries(componentAt(target))) if (v) anchor[k] = short(v, 200);
  if (target !== document.body) {
    anchor.looks = looksOf(target);
    anchor.rules = rulesOf(target);
    anchor.box = boxOf(target);
    if (!anchor.source && astroSource(target)) anchor.source = short(astroSource(target), 200);
  }
  // A <select>: which option is chosen (its text is every option in a row).
  const select = target.closest?.('select');
  if (select && select.selectedIndex >= 0) {
    anchor.chosen = short(`${select.selectedIndex + 1} of ${select.options.length}: "${select.options[select.selectedIndex].text}"`, 120);
  }
  // Text that CSS adds with ::before / ::after content (a badge, a label): it isn't in the HTML.
  for (const el of [target, target.parentElement]) {
    if (!el || el === document.body) continue;
    for (const which of ['::before', '::after']) {
      const c = getComputedStyle(el, which).content;
      const m = c && c.match(/^"(.+)"$/);
      if (m && m[1].trim()) {
        anchor.cssText = short(`"${m[1]}" from ${which} of ${openingTag(el)}`, 160);
        break;
      }
    }
    if (anchor.cssText) break;
  }
  const build = document.querySelector<HTMLMetaElement>('meta[name="lab-build"]')?.content;
  if (build) anchor.build = short(build, 40);

  // What the pin sits on: media first (even under a transparent overlay), then text, then a background image.
  const media = stack.slice(0, 5).find((n) => /^(img|video|canvas|svg|image)$/.test(n.localName) && !host.contains(n));
  if (media?.localName === 'image' && media.namespaceURI === 'http://www.w3.org/2000/svg') {
    // A picture placed inside an SVG with <image href>: a picture file, not a drawing.
    anchor.kind = 'image';
    anchor.src = new URL(media.getAttribute('href') || media.getAttribute('xlink:href') || '', location.href).href;
    anchor.file = fileHint(anchor.src);
    svgImageSpot(media, anchor, clientX, clientY);
  } else if (media) {
    const r = media.getBoundingClientRect();
    anchor.kind = media.localName === 'img' ? 'image' : media.localName;
    if (media.localName === 'img' || media.localName === 'video') {
      const img = media as HTMLImageElement, video = media as HTMLVideoElement; // the same element, by kind
      anchor.src = mediaSrc(media);
      anchor.file = fileHint(anchor.src);
      if (img.alt) anchor.alt = short(img.alt, 120);
      // Turned or skewed by a CSS transform: undo it, so the spot is measured on the picture itself.
      const local = untransform(media, clientX, clientY);
      const [box, px, py] = local ? [local.rect, local.x, local.y] : [r, clientX, clientY];
      const spot = media.localName === 'img'
        ? naturalSpot(media, box, px, py, fileSize(media).nw, fileSize(media).nh)
        : naturalSpot(media, box, px, py, video.videoWidth, video.videoHeight);
      if (spot) Object.assign(anchor, spot);
      if (local) anchor.transform = short(getComputedStyle(media).transform, 80);
      // An animated picture (GIF, WebP, APNG): how long it had been showing, to find the frame.
      if (media.localName === 'img' && /\.(gif|webp|apng)(\?|#|$)/i.test(img.currentSrc || img.src)) {
        const entry = performance.getEntriesByName(img.currentSrc || img.src)[0] as PerformanceResourceTiming | undefined;
        const since = entry ? (performance.now() - entry.responseEnd) / 1000 : performance.now() / 1000;
        anchor.shownFor = Math.round(since * 10) / 10;
      }
      if (media.localName === 'video') {
        anchor.time = Math.round(video.currentTime * 10) / 10;
        if (Number.isFinite(video.duration)) anchor.duration = Math.round(video.duration * 10) / 10;
        if (!anchor.file && video.poster) anchor.file = fileHint(video.poster);
      }
    } else {
      // canvas / svg animation: when it was, and where inside it.
      anchor.time = Math.round(performance.now() / 100) / 10;
      anchor.imgX = clamp01((clientX - r.left) / (r.width || 1));
      anchor.imgY = clamp01((clientY - r.top) / (r.height || 1));
      anchor.nw = Math.round(r.width);
      anchor.nh = Math.round(r.height);
    }
  } else {
    // Code keeps its quote on a plain click: the line and its number are what an agent opens the file at.
    const inCode = target.closest('pre, [data-file], table[class*="code" i]') || getComputedStyle(target).whiteSpace.startsWith('pre');
    const quote = (words || inCode) && !aside ? quoteAt(clientX, clientY, shadowRoots) : null; // beside the content there are no words under the click
    if (quote) {
      anchor.kind = 'text';
      anchor.quote = quote;
    } else {
      for (let n = target, i = 0; n && n !== document.documentElement && i < 4; n = n.parentElement, i++) {
        const bg = getComputedStyle(n).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        if (bg) {
          anchor.kind = 'background';
          anchor.src = new URL(bg[1], location.href).href;
          anchor.file = fileHint(anchor.src);
          backgroundSpot(n, anchor.src, anchor, clientX, clientY);
          break;
        }
      }
      anchor.kind ||= 'element';
      if (anchor.kind === 'element') {
        const gap = between(target, clientY);
        if (gap) Object.assign(anchor, { gapAbove: gap.above, gapBelow: gap.below });
      }
    }
  }
  Object.assign(anchor, schemeAt(target));
  if (target !== document.body) anchor.fp = fingerprint(target);
  if (aside) anchor.sx = Math.round(aside);
  return anchor;
}

// The content a click in the page's side margin is level with: the nearest box of the page (a child of body) whose top
// and bottom hold the click's height and that the click is beside, and what stands at its edge there (past its padding),
// as a block (not a word of it). Null when none is (the click is above or below the page's content).
function sideOf(x: number, y: number): { x: number; stack: Element[] } | null {
  let best: { d: number; r: DOMRect; c: Element; left: boolean } | null = null;
  for (const c of document.body.children) {
    if (c === host || host.contains(c)) continue;
    const r = c.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d && r.width && r.height && y >= r.top && y <= r.bottom && (!best || d < best.d)) best = { d, r, c, left: x < r.left };
  }
  if (!best) return null;
  const pad = parseFloat(getComputedStyle(best.c)[best.left ? 'paddingLeft' : 'paddingRight']) || 0;
  const px = best.left ? best.r.left + pad + 1 : best.r.right - pad - 1;
  const stack = document.elementsFromPoint(px, y).filter((n) => n !== host && n !== document.documentElement);
  if (!best.c.contains(stack[0])) return null;
  // Not on a word of the line (an inline element, a link or a bold word): on the block holding it.
  while (stack.length > 1 && stack[0] !== best.c && getComputedStyle(stack[0]).display === 'inline' && !/^(img|video|canvas|svg|image|iframe)$/.test(stack[0].localName)) stack.shift();
  return { x: px, stack };
}

// What a pin keeps of the page around its element: the box with an id or data-lab it sits in, the heading above it, and
// the nearest element with an id (its block).
function around(target: Element): Pick<Anchor, 'inside' | 'section' | 'block'> {
  const out: Pick<Anchor, 'inside' | 'section' | 'block'> = {};
  const inside = target.parentElement?.closest<HTMLElement>('[id], [data-lab]');
  if (inside) out.inside = inside.dataset.lab ? `[data-lab="${inside.dataset.lab}"]` : `#${inside.id}`;
  const section = sectionIn(target);
  if (section) out.section = section;
  for (let b: Element | null = target; b && b !== document.body && b !== document.documentElement; b = b.parentElement) {
    if (b.id) {
      out.block = b.id;
      break;
    }
  }
  return out;
}

// An agent's pin (labit pin) is made from a selector alone. Drawn in a browser and found, it learns what a person's pin
// carries (the element's tag, its words, its heading and box), so it is found again after the agent edits the page.
// Null when its element is not found.
export function fillAt(anchor) {
  const node = findTarget(anchor);
  if (!node) return null;
  const out: Partial<Anchor> = { ...placeOf(node, anchor), element: openingTag(node), ...around(node), fp: fingerprint(node) };
  if (node !== document.body && (node.textContent || '').length < 400 && !anchor.quote) out.text = short(node.textContent, 80);
  return out;
}

// The heading of the section an element sits in: the nearest heading before it or before a box around it (a heading
// rules the blocks that follow it in its parent, not whatever comes after it in the page).
const lead = (e: Element | null): string => {
  const m = read().lead;
  if (e && !m.has(e)) m.set(e, e.matches('h1, h2, h3, h4, h5, h6') ? short(e.textContent, 100) : lead(e.previousElementSibling));
  return (e && m.get(e)) || '';
};
function sectionIn(n: Element) {
  for (let e: Element | null = n; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const s = lead(e.previousElementSibling);
    if (s) return s;
  }
  return '';
}
// Is the element in the section a pin saved? Pins made before sections were read by scope saved the last h1–h3 before it.
const inSection = (n: Element, section: string) => {
  let last = '';
  for (const h of (read().heads ||= [...document.querySelectorAll('h1, h2, h3')])) if (h.compareDocumentPosition(n) & 4) last = short(h.textContent, 100); else break;
  return sectionIn(n) === section || last === section;
};

// What proves an element is the one a pin was put on. Saved with the pin: a hash of its words (h) and their first 80
// letters (t), how many elements of its tag said exactly the same (u) and which of them it was (k), and its company: what
// the box around it says besides it, as a hash (x) read l boxes up, and which it was among the look-alikes in that
// company (o: its place and their number). What stands beside it (b: the first words of the element before and after it),
// and whether that tells identical twins apart (a); r: what the look-alikes around it say, s: how many say nearly the same.
type Fp = { h: string; t: string; u: number; k: number; x: string; l: number; o: [number, number]; b?: string; a?: 1; r?: string[]; s?: number };
/** What was found for a pin: the element (null: lost), whether it is proven (sure), or a guess of look-alikes (alike). */
type Proof = { node: Element | null; sure?: boolean; alike?: boolean };
// One read of the page, shared by every pin until the page changes (a MutationObserver says so; takeRecords makes it
// true at once too, in the same task): each element's words, the elements by tag and by words, and each pin's proof.
type Read = { words: Map<Element, string>; tags: Map<string, Element[]>; said: Map<string, Map<string, Element[]>>; got: WeakMap<object, Proof>; lead: Map<Element, string>; heads?: Element[]; roots?: ShadowRoot[] };
let seen: Read | null = null;
let watch: MutationObserver | null = null;
// What names an element that has no words (a field, an icon button, a picture: with its file's name).
const NAMING = ['alt', 'aria-label', 'placeholder', 'name', 'title', 'for', 'href', 'type'];
const WATCH: MutationObserverInit = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: NAMING };
const read = (): Read => {
  watch ||= new MutationObserver(() => (seen = null));
  if (!seen) watch.observe(document, WATCH);
  else if (watch.takeRecords().length) seen = null;
  return (seen ||= { words: new Map(), tags: new Map(), said: new Map(), got: new WeakMap(), lead: new Map() });
};
const words = (n: Element): string => {
  const w = read().words;
  let t = w.get(n);
  if (t === undefined) w.set(n, (t = short(n.textContent, Infinity) || [...NAMING.map((a) => n.getAttribute(a)), /^(img|video)$/.test(n.localName) && fileHint(mediaSrc(n))].filter(Boolean).join('|')));
  return t;
};
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
// The page's open web components' shadow roots (nested ones too), watched for changes like the page.
const shadows = (): ShadowRoot[] => {
  const r = read();
  if (!r.roots) {
    const out: ShadowRoot[] = [];
    const scan = (n: ParentNode) => {
      for (const e of n.querySelectorAll('*')) {
        if (!e.shadowRoot || e === host) continue;
        out.push(e.shadowRoot);
        watch!.observe(e.shadowRoot, WATCH);
        scan(e.shadowRoot);
      }
    };
    scan(document.body);
    r.roots = out;
  }
  return r.roots;
};
const kin = (tag: string): Element[] => {
  const t = read().tags;
  if (!t.has(tag)) t.set(tag, [...document.body.getElementsByTagName(tag), ...shadows().flatMap((r) => [...r.querySelectorAll(tag)])].filter((n) => !host.contains(n)));
  return t.get(tag)!;
};
// An element's parent, a web component's host for the first element inside its shadow root.
const up = (e: Element): Element | null => e.parentElement || (e.getRootNode() as ShadowRoot).host || null;
// The elements of a tag that say exactly these words (by hash), in page order.
const saying = (tag: string, h: string): Element[] => {
  const s = read().said;
  if (!s.has(tag)) {
    const m = new Map<string, Element[]>();
    for (const n of kin(tag)) {
      const k = hash(words(n));
      (m.get(k) || m.set(k, []).get(k)!).push(n);
    }
    s.set(tag, m);
  }
  return s.get(tag)!.get(h) || [];
};
// What the box around an element says besides it, as a hash: the level-th ancestor (up to 6 up) that says more.
// Nothing ('') when there is none or it says too much to tell one thing from another.
const company = (n: Element, level = 1) => {
  const own = words(n);
  for (let e = n.parentElement, i = 0; e && e !== document.body && i < 6; e = e.parentElement, i++) {
    const t = words(e);
    if (t !== own && t.length > own.length && !--level) return t.length > 600 ? '' : hash(t.replace(own, '').trim());
  }
  return '';
};
// The first words of the elements before and after one (an only child asks its parent's, up to 3 up).
const beside = (n: Element) => {
  for (let e: Element | null = n, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++)
    if (e.previousElementSibling || e.nextElementSibling) return [e.previousElementSibling, e.nextElementSibling].map((x) => (x ? words(x).slice(0, 40) : '')).join('\u0001');
  return '';
};
/** What a pin saves about its element so it can be proven again. */
function fingerprint(n: Element): Fp {
  const t = words(n);
  const same = saying(n.localName, hash(t));
  let l = 1, x = company(n), eq = same.filter((m) => company(m) === x);
  for (let i = 2; i < 4 && eq.length > 1; i++) {
    const c = company(n, i), e = same.filter((m) => company(m, i) === c);
    if (c && e.length < eq.length) [l, x, eq] = [i, c, e];
  }
  const b = beside(n), near = kin(n.localName), i = near.indexOf(n);
  // r: what the look-alikes around it say (the few before and after it in the page): they are not it.
  const r = [...new Set(near.slice(Math.max(0, i - 4), i + 5).filter((m) => m !== n && words(m) !== t && words(m)).map((m) => hash(words(m)).slice(0, 4)))];
  const s = near.slice(0, 400).filter((m) => m !== n && words(m) !== t && alike(t.slice(0, 80), words(m).slice(0, 80)) >= 0.8).length; // others that say nearly the same: edited words can't be told from those
  return { h: hash(t), t: t.slice(0, 80), u: same.length, k: same.indexOf(n), x, l, o: [eq.indexOf(n), eq.length], ...(b ? { b } : {}), ...(eq.length > 1 && eq.filter((m) => beside(m) === b).length === 1 ? { a: 1 } : {}), ...(r.length ? { r } : {}), ...(s ? { s } : {}) };
}
// How alike two texts are, 0 to 1: the same; one starts with the other; the old words inside the new; else the share of
// their letter pairs they have in common (a typo costs little).
const alike = (a: string, b: string) => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  let k = 0, e = 0, hit = 0;
  while (k < a.length && a[k] === b[k]) k++;
  while (e < Math.min(a.length, b.length) - k && a[a.length - 1 - e] === b[b.length - 1 - e]) e++; // one edit in between: a typo, a swapped word
  const m = new Map<string, number>();
  for (let i = 1; i < a.length; i++) m.set(a.slice(i - 1, i + 1), (m.get(a.slice(i - 1, i + 1)) || 0) + 1);
  for (let i = 1; i < b.length; i++) {
    const g = b.slice(i - 1, i + 1), c = m.get(g);
    if (c) {
      m.set(g, c - 1);
      hit++;
    }
  }
  return Math.max((1.8 * hit) / (a.length + b.length - 2), k >= Math.min(a.length, 40) ? 0.85 : (0.9 * (k + e)) / Math.max(a.length, b.length), a.length > 3 && b.includes(a) ? 0.8 : 0);
};
// A pin from before fingerprints stands in with what it saved: its words (all of them when short), its tag and path.
const standIn = (a): Fp => {
  const t = a.text || (a.file ? [a.alt, a.file].filter(Boolean).join('|') : '');
  return { h: t && t.length < 80 ? hash(t) : '', t, u: 1, k: 0, x: '', l: 1, o: [0, 1] };
};
// The elements a pin might be on, scored by what they say, who stands beside them, the box around them, their kind, their
// path and their section. Sure only when the best is clearly ahead and says what it said (in its company, when others
// said it too); a guess (told to the agent) when it stands in its old place with other words; else lost.
const SURE = 0.78, LOW = 0.5, GAP = 0.06;
type Scored = { c: Element; s: number; T: number | null; X: number | null; N: number | null; Q: number; veto: boolean };
function search(a, fp: Fp, at: Element | null, tag: string, co: (n: Element) => boolean): Proof {
  const u = fp.u || 1;
  const sq = (s: string) => s.replace(/\s+/g, '');
  const want = (/ class="([^"]*)"/.exec(a.element || '')?.[1] || '').split(/\s+/).filter(Boolean);
  const wantId = / id="([^"]*)"/.exec(a.element || '')?.[1] || '';
  const steps = String(a.selector || '').split(/ >{1,3} /).filter((s) => s !== 'body').reverse();
  const [was0, was1] = (fp.b || '').split('\u0001');
  const side = (was: string, now: string) => (was ? alike(was, now) : Number(!now));
  const nth = (e: Element) => [...((e.parentNode as ParentNode | null)?.children || [])].filter((x) => x.localName === e.localName).indexOf(e) + 1;
  const score = (c: Element): Scored => {
    let sum = 0, tot = 0;
    const add = (w: number, v: number) => ((sum += w * v), (tot += w), v);
    const t = words(c);
    const T = fp.t ? add(4 / u, fp.h === hash(t) ? 1 : Math.min(0.97, alike(fp.t, t.slice(0, Math.max(80, fp.t.length))))) : null;
    const q = a.quote?.exact && sq(a.quote.exact).slice(0, 24);
    let Q = 0;
    if (q) {
      const all = sq(c.textContent || ''), pr = sq(a.quote.prefix || '').slice(-12), su = sq(a.quote.suffix || '').slice(0, 12);
      Q = add(8 / u, all.includes(pr + q + su) ? 1 : (all.includes(pr + q) || all.includes(q + su)) && (pr || su) ? 0.75 : pr.length > 5 && su.length > 5 && all.includes(pr) && all.indexOf(su, all.indexOf(pr)) > 0 ? 0.6 : all.includes(q) ? (q.length > 15 ? 0.7 : 0.35) : 0);
    }
    const [now0, now1] = beside(c).split('\u0001');
    const N = fp.b ? add(2.5, (side(was0, now0 || '') + side(was1 ?? '', now1 || '')) / 2) : null;
    const X = fp.x ? add(1.5 + 4 * (1 - 1 / u), Number(co(c))) : null;
    const cl = [...c.classList].filter((x) => !generated(x)), both = want.filter((x) => cl.includes(x)).length;
    add(1.5, (c.localName === tag ? 0.5 : 0) + 0.3 * (want.length + cl.length - both ? both / (want.length + cl.length - both) : 1) + 0.2 * Number((c.id || '') === wantId));
    let hit = 0, n = 0;
    for (let e: Element | null = c; n < steps.length && n < 6; e = e && up(e), n++) {
      const m = /^([\w-]+):nth-of-type\((\d+)\)/.exec(steps[n]);
      hit += !e ? 0 : m ? (e.localName === m[1] ? (nth(e) === +m[2] ? 1 : 0.6) : 0) : Number(e.matches(steps[n]));
    }
    add(1.5, c === at ? 1 : n ? (0.9 * hit) / n : 0);
    if (a.section) add(0.5, Number(inSection(c, a.section)));
    // It says what an element beside the pin said: it is that one.
    const veto = T !== 1 && Boolean(t) && (Boolean(fp.r?.includes(hash(t).slice(0, 4))) || (was0 !== was1 && (t.slice(0, 40) === was0 || t.slice(0, 40) === was1)));
    return { c, s: (tot ? sum / tot : 0) * (veto ? 0.5 : 1), T, X, N, Q, veto };
  };
  const rank = (l: Iterable<Element>) => [...l].filter((c) => !host.contains(c) && c !== document.body).map(score).sort((x, y) => y.s - x.s);
  // No words to go by (a long element's pin from before fingerprints) and the page named it (its path is just its id): it.
  if (!fp.t && at && !a.selector.includes(' ')) return { node: at, sure: true };
  let list = kin(tag);
  if (list.length > 400) {
    const i = at ? list.indexOf(at) : Math.round((a.docY / Math.max(1, document.documentElement.scrollHeight)) * list.length);
    list = list.slice(Math.max(0, i - 200), i + 200);
  }
  let ranked = rank(new Set(at ? [...list, at] : list));
  // Nothing of its kind says its words (its tag was changed, or it was wrapped): any element that does, the innermost.
  if (fp.t.length > 3 && !ranked.some((r) => (r.T ?? 0) >= 0.9 && !r.veto && (u < 2 || r.X === 1))) {
    const bound = fp.t.length < 80 ? 2 * fp.t.length + 24 : Infinity;
    let more = [...document.body.querySelectorAll('*')].filter((c) => c.localName !== tag && !host.contains(c) && words(c).length < bound && alike(fp.t, words(c).slice(0, Math.max(80, fp.t.length))) >= 0.8);
    more = more.filter((c) => !more.some((d) => d !== c && c.contains(d)));
    if (more.length && more.length < 40) ranked = [...ranked, ...rank(more)].sort((x, y) => y.s - x.s);
  }
  const cls = (c: Element) => want.filter((x) => c.classList.contains(x)).length;
  const secOk = (r: Scored) => !a.section || inSection(r.c, a.section);
  const ok = ranked.filter((r) => !r.veto && (fp.t || secOk(r)) && !ranked.some((d) => d !== r && !d.veto && d.T === r.T && words(d.c) === words(r.c) && (r.c.contains(d.c) ? cls(d.c) >= cls(r.c) : d.c.contains(r.c) && cls(d.c) > cls(r.c))));
  const top = ok[0];
  if (!top) return { node: null };
  const isAt = (r: Scored) => r.c === at;
  // Its company: the box around it says what it said, or it stands at its path between the same neighbours.
  const mine = (r: Scored) => (r.X ?? 0) >= 0.9 || (isAt(r) && (r.N ?? 0) >= 0.9) || (r.X === null && r.N === null && isAt(r));
  const clear = top.s - (ok[1]?.s ?? 0) >= GAP;
  const near = (r: Scored) => (r.T ?? 0) >= 0.9 || (fp.t.length > 3 && words(r.c).includes(fp.t));
  if (top.s >= SURE && clear && !(u > 1 && top.T === 1 && top.c.localName === tag) && (top.c.localName === tag || mine(top) || fp.t.length >= 20) && (fp.t ? (near(top) && (u < 2 || mine(top))) || ((top.T ?? 0) >= 0.5 && isAt(top) && mine(top)) : mine(top))) return { node: top.c, sure: true };
  // The same place with other words (rewritten where it stood): the element at its path in its company, or the only one between its two neighbours.
  const old = fp.t.match(/\w{3,}/g) || [];
  const kept = (r: Scored) => (r.T ?? 0) >= 0.5 || !old.length || old.filter((w) => words(r.c).includes(w)).length * 3 >= old.length || r.Q >= 0.35 || (!a.fp && !a.file && secOk(r)); // a third of its old words (a new element in its place says none)
  const inPlace = ok.filter((r) => kept(r) && ((isAt(r) && (mine(r) || (r.T ?? 0) >= 0.6)) || ((r.N ?? 0) >= 1 && was0 && was1) || (u > 1 && (r.X ?? 0) >= 0.9 && r.c.localName === tag)));
  const own = inPlace.filter(secOk); // a twin in another section is not it
  if (own.length && (own.length === 1 || isAt(own[0])) && own[0].s >= LOW) return { node: (own.find(isAt) || own[0]).c };
  // Its own words (nobody else's), partly, somewhere else in its section.
  return top.s >= LOW && (top.T ?? 0) >= 0.75 && u < 2 && !fp.s && clear && kept(top) && (!a.section || inSection(top.c, a.section)) ? { node: top.c } : { node: null };
}

// The element a pin is on, but only when its fingerprint proves it: sure (the same words, the same company, as many
// look-alikes as before: wherever it went), or shown where its words or its place say it is and told to the agent (a
// guess). Never an element only because it came to sit at the old path.
function prove(a): Proof {
  let at: Element | null = null;
  try {
    at = query(a.selector);
  } catch {}
  const tag = /^<([\w-]+)/.exec(a.element || '')?.[1] || at?.localName || '';
  if (at && (at === document.body || at.localName !== tag || host.contains(at))) at = null;
  const fp: Fp = a.fp || standIn(a);
  const co = (n: Element) => Boolean(fp.x) && company(n, fp.l) === fp.x;
  const sure = (node: Element | null): Proof => ({ node, sure: true });
  const guess = (node: Element | null | undefined, alike = false): Proof => ({ node: node || null, alike });
  // Of a few look-alikes, the one nearest to where the pin was (told as unsure: nothing else tells them apart).
  const near = (l: Element[]) => (l.length < 9 ? l.map((n) => [Math.abs(n.getBoundingClientRect().top + scrollY - (a.docY || 0)), n] as const).sort((x, y) => x[0] - y[0])[0]?.[1] : null);
  // A pin from before fingerprints, its element at its path still says its words: as before (it gets a fingerprint then).
  if (!a.fp && at && fp.t && words(at).startsWith(fp.t.slice(0, 40))) return sure(at);
  const ex = fp.h ? saying(tag, fp.h) : [];
  const set = fp.x ? ex.filter(co) : ex;
  const apart = set.filter((n) => beside(n) === fp.b);
  // Its exact words. Only it said them, and one element says them now: that one, wherever it went. Several say them (it
  // said them too, or a copy came): the one in its company (and, among twins, the one between the same neighbours);
  // twins nothing tells apart, as many as there were: its place among them.
  const byWords: Proof | false =
    fp.u < 2 && ex.length < 2 ? sure(ex[0])
    : fp.o[1] < 2 && set.length === 1 ? { node: set[0], sure: fp.u > 1, alike: fp.u < 2 }
    : fp.a && fp.o[1] > 1 && apart.length === 1 ? sure(apart[0])
    : set.length === fp.o[1] && fp.o[1] > 1 ? { node: set[fp.o[0]], sure: !fp.a || set[fp.o[0]] === at, alike: Boolean(fp.a) && set[fp.o[0]] !== at }
    : set.length ? guess(set.find((n) => n === at), true)
    : guess(ex.length === fp.u ? ex[fp.k] : ex.find((n) => n === at), true);
  if (byWords && byWords.node) return byWords;
  const found = tag && tag !== 'body' && tag !== 'html' ? search(a, fp, at, tag, co) : { node: at };
  // Nothing else, and its words came to stand on several elements (a copy): the one nearest to where it was, told as unsure.
  return found.node || fp.u > 1 ? found : guess(near(set.length ? set : ex), true);
}
const proof = (a): Proof => {
  const got = read().got;
  if (!got.has(a)) got.set(a, prove(a));
  return got.get(a)!;
};

export const findTarget = (anchor) => proof(anchor).node;

// A pin kept at its old spot never sits below the page's end (the page got shorter, say after a cleanup): it moves up
// to just above the end, so it doesn't make the page longer. The end is the page's own content, not the pins' layer.
export let pageEnd = { at: -Infinity, y: 0 }; // never fresh at first: a pin drawn in the page's first 300 ms sat at the top
export const inPage = (y, h = 0) => {
  if (performance.now() - pageEnd.at > 300) {
    const bottoms = [...document.body.children].filter((c) => c !== host && !host.contains(c)).map((c) => c.getBoundingClientRect().bottom + scrollY);
    pageEnd = { at: performance.now(), y: Math.max(innerHeight, ...bottoms) };
  }
  return Math.max(0, Math.min(y, pageEnd.y - h - 40));
};
// An area's pin sits at the corner where the drag ended (where you let go), not where it started.
const pinOf = (zone, anchor) => ({ left: zone.left + (anchor.pinX ? zone.width : 0), top: zone.top + (anchor.pinY ? zone.height : 0) });
// A pin whose spot changed waits beside the content at the height it had, small and faded, out of the content's way
// (it pointed at something that's gone, so its old x means nothing now). Opening it still shows its old area.
// "Beside the content" is the gutter just left of what it sat in: the nearest box in its selector that is still on the
// page, else the page's own content. It used to be the window's left edge, which on a wide window with a centred
// column is hundreds of px from anything people look at: such pins read as lost. EDGE is the least it can be, so on a
// phone, or a page that fills the window, it is where it was.
const EDGE = 10;
const GUTTER = 30; // a moved pin is 22 px wide: its right side stops 8 px short of the content
// The nearest box of a pin's path that is still on the page and passes `keep`.
function holder(anchor, keep: (n: Element) => boolean): Element | null {
  const parts = String(anchor?.selector || '').split(' > ');
  while (parts.length > 1) {
    parts.pop();
    let node: Element | null = null;
    try {
      node = query(parts.join(' > '));
    } catch {}
    if (node && !/^(html|body)$/.test(node.localName) && !host.contains(node) && keep(node)) return node;
  }
  return null;
}
function edgeFor(anchor) {
  const beside = (rect) => Math.max(EDGE, Math.round(rect.left + scrollX - GUTTER));
  const box = holder(anchor, (n) => n.getBoundingClientRect().width > 0);
  if (box) return beside(box.getBoundingClientRect());
  const boxes = [...document.body.children]
    .filter((c) => c !== host && !host.contains(c))
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  return boxes.length ? beside({ left: Math.min(...boxes.map((r) => r.left)) }) : EDGE;
}
export function position(anchor) {
  const at = spotOf(anchor);
  // Why a pin is not plainly on its spot, for its look and its card: lost (a ghost stays where it stood), hidden (not shown
  // right now: it is not lost), or a guess (unsure: look-alikes; changed: its words).
  const doubt = (): 'unsure' | 'changed' | undefined => {
    const { node, sure, alike } = anchor.element && anchor.selector ? proof(anchor) : ({} as Proof);
    return node && !sure ? (alike ? 'unsure' : 'changed') : undefined;
  };
  if (at.moved) return { ...at, from: at.left, left: edgeFor(anchor), why: 'lost' };
  if (anchor.kind === 'board') return at;
  // A page's board view covers what is under it: the page's pins there hide (overlay.ts).
  const covered = coveredAt(at.left - scrollX, at.top - scrollY); // told apart, so a scroll under the view only asks this again
  return { ...at, covered, why: at.hidden ? 'hidden' : doubt(), clipped: covered || at.hidden || clippedAt(findTarget(anchor), at.left - scrollX - (anchor.sx || 0), at.top - scrollY) }; // a pin beside its line: its line's spot is what a scroll box hides
}
/** A pin whose tip is at this screen point is under a page's board view: its tip, or its far corner (a pin with its tip
 * just past the view's edge still lay over the board). */
export function coveredAt(x: number, y: number) {
  const covers = (window as unknown as { __labBoard?: { covers?: (x: number, y: number) => boolean } }).__labBoard?.covers;
  return Boolean(covers && (covers(x, y) || covers(x + 28, y - 28)));
}
// A pin whose spot a box with overflow cut off (panned or scrolled out of a canvas, a carousel, a scroll box) hides
// until its spot is back in view, instead of floating over the page outside that box.
function clippedAt(node, x, y) {
  for (let el = node?.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (getComputedStyle(el).overflow === 'visible') continue;
    const r = el.getBoundingClientRect();
    if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) return true;
  }
  return false;
}
// Where a pin on quoted words sits: on the piece of them (one per line) nearest to where it was in its element, at
// that spot when it's still on the words, else at the nearest point of them. So an unchanged page keeps the pin
// exactly where it was put, and words that moved inside the element take the pin with them.
function onWords(range, anchor, rect) {
  const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
  if (!rects.length) return null;
  const gx = rect.left + (anchor.x || 0) * rect.width;
  const gy = rect.top + (anchor.y || 0) * rect.height;
  const pull = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const far = (r) => Math.hypot(gx - pull(gx, r.left, r.right), gy - pull(gy, r.top, r.bottom));
  let at = rects[rects.length - 1]; // the last piece (where a selection ended) wins a tie
  for (const r of rects) if (far(r) < far(at)) at = r;
  // A click on a line of code, in the leading of the line (the space the line-height leaves above and below the
  // letters): there it stays, as clicked; the nearest point of the words moved it up or down by a few px. (Selected
  // words keep to the words: a pin made by selecting them follows them.)
  if (anchor.quote?.line && far(at) <= 6) return { left: gx + scrollX, top: gy + scrollY };
  return { left: pull(gx, at.left, at.right) + scrollX, top: pull(gy, at.top, at.bottom) + scrollY };
}
// Pin point (the zone's top-left corner for area comments) and, for areas, the zone box, in page coordinates.
// A pin in the margin beside its element's line: that many px out from it, kept on the page (a window too narrow for a
// margin puts it at the page's edge instead of off it).
const sideLeft = (left: number, anchor): number => (anchor.sx ? Math.min(Math.max(left + anchor.sx, 4), document.documentElement.clientWidth - 4) : left);
function spotOf(anchor): Spot {
  if (anchor.kind === 'board') {
    // A board pin on a page shows only while that board is open in it (overlay.ts); the list still has it.
    const board = (window as unknown as { __labBoard?: { name?: string; spot: (a: unknown) => Spot } }).__labBoard;
    return board && (!anchor.board || !board.name || board.name === anchor.board) ? board.spot(anchor) : { left: 0, top: 0, zone: null, clipped: true };
  }
  if (anchor.gone) return { left: anchor.docX * docWidth(), top: inPage(anchor.docY, anchor.docH || 0), zone: null, moved: true }; // the agent said its spot was removed (labit pin gone)
  const node = findTarget(anchor);
  // On the page but not shown (a closed details or tab, display:none): hidden, not lost. It comes back with its element.
  if (node && node.checkVisibility?.() === false) return { left: anchor.docX * docWidth(), top: inPage(anchor.docY, anchor.docH || 0), zone: null, hidden: true };
  const hasWords = anchor.quote?.exact;
  // Words straight in the page (findTarget never returns the page itself): looked for in the whole page.
  const box = node || (hasWords && /^<(body|html)[\s>]/.test(anchor.element || '') ? document.body : null);
  const big = box && !anchor.zw && !anchor.docW && /^(html|body|main)$/.test(box.localName);
  // A pin on a big container (the page's body or main) is placed by a share of its size, which drifts when content is
  // added above. If it was on words, find them again and sit on them; if they're gone, say so (the pin shows faded as
  // moved) instead of pointing at whatever is there now.
  if (big && hasWords) {
    const range = quoteRange(anchor, box, true);
    const spot = range && onWords(range, anchor, box.getBoundingClientRect());
    return spot ? { ...spot, zone: null } : { left: anchor.docX * docWidth(), top: inPage(anchor.docY), zone: null, moved: true };
  }
  if (node && !anchor.zw && (anchor.gapAbove || anchor.gapBelow)) {
    const rect = node.getBoundingClientRect();
    const top = gapTop(anchor, node, rect);
    if (top !== null) return { left: sideLeft(rect.left + scrollX + anchor.x * rect.width, anchor), top: top + scrollY, zone: null };
  }
  // On a big container with no word to find: if the container's height changed since, the share of it no longer points
  // at the same thing, so the pin keeps its old place and shows faded as moved rather than pointing at something else.
  if (big && anchor.eh && !hasWords) {
    if (Math.abs(node.getBoundingClientRect().height - anchor.eh) > 40) return { left: anchor.docX * docWidth(), top: inPage(anchor.docY), zone: null, moved: true };
  }
  if (node) {
    const rect = node.getBoundingClientRect();
    // A pin on words sits on those words, wherever they went inside the element; its share of the element only
    // when they can't be found.
    const range = anchor.kind === 'text' && !anchor.zw && anchor.quote?.exact ? quoteRange(anchor, node) : null;
    const words = range && onWords(range, anchor, rect);
    if (words) return { ...words, zone: null };
    if (rect.width || rect.height) {
      const left = sideLeft(rect.left + scrollX + anchor.x * rect.width, anchor);
      // An area on a box much taller than itself (a section, the page) keeps its px offset and size: as a share of the
      // box it jumped onto other text when pictures above it loaded or the page grew.
      const tall = anchor.zw && Number.isFinite(anchor.oy) && anchor.docH && rect.height > 2 * anchor.docH;
      const top = rect.top + scrollY + (tall ? anchor.oy : anchor.y * rect.height);
      const zone = anchor.zw ? { left, top, width: anchor.zw * rect.width, height: tall ? anchor.docH : anchor.zh * rect.height } : null;
      return zone ? { ...pinOf(zone, anchor), zone } : { left, top, zone };
    }
  }
  // Its element is gone: its words may still be on the page.
  const words = !box && hasWords && !anchor.docW && wordsOnPage(anchor);
  if (words) return { ...words, zone: null };
  const left = anchor.docX * docWidth();
  const top = inPage(anchor.docY, anchor.docH || 0);
  // Not built at the moment (a long scroll box builds only the rows in view): not here now is not gone.
  const tag = /^<([\w-]+)/.exec(anchor.element || '')?.[1] || '';
  if (!node && tag && holder(anchor, (n) => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > 1.5 * n.clientHeight && n.getElementsByTagName(tag).length > 4)) return { left, top, zone: null, hidden: true };
  const zone = anchor.docW ? { left, top, width: anchor.docW, height: anchor.docH } : null;
  if (zone) return { ...pinOf(zone, anchor), zone, moved: Boolean(anchor.selector) && anchor.selector !== 'body' };
  // Anchored to the page itself (a margin, or an area wider than any element): nothing has moved.
  return { left, top, zone, moved: Boolean(anchor.selector) && anchor.selector !== 'body' };
}

// A pin whose element is gone, by its words. Sure when they stand once on the page between the same words as before
// (or are long, and stand once). Else the nearest look-alike within two screens of where the pin was (the same words in
// other company, or other words in the same company) is a guess: the pin waits beside it, shown as moved.
function wordsOnPage(anchor, fresh = false) {
  const squash = (t) => (t || '').replace(/\s+/g, '');
  const [pre, want, post] = [squash(anchor.quote.prefix).slice(-12), squash(anchor.quote.exact), squash(anchor.quote.suffix).slice(0, 12)];
  const { text, at } = lettersOf(document.body, fresh);
  const all = (s, out = []) => {
    for (let i = text.indexOf(s); s && i !== -1 && out.length < 50; i = text.indexOf(s, i + 1)) out.push(i);
    return out;
  };
  let stale = false; // the page's text changed since it was read (less than a moment ago): read it again
  const spot = (i, n) => {
    try {
      const range = document.createRange();
      range.setStart(...at[i]);
      range.setEnd(at[i + n - 1][0], at[i + n - 1][1] + 1);
      const r = range.getClientRects()[0];
      stale ||= !at[i][0].isConnected;
      return r && { left: r.left + scrollX + Math.min(6, r.width / 2), top: r.top + scrollY + r.height / 2 };
    } catch {
      stale = true;
    }
  };
  const sure = (anchor.fp ? pre.length + post.length > 19 : pre || post) || want.length > 15 ? all(pre + want + post) : []; // a pin with a fingerprint needs words around them to be sure
  let best: { left: number; top: number; moved?: boolean } | null | undefined = sure.length === 1 ? spot(sure[0] + pre.length, want.length) : null;
  const company = pre.length > 5 && post.length > 5 ? all(pre).map((i) => [i + pre.length, text.indexOf(post, i + pre.length) - i - pre.length]).filter(([, n]) => n > 0 && n < want.length * 2 + 20) : [];
  let near = 2 * innerHeight;
  for (const [i, n] of best ? [] : [...all(want).map((i) => [i, want.length]), ...company]) {
    const s = spot(i, n);
    if (s && Math.abs(s.top - anchor.docY) < near) [best, near] = [{ ...s, moved: true }, Math.abs(s.top - anchor.docY)];
  }
  return stale && !fresh ? wordsOnPage(anchor, true) : best;
}

// A pin found again: what the widget saves, so the next look and the agent's text start from there. Where it is now (its
// path and place) when it is on another element than its path leads to, and, when it is proven (sure), what it is now:
// its fingerprint, tag, words, heading and box, so the next edit is measured from this one. A pin from before
// fingerprints gets its own the first time its path and words agree. Null when nothing differs, or when the find is in
// another section than the pin's own and not proven (never saved silently).
export function foundAt(anchor) {
  const { node, sure } = proof(anchor);
  let at = null;
  try {
    at = query(anchor.selector);
  } catch {}
  if (!node || (anchor.section && !sure && !inSection(node, anchor.section))) return null;
  const now: Partial<Anchor> = sure || (!anchor.fp && node === at && words(node).startsWith(short(anchor.text, 40))) ? { ...around(node), element: openingTag(node), fp: fingerprint(node), ...(node.textContent!.length < 400 && !anchor.quote ? { text: short(node.textContent, 80) } : {}) } : {};
  return node === at && !Object.entries(now).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(anchor[k])) ? null : { ...placeOf(node, anchor), ...now };
}
// Where a pin sits on its element, as the lab keeps it: the element's path, its place on the page, its height.
function placeOf(node, anchor) {
  const rect = node.getBoundingClientRect();
  return { selector: selectorFor(node), docX: clamp01(sideLeft(rect.left + scrollX + anchor.x * rect.width, anchor) / docWidth()), docY: Math.round(rect.top + scrollY + anchor.y * rect.height), eh: Math.round(rect.height) };
}

// A pin whose words or element were changed or removed on the page (the agent edited the file; a hot patch): what it said
// and where it sits now, for the widget to tell the lab, so the agent's next wait says it ("check it still fits, or
// re-pin"). Null when its words are still there. The pin itself stays open and where findTarget puts it.
export function spotChanged(anchor) {
  if (!anchor.selector || anchor.kind === 'board' || anchor.kind === 'page') return null;
  const was = short(anchor.quote?.exact || anchor.text || anchor.zoneText || anchor.fp?.t || '', 80);
  const { node, sure, alike } = proof(anchor);
  if (!node) return position(anchor).moved && was ? { was, gone: true } : null;
  if (sure && (!anchor.quote?.exact || quoteRange(anchor, node, true))) return null; // its quoted words are still there too
  const now = sectionIn(node);
  return { was, now: short(node.textContent, 80), element: openingTag(node), ...(alike ? { alike: true } : {}), ...(anchor.section && !inSection(node, anchor.section) ? { away: true, in: now } : {}) };
}

// An element's letters without spaces, each with its text piece and place in it; read once per moment and shared by
// the pins in it (pins on the page itself each read the whole page).
let letters = new WeakMap<Node, { when: number; text: string; at: [Text, number][] }>();
/** The page's words were changed by the widget itself (a question's choice tried in place, thread.ts): read them again. */
export const forgetLetters = () => void ((letters = new WeakMap()), (seen = null));
function lettersOf(node, fresh = false) {
  const had = letters.get(node);
  if (had && !fresh && performance.now() - had.when < 400) return had;
  let text = '';
  const at: [Text, number][] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (host.contains(t.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null)
    for (let i = 0; i < t.data.length; i++) {
      if (/\s/.test(t.data[i])) continue;
      text += t.data[i];
      at.push([t, i]);
    }
  const got = { when: performance.now(), text, at };
  letters.set(node, got);
  return got;
}
// The quoted words of a text comment, found again in the page, for the pin and the highlight (CSS Custom Highlight API:
// nothing in the page's DOM is touched).
// The words are matched with spaces left out, across text pieces, so a quote that runs over several items (Shift +
// select) is found too; the search widens from the pinned element to the few boxes around it.
// strict: only where the words before them match too (a pin on the page itself: the same word elsewhere is not it).
function quoteRange(anchor, node = null, strict = false, fresh = false) {
  const q = anchor?.quote;
  const from = q?.exact ? node || findTarget(anchor) : null;
  if (!from) return null;
  const want = q.exact.replace(/\s+/g, '');
  if (!want) return null;
  const tail = (q.prefix || '').replace(/\s+/g, '').slice(-12);
  let stale = false;
  for (let n = from, up = 0; n && up < 4; n = n.parentElement, up++) {
    const { text, at } = lettersOf(n, fresh);
    let first = null;
    for (let i = text.indexOf(want); i !== -1; i = text.indexOf(want, i + 1)) {
      const range = document.createRange();
      try {
        range.setStart(...at[i]);
        const [end, k] = at[i + want.length - 1];
        range.setEnd(end, k + 1);
      } catch {}
      // The page's text changed since it was read (less than a moment ago): read it again.
      if (range.toString().replace(/\s+/g, '') !== want) {
        stale = true;
        continue;
      }
      if (!tail || text.slice(0, i).endsWith(tail)) return range;
      first ||= range;
    }
    if (first && !strict) return first;
  }
  return stale && !fresh ? quoteRange(anchor, from, strict, true) : null;
}
// The quoted words of a text comment as a Range in the page now, or null (a question's choices are tried in their place:
// src/widget/thread.ts). Found as the pin and the highlight find them.
export const quoteRangeOf = (anchor) =>
  quoteRange(anchor) || (anchor?.quote?.exact && /^<(body|html)[\s>]/.test(anchor.element || '') ? quoteRange(anchor, document.body, true) : null);
// A message's name. An agent's session id ("Claude · session 8a296ba1") is left off.
export const nameLine = (name) => el('b', {}, String(name || '').replace(/\s*·\s*session\s+\S+$/i, ''));
// A block named in a message: its heading in view with room above, and outlined for a moment. On the element itself
// (the widget's layer is redrawn as comments arrive, which would drop an outline drawn there).
export function goToBlock(e: Element) {
  const r = e.getBoundingClientRect();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollTo({ top: Math.max(0, r.top + scrollY - 24 - (parseFloat(host.style.getPropertyValue('--lab-sbb')) || 0)), behavior: still ? 'auto' : 'smooth' });
  // A heading wears the half ink of words for a moment, as the bar's names do, not a box (Leo, 19 Nov: "green ink on
  // header not green box after click"): a band under the lower 44 % of each line of its words, green at 30 % (45 % on
  // dark), corners 3 px. In the page's own coordinates, so it scrolls with the heading; gone when it has faded.
  if (/^H[1-6]$/.test(e.tagName)) {
    const range = document.createRange();
    range.selectNodeContents(e);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const green = getComputedStyle(host).getPropertyValue('--_green-fg').trim();
    const ink = document.createElement('div'); // in the widget's shadow root: a page's i, div or * rules don't reach it
    ink.setAttribute('aria-hidden', 'true');
    ink.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646';
    for (const l of range.getClientRects()) {
      if (!l.width || !l.height) continue;
      const b = document.createElement('i');
      b.style.cssText = `position:absolute;left:${l.left + scrollX}px;top:${l.top + scrollY + l.height * 0.526}px;width:${l.width}px;height:${l.height * 0.44}px;border-radius:3px;background:color-mix(in srgb, ${green} ${dark ? 45 : 30}%, transparent)`;
      ink.append(b);
    }
    if (ink.childElementCount) {
      host.shadowRoot!.append(ink);
      const a = ink.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: ms('hold', 2) });
      a.onfinish = a.oncancel = () => ink.remove();
      return;
    }
  }
  const ring = `2px solid ${getComputedStyle(host).getPropertyValue('--_green').trim()}`;
  e.animate([{ outline: ring, outlineOffset: '4px' }, { outline: ring, outlineOffset: '4px', offset: 0.7 }, { outline: '2px solid transparent', outlineOffset: '4px' }], { duration: ms('hold', 2) });
}
// Messages show web addresses as links that open in a new tab, and #some-id, when the page has an element with that
// id, as a link that goes to it there (an agent names the block it placed: "#speed-deeper").
// The widget listens for lab-goto and scrolls (src/comments.js, goToBlock).
// An address of this lab (localhost, 127.0.0.1, [::1] or this page's own host, on this page's own port) opens on the
// reader's own origin, whatever the writer's machine called it: "http://localhost:4401/x" works on a phone. One with the
// page's own path and a #id is that same shortcut: no reload, no address.
const onPage = (id) => {
  const e = document.getElementById(id);
  return Boolean(e) && !e.closest('[data-lab-comments]');
};
const route = (p) => p.replace(/(\/index)?(\.html)?\/?$/, '');
const linked = (text) => {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]|(?<![\w&/#])#([A-Za-z][\w:.-]*[\w])/g)) {
    let to = m[1];
    let href = m[0];
    let words = m[0];
    let u: URL | null = null;
    try {
      if (!to) u = new URL(href);
    } catch {}
    if (u && u.port === location.port && (u.hostname === location.hostname || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) {
      if (u.hash.length > 1 && route(u.pathname) === route(location.pathname)) {
        try {
          to = decodeURIComponent(u.hash.slice(1));
        } catch {
          to = u.hash.slice(1);
        }
        words = u.hash;
      } else href = words = location.origin + u.pathname + u.search + u.hash;
    }
    if (to && !onPage(to)) continue;
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    const a = to
      ? el('a', { href: `#${to}`, class: 'link' }, words)
      : el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, words);
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!to) return;
      e.preventDefault();
      dispatchEvent(new CustomEvent('lab-goto', { detail: to }));
    });
    out.push(a);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
};
// Messages read in short blocks: a blank line starts a new paragraph, "- " or "1. " lines are a list, and one long
// paragraph (as agents tend to write) is broken after every second sentence, so a small window isn't a wall of text.
const sentences = (t) => t.split(/(?<=[.!?])\s+(?=["'([]?[A-Z0-9])/);
export const readable = (text) => {
  const blocks = [];
  for (const [n, para] of String(text || '').trim().split(/\n\s*\n/).entries()) {
    const lines = para.split('\n');
    if (lines.length === 1 && para.length > 240) { // one long paragraph: two sentences a block
      const ss = sentences(para);
      for (let i = 0; i < ss.length; i += 2) blocks.push({ text: ss.slice(i, i + 2).join(' '), gap: n > 0 || i > 0 });
      continue;
    }
    lines.forEach((line, i) => {
      const item = /^\s*(?:[-•*]|\d+[.)])\s+/.exec(line);
      const prev = i > 0 ? blocks.at(-1) : null;
      if (item) blocks.push({ li: /\d/.test(item[0]) ? item[0].trim() : '•', text: line.slice(item[0].length), gap: n > 0 && i === 0 });
      else if (prev && !prev.li) prev.text += `\n${line}`;
      else blocks.push({ text: line, gap: (n > 0 && i === 0) || Boolean(prev) });
    });
  }
  return blocks.map((b) => {
    const node = el('span', { class: `p${b.li ? ' li' : ''}${b.gap ? ' gap' : ''}` });
    if (b.li) node.append(el('span', { class: 'mk' }, b.li));
    node.append(...linked(b.text));
    return node;
  });
};
// A drag that starts or ends inside a word takes the whole word (as most editors do; Leo, 18 Nov), so a note is on
// "Send … carry", not "nd … ca". A drag that stays inside one word keeps exactly its letters. Letters, digits, marks,
// apostrophes and _ are a word's. The quote (comments.js) uses it.
const grow = (node: Node, i: number, step: number) => {
  const d = node.nodeType === 3 ? (node as Text).data : '';
  while (/[\p{L}\p{N}\p{M}'’_]/u.test(d[step < 0 ? i - 1 : i] ?? ' ')) i += step;
  return i;
};
export const wholeWords = (range: Range) => {
  if (/\s/.test(String(range).trim())) {
    range.setStart(range.startContainer, grow(range.startContainer, range.startOffset, -1));
    range.setEnd(range.endContainer, grow(range.endContainer, range.endOffset, 1));
  }
  return range;
};
const canMark = typeof Highlight === 'function' && Boolean(CSS.highlights);
export const markQuote = (anchor) => {
  if (!canMark) return;
  const range = anchor && quoteRange(anchor);
  if (!range) return CSS.highlights.delete('lab-quote');
  // WebKit paints no highlight set while the text can't be selected (comments on, Shift up: data-lab-pinning in
  // comments.js), and keeps one set while it can: the page's text is selectable for the frame the words are lit in.
  document.documentElement.classList.add('lab-lit');
  CSS.highlights.set('lab-quote', new Highlight(range));
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('lab-lit')));
};

// The area's outline: round dots with room between them (CSS dotted borders can't space their dots).
export const zoneEl = (cls) => {
  const z = el('div', { class: `zone ${cls}` });
  z.innerHTML = '<svg aria-hidden="true"><rect class="dots" width="100%" height="100%"/></svg>';
  return z;
};
export const drawZone = (box, cls) => {
  if (!box) return;
  const z = zoneEl(cls);
  Object.assign(z.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  layer.append(z);
  return z;
};

// An area comment: facts come from the middle of the zone; the anchor element is the smallest one that
// contains the whole zone, so the zone is stored as fractions of it and follows it like a pin.
export function zoneAnchor({ x0, y0, x1, y1 }) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  const anchor = anchorAt((left + right) / 2, (top + bottom) / 2);
  // An area on a board's frame: kept in the frame's own px (its corner, its size as shares of the frame), never measured on the
  // board's own boxes; on a picture, its two corners on the file too. Not within one frame: a point at its middle.
  if (anchor.kind === 'board') {
    const B = (window as unknown as { __labBoard?: { anchor: (x: number, y: number) => Anchor; size?: (id: string) => { w: number; h: number } | null } }).__labBoard;
    const [p, q] = [B?.anchor(left, top), B?.anchor(right, bottom)];
    const size = p?.frame && p.frame === q?.frame ? B?.size?.(p.frame) : null;
    if (!p || !q || !size) return anchor;
    const [w, h] = [Math.round(q.fx - p.fx), Math.round(q.fy - p.fy)];
    return Object.assign(p, { zw: w / size.w, zh: h / size.h, fw: size.w, fh: size.h, docW: w, docH: h, pinX: x1 >= x0 ? 1 : 0, pinY: y1 >= y0 ? 1 : 0, ...(p.nw && { imgX2: q.imgX, imgY2: q.imgY }) });
  }
  delete anchor.sx; // an area is stored on its box, as shares of it
  let box = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).find((n) => n !== host && !host.contains(n));
  // The area is on the smallest element that holds most of it (80%): a narrow strip drawn a little past a picture's
  // edge stays on the picture, instead of climbing to the page itself.
  const area = Math.max(1, (right - left) * (bottom - top));
  const contains = (r) => (Math.max(0, Math.min(r.right, right) - Math.max(r.left, left)) * Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top))) / area >= 0.8;
  while (box && box !== document.body && !contains(box.getBoundingClientRect())) box = box.parentElement;
  box ||= document.body;
  const r = box.getBoundingClientRect();
  Object.assign(anchor, {
    selector: box === document.body ? 'body' : selectorFor(box),
    element: openingTag(box),
    x: r.width ? (left - r.left) / r.width : 0,
    y: r.height ? (top - r.top) / r.height : 0,
    zw: r.width ? (right - left) / r.width : 0, // may pass 1 a little: the area can reach past its element's edge
    zh: r.height ? (bottom - top) / r.height : 0,
    oy: Math.round(top - r.top), // px below the element's top: a share of a tall box drifts when it grows (pictures load)
    docX: (left + scrollX) / docWidth(),
    docY: top + scrollY,
    docW: Math.round(right - left),
    docH: Math.round(bottom - top),
    pinX: x1 >= x0 ? 1 : 0, // the drag ended on the right / at the bottom: the pin goes there
    pinY: y1 >= y0 ? 1 : 0,
  });
  Object.assign(anchor, schemeAt(box), { eh: Math.round(r.height) });
  // The area is on the box: its heading, the box it sits in, its component are the box's, not those of the element under the middle.
  for (const k of ['inside', 'section', 'block', 'component', 'source', 'usedAt', 'chosen', 'cssText', 'shadow']) delete (anchor as Record<string, unknown>)[k];
  Object.assign(anchor, box === document.body ? {} : around(box));
  if (box !== document.body) for (const [k, v] of Object.entries(componentAt(box))) if (v) anchor[k] = short(v, 200);
  anchor.fp = box === document.body ? undefined : fingerprint(box); // the box's, not the element under the middle
  // The middle of an area often lands on one word (a caption under a picture): that word is not what the area is
  // on, so no quote (it lit up green as if it alone was picked); the area's words are in zoneText below.
  if (anchor.kind === 'text') {
    delete anchor.quote;
    anchor.kind = 'element';
  }
  const boxText = box === document.body ? '' : short(box.textContent, 200);
  if (boxText && (box.textContent || '').length < 400) anchor.text = short(boxText, 80);
  else delete anchor.text;
  if (box !== document.body) {
    anchor.looks = looksOf(box);
    anchor.rules = rulesOf(box);
    anchor.box = boxOf(box);
  }
  // Text inside the zone: the words whose middle falls inside it, in reading order. (Reading it like a selection
  // between the zone's corners took the whole paragraph whenever a corner sat above or below a line of text.)
  const words = [];
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode() as Text | null; n && words.length < 80; n = walker.nextNode() as Text | null) {
    if (host.contains(n)) continue;
    const pr = n.parentElement?.getBoundingClientRect();
    if (!pr || pr.bottom < top || pr.top > bottom || pr.right < left || pr.left > right) continue;
    for (const m of n.data.matchAll(/\S+/g)) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const w = range.getBoundingClientRect();
      const cx = (w.left + w.right) / 2;
      const cy = (w.top + w.bottom) / 2;
      if (w.width && cx >= left && cx <= right && cy >= top && cy <= bottom) words.push(m[0]);
    }
  }
  const text = short(words.join(' '), 300);
  if (text) anchor.zoneText = text;
  // What the area holds: the outermost elements that sit wholly inside it (two cards, not the page around them),
  // each with its text and, on a dev build, the component and line that wrote it.
  const inArea = [];
  const all = box.querySelectorAll('*');
  for (let i = 0; i < all.length && i < 3000; i++) {
    const el = all[i];
    if (host.contains(el) || inArea.some((x) => x.contains(el))) continue;
    const er = el.getBoundingClientRect();
    if (er.width < 8 || er.height < 8 || er.left < left - 4 || er.right > right + 4 || er.top < top - 4 || er.bottom > bottom + 4) continue;
    inArea.push(el);
  }
  if (inArea.length) {
    anchor.zoneItems = inArea.slice(0, 5).map((el) => {
      const c = componentAt(el);
      const t = short(el.textContent, 50);
      return short([openingTag(el), t && `"${t}"`, c.component, c.source && `written at ${c.source}`, c.usedAt && `used at ${c.usedAt}`].filter(Boolean).join(' · '), 500);
    });
    if (inArea.length > 5) anchor.zoneItems.push(`and ${inArea.length - 5} more`);
  }
  // The same area inside the original image or video file, when the zone is on one.
  if (/^(img|video)$/.test(box.localName)) {
    const nw = box.localName === 'img' ? fileSize(box).nw : (box as HTMLVideoElement).videoWidth;
    const nh = box.localName === 'img' ? fileSize(box).nh : (box as HTMLVideoElement).videoHeight;
    const a = naturalSpot(box, r, left, top, nw, nh);
    const b = naturalSpot(box, r, right, bottom, nw, nh);
    if (a && b) Object.assign(anchor, { imgX: a.imgX, imgY: a.imgY, imgX2: b.imgX, imgY2: b.imgY });
  } else if (anchor.kind === 'image' || anchor.kind === 'video') {
    // Zone is bigger than the media it is centred on: drop the single-point spot, keep the file as a hint. It's on
    // the box, not the picture: as an 'image' it was placed on the picture by its file, with the box's shares, and
    // jumped somewhere else on the page.
    delete anchor.imgX;
    delete anchor.imgY;
    anchor.kind = 'element';
  }
  return anchor;
}
