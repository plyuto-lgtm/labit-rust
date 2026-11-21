// The message box of the chat, a thread and a new comment: the text, your name (once), the send arrow. Part of the
// comment widget (src/comments.js bundles it).

type Deps = {
  el: (tag: string, attrs?: Record<string, string>, text?: string) => HTMLElement;
  store: { get: (k: string) => string; set: (k: string, v: string) => void };
  root: ShadowRoot;
  /** A motion token in ms, and a motion curve (anchoring.ts). */
  ms: (token: 'quick' | 'base' | 'slow', times?: number) => number;
  ease: (curve?: '' | 'out' | 'in' | 'settle' | 'pop') => string;
  refreshPinCursor: () => void;
  syncReads: () => void;
  rememberMe: (name: string) => void;
  /** Called as boxes fill and empty, so the page's own pointer can come back while you write. */
  whileWriting?: () => void;
  /** A part of the widget loaded when first used (attach: pictures in a comment). */
  part: (name: string) => Promise<any>;
};

// Set once by the widget at startup (bindComposer), so importing this module touches nothing.
let d: Deps;
export function bindComposer(deps: Deps) {
  d = deps;
}

import { holdReloads } from './hold.ts';

// Every box on the page that holds words nobody has sent. While there is one, a reload waits (hold.ts).
const writing = new Set<HTMLTextAreaElement>();
// Drafts whose words are on their way to the lab. A box rebuilt while one is in flight (the widget redraws as the
// comment lands) must not read them back in, and must not lose them either if the send fails.
const sending = new Set<string>();
// The pictures of a box, kept by its draft key as its words are: the widget draws its boxes again (a comment comes in, a
// click outside, a thread opened again) and the new box has them still, until the comment goes. The attach part fills
// and empties a list (attach.ts); here only its length is read.
const kept: Record<string, unknown[]> = {};
/** True while any box on the page holds words nobody has sent. A box that has left the page doesn't count, even before
 *  it has let go of its hold: a stale entry used to keep comment mode off (the page's own pointer) until the page next changed. */
export const anyWriting = () => [...writing].some((t) => t.isConnected);
const saysWriting = (field: HTMLTextAreaElement, pics = 0) => {
  if (field.value.trim() || pics) writing.add(field);
  else writing.delete(field);
  holdReloads(writing.size);
  d?.whileWriting?.(); // the page's own pointer comes back while you are writing (comments.js)
};

// Boxes that have been built, to see which have left the page. One observer for all of them, on the page and on the
// widget's own tree (a box let go inside it, by Escape, changes nothing on the page, and its hold stayed until
// something there did, keeping the page's text selectable without Shift). A box that is gone lets go of its hold; one
// built for each redraw used to carry an observer of its own for good, and each ran on every change to the page.
const boxes = new Set<WeakRef<HTMLElement>>();
const textOf = new WeakMap<HTMLElement, HTMLTextAreaElement>();
let sweeper: MutationObserver | null = null;
const sweep = () => {
  let gone = false;
  for (const ref of boxes) {
    const box = ref.deref();
    if (!box) boxes.delete(ref);
    else if (!box.isConnected) {
      gone = true;
      writing.delete(textOf.get(box) as HTMLTextAreaElement);
    }
  }
  if (!gone) return;
  holdReloads(writing.size);
  d?.whileWriting?.();
};

// The send arrow is drawn with CSS (a stem and a chevron), no picture.
const ARROW = '<i class="arr" aria-hidden="true"></i>';

// The words as sent: a stray space doesn't go with them (Leo, 19 Nov). Safari's no-break space, two spaces where the
// keyboard's suggestion added one before the next word, and spaces at a line's end become what was meant. A line's
// leading spaces (indented code) stay.
const tidy = (v: string) =>
  v.replace(/\u00a0/g, ' ').replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ').replace(/[ \t]+$/gm, '').trim();

// One field that grows: a pill while empty, a box with a divider and the name row once you type.
// empty: what an empty box sends; nameFirst: the cursor goes to the name. Both for a "go" comment from someone with no name
// yet: the "go" is implied, only the name is missing (guests, Leo 16 Nov: go opened the full comment box).
// opened: the box is open from the start (selected words' dialog and sheet: "comment preopened", Leo 18 Nov).
export function composer({ placeholder, onSubmit, autofocus = false, opened = false, draftKey = '', empty = '', attach = false }: {
  placeholder: string;
  // Sent when nothing is typed (a drawing: what it reads as). Without it, an empty box doesn't send.
  empty?: string;
  onSubmit: (name: string, text: string, att?: { attachments: string[] }) => Promise<unknown>;
  /** A pasted or dropped picture goes with the comment (the new pin's box and a thread's reply; not the chat). */
  attach?: boolean;
  autofocus?: boolean;
  opened?: boolean;
  /** Where to keep what is typed but not sent, so a page that reloads under you (a dev server rebuilding,
   *  a crash, a tab closed by mistake) does not take the words with it. Empty: not kept. */
  draftKey?: string;
}): HTMLElement {
  const { el, store, root, refreshPinCursor, syncReads, rememberMe } = d;
  const wrap = el('div', { class: 'composer' });
  const pics = (kept[draftKey] ||= []);
  const box = el('div', { class: 'box' });
  // No autofill or suggestion bar on phones: a comment isn't a form to fill.
  const text = el('textarea', { placeholder, maxlength: '2000', rows: '1', 'aria-label': placeholder, enterkeyhint: 'send', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', writingsuggestions: 'false' }) as HTMLTextAreaElement;
  const who = el('label', { class: 'who' });
  const as = el('span', {}, 'as');
  // Safari offers "AutoFill Contact" on anything that looks like a name, autocomplete="off" or not; a field whose name
  // says search it leaves alone.
  const name = el('input', { type: 'text', name: 'search-lab-who', placeholder: 'your name', maxlength: '60', enterkeyhint: 'send', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'words', spellcheck: 'false', writingsuggestions: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true' }) as HTMLInputElement;
  name.value = store.get('lab-name');
  // What was typed here last time and never sent. A dev server rebuilding the page used to wipe it.
  if (draftKey && !sending.has(draftKey)) {
    const kept = store.get(draftKey);
    if (kept) {
      text.value = kept;
      queueMicrotask(() => sync());
    }
  }
  const keepDraft = () => {
    if (draftKey) store.set(draftKey, text.value.trim() ? text.value : '');
  };
  const dropDraft = () => {
    writing.delete(text);
    holdReloads(writing.size);
    d?.whileWriting?.();
    if (draftKey) store.set(draftKey, '');
  };
  who.append(as, name);
  const sendBtn = el('button', { class: 'send', type: 'button', 'aria-label': 'send' });
  // Pressing send keeps the cursor in the box: on phones a blur first drops the keyboard, the sheet moves, and the
  // tap misses the button.
  sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
  sendBtn.innerHTML = ARROW;
  const error = el('div', { class: 'error' });
  // "+" (a picture) sits beside the send arrow, in the same cell: the box is no taller for it.
  const clip = attach ? el('button', { class: 'clip', type: 'button', 'aria-label': 'add a picture', title: 'add a picture' }, '+') : null;
  const tail = clip ? el('div', { class: 'act' }) : sendBtn;
  if (clip) tail.append(clip, sendBtn);
  box.append(text, el('div', { class: 'line' }), who, tail);
  wrap.append(box, error);
  // The box is taller than its one line of text: a tap anywhere on it (not the name or send) puts the cursor in, at the end.
  box.addEventListener('click', (e) => {
    if (e.target !== box && !(e.target as Element).classList?.contains('line')) return;
    text.focus({ preventScroll: true });
    text.setSelectionRange(text.value.length, text.value.length);
  });
  // A tap into a field without the cursor: put it there ourselves, without scrolling. Left to Safari, it scrolls the
  // page to show the field (170 px going from the text to the name, iOS 27 simulator), the sheet loses track of the
  // keyboard and drops behind it. A drag that starts on a field still scrolls.
  let start: { x: number; y: number } | null = null;
  for (const field of [text, name]) {
    field.addEventListener('touchstart', (e: TouchEvent) => (start = { x: e.touches[0].clientX, y: e.touches[0].clientY }), { passive: true });
    field.addEventListener('touchend', (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const moved = !start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10;
      if (moved || root.activeElement === field) return;
      e.preventDefault();
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    }, { passive: false });
  }

  const sync = () => {
    const open = opened || text.value.length > 0 || root.activeElement === name || !!error.textContent;
    // Opening moves the arrow from the text row to the name row: slide it there while the box grows, no jump.
    const glide = open !== box.classList.contains('open') && !store.get('lab-name') && box.isConnected && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = glide && { arrow: sendBtn.getBoundingClientRect(), height: box.getBoundingClientRect().height };
    const one = Boolean(store.get('lab-name'));
    box.classList.toggle('one', one);
    box.classList.toggle('open', open);
    as.hidden = !name.value.trim();
    sendBtn.classList.toggle('ready', Boolean((text.value.trim() || empty || pics.length) && name.value.trim()));
    saysWriting(text, pics.length); // a box built with words already in it (a kept draft, a redraw) counts too
    // The box grows with its words by itself (field-sizing, styles.css).
    // Once the words scroll, the box goes to the wide layout (name and arrow on a row of their own) so the scrollbar sits at
    // the box's right edge, not left of the name; it stays wide until the words are clearly shorter (no flapping at the edge).
    // Its tallest is the max-height the box has where it is (200 px, less in a short window), not a fixed 200: with a
    // fixed number, words between the two were cut off at the top with no scrollbar (a long paste, Leo 20 Nov).
    // Safari grows the field (field-sizing) but not always the box around it: a pasted message of a few lines stuck out
    // above the box (Leo 20 Nov). A height for one layout, then none, makes it measure the box again; the field keeps
    // growing by itself, no height left on it.
    text.style.height = `${text.scrollHeight}px`;
    void box.offsetHeight;
    text.style.height = '';
    const cap = parseFloat(getComputedStyle(text).maxHeight) || 200;
    const tall = one && (text.scrollHeight > cap || (box.classList.contains('tall') && text.scrollHeight > cap - 40));
    if (tall !== box.classList.contains('tall')) box.classList.toggle('tall', tall);
    const over = text.scrollHeight > cap + 1;
    text.style.overflowY = over ? 'auto' : 'hidden'; // a scrollbar only once the box is at its tallest
    // Words added at the end (typing, a long paste) keep the cursor in view: Safari left the box scrolled to the top.
    if (over && root.activeElement === text && text.selectionEnd === text.value.length) text.scrollTop = text.scrollHeight;
    if (glide) {
      const to = sendBtn.getBoundingClientRect();
      const timing = { duration: d.ms('base'), easing: d.ease() };
      sendBtn.animate([{ transform: `translate(${from.arrow.left - to.left}px, ${from.arrow.top - to.top}px)` }, { transform: 'none' }], timing);
      box.style.overflow = 'hidden';
      box.animate([{ height: `${from.height}px` }, { height: `${box.getBoundingClientRect().height}px` }], timing).onfinish = () => (box.style.overflow = '');
    }
  };
  let busy = false;
  const go = async () => {
    if (busy) return;
    const said = tidy(text.value) || empty;
    if (!said && !pics.length) return text.focus();
    if (!name.value.trim()) {
      box.classList.add('open');
      return name.focus();
    }
    store.set('lab-name', name.value.trim());
    rememberMe(name.value.trim()); // so the next lab on this computer knows you already
    refreshPinCursor(); // the pointer shows your initial
    syncReads();
    sendBtn.classList.remove('sent');
    void sendBtn.offsetWidth; // restart the arrow's flight on a quick second send
    sendBtn.classList.add('sent');
    busy = true;
    // The words are in flight: a box rebuilt while they are on their way leaves them alone, instead of reading
    // them back in as if they had never been sent.
    const words = text.value;
    if (draftKey) sending.add(draftKey);
    error.textContent = '';
    error.classList.remove('wait');
    // Taking a while (the lab is restarting): say so; it goes as soon as the lab is back.
    const slow = setTimeout(() => {
      error.textContent = 'sending… it goes as soon as the lab is back';
      error.classList.add('wait');
    }, 1500);
    try {
      const sent = onSubmit.bind(null, name.value.trim(), said);
      const result = (await (pics.length ? d.part('attach').then((m) => m.send(wrap, pics, sent)) : sent())) as { keep?: boolean } | undefined;
      // It went: the kept draft goes with it.
      dropDraft();
      if (draftKey) sending.delete(draftKey);
      clearTimeout(slow);
      error.textContent = '';
      error.classList.remove('wait');
      if (result?.keep) {
        text.value = '';
        sync();
      }
    } catch (e) {
      clearTimeout(slow);
      error.classList.remove('wait');
      error.textContent = e.message;
      // It did not go: the words are yours again, kept as they were.
      if (draftKey) sending.delete(draftKey);
      text.value = words;
      keepDraft();
      sync();
    }
    busy = false;
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { // 229: Safari's Enter that picks a word
      e.preventDefault();
      go();
    }
  };
  if (attach) {
    // "+": a phone has no paste or drop. The file input is made here, not in the part: Safari opens the picker only
    // from the tap itself.
    const file = el('input', { type: 'file', accept: 'image/*', multiple: '', hidden: '' }) as HTMLInputElement;
    clip!.addEventListener('mousedown', (e) => e.preventDefault()); // the cursor stays in the box
    clip!.addEventListener('click', () => file.click());
    // A pasted, dropped or picked picture: kept for the comment, by the attach part (its words, if the clipboard had any, go
    // in at the cursor). A paste or a drop brings only its images; what the picker gave goes as it is (the part says if it can't show it).
    const pic = (e: ClipboardEvent & DragEvent) => {
      const dt = e.clipboardData || e.dataTransfer;
      const files = [...((dt || file).files || [])].filter((f) => !dt || f.type.startsWith('image/'));
      file.value = ''; // (the same file can be picked again)
      if (dt?.types.includes('Files')) e.preventDefault(); // a file dropped here is ours, never the browser's (it would leave the page for it)
      const words = e.clipboardData?.getData('text'); // read now: the clipboard is closed once this event is over (the part loads later)
      if (e.type !== 'dragover' && files.length) void d.part('attach').then((m) => m.add(wrap, pics, files, words));
    };
    wrap.addEventListener('paste', pic as EventListener); // the name field too
    for (const t of ['dragover', 'drop', 'change']) wrap.addEventListener(t, pic as EventListener); // anywhere on the card of the box, the strip too; change: the picker's
    wrap.append(file);
    if (pics.length) void d.part('attach').then((m) => m.restore(wrap, pics)); // kept pictures: put back as this box shows
  }
  text.addEventListener('input', sync);
  text.addEventListener('input', keepDraft);
  // A box taken off the page (a card closing, a redraw) lets go of its hold; its words are kept (see sweep).
  boxes.add(new WeakRef(wrap));
  textOf.set(wrap, text);
  if (!sweeper) {
    sweeper = new MutationObserver(sweep);
    for (const n of [document.documentElement, d.root]) sweeper.observe(n, { childList: true, subtree: true });
  }
  name.addEventListener('input', sync);
  name.addEventListener('blur', () => setTimeout(sync, 0));
  text.addEventListener('keydown', onKey);
  name.addEventListener('keydown', onKey);
  // A tap sends on the first try. The arrow keeps the cursor in the box by preventing the default on
  // pointerdown, and a prevented pointerdown can swallow the click that follows on a phone — the tap then only
  // moved focus, the box went back to its one-line self, and it took a second tap to send (Leo, 16 Nov). So a
  // touch sends from touchend itself, and the click that may follow is ignored.
  let sentByTouch = 0;
  sendBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    sentByTouch = Date.now();
    go();
  }, { passive: false });
  sendBtn.addEventListener('click', () => {
    if (Date.now() - sentByTouch < 700) return; // the ghost click after a tap
    go();
  });
  // Keep focus in the field when the send button is pressed.
  sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
  sync(); // already as it will be when it shows: a card that is placed, then grows a line, moves (near the screen's end)
  requestAnimationFrame(sync); // and once more when it is on screen, where its words can be measured
  // Right after it's on screen, in the same tap: phones open the keyboard only then.
  // preventScroll: the sheet is still sliding in from below the screen, and the page must not scroll to meet it.
  const focus = () => text.focus({ preventScroll: true });
  if (autofocus) queueMicrotask(() => (text.isConnected ? focus() : setTimeout(focus, 0)));
  return wrap;
}
