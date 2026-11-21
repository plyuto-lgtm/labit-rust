/*!
 * lab comments: click anywhere on a lab page to pin a comment. No login, just a name.
 * https://github.com/leonidstern/labit · PolyForm Small Business 1.0.0
 */
// The lab (local.mjs) puts this script on every page it serves. When comments are on, click anywhere that isn't a
// link or control to pin one (alt/option-click pins on those too); esc or a click outside closes an open comment.
// Dragging (mouse/pen) marks an area instead of a point. data-admin (this computer's browser) may resolve, move and delete.
import styles from './widget/styles.css';
import {
  bindAnchoring,
  anchorAt,
  drawZone,
  foundAt,
  fillAt,
  spotChanged,
  goToBlock,
  inPage,
  ease,
  findTarget,
  markQuote,
  ms,
  nameLine,
  pageEnd,
  position,
  readable,
} from './widget/anchoring.ts';
import { anyWriting, bindComposer, composer } from './widget/composer.ts';
import { numberOf as pinNumber } from '../lib/schema.mjs';
import { flushPins, heldPin, holdPin, letPin, newPass, readPins } from './widget/pinhold.ts';
import { bindMessages, foldRow, foldStatus, isStatus, stampOf } from './widget/messages.ts';
import { afterLeave, backFromReveal, bindSheets, backCloses, fromTap, holdKeyboard, leave, letGo, liftedDraft, revealDraft, roomFor, slideAway, startSheets, swipeDown } from './widget/sheets.ts';
import { bindList, drawList, goTo, lineOf, lineUp, ord, revealOpen, stepMoved, stepNew, workState } from './widget/list.ts';
import { bindChat, drawChat, stamped } from './widget/chat.ts';
import { bindThread, flushPick, grab, openAsk, moveTicked, pickByKey, pickTicked, placeBeside, placeCard, threadCard, tieToPin } from './widget/thread.ts';
import { isTrying, pauseTry, placeAsk, relight } from './widget/trial.ts';
import { bindLive, startLive, MARK_PATHS } from './widget/live.ts';
import { inFrame, startFrame } from './widget/frame.ts';
import { holdWhileOpen } from './widget/hold.ts';
import { inkSvg } from './widget/ink.ts';
import { bindActions } from './widget/actions.ts';
import { bindDrag, draftHasText, endDrag, inkSaid, offerSelection, startDrag } from './widget/drag.ts';
import { addBoard, bindBoardCam, showBoard } from './widget/boardcam.ts';
import { bindFramework, overFramework, scanForFramework } from './widget/framework.ts';
import { bindKeys } from './widget/keys.ts';

(() => {
  // The widget's state, in one place, so its parts can live in their own files (src/widget/*) and share it.
  const state = {};
  // Debug only (a page, e.g. a test, sets window.__labDebug before this loads): a change to what the page shows that no
  // render() follows within two frames goes into window.__labMissed, with where it was made. From the first render on;
  // a change left unredrawn on purpose says so with quiet(key). Otherwise S is the plain object and this costs nothing.
  const win = /** @type {any} */ (window);
  /** @type {Map<string | symbol, Error> | null} */
  let unseen = null;
  const quiet = (/** @type {string} */ k) => unseen?.delete(k);
  /** @type {any} */
  const S = !win.__labDebug
    ? state
    : new Proxy(state, {
        set(o, k, v) {
          o[k] = v;
          if (unseen && !unseen.has(k) && /^(openId|draft|chatOpen|comments|on|showDone|page|seen|isAdmin)$/.test(String(k))) {
            const e = Error(String(k));
            unseen.set(k, e);
            requestAnimationFrame(() => requestAnimationFrame(() => unseen?.get(k) === e && unseen.delete(k) && (win.__labMissed ||= []).push(e.stack)));
          }
          return true;
        },
      });
  const UNDO_MS = 3000; // a sent pin can be taken back this long (takeBack)
  S.undo = null; // { id, until, text, anchor, touched }: the pin this tab just sent, while undo is on offer
  // What the parts in src/widget/ use from here, read when they use it (getters: nothing is read before it exists).
  const W = {
    paintWho: /** @type {(() => void) | null} */ (null), // set by live.ts: the pill's words, painted again as the agent's work moves on
    fade: /** @type {Promise<unknown> | null} */ (null), // set by live.ts while a patched-in save cross-fades: the page can't be hit-tested then (see pinned)
    get $() { return $; },
    get OFF() { return OFF; },
    get isOff() { return isOff; },
    get S() { return S; },
    get actionOf() { return actionOf; },
    get adminToken() { return adminToken; },
    get agentOf() { return agentOf; },
    get anchorAt() { return anchorAt; },
    get begin() { return begin; },
    get sendDrawing() { return sendDrawing; },
    get addComment() { return addComment; },
    get bar() { return bar; },
    get chatBtn() { return chatBtn; },
    get chatEl() { return chatEl; },
    get closeOrNudge() { return closeOrNudge; },
    get coarse() { return coarse; },
    get composer() { return composer; },
    get contentEnd() { return contentEnd; },
    get control() { return control; },
    get doneBtn() { return doneBtn; },
    get movedBtn() { return movedBtn; },
    get drawList() { return drawList; },
    get el() { return el; },
    get pageStyle() { return pageStyle; },
    get goTo() { return goTo; },
    get headers() { return headers; },
    get host() { return host; },
    get isNew() { return isNew; },
    get keepSpot() { return keepSpot; },
    get isPage() { return isPage; },
    get KEYS() { return KEYS; },
    get keyLabel() { return keyLabel; },
    get layer() { return layer; },
    get listBtn() { return listBtn; },
    get load() { return load; },
    get loadChanges() { return loadChanges; },
    get markSeen() { return markSeen; },
    get ms() { return ms; },
    get mine() { return mine; },
    get motions() { return motions; },
    get nameLine() { return nameLine; },
    get numberOf() { return numberOf; },
    get openSheet() { return openSheet; },
    get part() { return part; },
    get patchKids() { return patchKids; },
    get pinData() { return pinData; },
    get pinsById() { return pinsById; },
    get pinCursorStyle() { return pinCursorStyle; },
    get placeBar() { return placeBar; },
    get position() { return position; },
    get readable() { return readable; },
    get recheck() { return recheck; },
    get reflow() { return reflow; },
    get relook() { return relook; },
    letPin,
    get render() { return render; },
    get repliesOf() { return repliesOf; },
    get root() { return root; },
    get scrim() { return scrim; },
    get say() { return say; },
    get script() { return script; },
    get send() { return send; },
    get showAgain() { return showAgain; },
    get stampOf() { return stampOf; },
    get foldRow() { return foldRow; },
    get foldStatus() { return foldStatus; },
    get isStatus() { return isStatus; },
    get stamped() { return stamped; },
    get still() { return still; },
    get store() { return store; },
    get syncReads() { return syncReads; },
    get takeBack() { return takeBack; },
    get typing() { return typing; },
    UNDO_MS,
    get tabTitle() { return tabTitle; },
    get threads() { return threads; },
    get toggleDone() { return toggleDone; },
    get unread() { return unread; },
    get vv() { return vv; },
  };
  bindLive(W);
  bindList(W);
  bindChat(W);
  bindThread(W);
  bindSheets(W);
  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  // In a board's frame the widget draws nothing and binds nothing (src/widget/frame.ts).
  if (inFrame()) return startFrame(script);
  // Parts loaded only when they are used: each is its own file beside this script (scripts/build-widget.mjs), its
  // styles with it. Asked for once; a module that can't load leaves the rest of the widget as it is.
  const parts = {};
  /** @param {string} name */
  const part = (name) => (parts[name] ??= import(new URL(`${name}.js`, script?.src || location.href).href));
  // Shortcuts, action → key: these defaults, with what a project or you changed (labit.json or your settings.json
  // `shortcuts`, passed by the lab as data-keys; docs/settings.md).
  const KEYS = { toggle: 'm', chat: 't', next: 'w', pause: 'p', slow: 's', done: 'd', reply: 'r', resolve: 'e' };
  try {
    Object.assign(KEYS, JSON.parse(script?.dataset.keys || '{}'));
  } catch {}
  // Your one list of actions (settings.json `actions`, passed as data-actions; lib/actions.ts, docs/settings.md): as many
  // chips as fit, the rest behind "…".
  const actButton = (name) => el('button', { type: 'button', 'data-k': name }, name);
  let LIST = [];
  try {
    const l = JSON.parse(script?.dataset.actions || 'null');
    if (Array.isArray(l)) LIST = l;
  } catch {}
  // The key pressed, as the settings name it: a digit by its place (Shift or AZERTY don't matter), a letter as typed
  // when it's Latin (QWERTZ and AZERTY move letters), else by its place (Cyrillic and other layouts).
  const keyOf = (e) => {
    const d = /^(Digit|Numpad)(\d)$/.exec(e.code || '');
    // Shift and a digit is the board's (⇧1 fit, ⇧2 100%, ⇧0): its key shows another character ("!"), which a plain 1 never does.
    if (d) return e.shiftKey && e.key !== d[2] ? '' : d[2];
    return /^[a-z]$/i.test(e.key || '') ? e.key.toLowerCase() : /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : '';
  };
  const actionOf = (e) => Object.keys(KEYS).find((a) => KEYS[a] === keyOf(e)) || '';
  // A word with its key marked: in it, (c)hat, or after it when it doesn't hold the key, chat (x).
  const keyLabel = (word, key) => {
    const i = word.indexOf(key);
    return i >= 0 ? keyWord(word.slice(0, i), key, word.slice(i + 1)) : keyWord(`${word} `, key, '');
  };
  if (/** @type {any} */ (window).__labComments) return;
  /** @type {any} */ (window).__labComments = true;

  const API = '/_lab/api/comments';
  // Behind a dev server the page is the live address (named as the lab names pages, lib/labs.ts keyFor): an app that
  // navigates on its own keeps no first page's marks. A page the lab serves keeps the name it was served under.
  const enc = new TextEncoder();
  const pageNow = () =>
    script?.dataset.proxied === '1'
      ? '/' + (location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html?$/i, '') || 'index').split('/').map((seg) =>
          [...enc.encode(seg.toLowerCase())].map((b, i) => (/[a-z0-9]/.test(String.fromCharCode(b)) || (b === 45 && i) ? String.fromCharCode(b) : `_${b.toString(16)}`)).join('')).join('/')
      : script?.dataset.page || location.pathname.replace(/\/+$/, '') || '/';
  S.page = pageNow();
  // One pass (a drawing, a handler) asks the same things many times: who replied to a pin, what is unread, what
  // localStorage holds. Each is worked out once and kept until the pass ends (the next microtask) or what it comes from
  // changes (a new list of comments, something stored, something read), so a lab with thousands of pins draws in one
  // sweep, not one per question.
  /** @type {{ list: any[], n: number, by: Map<string, any[]>, unread: Map<string, any[]>, stored: Map<string, string> } | null} */
  let pass = null;
  const passNow = () => {
    const list = S.comments || [];
    if (pass?.list === list && pass.n === list.length) return pass;
    const by = new Map();
    for (const c of list) if (c.parent) (by.get(c.parent) || by.set(c.parent, []).get(c.parent)).push(c);
    const mine = (pass = { list, n: list.length, by, unread: new Map(), stored: new Map() });
    queueMicrotask(() => pass === mine && (pass = null));
    return mine;
  };
  const store = {
    get: (k) => {
      const stored = passNow().stored;
      if (!stored.has(k)) {
        try {
          stored.set(k, localStorage.getItem(k) || '');
        } catch {
          return '';
        }
      }
      return stored.get(k);
    },
    set: (k, v) => {
      pass = null;
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  // Your name lives in localStorage, which is per origin — and every lab has its own port, so a name given to one
  // lab was a stranger to the next. The lab hands it over instead: this computer's remembered name, or, for a guest,
  // the name their one-time link carried. The browser still wins if it already knows one.
  const ME = script?.dataset.me || '';
  if (ME && !store.get('lab-name')) store.set('lab-name', ME);
  // Where to tell the lab a new name, so the next lab on this computer starts out knowing it.
  const MEAPI = script?.dataset.live ? script.dataset.live.replace(/live$/, 'me') : '';
  let meSent = ME;
  const rememberMe = (name) => {
    if (!MEAPI || !name || name === meSent) return;
    meSent = name;
    fetch(MEAPI, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {});
  };

  // The lab hands this computer's browser its admin key; a guest's page has none.
  const adminToken = script?.dataset.admin || '';

  S.comments = [];
  S.isAdmin = false;
  S.mac = Boolean(adminToken); // this computer's own browser holds the key: what only it may do (keeping a rule) is shown there alone
  // Off by default: the page looks clean until someone turns comments on (button or c); remembered per browser.
  S.on = store.get('lab-on') ? store.get('lab-on') === '1' : script?.dataset.on === '1';
  // A board page (src/board/): a tap selects a frame; 1 (comment mode) pins the board.
  S.board = /^\/_board\/[^/]+$/.test(S.page);
  S.openId = null;
  S.closeFast = false; // the next redraw that closes a comment fades it out quickly instead of sliding it
  S.cardFull = false; // a comment pulled up to full height (the card is drawn anew on each redraw)
  S.draft = null; // { anchor, docX, docY }
  // An unsent comment is kept whole — the words (composer.ts) and the spot they were pinned to — so a page that
  // reloads under you, a dev server rebuilding it most of all, gives both back instead of eating them.
  const spotKey = () => `lab-spot:${S.page}`;
  // Kept with it: whether it is on selected words (the dialog, not the plain box) and the action picked. An older
  // spot, the bare anchor, comes back as a plain box.
  const keepSpot = (anchor) => store.set(spotKey(), anchor ? JSON.stringify({ anchor }) : '');
  // The unsent comment kept (words and spot), as a draft that comes back with no motion; none when nothing was typed.
  const keptDraft = () => {
    try {
      const k = JSON.parse(store.get(spotKey()) || 'null');
      return k && store.get(`lab-typing:${S.page}:new`) ? { ...(k.anchor ? k : { anchor: k }), back: true } : null;
    } catch {
      return null;
    }
  };

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.setAttribute('data-lab-comments', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${styles}</style>
    <div class="scrim"></div>
    <i class="fit" aria-hidden="true"></i>
    <div class="layer"></div>
    <div class="motions"></div>
    <div class="ui"><div class="hint" role="status" hidden></div>
    <div class="list chatwin" hidden><div class="tabs"></div><div class="msgs"></div><div class="chat"></div></div>
    <div class="left"><button class="secondary copy-all" type="button" hidden>copy link</button></div>
    <div class="bar" hidden>
      <button class="secondary chat-btn" type="button" hidden>chat</button>
      <button class="secondary list-btn" type="button" hidden>list</button>
      <button class="secondary done-btn" type="button" hidden title="show or hide done pins on the page"></button>
      <button class="secondary moved-btn" type="button" hidden title="pins whose spot is gone from the page: open one to drop it on a new spot, or close it"></button>
      <button class="toggle" type="button"></button>
      <button class="secondary more" type="button" hidden aria-label="more options" aria-expanded="false" aria-controls="lab-more">⋯</button>
    </div>
    <div class="more-menu" id="lab-more" hidden></div></div>`;
  // The widget's own parts, which are always there: typed as HTML elements.
  /** @param {string} sel @param {ParentNode} [box] */
  const $ = (sel, box = root) => /** @type {HTMLElement} */ (box.querySelector(sel));
  const layer = $('.layer');
  const hint = $('.hint');
  // Leaving: the card's exit (lab-out: fades and sinks 2 px, quick, in curve) for a card closing at once, the ⋯ menu,
  // ⌘K and the hint, as they all come in with lab-in / lab-fade; then `hide`. With reduced motion quick is 0 ms.
  const goOut = (/** @type {HTMLElement | null} */ node, /** @type {() => void} */ hide) => {
    if (!node || node.classList.contains('out')) return;
    if (node.hidden) return hide();
    node.classList.remove('in');
    node.classList.add('out');
    setTimeout(() => {
      if (!node.classList.contains('out')) return; // shown again meanwhile
      node.classList.remove('out');
      hide();
    }, still.matches ? ms('calm') : ms('quick')); // reduced motion: a short fade (styles.css, lab-calm-out)
  };
  const toggleBtn = $('.toggle');
  const bar = /** @type {HTMLElement} */ (root.querySelector('.bar'));
  const moreBtn = $('.more');
  const moreMenu = $('.more-menu');
  const copyBtn = $('.copy-all');
  // The bar's "new" pill: J/K step through the new comments, R replies, E resolves.
  const listBtn = /** @type {HTMLButtonElement} */ ($('.list-btn'));
  const doneBtn = /** @type {HTMLButtonElement} */ ($('.done-btn'));
  const motions = $('.motions');
  const movedBtn = /** @type {HTMLButtonElement} */ ($('.moved-btn'));
  const tabTitle = { base: '' };
  // Done pins show unless hidden (Leo, 17 Nov): closed ones are faded on the page, and D hides them.
  S.showDone = store.get('lab-hide-done') !== '1';
  const toggleDone = () => {
    S.showDone = !S.showDone;
    store.set('lab-hide-done', S.showDone ? '' : '1');
    render();
  };
  const chatEl = $('.chatwin');
  const chatBtn = /** @type {HTMLElement} */ (root.querySelector('.chat-btn'));
  chatBtn.title = `chat (${KEYS.chat.toUpperCase()})`;
  S.refit = () => {}; // phones: fit the sheets to the keyboard again (below)
  S.chatOpen = false;

  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text instanceof Node) node.append(text); // an icon
    else if (text != null) node.textContent = text;
    return node;
  };

  // ---------- anchoring (src/widget/anchoring.ts) ----------
  bindAnchoring({ host, layer, el });
  bindFramework(W);
  // The message box and a message's small pieces (src/widget/composer.ts, messages.ts). Arrows, so helpers defined
  // further down are read when called.
  bindComposer({ el, store, root, ms, ease, refreshPinCursor: () => refreshPinCursor(), syncReads: () => syncReads(), rememberMe, whileWriting: () => setPinning(), part });
  bindMessages({ el, mine: (c) => mine(c), repliesOf: (id) => repliesOf(id), lineUp, ord, render: () => render(), S, root });

  // Puts `next` into `box` in order, touching only what changed: nodes already in place stay (a node taken out and put
  // back restarts its animations, which showed as a blink), new ones go in where they belong, the rest come out.
  function patchKids(box, next) {
    const keep = new Set(next);
    for (const n of Array.from(box.childNodes)) if (!keep.has(n)) n.remove();
    let at = box.firstChild;
    for (const n of next) {
      if (n === at) at = at.nextSibling;
      else box.insertBefore(n, at);
    }
  }

  // Which agent wrote a message, for its brand colour: the session's kind, else the first word of its name.
  const AGENT_KINDS = ['claude', 'codex', 'cursor', 'gemini', 'antigravity', 'copilot', 'amp', 'opencode'];
  const agentOf = (m) => {
    if (!m?.session) return '';
    const k = String(m.session.kind || m.name || '').trim().split(/\W/)[0].toLowerCase();
    return AGENT_KINDS.includes(k) ? (k === 'antigravity' ? 'gemini' : k) : '';
  };

  // ---------- data ----------
  const headers = () => ({ 'content-type': 'application/json', ...(adminToken ? { 'x-lab-admin': adminToken } : {}) });

  S.loaded = false;
  // A box has the cursor (not a pin: a pin now stays the same element across redraws, so in Chrome, where a clicked
  // button keeps focus, a clicked pin held every later redraw back).
  const typed = () => /^(textarea|input)$/.test(root.activeElement?.localName || '') || Boolean(/** @type {HTMLElement | null} */ (root.activeElement)?.isContentEditable) || [...root.querySelectorAll('textarea')].some((t) => t.value.trim());
  async function load() {
    try {
      const res = await fetch(`${API}?page=${encodeURIComponent(S.page)}`, { headers: headers(), cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      S.comments = data.comments || [];
      S.rev = res.headers.has('x-lab-rev') ? Number(res.headers.get('x-lab-rev')) : null; // the lab's comments version this list is as of
      S.isAdmin = Boolean(data.admin);
      // A thread you were part-way through writing in opens again: the page may have reloaded under you
      // (a dev server rebuilding) and the words are kept, so the box they belong to comes back with them.
      if (!S.loaded && !S.openId) {
        const half = S.comments.find((c) => !c.parent && store.get(`lab-typing:${S.page}:${c.id}`));
        if (half) S.openId = half.id;
        // A comment that was being written but never sent: its words and its spot both come back.
        else if (!S.draft) S.draft = keptDraft();
      }
      S.loaded = true;
      setTimeout(found, 3000);
    } catch {
      // Keep what is already on screen when a refresh fails.
    }
    shownAgain();
  }
  // A pin found again somewhere else than its saved path (the page changed around it) says where it is now, so the
  // next look and the agent's text start from there. Once per pin and page load, once the page has settled, and only
  // from a browser that may move the pin, and again after the page was patched in place (relook).
  const looked = new Set();
  const found = (quick = false) => {
    for (const c of document.readyState === 'complete' ? threads() : []) {
      if (quick === true && !(c.session && !c.anchor?.element)) continue;
      const edit = store.get(`lab-edit:${c.id}`) || undefined;
      if (c.resolved || looked.has(c.id) || !(S.isAdmin || edit) || !c.anchor?.selector || c.anchor.gone) continue;
      looked.add(c.id);
      const anchor = foundAt(c.anchor);
      // Its words or element were changed or taken away (the agent's edit): the lab says so on the pin's next wait.
      const changed = spotChanged(c.anchor);
      if (anchor || changed) send({ action: 'move', id: c.id, found: true, ...(anchor ? { anchor } : {}), ...(changed ? { changed } : {}), edit }).then(({ comment }) => Object.assign(c, comment), () => {});
      // An agent's pin made from a selector (labit pin): it learns what a person's pin carries, once, so it survives edits;
      // or, when its selector finds nothing, it says so (the agent is told), and fills in when it is found later.
      if (c.session && !anchor && !c.anchor.element) {
        const fill = fillAt(c.anchor);
        if (fill || !c.unmatched) send({ action: 'move', id: c.id, anchor: fill || c.anchor, [fill ? 'fill' : 'unmatched']: true, edit }).then(({ comment }) => Object.assign(c, comment), () => {});
      }
    }
  };
  // Not while a choice is tried in the page (its words are swapped in): once it is put back.
  const relook = () => {
    looked.clear();
    setTimeout(() => (isTrying() ? relook() : found()), 500);
  };
  // Only what changed since comments version `since` (local labs): a reply costs ~1 KB, not the page's whole list.
  // Anything odd (a gap, an error, an old lab) falls back to the whole list.
  // One at a time, in the order asked: two answers on the way (wifi) may arrive the other way round, and the older would
  // then overwrite what the newer one brought (a pin resolved, then reopened, shown resolved; a deleted pin back).
  let changesChain = Promise.resolve();
  const loadChanges = (since) => (changesChain = changesChain.then(() => changesSince(since)));
  async function changesSince(since) {
    try {
      const url = new URL('/_lab/api/changes', new URL(API, location.href));
      url.search = String(new URLSearchParams({ page: S.page, since: String(since) }));
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); // a hung ask must not hold the ones behind it
      const data = res.ok ? await res.json() : { full: true };
      if (data.full || !S.loaded) return load();
      const gone = new Set(data.del);
      const fresh = new Map(data.set.map((c) => [c.id, c]));
      S.comments = S.comments.filter((c) => !gone.has(c.id)).map((c) => fresh.get(c.id) || c);
      const had = new Set(S.comments.map((c) => c.id));
      for (const c of data.set) if (!had.has(c.id)) S.comments.push(c);
      S.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      return load();
    }
    shownAgain();
  }
  function shownAgain() {
    setTimeout(found, 400, true); // an agent's new pin is looked at at once (labit pin waits for it)
    if (!typed() && !S.grabbing) render();
    // Someone is in a box: the open thread gets its new replies in place, the chat its new messages (its box is left
    // alone); everything else shows on the next render.
    else {
      quiet('comments'); // drawn on the next render, not under the cursor
      if (S.openCard?.isConnected) S.openCard.sync();
      if (S.chatOpen) drawChat();
      drawList(); // the bar's counts and the tab's "(3)" keep up even while a box has the cursor (a tab left in the background)
    }
  }

  // While the agent works on something, every 10 s: the ages in the pill, the sheets' lines and the tooltips move on, and a
  // pin that has gone 5 minutes without a sign turns grey (a pin changing state is drawn again, as with any change).
  const BUSY = new Set(['now', 'got', 'wait', 'stale']);
  setInterval(() => {
    if (document.hidden || !S.on) return;
    S.line = null;
    const now = lineUp();
    if (![...now.values()].some((e) => BUSY.has(e.s))) return;
    if ([...now].some(([id, e]) => pinsById.has(id) && S.rings.get(id) !== e.s)) return shownAgain();
    W.paintWho?.();
    for (const [id, pin] of pinsById) {
      const tip = pin.querySelector('.tip');
      if (tip) tip.textContent = lineOf(now.get(id));
    }
  }, 10000);

  // One way to pin (Leo, 20 Nov): a click pins, on a page or a board, the page's own links and buttons keep their
  // clicks, and holding Option pins on anything, controls too. There is no mode to switch.
  // Whether a click on the page would place something: comments on, and not while you are
  // writing one — mid-sentence the page's own pointer is what you want, not a second pin waiting to be dropped.
  const setPinning = () => {
    const placing = S.on && !anyWriting() && !S.draft; // an open new comment, empty or not, gives the page its own pointer (Leo, 18 Nov)
    host.toggleAttribute('data-lab-pinning', placing); // not a class on <html>: a framework that hydrates the page (Next) reports it
    recheck();
  };
  // A thread or the chat opened at its newest message stays there while its words settle (a phone's sheet grows into
  // place and long messages lay out after the first frame): Leo, 20 Nov, the last message was half hidden. It lets go at
  // the first touch or wheel, or after a second.
  // `at` says where it stays: the end, or (a computer's thread with new messages) the first new one, found again as the
  // words settle (it opened at 734 px of a box that grew 500 px a frame later, and neither the new message nor the last
  // one was in view).
  const staying = new WeakMap(); // a box's running stay, so a newer one replaces it
  const stays = new Set(); // every running stay: a tap that opens folded updates lets go of them all (they'd pull the list to the end)
  function stayAtEnd(box, at = () => box.scrollHeight) {
    staying.get(box)?.();
    let until = performance.now() + 1000;
    const stop = () => (until = 0);
    box.addEventListener('touchstart', stop, { once: true, passive: true });
    box.addEventListener('wheel', stop, { once: true, passive: true });
    const end = () => (performance.now() < until ? (box.scrollTop = at()) : ro?.disconnect());
    const ro = 'ResizeObserver' in window ? new ResizeObserver(end) : null;
    ro?.observe(box);
    for (const k of box.children) ro?.observe(k);
    const timer = setTimeout(() => ro?.disconnect(), 1100);
    const cancel = () => {
      stop();
      ro?.disconnect();
      clearTimeout(timer);
      box.removeEventListener('touchstart', stop);
      box.removeEventListener('wheel', stop);
      stays.delete(cancel);
    };
    staying.set(box, cancel);
    stays.add(cancel);
    requestAnimationFrame(() => requestAnimationFrame(end));
  }
  S.stayAtEnd = stayAtEnd;
  S.endStays = () => [...stays].forEach((f) => f());
  function begin(anchor) {
    if (!anchor.moment) {
      const moment = mo?.momentFor(anchor); // the moment as the pin goes down, not as it is sent
      if (moment) anchor = { ...anchor, moment };
    }
    S.draft = { anchor };
    keepSpot(anchor);
    ptr.classList.add('still'); // the new pin is where the drawn pointer is: it goes at once (it faded over the pin), back with the next move
    render();
  }
  // A new comment the lab saved: on the page, its box closed, undo for a moment (takeBack).
  function posted(comment, edit, said, anchor) {
    if (edit) store.set(`lab-edit:${comment.id}`, edit); // lets this browser drag the pin later
    addComment(comment);
    markSeen([comment]);
    S.draft = null;
    keepSpot(null);
    S.openId = null; // once posted, the card closes and the new pin stays (click it to open)
    // Undo for 3 s (takeBack): the card is closed at once (Leo, 20 Nov: "autoclose modal if its first comment"), with
    // no strip above the bar (Leo, 20 Nov: "no need this pill"); opening the pin meanwhile puts undo in its card
    // (thread.ts), and Command-Z takes it back too, on a computer.
    // A tapped action (go, fix, remove…) closes at once with no undo (Leo, 20 Nov: "if action close it right away").
    if ((S.isAdmin || edit) && !anchor.act) {
      const u = { id: comment.id, until: Date.now() + UNDO_MS, text: said, anchor, touched: false };
      S.undo = u;
      setTimeout(() => {
        if (S.undo !== u) return;
        S.undo = null;
        if (u.touched || S.openId !== u.id) return;
        S.closeFast = true;
        S.openId = null;
        render();
      }, UNDO_MS);
    }
    S.posted = comment.id;
    holdKeyboard(); // the keyboard waits until the card has gone (sheets.ts)
    render();
  }
  // A drawing goes as it is, with what it reads as, the moment it is done: no box to send it from (Leo, 21 Nov: "just
  // draw maybe and send dont open comment to send it, just send"). Undo stays (⌘Z, or the pin's card). With no name
  // given yet, or the lab refusing it, its box opens instead.
  async function sendDrawing(anchor) {
    const name = store.get('lab-name');
    if (!name) return begin(anchor);
    const said = inkSaid(anchor.ink.mark);
    try {
      const { comment, edit } = await send({ name, text: said, anchor });
      posted(comment, edit, said, anchor);
    } catch {
      begin(anchor);
    }
  }
  // Sent once the lab answers: while it can't be reached (restarting, the laptop just woke), the message waits and is
  // tried again every 2 s for up to 5 minutes, instead of failing. Only a lab that answers with an error fails it.
  async function send(payload) {
    let res = null;
    // A new comment or reply carries a nonce, so a retry after a lost answer can't save it twice.
    // Paused when written: the agent is told, with the moment (a loop's pass and second, a video's time, lib/moment.mjs).
    // The page stays paused after (Leo, 19 Nov: "dont need to play again"): pause, pin, pin again, play when you like.
    if (S.paused && payload.anchor && !payload.action) payload = { ...payload, anchor: { ...payload.anchor, paused: true, atMs: mo.msOf(mo.pausedEl(payload.anchor)) } };
    const moment = payload.anchor && !payload.action && !payload.anchor.moment ? mo?.momentFor(payload.anchor) : undefined;
    if (moment) payload = { ...payload, anchor: { ...payload.anchor, moment } };
    if ((S.slow || mo?.slowEls.size) && payload.anchor && !payload.action) payload = { ...payload, anchor: { ...payload.anchor, slow: true } }; // at ¼ speed
    if (!payload.action && !payload.nonce) payload = { ...payload, nonce: Math.random().toString(36).slice(2) + Date.now().toString(36) };
    for (let tries = 0; !res; tries++) {
      try {
        // A pick (thread.ts) may go as the page is hidden or closed: keepalive lets the request finish.
        res = await fetch(API, { method: 'POST', headers: headers(), body: JSON.stringify({ page: S.page, ...payload }), keepalive: payload.picked !== undefined });
      } catch {
        if (tries >= 150) throw new Error("couldn't reach the lab; your text is still here");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `could not save (${res.status})`);
    // A new pin or go from this tab can be taken back with Command-Z (the newest first).
    if (data.comment && !payload.parent && !payload.action && payload.anchor?.kind !== 'page') placed.push(data.comment.id);
    return data;
  }
  const placed = [];
  // Undo, 3 s after a new pin is sent (Leo, 19 Nov): its card opens with "undo" in the resolve key's place (thread.ts).
  // A tap deletes it (this computer as admin, anyone else with the pin's own key, which the lab takes for a fresh pin
  // nobody answered) and closes the card: no comment box, no words kept anywhere.
  // An agent may have been handed it already (the lab hands pins after batchSeconds, 2 s): it is gone on its next look.
  async function takeBack(c) {
    const u = S.undo;
    if (!u || u.id !== c.id) return;
    const ownKey = store.get(`lab-edit:${c.id}`);
    await send({ action: 'delete', id: c.id, ...(ownKey && !S.isAdmin ? { edit: ownKey } : {}) });
    S.undo = null;
    S.comments = S.comments.filter((x) => x.id !== c.id && x.parent !== c.id);
    if (ownKey) store.set(`lab-edit:${c.id}`, '');
    const at = placed.indexOf(c.id);
    if (at >= 0) placed.splice(at, 1);
    // Gone for good (Leo, 19 Nov: "undo should not leave text in input"): the card closes, no box, no kept words.
    S.openId = null;
    S.draft = null;
    store.set(`lab-typing:${S.page}:new`, '');
    keepSpot(null);
    render();
  }
  // Command-Z (Control-Z elsewhere), not in a text box: the last pin or go placed from this tab goes away. This
  // computer deletes it; a guest, who can't delete, resolves it (it steps aside).
  async function undoLast() {
    const id = placed.pop();
    const c = id && S.comments.find((x) => x.id === id);
    if (!c) return;
    const ownKey = store.get(`lab-edit:${id}`);
    try {
      if (S.isAdmin) {
        await send({ action: 'delete', id });
        S.comments = S.comments.filter((x) => x.id !== id && x.parent !== id);
      } else if (ownKey) {
        const { comment } = await send({ action: 'resolve', id, edit: ownKey });
        Object.assign(c, comment);
      } else return void placed.push(id);
    } catch {
      return void placed.push(id); // not taken back: it stays next in line
    }
    if (S.openId === id) S.openId = null;
    if (S.undo?.id === id) S.undo = null;
    render();
    say(`took back a pin · ${placed.length ? 'again for the one before' : 'nothing more to take back'}`);
  }
  // Option-click on a pin: its thread is resolved, or opened again, without opening its card (Leo, 17 Nov). For whoever
  // may resolve it, as in the card: this computer, and whoever started the thread (its key is kept in their browser).
  const autoShut = new Set();
  const mayResolve = (c) => S.isAdmin || Boolean(store.get(`lab-edit:${c.id}`));
  function toggleResolved(c) {
    const ownKey = store.get(`lab-edit:${c.id}`);
    const reopen = Boolean(c.resolved);
    send({ action: reopen ? 'reopen' : 'resolve', id: c.id, ...(ownKey ? { edit: ownKey } : {}) }).then(
      ({ comment }) => {
        Object.assign(c, comment);
        if (!reopen && S.openId === c.id) { // as its resolve button closes it
          S.closeFast = true;
          S.openId = null;
        }
        render();
        say(reopen ? 'open again' : 'resolved');
      },
      () => say("couldn't save that, try again"),
    );
  }
  // A short note in the hint strip (an undo, a copied link), then the strip goes back to its own words.
  const said = { was: undefined, t: undefined };
  function say(words) {
    said.was ??= hint.textContent;
    hint.textContent = words;
    hint.classList.remove('out');
    hint.hidden = false;
    clearTimeout(said.t);
    said.t = setTimeout(() => goOut(hint, () => {
      hint.hidden = true;
      hint.textContent = said.was;
      said.was = undefined;
    }), 1800);
  }

  // ---------- copy for an agent ----------
  // The link an agent reads: every open comment on this page as plain text.
  const agentLink = () => new URL('/_lab/agent' + S.page, new URL(API, location.href)).href;

  async function copy(textPromise) {
    const textValue = await textPromise;
    try {
      await navigator.clipboard.writeText(textValue);
    } catch {
      const area = document.createElement('textarea');
      area.value = textValue;
      area.style.cssText = 'position:fixed;opacity:0;';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    say('link copied');
  }

  // ---------- render ----------
  // Everyone sees done threads the same way (a guest's resolved pin vanished at once, with the answer in it unread):
  // done ones with nothing new step aside, and show done brings them back.
  // A declaration, not a const: on a board page the live state arrives while the widget is still setting up, and the
  // pill's line reads the threads then (it threw "Cannot access 'threads' before initialization" and the board stopped).
  function threads() { return (S.comments || []).filter((c) => !c.parent); }
  const isPage = (c) => c.anchor?.kind === 'page'; // about the page as a whole: no pin; it lives in the chat
  // prev / next / J / K: the thread swaps in place, no slide; the keyboard stays as it was (up stays up, down stays down).
  S.stepping = false;
  S.keepKeys = false;
  // Computers (Leo, 2026-11-15, option 1b): one bar of segments (chat, new, go, ⋯) at the bottom right; the less used
  // ones (show done, copy link, hide) sit in the ⋯ menu. Comments hidden: the bar is just "comments". Phones keep theirs.
  // A word with its key marked inside it, as in menus: (c)hat, ne(w).
  const keyWord = (before, key, after) => {
    const w = el('span');
    w.append(before, el('span', { class: 'mn', 'aria-hidden': 'true' }, `(${key})`), after);
    return w;
  };
  // Which labit this is, at the very foot of the ⋯ menu (the lab passes it as data-labit), so labs on different
  // builds can be told apart at a glance.
  const versionLine = script?.dataset.labit ? el('div', { class: 'labit-version' }, script.dataset.labit) : null;
  // A newer release (a lab from npm, on this computer): "update" in the menu. It asks the agent in the chat, as an
  // action: the agent says what's new and runs labit update. Nothing changes on its own (Leo, 19 Nov).
  let update = null;
  try {
    update = script?.dataset.admin && script.dataset.update ? JSON.parse(script.dataset.update) : null;
  } catch {}
  // A small "update" beside the version line (Leo, 19 Nov), not a menu item of its own.
  const updateBtn = update && versionLine && el('button', { type: 'button', class: 'update-btn', title: `update to labit ${update.version}` }, 'update');
  if (updateBtn) versionLine.append(' · ', updateBtn);
  updateBtn?.addEventListener('click', async () => {
    setMenu(false);
    const act = `update labit to ${update.version}`;
    try {
      const { comment } = await send({ name: store.get('lab-name') || '', text: act, anchor: { kind: 'page', width: innerWidth, height: innerHeight, act } });
      addComment(comment);
      S.chatOpen = true;
      render();
    } catch {}
  });
  // Labs & pages (⌘K, src/widget/switcher.ts): local labs only. The menu opens with which lab this is, then the item.
  const LABS = script?.dataset.live ? script.dataset.live.replace(/live$/, 'labs') : '';
  // Labs & pages is its own file, loaded and set up the first time it is asked for (⌘K, or the ⋯ menu opening); labs:
  // the module, once it is.
  /** @type {any} */
  let labs = null;
  const switcher = () => (S.switcher ??= part('switcher').then((m) => {
    m.bindSwitcher({
      root, el, api: LABS, admin: script?.dataset.admin || '', page: S.page, beforeOpen: () => {
        setMenu(false);
        if (coarse) S.chatOpen = false; // one sheet at a time on a phone
      },
      // Phones: labs & pages is a sheet like the list and the chat (see openSheet); a computer keeps its box over the page.
      sheet: (open) => {
        S.labsOpen = open;
        render();
      },
      swipe: swipeDown,
      leave: goOut,
    });
    return (labs = m);
  }).catch(() => (S.switcher = null))); // couldn't load: nothing opens, and the next ask tries again
  const labHead = LABS ? el('div', { class: 'lab-head' }, `${script?.dataset.labName || 'lab'} · ${location.port || '80'}`) : null;
  const labsBtn = LABS ? el('button', { type: 'button' }) : null;
  if (labsBtn) {
    labsBtn.append('labs & pages', el('kbd', { 'aria-hidden': 'true' }, navigator.platform.startsWith('Mac') ? '⌘K' : 'ctrl K'));
    // The menu closes without taking the focus back to ⋯ (its own click handler would, after the box opened, and on a
    // phone that blurred the search and bounced the keyboard).
    labsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(false);
      void switcher().then((m) => m?.openSwitcher());
    });
  }
  function placeBar() {
    const inMenu = !S.on ? [] : [...(labHead ? [labHead, labsBtn] : []), doneBtn, movedBtn, copyBtn, toggleBtn, ...(versionLine ? [versionLine] : [])];
    // In this order every time: a part that came back (hide comments, after showing them again) went to the end, below
    // the version line.
    if (S.on && (inMenu.some((b, i) => moreMenu.children[i] !== b) || moreMenu.children.length !== inMenu.length)) moreMenu.replaceChildren(...inMenu);
    if (!S.on && toggleBtn.parentNode !== bar) bar.insertBefore(toggleBtn, moreBtn);
    if (!S.on) root.querySelector('.left').append(copyBtn);
    moreBtn.hidden = !S.on;
    if (!S.on && !moreMenu.hidden) setMenu(false);
    // The first segment shown has no line before it.
    let first = true;
    for (const b of /** @type {HTMLCollectionOf<HTMLElement>} */ (bar.children)) {
      b.classList.toggle('first', first && !b.hidden);
      if (!b.hidden) first = false;
    }
  }
  // The work tab: what the agent is on now (handed to it, not answered yet, or answered "On it"), what's next (sent,
  // not handed yet) and what's done today (resolved, or answered "Done"), from what the lab records on each thread.
  S.newFrom = null;
  // A pin's number: the one it was made with (the same for everyone, admins and the agent text; never shared by two pins).
  const numberOf = (c) => pinNumber(c, S.comments);

  // Unread: comments and replies by someone else that this browser hasn't opened yet (kept per page).
  const seenKey = () => `lab-seen:${S.page}`;
  const readSeen = () => new Set(store.get(seenKey()).split(',').filter(Boolean));
  S.seen = readSeen();
  // Yours is never new: your name (any case or spacing), or a pin this browser started (it keeps its edit key).
  const plain = (n) => String(n || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const mine = (c) => (plain(c.name) && plain(c.name) === plain(store.get('lab-name'))) || Boolean(store.get(`lab-edit:${c.id}`));
  // The agent's status messages ("on it") are never unread: they fold once the answer comes (messages.ts).
  const isNew = (c) => !S.seen.has(c.id) && !mine(c) && !isStatus(c);
  const unread = (c) => {
    const memo = passNow().unread;
    if (!memo.has(c.id)) memo.set(c.id, [c, ...repliesOf(c.id)].filter(isNew));
    return /** @type {any[]} */ (memo.get(c.id));
  };
  // A comment this page just sent, added unless it is there already: the live stream and /changes may have brought it
  // before the POST's answer (or a retry of the POST answers with the same comment again).
  const addComment = (comment) => {
    if (!S.comments.some((c) => c.id === comment.id)) S.comments.push(comment);
  };
  const markSeen = (items) => {
    const fresh = items.filter((item) => !S.seen.has(item.id)).map((item) => item.id);
    for (const item of items) S.seen.add(item.id);
    pass = null;
    store.set(seenKey(), [...S.seen].join(','));
    if (fresh.length) shareReads(fresh);
  };
  // On a local lab, what's read is shared by name: your phone and your Mac (the same name) show the same new and read.
  const READS = script?.dataset.live ? script.dataset.live.replace(/live$/, 'api/reads') : '';
  const shareReads = (ids) => {
    const who = store.get('lab-name').trim();
    if (!READS || !who || !ids.length) return;
    fetch(READS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: who, page: S.page, ids }) }).catch(() => {});
  };
  async function syncReads() {
    const who = store.get('lab-name').trim();
    if (!READS || !who) return;
    const at = S.page;
    try {
      const { ids } = await (await fetch(`${READS}?name=${encodeURIComponent(who)}&page=${encodeURIComponent(at)}`, { cache: 'no-store' })).json();
      if (at !== S.page) return;
      const theirs = new Set(ids);
      const mineOnly = [...S.seen].filter((id) => !theirs.has(id));
      const added = ids.filter((id) => !S.seen.has(id));
      if (mineOnly.length) shareReads(mineOnly); // read here before: the other devices get it too
      if (!added.length) return;
      for (const id of added) S.seen.add(id);
      pass = null;
      store.set(seenKey(), [...S.seen].join(','));
      shownAgain(); // typed text in an open box stays
    } catch {}
  }
  const repliesOf = (id) => passNow().by.get(id) || [];
  // Pins show who left them: the first letter of the name.
  const initial = (name) => [...String(name || '').trim()][0]?.toUpperCase() || '';
  // A pin the agent left wears labit's own mark — the same one the bar shows while an agent listens — instead of a
  // letter, so you can tell at a glance across a page who asked.
  const agentMark = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', 'agentmark');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = MARK_PATHS;
    return svg;
  };
  // An agent's own comment carries the session it was written in; a person's carries where they wrote it from.
  const byAgent = (c) => Boolean(c.session);
  // Where the page's own content ends (not the pins' layer): see inPage().
  const contentEnd = () => {
    inPage(0);
    return pageEnd.y;
  };

  // What the last render had open (a thread id or a draft), so cards, pins and areas only animate when they
  // appear, not on every re-render, and a card that closes to nothing can fade out.
  S.shown = null;
  S.posted = null;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const pinsById = new Map(); // the pins on the layer now, by thread id, for movePins()
  S.faces = new Map(); // each pin's last drawn state, so a change can ease in
  S.rings = new Map(); // and its state with the agent, for the ring
  const RINGS = { now: '', got: ' got', wait: ' wait', stale: ' stale', missed: ' stale', asks: ' asks' }; // the ring each state wears (none: sent, done)
  const SAY = { now: 'agent working on it', got: 'picked up by the agent', wait: 'waiting', stale: 'no update from the agent', missed: 'not answered', asks: 'agent asked a question' };
  // Ends a pin drag's window listener when the layer is redrawn under it (the pin is gone, its pointer events with it).
  S.dropDrag = null;
  // A link on the page to a board opens it over this same page, its pins this page's (Leo, 19 Nov: "can board be part
  // of same page?"); /_lab/board/<name> itself still works as a link from anywhere else. Any other way to a board keeps
  // the scroll under the page's key, so the board's back lands where you were. A page the browser gives back whole
  // (bfcache) has its scroll already, so the key goes, or a later reload would jump.
  if (!S.board && self === top) {
    const scrollKey = 'lab-scroll:' + location.pathname;
    document.addEventListener('click', (e) => {
      const a = /** @type {HTMLAnchorElement | null} */ (e.target instanceof Element ? e.target.closest('a[href]') : null);
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (a.target && a.target !== '_self')) return;
      try {
        const u = new URL(a.href, location.href);
        const bn = u.origin === location.origin && /^\/_lab\/board\/([a-z0-9][a-z0-9_-]*)\/?$/i.exec(u.pathname)?.[1];
        if (bn) {
          e.preventDefault();
          return void showBoard(bn, u.searchParams.get('of') || '');
        }
        if (u.origin === location.origin && u.pathname.startsWith('/_lab/board/')) sessionStorage.setItem(scrollKey, JSON.stringify({ y: scrollY }));
      } catch {}
    });
    addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      try {
        sessionStorage.removeItem(scrollKey);
      } catch {}
    });
  }
  // What each pin on the layer was drawn from, so a redraw can keep the pin itself and only update it.
  /** @type {WeakMap<Element, any>} */
  const pinData = new WeakMap();
  // A board is held to the screen (its own page, or a view over a page), so what sits on it is too: its pins, an open
  // card, a new comment's box. The page scrolling under a half view then moves none of them, and nothing is put back a
  // frame late (Leo, 19 Nov: "when on half board scrolling pins flickering weirdly"). n was just placed by the page's px.
  // A pin the browser holds (pinhold.ts) is tied to its frame's box and left alone.
  const onBoard = (/** @type {HTMLElement} */ n, /** @type {any} */ a) => {
    if (a?.kind !== 'board' || heldPin(n)) return void (n.style.position && (n.style.position = ''));
    n.style.position = 'fixed';
    n.style.left = `${parseFloat(n.style.left) - scrollX}px`;
    n.style.top = `${parseFloat(n.style.top) - scrollY}px`;
  };
  // Phones: the page behind an open sheet doesn't scroll (the rule is with the page's other styles, below).
  const holdPage = (/** @type {boolean} */ on) => {
    const de = document.documentElement;
    de.classList.remove('lab-hold-b', 'lab-hold-h');
    if (!on) return;
    const cs = getComputedStyle(de);
    const own = /auto|scroll|hidden|clip/.test(cs.overflowX + cs.overflowY); // html has an overflow of its own
    de.classList.add(own ? 'lab-hold-h' : 'lab-hold-b');
  };
  let viewW = 0; // the screen's width without its scrollbar (flipAt)
  function render() {
    // The bar shows from its first drawing on: as it comes in the page's source it holds one empty button with a dot, and that
    // dot stood where the menu comes for as long as the comments took to arrive (Leo, 21 Nov, on his phone over wifi:
    // "some dot blinking on page reload on menu place").
    bar.hidden = false;
    if (!moAsked && (S.draft?.anchor?.moment || S.comments.some((/** @type {any} */ x) => x.anchor?.moment))) void loadMotion().then(() => render()); // a moment's chip is the motion file's
    newPass(); // what pinhold read about the pins' elements is read again (pinhold.ts)
    viewW = document.documentElement.clientWidth; // read once a pass, before any pin is written (flipAt)
    if (win.__labDebug) unseen = new Map();
    const dragged = S.grabbing;
    S.line = null; // where each thread stands with the agent is worked out again (list.ts lineUp)
    // A question's choice tried in the page (thread.ts): the page's own words are back before anything is read or drawn;
    // the same card drawn again tries the same row again.
    pauseTry(S.on ? S.openId : null);
    // A pick still in its 5 s of undo goes now if its card (or the chat) has closed.
    flushPick(S.on ? S.openId : null, Boolean(S.on && S.chatOpen));
    S.grabbing = false; // a pin being dragged is replaced: its drag ends here
    S.dropDrag?.();
    const prev = /** @type {HTMLElement | null} */ (layer.querySelector('.card:not(.out), .float:not(.out)'));
    const prevHeight = S.stepping && coarse && prev ? prev.offsetHeight : 0; // stepping on a phone: the sheet's top doesn't drop
    // The same thread drawn again (reopened, resolved, a reply came in): it keeps where its messages were scrolled to.
    const prevBody = prev?.querySelector('.body');
    const prevScroll = prevBody ? prevBody.scrollTop : null;
    // …or, read at its newest, stays at its newest, so an answer that just came in is in view (as the chat follows new
    // messages; Leo, 17 Nov: "message scrolled up" on a phone).
    const prevAtEnd = prevBody ? prevBody.scrollHeight - prevBody.scrollTop - prevBody.clientHeight < 48 : false;
    // Every pin's place is read before anything is written, so the page lays out once per render, not once per pin.
    const places = new Map(S.on ? threads().filter((c) => c.anchor?.kind !== 'page').map((c) => [c.id, position(c.anchor || {})]) : []);
    readPins(threads().map((c) => (c.anchor?.kind === 'board' ? frameBox(c.anchor) : c.anchor && c.anchor.kind !== 'page' && !places.get(c.id)?.moved ? findTarget(c.anchor) : null)));
    // A pin that is still there stays the same element, updated in place, so what runs on it (the agent's ring, a pop, a
    // swap, a hover or open transition) carries on instead of starting again (Leo, 18 Nov: clicking or leaving a pin
    // "reloads" its animation). Everything else on the layer (cards, outlines, drafts) is drawn anew, as before; a pin
    // that was being dragged is drawn anew too.
    const old = dragged ? new Map() : new Map(pinsById);
    const keep = new Set(old.values());
    for (const n of Array.from(layer.children)) if (!keep.has(n)) n.remove();
    pinsById.clear();
    const next = []; // what the layer holds when this is drawn, in order
    const add = (n) => (n && next.push(n), n);
    const now = S.on ? S.draft || S.openId : null;
    const appear = now !== S.shown;
    const anim = appear ? ' in' : '';
    let quoted = null;
    const done = () => {
      patchKids(layer, next); // pins still in place stay; the new ones go in, the gone ones come out
      flushPins(); // the rules of the pins the browser holds, now they are on the page (pinhold.ts)
      if ((S.closeFast || (still.matches && S.shown)) && !now && prev) { // reduced motion: a card or sheet fades out (a computer's went at once), no slide
        S.closeFast = false;
        prev.inert = true;
        layer.append(prev);
        goOut(prev, () => prev.remove());
      } else if (coarse && !now && S.shown && prev && !still.matches && !prev.style.transform) { // phones slide the sheet away; computers close at once, like the chat // not when it already slid away (phones)
        prev.classList.remove('in');
        prev.classList.add('out');
        prev.inert = true;
        layer.append(prev);
        // It shrinks back with the keyboard going (sheets.ts); after a send it slides down and the new pin pops in.
        const newPin = S.posted && pinsById.get(S.posted);
        if (newPin) newPin.style.animationDelay = 'var(--_t-quick)'; // as the card goes (lab option 5)
        const dur = leave(prev, 0, Boolean(newPin));
        afterLeave(prev, dur, () => (prev.remove(), letGo(prev), prev.classList.contains('float') && backFromReveal())); // the page goes back once the card has landed in its pin
      }
      // Phones: a new comment's sheet has gone (dropped, swiped away; a sent one waits for its card above): the page goes
      // back where it was (sheets.ts).
      if (coarse && prev?.classList.contains('float') && !prev.classList.contains('out') && !root.querySelector('.float:not(.out)')) setTimeout(backFromReveal, ms('slow'));
      // Phones: a sheet that opens grows out of what was tapped (sheets.ts).
      if (coarse) {
        const sheet = /** @type {HTMLElement | null} */ (root.querySelector('.card:not(.out), .float:not(.out)')) || (S.chatOpen ? chatEl : null);
        const key = sheet && (S.draft ? 'draft' : S.openId || (S.chatOpen ? 'chat' : ''));
        if (sheet && key !== S.sheetKey) fromTap(sheet);
        S.sheetKey = key;
        // Its pin above the sheet, before the keyboard (sheets.ts): made by a hold, now, while the finger is still down.
        if (appear && S.draft && S.pinnedByHold) revealDraft();
        else if (appear && S.draft) requestAnimationFrame(() => revealDraft(true));
      }
      if (!isTrying()) markQuote(quoted); // a tried choice wears the green itself
      S.quoted = quoted;
      S.shown = now;
      S.posted = null;
    };
    const list = threads();
    const open = list.filter((c) => !c.resolved && c.anchor?.kind !== 'page').length; // chat messages count in the chat
    const fresh = list.filter((c) => !c.resolved && c.anchor?.kind !== 'page').reduce((n, c) => n + unread(c).length, 0); // the chat counts its own
    // New replies are counted on "list" while comments show, on the toggle while they are hidden.
    toggleBtn.replaceChildren(
      document.createTextNode((S.on ? 'hide comments' : open ? `comments · ${open}` : 'comments') + (!S.on && fresh ? ` · ${fresh} new` : '')),
      el('kbd', { 'aria-hidden': 'true' }, KEYS.toggle),
    );
    toggleBtn.classList.toggle('secondary', S.on);
    host.toggleAttribute('data-labs', Boolean(!coarse && S.labsOpen)); // the page dims behind labs & pages (the widget's .scrim)
    host.toggleAttribute('data-sheet', Boolean((coarse && S.labsOpen) || (S.on && (S.draft || S.openId || S.chatOpen)))); // phones: the sheet has the screen's bottom
    if (coarse && appear && now) { // a sheet opening slides in once its first frame is drawn (see data-opening in styles.css)
      host.setAttribute('data-opening', '');
      requestAnimationFrame(() => requestAnimationFrame(() => host.removeAttribute('data-opening')));
    }
    if (coarse && host.hasAttribute('data-sheet') !== document.documentElement.classList.contains('lab-sheet')) holdPage(host.hasAttribute('data-sheet'));
    document.documentElement.classList.toggle('lab-sheet', host.hasAttribute('data-sheet'));
    holdWhileOpen(host.hasAttribute('data-sheet')); // a dev server's reload waits until the chat, thread or list is closed
    backCloses();
    S.refit();
    setPinning();
    copyBtn.hidden = !S.on || !S.isAdmin || list.every((c) => c.resolved);
    drawList(places);
    drawChat();
    if (!S.on) return done();
    list.forEach((c) => {
      if (isPage(c)) return; // in the chat, not on the page
      // Done pins with nothing new in them step aside when done ones are hidden (D); an open one stays.
      if (!S.showDone && S.openId !== c.id && (c.resolved || workState(c)[0] === 'done') && !unread(c).length) return;
      const { left, top, moved, zone, clipped, covered, why } = places.get(c.id) || position(c.anchor || {});
      // A pin whose spot is gone is off the page: the ⋯ menu lists them ("moved · N"); an open one shows, to drop on a
      // new spot (drag) or close. The agent finishing one closes it.
      if (moved) {
        if (!c.resolved && !autoShut.has(c.id) && workState(c)[0] === 'done' && mayResolve(c)) {
          autoShut.add(c.id);
          send({ action: 'resolve', id: c.id, edit: store.get(`lab-edit:${c.id}`) || undefined }).then(({ comment }) => (Object.assign(c, comment), render()), () => {});
        }
        if (S.openId !== c.id) return;
      }
      const ink = zone && c.anchor.ink; // a drawing is its own pin: its lines, no marker (draw.ts)
      if (S.openId === c.id && !ink) add(drawZone(zone, `saved${anim}`)); // a drawn area shows its outline while open
      const news = unread(c);
      const movable = !zone && (S.isAdmin || store.get(`lab-edit:${c.id}`));
      const sg = lineUp().get(c.id) || { s: null, n: 0, at: '', line: '' }; // where it stands with the agent: sent, got (picked up), now (working), wait, stale, asks or done
      // A question you've read goes back to a plain pin: amber is for one still unread (Leo, 20 Nov: "orange pin after
      // opening should become regular").
      const state = sg.s === 'asks' && !news.length ? null : sg.s;
      const tip = coarse || (state !== 'now' && state !== 'stale') ? '' : lineOf(sg); // hovering a working ring says what it is doing
      const born = !old.has(c.id);
      const pin = old.get(c.id) || el('button', { type: 'button' });
      const info = pinData.get(pin) || {};
      pinData.set(pin, Object.assign(info, { c, zone, hot: info.hot }));
      // Its state as classes and words (the ring, the tick and the new dot are only seen). Set one by one: the
      // classes that carry an animation (.in, .swap) are left as they are, so nothing starts again.
      for (const [cls, on] of Object.entries({
        resolved: c.resolved, done: state === 'done', new: news.length, moved, unsure: why === 'unsure' || why === 'changed',
        grab: movable, open: S.openId === c.id, dragging: false,
      })) pin.classList.toggle(cls, Boolean(on));
      pin.classList.add('pin');
      if (born && S.posted === c.id) pin.classList.add(coarse ? 'arrive' : 'in');
      if (tip) pin.removeAttribute('title');
      else pin.title = `${c.resolved ? '' : `${numberOf(c)} · `}${c.name}${movable ? ' · drag to move' : ''}${!coarse && mayResolve(c) ? ` · option-click to ${c.resolved ? 'open it again' : 'resolve'}` : ''}`;
      pin.setAttribute('aria-label', `comment${c.resolved ? '' : ` ${numberOf(c)}`} by ${c.name}${c.resolved || state === 'done' ? ', done' : SAY[state] ? `, ${SAY[state]}${state === 'wait' ? ` ${ord(sg.n)} in line` : ''}` : ''}${news.length ? `, ${news.length} new` : ''}`);
      // Done wins over every face: a pin that has been answered or resolved wears the tick.
      const mark = state !== 'done' && !c.resolved && byAgent(c);
      const key = state === 'done' || c.resolved ? '✓' : mark ? '\0mark' : initial(c.name);
      if (info.face !== key) {
        const node = mark ? agentMark() : document.createTextNode(key);
        if (info.node) info.node.replaceWith(node);
        else pin.prepend(node);
        Object.assign(info, { face: key, node });
      }
      // Its face changed since the last drawing (the agent took it, it's done, something new in it): it eases into the
      // new one and the ring fades in or out, instead of a cut (see .swap in styles.css).
      // A new reply read (the dot goes) is no change of face: it doesn't play (Leo, 18 Nov: closing one made it jump).
      const face = `${state}${c.resolved ? ' resolved' : ''}`;
      const was = S.faces.get(c.id);
      S.faces.set(c.id, face);
      const changed = was !== undefined && was !== face && !still.matches;
      if (changed) {
        pin.classList.remove('swap');
        void pin.offsetWidth; // so it plays again if it played before
        pin.classList.add('swap');
      }
      // The ring is the state (src/widget/styles.css): turning green while it works, still pale green when picked up, muted
      // while it waits in line, grey when it went quiet, amber when it asks. Moving between them crossfades; none to one fades in.
      // The pin is kept across redraws, so is its ring: one that stays in its state keeps turning, uninterrupted.
      const before = S.rings.get(c.id);
      S.rings.set(c.id, state);
      const ring = (/** @type {string | null} */ st, extra = '') => el('i', { class: `ring${RINGS[st] ?? ''}${extra}`, 'aria-hidden': 'true' });
      const shifted = changed && before !== state;
      let r = /** @type {HTMLElement | null} */ (pin.querySelector(':scope > .ring:not(.gone)'));
      if (state in RINGS) {
        pin.querySelector(':scope > .ring.gone')?.remove();
        const to = ring(state).className;
        if (!r) {
          r = ring(state, shifted ? (state === 'now' ? ' come' : ' off') : '');
          pin.append(r);
          const nr = r;
          if (shifted && state !== 'now') requestAnimationFrame(() => requestAnimationFrame(() => nr.classList.remove('off')));
        } else if (r.className !== to && !r.classList.contains('come')) {
          const nr = r;
          if (shifted) requestAnimationFrame(() => requestAnimationFrame(() => (nr.className = to)));
          else nr.className = to;
        } else if (r.classList.contains('come') && r.className !== `${to} come`) r.className = to;
      } else if (r) {
        if (shifted) {
          const gone = r;
          gone.classList.add('gone');
          gone.addEventListener('animationend', () => gone.remove(), { once: true });
        } else r.remove();
      }
      const oldTip = pin.querySelector(':scope > .tip');
      if (!tip) oldTip?.remove();
      else if (oldTip) { if (oldTip.textContent !== tip) oldTip.textContent = tip; }
      else pin.append(el('span', { class: 'tip', 'aria-hidden': 'true' }, tip));
      if (coarse && !pin.querySelector(':scope > .hit')) pin.append(el('i', { class: 'hit', 'aria-hidden': 'true' })); // a 44 pt place to tap (styles.css)
      pin.classList.toggle('ink', Boolean(ink));
      if (ink) {
        pin.querySelector(':scope > svg')?.remove();
        pin.append(inkSvg(ink, { left: 0, top: 0, width: zone.width, height: zone.height }));
      }
      const held = placePin(pin, c, ink && zone, left, top, moved);
      // Cut off by a box it's inside (see position; a held pin: the browser), or under a board's view over the page.
      pin.style.visibility = ((clipped && !held) || covered) && S.openId !== c.id ? 'hidden' : '';
      if (born) {
        // Bound once; they read what the pin shows now (pinData), not what it showed when it was made.
        grab(pin, () => pinData.get(pin).c);
        // Hovering a pin shows what it's on, as an open one does: a drawn area its outline, selected words their highlight.
        pin.addEventListener('pointerenter', () => {
          const d = pinData.get(pin);
          d.hot = true;
          if (coarse || S.openId === d.c.id) return;
          if (d.zone && !d.c.anchor.ink) d.shown = drawZone(d.zone, 'saved');
          else if (d.c.anchor?.quote) markQuote(d.c.anchor);
        });
        pin.addEventListener('pointerleave', () => {
          const d = pinData.get(pin);
          d.hot = false;
          d.shown?.remove();
          d.shown = null;
          if (d.zone || !d.c.anchor?.quote) return;
          if (isTrying()) relight(); // a tried choice: its green back
          else markQuote(S.quoted);
        });
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          const c = pinData.get(pin).c;
          if (pin.dataset.dragged) return;
          if (e.altKey && mayResolve(c)) return toggleResolved(c);
          // Phones: opening it goes through goTo, which moves the page so the pin sits above its sheet, not under it.
          if (coarse && S.openId !== c.id) return goTo(c);
          S.openId = S.openId === c.id ? null : c.id;
          S.draft = null;
          render();
        });
      }
      // Pointing at it while the page is redrawn: what it shows for being pointed at is drawn again with it.
      info.shown = null;
      if (info.hot && !coarse && S.openId !== c.id) {
        if (zone && !ink) info.shown = add(drawZone(zone, 'saved'));
        else if (c.anchor?.quote && !quoted) quoted = c.anchor;
      }
      next.push(pin);
      pinsById.set(c.id, pin);
      if (S.openId === c.id) {
        // Area comments open below the area, so the card doesn't hide what it is about.
        // Opened by a click: the reply box takes focus (not on touch screens, where it would pop the keyboard).
        // The reply box takes the cursor on a computer. Phones don't (no keyboard popping up over what you came to read,
        // Leo 15 Nov); a keyboard already up while stepping to the next one stays up.
        const card = threadCard(c, new Set(news.map((x) => x.id)), appear && (coarse ? S.keepKeys : !S.stepping || S.keepKeys));
        S.openCard = card;
        if (appear && !S.stepping) card.classList.add('in');
        // Reduced motion: the page's scroll to the pin is instant, so the card is drawn again within its fade: it keeps the fade (a fresh node has no class).
        if (appear) S.inAt = performance.now();
        else if (still.matches && performance.now() - S.inAt < 200) card.classList.add('in');
        if (prevHeight) card.style.minHeight = `min(${prevHeight}px, var(--_thread-max))`;
        S.stepping = S.keepKeys = false;
        next.push(card);
        const boardPin = c.anchor?.kind === 'board' && !heldPin(pin); // held to the screen by the script (onBoard), not tied
        placeCard(card, zone ? left + 14 : left, zone ? zone.top + zone.height : top, nativeTie() && !boardPin ? pin : null, zone ? zone.top - 12 : top - 40);
        if (boardPin && !sheetMode.matches) onBoard(card, c.anchor);
        // A question with choices on quoted words: by its quote, in the margin or under it (thread.ts). Drawn again after
        // the pick, it stays where it was instead of jumping back under its pin.
        if (!zone && (openAsk(c) || (!appear && prev?.matches('.margin, .under')))) placeAsk(card, c);
        if (card.matches('.margin, .under')) tieToPin(card, null, 'card'); // by its words, where the script put it
        if (card.tie) next.push(card.tie); // its line to the words (trial.ts), kept by the layer's redraw
        // Opens at the newest message, as the chat does (a short thread doesn't scroll), on phones too (they opened at
        // the first message).
        if (!appear && prevScroll != null) {
          const body = card.querySelector('.body');
          body.scrollTop = prevAtEnd ? body.scrollHeight : prevScroll;
          if (prevAtEnd) stayAtEnd(body); // a new message at the end stays in view while its words settle
        }
        else if (appear) {
          // Computers: at the first new message when there is one. Phones: already at the end when it shows, the last
          // message in view, as the chat opens (Leo, 15 Nov: no scroll you can see; the sheet's height is fixed now, so
          // nothing grows after it's set).
          const body = card.querySelector('.body');
          // An open question: at the question and its rows, not below them (thread.ts).
          const asks = openAsk(c) ? [...body.querySelectorAll('.msg.asks')].pop() : null;
          const first = asks || (coarse ? null : body.querySelector('.fresh, .newline'));
          const at = first ? () => !first.isConnected ? body.scrollTop : first.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8 : undefined;
          body.scrollTop = at ? at() : body.scrollHeight;
          stayAtEnd(body, at); // the end or the first new message, kept while it settles
        }
        if (coarse && S.cardFull) card.classList.add('full'); // stays pulled up while you step from comment to comment
        swipeDown(card, () => ((S.openId = null), (S.cardFull = false), render()), true);
        markSeen(news);
        if (news.length) {
          drawList(); // opened is read: the "N new" pill and the tab title count it off at once
        }
        quoted = zone ? null : c.anchor; // an area's outline says what it's on; only selected words get the highlight
      }
    });

    if (S.draft) {
      const draft = S.draft;
      const { anchor } = draft;
      const { left, top, zone } = position(anchor);
      if (zone && anchor.ink) add(inkSvg(anchor.ink, zone)); // a drawing shows its lines, with no draft pin
      else add(drawZone(zone, 'draft'));
      quoted = zone ? null : anchor; // an area lights no single word
      if (!anchor.ink) {
        const pin = el('div', { class: `pin draft${anim}` }, initial(store.get('lab-name')));
        pin.style.left = `${left}px`;
        pin.style.top = `${top}px`;
        flipAt(pin, left, null);
        onBoard(pin, anchor);
        layer.append(pin);
        next.push(pin);
      }
      const float = el('div', { class: `float${anim}` });
      const box = composer({
        placeholder: anchor.ink ? `${inkSaid(anchor.ink.mark)} · Enter sends, or add words` : S.unheard ? 'comment · no agent yet' : 'add a comment', // S.unheard: local labs, set from the lab's state; short, so on a phone it fits beside "as <name>" and the arrow (the long words wrapped and were cut), and the same wording on a computer (Leo, 21 Nov)
        opened: true, // the comment is already picked and its box open (the actions are one tap away)
        // Made by a hold on a phone: the finger's lift focuses the box (below). Focused before it, Safari could put the
        // cursor in without a keyboard, and the lift's focus then changed nothing (Leo, 19 Nov: "sometimes not in focus").
        autofocus: !S.pinnedByHold,
        draftKey: `lab-typing:${S.page}:new`,
        empty: anchor.ink ? inkSaid(anchor.ink.mark) : '',
        attach: true,
        onSubmit: async (name, said, att) => {
          const { comment, edit } = await send({ name, text: said, anchor, ...att });
          posted(comment, edit, said, anchor);
        },
      });
      float.append(el('div', { class: 'handle' }));
      // Paused: the moment this pin will carry, so you know it is kept (Leo, 19 Nov: "some info in pin where it was").
      const chip = anchor.moment && S.momentChip?.(anchor.moment); // only a paused video has one (Leo, 21 Nov)
      if (chip) float.append(chip);
      const row = quickRow(draft, box);
      if (row?.children.length) float.append(row);
      float.append(box);
      swipeDown(float, () => ((S.draft = null), keepSpot(null), render()));
      next.push(float);
      if (zone) placeCard(float, left + 14, zone.top + zone.height);
      else placeBeside(float, left, top, nativeTie() && anchor.kind !== 'board' ? layer.querySelector(':scope > .pin.draft') : null);
      if (!sheetMode.matches) onBoard(float, anchor);
      draft.back = false;
    }
    done();
  }

  S.grabbing = false; // a pin is being dragged to fix its spot (thread.ts grab)

  // The open thread's card. New replies (Claude's too) are added to it in place, so the reply box keeps focus.
  S.openCard = null;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // Where sheets take the screen's bottom (styles.css): a new comment on selected words grows into the sheet there.
  const sheetMode = matchMedia('(pointer: coarse) and (max-width: 560px), (pointer: coarse) and (max-height: 500px)');

  // ---------- events ----------
  const setOn = (value) => {
    S.on = value;
    if (!S.on) ptr.classList.remove('show'); // comments hidden: the system pointer is back at once
    else recheck();
    store.set('lab-on', S.on ? '1' : '0');
    S.checkSections?.(); // hidden comments: no section bar (the file loads if there is one to show)
    S.draft = S.on ? keptDraft() : null; // hidden, a new comment lets go of the screen; its words wait, and come back when comments do
    S.openId = null;
    render();
    mo?.drawMotion(); // the pause / play beside each moving thing goes and comes with the comments
  };
  toggleBtn.addEventListener('click', () => setOn(!S.on));
  // The ⋯ menu is a disclosure: the button says whether it's open; opening puts focus on its first item, and Escape
  // or a pick gives focus back to the button.
  // On a computer the menu is a popover the ⋯ button opens: the browser closes it on a press elsewhere or Esc, gives
  // focus back, and shows it above the page's own dialogs. hidden still says whether it is open.
  const popMenu = !coarse && CSS.supports('overlay', 'auto'); // phones: the menu stays in the bar (a pinch zoom scales the bar, not the top layer); Safari has no `overlay`, so a popover would close in one frame: it stays in the bar too, and fades (goOut)
  if (popMenu) {
    moreMenu.popover = 'auto';
    /** @type {HTMLButtonElement} */ (moreBtn).popoverTargetElement = moreMenu;
    moreMenu.addEventListener('beforetoggle', (e) => {
      const open = /** @type {ToggleEvent} */ (e).newState === 'open';
      if (open || !still.matches) moreMenu.hidden = !open;
      else { // reduced motion: it fades out where it is (display and hidden would end that at once)
        moreMenu.classList.add('out');
        setTimeout(() => (moreMenu.classList.remove('out'), moreMenu.matches(':popover-open') || (moreMenu.hidden = true)), ms('calm'));
      }
      moreBtn.setAttribute('aria-expanded', String(open)); // the browser doesn't write it for its invoker
      if (open) {
        moreMenu.classList.remove('out');
        if (LABS) void switcher().then((m) => m?.preloadSwitcher());
        requestAnimationFrame(() => [...moreMenu.querySelectorAll('button')].find((b) => !b.hidden && !b.disabled)?.focus({ preventScroll: true }));
      }
    });
  }
  function setMenu(open, refocus = false) {
    if (popMenu) {
      if (open !== moreMenu.matches(':popover-open')) moreMenu[open ? 'showPopover' : 'hidePopover']();
      if (!open && refocus) moreBtn.focus({ preventScroll: true });
      return;
    }
    if (open && LABS) void switcher().then((m) => m?.preloadSwitcher()); // the box and its list, ready by the time it is picked
    if (open) {
      moreMenu.classList.remove('out');
      moreMenu.hidden = false;
    } else if (!moreMenu.hidden) goOut(moreMenu, () => (moreMenu.hidden = true));
    moreBtn.setAttribute('aria-expanded', String(open));
    if (open) [...moreMenu.querySelectorAll('button')].find((b) => !b.hidden && !b.disabled)?.focus({ preventScroll: true });
    else if (refocus) moreBtn.focus({ preventScroll: true });
  }
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popMenu) setMenu(moreMenu.hidden || moreMenu.classList.contains('out')); // leaving counts as closed (a popover: the browser)
  });
  moreMenu.addEventListener('click', () => setTimeout(() => setMenu(false, true), 0));
  addEventListener('pointerdown', (e) => {
    if (!popMenu && !moreMenu.hidden && !e.composedPath().some((n) => n === moreMenu || n === moreBtn)) setMenu(false);
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popMenu && !moreMenu.hidden) {
      setMenu(false, true);
      e.stopPropagation();
    }
  }, true);
  // Motion (src/widget/motion.ts: pause and ¼ speed, the controls beside what moves, a pin's moment) is its own file, loaded
  // once something on the page moves (a video, an animation: looked for a second after the page starts, when one
  // starts, and on a phone each second), when ⌥ is held, P or S is pressed, or a comment has a moment; mo: the module, once it is.
  /** @type {any} */
  let mo = null;
  /** @type {Promise<any> | null} */
  let moAsked = null;
  const loadMotion = () => (moAsked ??= part('motion').then((m) => (m.bindMotion(W), (mo = m))).catch(() => (moAsked = null)));
  const lookForMotion = () => {
    if (!moAsked && (document.querySelector('video') || document.getAnimations().some((a) => !root.contains(/** @type {any} */ (a.effect)?.target)))) void loadMotion();
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !coarse && !mo) void loadMotion().then((m) => m?.altMotionSet(!e.metaKey && !e.ctrlKey && !e.shiftKey)); // its own keys come once it is there: this press is its first
  }, true);
  for (const type of ['animationstart', 'play']) addEventListener(type, lookForMotion, true);
  setTimeout(lookForMotion, 1000);
  if (coarse) {
    const phone = setInterval(() => (moAsked ? clearInterval(phone) : document.hidden || lookForMotion()), 1000);
  }
  doneBtn.addEventListener('click', toggleDone);
  movedBtn.addEventListener('click', () => (setMenu(false), stepMoved()));
  // Option-click (or Option-drag) with comments hidden still pins: comments come back with the new one.
  const showAgain = () => {
    if (S.on) return;
    S.on = true;
    store.set('lab-on', '1');
  };
  copyBtn.addEventListener('click', () => copy(agentLink()));
  // A #block link in a message: go to that block on the page. A phone's sheet covers the page, so it closes first.
  addEventListener('lab-goto', (e) => {
    const to = /** @type {CustomEvent} */ (e).detail;
    const target = typeof to === 'string' ? document.getElementById(to) : to; // an id, or the element itself (the section bar's)
    if (!target) return;
    if (coarse) {
      S.openId = null;
      S.chatOpen = false;
      render();
    }
    setTimeout(() => goToBlock(target), coarse ? 60 : 0); // after the sheet has started closing
  });
  listBtn.addEventListener('click', () => stepNew(1));
  chatBtn.addEventListener('click', () => {
    S.chatOpen = !S.chatOpen;
    // On a computer, opening the chat closes an open thread, and a new comment with nothing typed in it.
    if (S.chatOpen && !coarse) {
      S.openId = null;
      if (S.draft && !/** @type {HTMLTextAreaElement | null} */ (root.querySelector('.float textarea'))?.value.trim()) S.draft = null;
    }
    goOut(hint, () => (hint.hidden = true));
    render();
    // Computers: the cursor goes in the message box (phones wait for a tap, so the keyboard doesn't cover the chat).
    if (S.chatOpen && !coarse) /** @type {HTMLElement | null} */ (chatEl.querySelector('.chat textarea'))?.focus({ preventScroll: true });
  });
  // No close cross on the chat: a click outside it, Escape or T closes it (phones: the handle or the dimmed page).
  // On a computer a click outside the chat closes it (phones have the dimmed page for that); what you typed stays.
  // That click only closes: it doesn't start a comment or press what's under it.
  S.closingClick = false;
  document.addEventListener('pointerdown', (e) => {
    S.closingClick = false;
    if (coarse || !S.chatOpen || e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(chatEl) || path.includes(chatBtn)) return;
    S.chatOpen = false;
    // The widget's own buttons (N new, go, hide…) still do their thing; only a click on the page just closes. Their
    // bar is drawn again only after the click, or the button would be swapped out under it and the click lost.
    if (path.includes(host)) return void addEventListener('click', () => render(), { once: true });
    S.closingClick = true;
    render();
  }, true);
  addEventListener('click', (e) => {
    if (!S.closingClick) return;
    S.closingClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  const typing = (e) =>
    e.composedPath().some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)));
  document.addEventListener('keydown', (e) => {
    const inOtherWidget = document.activeElement?.localName.includes('-') && document.activeElement !== host; // e.g. an input in a closed shadow root
    if (actionOf(e) === 'toggle' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !typing(e) && !inOtherWidget) {
      e.preventDefault();
      setOn(!S.on);
      return;
    }
    // 1 to 6 answer an open question with that choice (thread.ts): before 1 is comment / pointer, which it keeps when no
    // question is open. Not while a text box has the focus.
    if (S.on && !coarse && /^Digit[1-6]$/.test(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && !typing(e) && !inOtherWidget && pickByKey(Number(e.code.slice(5)))) {
      e.preventDefault();
      return;
    }
    // ArrowDown / ArrowUp move the ticked row of an open question (tried in the page like pointing), stopping at the ends;
    // the page does not scroll while they are taken. Same rules as Enter.
    if (S.on && !coarse && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !typing(e) && !inOtherWidget
      && moveTicked(e.key === 'ArrowDown' ? 1 : -1)) {
      e.preventDefault();
      return;
    }
    // Enter takes the agent's pick of an open question (the ticked row), the same path as a tap. Not in a text box, nor
    // on a button or link (Enter presses that), and only when a row is ticked.
    if (S.on && !coarse && e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && !typing(e) && !inOtherWidget
      && !e.composedPath().some((n) => n instanceof HTMLElement && /^(BUTTON|A)$/.test(n.tagName)) && pickTicked()) {
      e.preventDefault();
      return;
    }
    if (S.on && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (/^z$/i.test(e.key || '') || (!/^[a-z]$/i.test(e.key || '') && e.code === 'KeyZ')) && !typing(e) && !inOtherWidget && placed.length) {
      e.preventDefault();
      return void undoLast();
    }
    // ⌥W (Leo 18 Nov: w does nothing in a text box) or Control-D goes to the next new comment from the widget's text boxes
    // too, where a plain W types a letter; Shift: back. By the key's place: Option turns W into ∑ on a Mac.
    const nextKey = (e.altKey && !e.ctrlKey && e.code === 'KeyW') || (e.ctrlKey && !e.altKey && e.code === 'KeyD');
    if (S.on && nextKey && !e.metaKey && !(typing(e) && !e.composedPath().includes(host))) {
      e.preventDefault();
      // Words typed in a reply box aren't thrown away: it nudges instead, send or clear them first.
      const typed = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('.card textarea, .float textarea'));
      if (typed?.value.trim()) return shake(typed.closest('.card, .float'));
      return stepNew(e.shiftKey ? -1 : 1);
    }
    const act = actionOf(e);
    // The list's keys, with comments shown and nothing typed: L list, T chat, J/K next/previous, R reply, E resolve.
    // By the key's place, not its letter, so the keys work with any layout (Russian, Greek…): the C key is C (keyOf).
    // The keys (Leo, 2026-11-15/16), marked in the bar's words: cha(t) (C was chat until 19 Nov), ne(w) (Shift-W: the one before),
    // P pause, M hide, D show/hide done. With a thread open: R reply, E resolve.
    // Shift is only for next (Shift-W: the one before); ⇧D, ⇧B and the rest belong to the board.
    if (S.on && !typing(e) && !inOtherWidget && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && ['pause', 'slow', 'chat', 'next', 'done', 'reply', 'resolve'].includes(act) && (act === 'next' || act === 'done' || !e.shiftKey)) { // ⇧D draws too: Shift straightens (below)
      const k = act;
      e.preventDefault();
      if (k === 'pause') return void loadMotion().then((m) => m?.setPause(!S.paused));
      if (k === 'slow') return void loadMotion().then((m) => m?.setSlow(!S.slow));
      if (k === 'chat') return chatBtn.click();
      if (k === 'next') return stepNew(e.shiftKey ? -1 : 1);
      if (k === 'done') return void ((S.dKey = true), (S.dShift = e.shiftKey), (S.drew = false), part('draw')); // on release (below): held, D draws (draw.ts); ⇧D tapped alone stays the board's
      if (k === 'reply' && S.openId) /** @type {HTMLElement | null} */ (root.querySelector('.card textarea'))?.focus({ preventScroll: true });
      else if (k === 'resolve' && S.openId && S.isAdmin) [.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.card .btn'))].find((b) => /^(resolve|reopen)$/.test(b.textContent))?.click();
      return;
    }
    // Escape closes the top one: a thread or new comment first, then the chat, then the list (typed chat text stays).
    if (e.key === 'Escape' && (S.draft || S.openId)) {
      // A new comment let go with Escape takes its words and its spot with it (a reload would give a box back that was
      // closed on purpose); a click elsewhere only closes an empty one, and the words wait.
      if (S.draft) {
        store.set(`lab-typing:${S.page}:new`, '');
        keepSpot(null);
      }
      S.draft = null;
      S.openId = null;
      e.preventDefault(); // this press was this one's: whatever listens after (the board's Esc) leaves it
      render();
    } else if (e.key === 'Escape' && S.chatOpen) {
      S.chatOpen = false;
      e.preventDefault();
      render();
    }
  });

  // Always ready to pin: a click on the page (not on a link or control) opens a new comment there.
  // Alt/Option-click pins on links and controls too. With a comment open, the first click outside only closes it.
  const INTERACTIVE =
    'a, button, input, textarea, select, label, summary, video[controls], audio, iframe, [contenteditable], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"]), [onclick]';
  // The page's own controls: links, buttons and fields, and anything the page gives a hand pointer (a clickable card, a
  // demo you tap to play), or that's inside one. A click there is the page's, as its pointer says; the widget's pointer
  // steps aside over them (lab-ctl). Clicking demos dropped stray pins (Leo, 16 Nov).
  // Whether the thing under the mouse keeps its own click, said in the class the pointer rules read.
  const sayCtl = (t) =>
    document.documentElement.classList.toggle(
      'lab-ctl',
      !host.contains(/** @type {Node} */ (t)) && t !== host && control(t),
    );
  // Said again without waiting for the mouse to move.
  const control = (t) => {
    for (let n = t instanceof Element ? t : null; n && n !== document.body && n !== document.documentElement; n = n.parentElement)
      if (n.matches(INTERACTIVE) || getComputedStyle(n).cursor === 'pointer') return true;
    return false;
  };
  // data-uncommentable: no new pins or areas start inside this part of the page (same attribute as Claude artifacts).
  const OFF = '[data-uncommentable]';
  // Is this press on a part marked so? Through shadow roots (a board's view has one), where the press's own target is the host.
  const isOff = (e) => e.composedPath().some((n) => n instanceof Element && n.matches(OFF));
  bindDrag(W);

  // Option (Alt) presses are for commenting: the page never sees them, so a menu item or a button doesn't run
  // and close itself before the pin lands on it.
  const optionPress = (e) => e.altKey && !e.metaKey && !e.ctrlKey && e.button === 0 && !e.composedPath().includes(host) &&
    !isOff(e);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    addEventListener(type, (e) => {
      if (!optionPress(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'pointerdown') startDrag(e);
      if (type === 'pointerup') endDrag(e);
    }, true);
  }
  addEventListener('click', (e) => {
    if (!optionPress(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!S.afterDrag) onPageClick(e); // the click that ends an Option-drag belongs to the area
  }, true);

  // Whether a click is on one of the page's controls is read as it starts, before the page's own handlers run: a demo
  // that redraws itself on click left its target off the page, which then didn't look like a control (and got pinned).
  S.ctlClick = false;
  addEventListener('click', (e) => (S.ctlClick = control(e.target)), true);
  document.addEventListener('click', (e) => onPageClick(e));

  // Phones. A tap only reads (it closes what's open); holding a finger still for half a second pins, anywhere, links
  // and buttons too (the phone's Option-click). Text selected the phone's way gets the actions bar that pins on it.
  S.lastTouch = 0;
  S.pinnedByHold = false; // a hold just made a pin: the lift that ends it puts the cursor in its box (phones open the keyboard only then)
  const scrim = /** @type {HTMLElement} */ (root.querySelector('.scrim'));
  // The open sheet (phones): a thread, a new comment, the list or the chat.
  /** @returns {HTMLElement | null} */
  const openSheet = () => (S.labsOpen && labs?.switcherSheet()) || root.querySelector('.card:not(.out), .float:not(.out)') || (S.chatOpen ? chatEl : null);
  const closeAll = () => {
    if (S.labsOpen) return labs?.closeSwitcher(); // labs & pages sits over the others: only it goes
    S.draft = null;
    S.openId = null;
    S.chatOpen = false;
    render();
  };
  // Unsent words: the card or sheet shakes sideways ("no") instead of closing, on a computer (⌥W) and a phone alike.
  const shake = (/** @type {Element | null | undefined} */ node) => node?.animate?.([{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: ms('base'), easing: ease() });
  // Text typed in a thread or a new comment would be lost, so the sheet stays and shakes instead; the chat's box keeps
  // its text when closed, so the chat always closes.
  const closeOrNudge = () => {
    const node = openSheet();
    if (![...root.querySelectorAll('textarea')].some((t) => t.value.trim() && !chatEl.contains(t))) return slideAway(node, closeAll);
    shake(node);
  };
  // A tap on the dimmed page closes the sheet; a pull on it moves the sheet with the finger (see swipeDown), and the
  // click that ends such a pull isn't a tap.
  S.sheetDraggedAt = -1e9;
  scrim.addEventListener('click', () => performance.now() - S.sheetDraggedAt > 300 && closeOrNudge());
  scrim.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false }); // iOS's sheet curve
  // Android's back gesture closes an open sheet first, like a native one, instead of leaving the page (CloseWatcher,
  // Chrome 120+; elsewhere back works as before). With something typed it nudges, as a tap on the dimmed page does.
  S.backWatcher = null;
  // iOS lays fixed things out on the page's full height while the keyboard covers its bottom part (and Safari may
  // pan the view). Measure what is hidden below what the screen shows, from a fixed probe the height of the layout,
  // so the sheets keep their box just above the keyboard and fit the rest (see --lab-kb and --lab-vh in the CSS).
  const vv = window.visualViewport;
  startSheets();
  swipeDown(chatEl, () => ((S.chatOpen = false), render()), true);
  S.press = null;
  const stopPress = () => S.press && (clearTimeout(S.press.timer), (S.press = null));
  // The page can't be selected while a finger is down on it (see lab-press in the CSS below), and can again a frame
  // after the lift, once iOS has let go of its own long press. Safari doesn't repaint the quoted words' green when the
  // text turns selectable, so the highlight a hold just set is set again, a frame later.
  const pressing = (on) => {
    const html = document.documentElement;
    if (on) return html.classList.add('lab-press');
    if (!html.classList.contains('lab-press')) return;
    requestAnimationFrame(() => {
      html.classList.remove('lab-press');
      const lit = window.CSS?.highlights?.get('lab-quote');
      if (lit) CSS.highlights.set('lab-quote', new Highlight(...lit));
    });
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      stopPress();
      S.pinnedByHold = false;
      if (e.pointerType === 'touch') S.lastTouch = Date.now();
      if (e.pointerType !== 'touch' || S.draft || !(e.target instanceof Element) || e.composedPath().includes(host) || isOff(e)) return;
      const { clientX: x, clientY: y } = e;
      pressing(true);
      S.press = {
        x,
        y,
        timer: setTimeout(() => {
          S.press = null;
          S.pinnedByHold = true;
          navigator.vibrate?.(8);
          getSelection?.()?.removeAllRanges();
          S.afterDrag = true; // the lift that ends the hold isn't a tap on the link
          setTimeout(() => (S.afterDrag = false), 800);
          showAgain();
          S.openId = null;
          pinned(() => begin(anchorAt(x, y)));
          // 400 ms: before iOS's own long press (~500 ms), which selects text and cancels the touch. At 500 ms the two
          // raced, and the hold sometimes gave a text selection instead of a pin (iOS 27 simulator, 16 Nov).
        }, 400),
      };
    },
    true,
  );
  document.addEventListener('pointermove', (e) => S.press && Math.hypot(e.clientX - S.press.x, e.clientY - S.press.y) > 10 && stopPress(), true);
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') S.lastTouch = Date.now();
    stopPress();
    pressing(false);
    // A finger's lift is touchend's (one focus, so the keyboard doesn't close and open again).
    if (S.pinnedByHold && e.pointerType !== 'touch') /** @type {HTMLElement | null} */ (root.querySelector('.float textarea'))?.focus({ preventScroll: true });
  }, true);
  // The lift after a hold: no click follows it (it would land on the dimmed page and take the cursor away), and the
  // touch's own end puts the cursor in the box, so the phone opens its keyboard.
  document.addEventListener('touchend', (e) => {
    pressing(false);
    if (!S.pinnedByHold) return;
    e.preventDefault();
    const box = /** @type {HTMLElement | null} */ (root.querySelector('.float textarea'));
    if (box && root.activeElement === box) box.blur(); // focused without a keyboard: again from the lift, so it opens
    // The cursor goes in here, in the lift itself: a real iPhone opens its keyboard only for a focus made in the touch (one
    // made a moment later, from a timer, opened it in the simulator and not on Leo's phone: "its not in focus now", 21 Nov).
    S.pinnedByHold = false;
    getSelection?.()?.removeAllRanges();
    box?.focus({ preventScroll: true });
    liftedDraft(); // (the page was put where the pin shows above the sheet as the pin appeared: sheets.ts revealDraft)
  }, { capture: true, passive: false });
  // Phones: nothing but the widget's own fields starts a selection (no Shift there to ask for one), and a hold's lift
  // clears one that iOS began anyway.
  if (coarse) document.addEventListener('selectstart', (e) => {
    const t = e.composedPath()[0];
    if (!(t instanceof Node) || !(t instanceof Element ? t : t.parentElement)?.closest?.('textarea, input, [contenteditable]')) e.preventDefault();
  }, true);
  // iOS took the touch (its own long press): no lift comes, and a tap in the box opens the keyboard. The next touch's
  // lift isn't this hold's.
  document.addEventListener('touchcancel', () => (S.pinnedByHold = false), true);
  document.addEventListener('pointercancel', () => (stopPress(), pressing(false)), true);
  addEventListener('scroll', stopPress, { passive: true, capture: true });
  document.addEventListener('contextmenu', (e) => (S.press || S.afterDrag) && e.preventDefault(), true);
  // The actions row of a new comment (the box is the comment, so no button for it): your own actions (labit.json
  // `actions`), each sending its text at once on a click. They go through the box's own send, so a missing name is asked
  // for there, a lab that can't be reached keeps them. ⌥ + 1…4 runs the nth button (holding ⌥ shows the numbers).
  const quickRow = (draft, box) => {
    const row = el('div', { class: 'quick' });
    const field = /** @type {HTMLTextAreaElement} */ (box.querySelector('textarea'));
    const fill = (v) => ((field.value = v), field.dispatchEvent(new Event('input')));
    const go = (said, prompt = '') => {
      if (prompt) draft.anchor.act = prompt; // the agent reads the whole prompt: "action: …"
      else delete draft.anchor.act;
      fill(said);
      /** @type {HTMLElement} */ (box.querySelector('.send')).click();
    };
    const chip = (a) => {
      const b = actButton(a.name);
      b.title = a.prompt;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // the cursor stays in the box
      b.addEventListener('click', () => go(field.value.trim() ? `${a.name}: ${field.value.trim()}` : a.name, a.prompt));
      return b;
    };
    // Your list, in its order, as many chips as fit on one line (measured); the ones that don't fit are not shown. The
    // list itself is set in labit.json or your settings.json (`actions`, docs/settings.md): nothing on the page edits it.
    const chips = LIST.map(chip);
    row.append(...chips);
    // +board (on a page; a guest too, who is the person on another device): a board for pictures and pages goes into the
    // page as a section at this spot, and opens; no pin is left (Leo, 21 Nov: "only board sections is enough"). The words
    // typed are its title. It is labit's own, not one of your list, so it looks different and sits at the right end.
    if (!S.board && draft.anchor.kind !== 'board') {
      const own = Object.assign(actButton('+board'), { className: 'own', title: 'a board of pictures and pages, as a section of the page here' });
      own.addEventListener('mousedown', (e) => e.preventDefault());
      own.addEventListener('click', () => {
        const title = field.value.trim();
        fill('');
        S.draft = null;
        keepSpot(null);
        render();
        void addBoard(draft.anchor, title);
      });
      row.append(own);
    }
    let tries = 0;
    const measure = () => {
      if (!row.isConnected || !row.clientWidth) return void (tries++ < 10 && requestAnimationFrame(measure));
      const over = () => row.scrollWidth > row.clientWidth + 1;
      for (let shown = chips.length; over() && shown; ) chips[--shown].remove();
      [...row.children].forEach((b, n) => b.setAttribute('data-n', String(n + 1)));
    };
    queueMicrotask(measure);
    // ⌥ + 1…4 (by the key's place, so Option's own characters don't matter) runs the nth button; holding ⌥ shows the numbers.
    [...row.children].forEach((b, n) => b.setAttribute('data-n', String(n + 1)));
    const alt = (on) => row.classList.toggle('alt', on);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') alt(true);
      const n = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey ? /^Digit([1-4])$/.exec(e.code)?.[1] : '';
      const b = row.isConnected && n ? row.children[+n - 1] : null; // a line saved over (✎) answers no more
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      /** @type {HTMLElement} */ (b).click();
    }, true);
    box.addEventListener('keyup', (e) => e.key === 'Alt' && alt(false), true);
    box.addEventListener('focusout', () => alt(false));
    return row;
  };
  // Computers: Shift + drag (or Shift + double or triple click) selects words; letting go opens the comment dialog.
  document.addEventListener('mouseup', (e) => {
    if (S.on && e.shiftKey && !S.shiftUp && e.button === 0 && !draftHasText() && !e.composedPath().includes(host)) setTimeout(offerSelection, 0);
  }, true);
  // A sent pin's card, opened by the send for its undo and not touched since, lets go on a press on the page, at once, so a
  // drag over words it covered still selects them (a4c5ddc). The click that press makes only lets it go (Leo, 19 Nov:
  // "when comment still 'undo' clicking outside opening another comment"): no new pin there; the sent one stays, and the
  // next click pins as usual. A link or the page's own control still acts (onPageClick prevents nothing).
  S.undoLetGo = 0; // when a press let a sent pin's undo card go: that press's click starts no pin
  S.letUndoGo = (e, draw = true) => {
    if (S.draft || !S.undo || S.openId !== S.undo.id || S.undo.touched || e.composedPath().includes(host)) return false;
    S.undo = null;
    S.openId = null;
    if (draw) render();
    return true;
  };
  document.addEventListener('pointerdown', (e) => {
    S.undoLetGo = 0;
    if (S.letUndoGo(e)) S.undoLetGo = Date.now();
  }, true);
  function onPageClick(e) {
    if (e.composedPath().includes(host)) return;
    if (S.undoLetGo && Date.now() - S.undoLetGo < 2000) return void (S.undoLetGo = 0); // this click let a sent pin's undo card go (above)
    if (S.draft || S.openId) {
      // Typed text doesn't keep it open (Leo, 18 Nov): the click closes it and the words stay as a draft (the box saves them as
      // they are typed, and the spot is kept, so it comes back); Escape discards them.
      S.draft = null;
      S.openId = null;
      render();
      return;
    }
    if ((!S.on && !e.altKey) || e.button !== 0 || e.metaKey || e.ctrlKey || (e.shiftKey && !S.shiftUp)) return;
    if (S.lastTouch && Date.now() - S.lastTouch < 800) return; // phones: a tap scrolls and reads; holding pins (below)
    if (e.altKey) e.preventDefault();
    else if (e.defaultPrevented || S.ctlClick) return;
    if (isOff(e)) return;
    if (String(getSelection?.() || '').trim()) return;
    showAgain();
    if (S.dKey && S.drew) return; // D held and something drawn (or cancelled): a click is part of that, not a pin
    if (S.dKey) S.drew = true; // a click with D held is a pin: letting D go then doesn't also show or hide done pins
    pinned(() => begin(anchorAt(e.clientX, e.clientY)));
  }
  // While a patched-in save cross-fades (live.ts) the browser hits nothing but <html> under a point: the pin is made once it is done.
  const pinned = (go) => (W.fade ? W.fade.then(go) : go());

  // A pin whose 28 px would hang past the screen's right edge points the other way: its body left of its tip, so it is
  // seen whole and never makes the page scroll sideways (a phone's sheets then measure a wider page and are cut off).
  const flipAt = (pin, left, zone) => pin.classList.toggle('flip', !zone && left + 28 > viewW);
  // A pin at its spot; a drawing (draw.ts) over its whole area, its lines stretched to it.
  const inkAt = (pin, zone, left, top) => {
    const svg = zone && pin.querySelector(':scope > svg');
    if (svg) Object.assign(svg.style, { width: `${zone.width}px`, height: `${zone.height}px` });
    pin.style.left = `${zone ? zone.left : left}px`;
    pin.style.top = `${zone ? zone.top : top}px`;
  };
  // A card or box tied to its pin by the browser (thread.ts tieToPin): on a computer; phones keep their sheets.
  const nativeTie = () => !sheetMode.matches;
  // A board pin's frame box, read with the other pins' elements before any pin is written (pinhold.ts readPins).
  const frameBox = (a) => (a.frame && a.fx !== undefined ? /** @type {any} */ (window).__labBoard?.box?.(a.frame) : null) || null;
  const placePin = (pin, c, zone, left, top, moved) => {
    const a = c.anchor || {};
    flipAt(pin, left, zone || a.kind === 'board');
    let held;
    if (a.kind === 'board') {
      // A board pin on a frame: tied to the frame's box by its share of it, so the board's camera carries it (pinhold.ts).
      // Its size from the board, not the box: reading the box after the last pin was written lays the page out again, once per pin.
      const B = /** @type {any} */ (window).__labBoard;
      const box = a.frame && a.fx !== undefined ? B?.box?.(a.frame) : null;
      const size = box && (B.size?.(a.frame) || { w: box.offsetWidth, h: box.offsetHeight });
      // (an area's pin is at the corner where the drag ended)
      const share = size?.w && size.h ? { x: (a.fx + (a.pinX ? (a.zw || 0) * size.w : 0)) / size.w, y: ((a.fy || 0) + (a.pinY ? (a.zh || 0) * size.h : 0)) / size.h } : null;
      held = holdPin(pin, Boolean(share), share ? box : null, left, top, share || undefined);
    } else {
      const node = moved ? null : findTarget(a);
      held = holdPin(pin, Boolean(node), node, zone ? zone.left : left, zone ? zone.top : top);
    }
    if (!held) inkAt(pin, zone, left, top);
    else if (zone) inkAt(pin, zone, zone.left, zone.top);
    onBoard(pin, a); // a board's pin the browser doesn't hold: held to the screen
    return held;
  };
  // Scrolling an inner box or the page growing only moves the pins: their places are read together, then written.
  // A full redraw happens only when something is open (a card or a composer follows its pin) or the pins changed.
  // After a scroll, the pins the browser holds are left alone.
  const movePins = (scrolled = false) => {
    // An open thread is drawn again with its pin; after a scroll, not when the browser holds the pin and its card.
    const openHeld = () => { const pin = pinsById.get(S.openId); return heldPin(pin) && !pinData.get(pin)?.zone; };
    if (!S.on || (S.openId && !(scrolled && openHeld()))) return render();
    newPass();
    viewW = document.documentElement.clientWidth;
    const all = threads().filter((c) => c.anchor?.kind !== 'page');
    const skip = (c) => scrolled && heldPin(pinsById.get(c.id));
    const places = all.filter((c) => !skip(c)).map((c) => [pinsById.get(c.id), position(c.anchor || {}), c]).filter(([, at]) => !at.moved);
    readPins(places.map(([, , c]) => (c.anchor?.kind === 'board' ? frameBox(c.anchor) : findTarget(c.anchor || {}))));
    if (places.length + all.filter(skip).length !== pinsById.size || places.some(([pin]) => !pin)) return render(); // one lost or found its spot
    for (const [pin, { left, top, clipped, covered, zone }, c] of places) {
      const held = placePin(pin, c, pin.classList.contains('ink') && zone, left, top, false);
      pin.style.visibility = (clipped && !held) || covered ? 'hidden' : '';
    }
    flushPins();
  };
  // An open card with the cursor in its reply box is not drawn again (the box would lose its caret, selection and words):
  // its pin and card are put at the page's new place where they stand. False when that is not a plain pin and card (an
  // area, a board, a question's margin card, a phone's sheet): they wait for the cursor to leave, as before.
  const followOpen = () => {
    const c = threads().find((t) => t.id === S.openId);
    const pin = pinsById.get(S.openId);
    const card = S.openCard;
    const a = c?.anchor || {};
    if (!c || !pin || !card?.isConnected || sheetMode.matches || card.matches('.margin, .under') || a.kind === 'board' || a.kind === 'page') return false;
    newPass();
    viewW = document.documentElement.clientWidth;
    const at = /** @type {any} */ (position(a));
    if (at.moved || at.zone) return false;
    readPins([findTarget(a)]);
    const held = placePin(pin, c, false, at.left, at.top, false);
    pin.style.visibility = (at.clipped && !held) || at.covered ? 'hidden' : '';
    flushPins();
    placeCard(card, at.left, at.top, nativeTie() ? pin : null, at.top - 40);
    return true;
  };
  // The host sits at the page's top left corner (styles.css :host), as its box's own: a page that makes <body> or <html>
  // the box an absolute child counts from (position: relative, transform, filter, contain, will-change, a margin on it)
  // moves that corner, and every pin with it. Zoom does the same (`zoom` on the page scales what is drawn inside it).
  // So the host is measured where it stands, and set back at the page's corner, zoomed the other way.
  const fitProbe = $('.fit');
  const fitVars = { x: 0, y: 0, z: 1 };
  const fit = () => {
    const k = fitProbe.getBoundingClientRect().width / 100;
    if (k > 0 && Math.abs(k - 1) > 0.001) host.style.setProperty('--lab-fz', String((fitVars.z = Math.min(10, Math.max(0.1, fitVars.z / k)))));
    const r = host.getBoundingClientRect();
    const [dx, dy] = [r.left + scrollX, r.top + scrollY];
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    host.style.setProperty('--lab-fx', `${(fitVars.x -= dx)}px`);
    host.style.setProperty('--lab-fy', `${(fitVars.y -= dy)}px`);
  };
  S.frame = 0;
  let reflowAll = false; // something but a scroll asked (a resize, the page's size): every pin is placed again
  const reflow = (scrolled) => {
    reflowAll ||= scrolled !== true;
    cancelAnimationFrame(S.frame);
    S.frame = requestAnimationFrame(() => {
      fit();
      const scrolledOnly = !reflowAll;
      // Keep an open composer's text: a new comment's box (and a drag) is not drawn again; neither is a reply box with
      // the cursor in it (its card follows in place).
      if (S.draft || S.grabbing || isTrying()) return; // words tried in place: the pins stay put
      const box = /^(textarea|input)$/.test(root.activeElement?.localName || '') || Boolean(/** @type {HTMLElement | null} */ (root.activeElement)?.isContentEditable);
      if (box && !(S.openId && followOpen())) return;
      reflowAll = false;
      if (!box) movePins(scrolledOnly);
    });
  };
  addEventListener('resize', reflow);
  addEventListener('resize', () => requestAnimationFrame(() => requestAnimationFrame(revealOpen))); // a turned phone: the open thread's pin stays in sight, above its sheet
  // A question's card in the margin (thread.ts) that no longer fits a narrower window goes back where cards go.
  addEventListener('resize', () => {
    const card = layer.querySelector('.card.margin');
    if (card && card.getBoundingClientRect().right > document.documentElement.clientWidth - 12) requestAnimationFrame(render);
  });
  addEventListener('scroll', (e) => e.target !== document && !host.contains(/** @type {Node} */ (e.target)) && reflow(true), { capture: true, passive: true }); // the page's own scroll moves only what is held to the screen

  // Client-side navigation (pushState, back/forward, Astro view transitions): comments follow the new page,
  // and the layer comes back if the page swapped out <body>.
  const navigated = () => {
    if (!host.isConnected && document.body) {
      document.body.append(host);
      fit();
    }
    if (!pageStyle.isConnected) document.head.append(pageStyle);
    if (!pinCursorStyle.isConnected) document.head.append(pinCursorStyle);
    const was = S.page;
    S.page = pageNow();
    S.routed?.(); // the section bar (sections.ts)
    if (S.page === was) return;
    S.seen = readSeen();
    pass = null;
    syncReads();
    S.comments = [];
    S.draft = null;
    S.openId = null;
    render();
    load();
    setTimeout(() => S.checkSections?.(), 400);
  };
  // The Navigation API says when the current entry changed (pushState, replaceState, back and forward alike), so the
  // page's own history is left as it is.
  /** @type {any} */ (window).navigation.addEventListener('currententrychange', () => queueMicrotask(navigated));
  document.addEventListener('astro:after-swap', navigated);
  // Pick up comments others left while this tab was in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.draft && !root.activeElement) load();
  });
  if ('ResizeObserver' in window) new ResizeObserver(reflow).observe(document.body);

  // The rules that act on the page itself (the pinning cursor, a drag's no-select, a sheet's overscroll), not on the
  // widget: a stylesheet in the document's head, since the widget's own live in its shadow root. The font is the system's
  // own, so nothing downloads.
  const pageStyle = document.createElement('style');

  // A comment pin as the pointer over everything you can comment on (links and controls keep theirs): the white
  // teardrop with a +, clicking at its point. Holding Shift gives the text cursor back for selecting words.
  // It looks like your own pin: the white teardrop with your initial (a + before you've given a name). It points (bottom
  // left) where the click lands.
  const pinCursorStyle = document.createElement('style');
  // The pointer itself is drawn (an element styled with CSS that follows the mouse), not an image: so it changes
  // smoothly, and fades out where the system pointer takes over (links, fields, the widget, Shift). Mice only; touch and
  // pens keep what they had.
  const ptr = el('div', { class: 'ptr', 'aria-hidden': 'true' });
  ptr.append(el('span', { class: 'ini' }, '+'));
  root.append(ptr);
  // It shows exactly where the system pointer is hidden (cursor: none from the rules above): never two pointers, never
  // none. That's checked on every move, and again when the page scrolls under a still mouse, Shift or Option is pressed,
  // or comments are switched.
  S.mouse = null; // the last mouse position
  const place = (x, y, target) => {
    const show = Boolean(target) && target !== host && !host.contains(target) && getComputedStyle(target).cursor === 'none';
    ptr.classList.toggle('show', show);
    ptr.style.transform = `translate(${x - 1}px, ${y - 27}px)`;
  };
  // The element under a still mouse, into open shadow roots (a board's view): its host alone inherits the page's hidden
  // pointer, and the drawn pin showed over a board for a moment after a picture was deleted (Leo, 21 Nov).
  const under = (x, y) => {
    let t = document.elementFromPoint(x, y);
    for (let n; t?.shadowRoot && t !== host && (n = t.shadowRoot.elementFromPoint(x, y)) && n !== t;) t = n;
    return t;
  };
  const recheck = () => S.mouse && requestAnimationFrame(() => S.mouse && place(S.mouse.x, S.mouse.y, under(S.mouse.x, S.mouse.y)));
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    ptr.classList.remove('still');
    document.documentElement.classList.add('lab-drawn');
    S.mouse = { x: e.clientX, y: e.clientY };
    const t = e.composedPath()[0];
    // Over the page's own controls the widget's pin pointer steps aside (the page's hand shows): a click there is theirs.
    if (t !== S.ctlTarget) {
      S.ctlTarget = t;
      sayCtl(t);
    }
    place(e.clientX, e.clientY, t instanceof Element ? t : null);
  }, { capture: true, passive: true });
  addEventListener('scroll', recheck, { capture: true, passive: true });
  addEventListener('keydown', (e) => (e.key === 'Shift' || e.key === 'Alt') && recheck(), true);
  addEventListener('keyup', (e) => (e.key === 'Shift' || e.key === 'Alt') && recheck(), true);
  document.documentElement.addEventListener('mouseleave', () => ((S.mouse = null), ptr.classList.remove('show')));
  addEventListener('blur', () => ((S.mouse = null), ptr.classList.remove('show')));
  // No pictures: where the drawn pin can't show (an open dialog or full screen draws above it, or before the mouse first
  // moves) the system pointer is a plain crosshair for comments.
  S.cursorKey = '';
  function refreshPinCursor() {
    const ch = (initial(store.get('lab-name')) || '+').replace(/[<>&'"]/g, '');
    if (ch === S.cursorKey) return; // nothing changed: leave the pointers alone
    S.cursorKey = ch;
    ptr.querySelector('.ini').textContent = ch;
    // In a cascade layer, so a page's own pointers (a clickable card) still win over ours.
    const plain = `:not(${INTERACTIVE}, a *, button *, label *, [role="button"] *, [contenteditable], [contenteditable] *, ${OFF}, ${OFF} *, [data-lab-comments])`;
    const top = `dialog, dialog *, [popover], [popover] *, :fullscreen, :fullscreen *`;
    pinCursorStyle.textContent =
      `@layer lab-pointer { html:has([data-lab-pinning]):not(.lab-shift-cur, .lab-ctl) body, html:has([data-lab-pinning]):not(.lab-shift-cur, .lab-ctl) body *${plain} { cursor: crosshair; } ` +
      // With the drawn pointer the system one hides over plain parts of the page (not in the top layer, which is above it).
      `html.lab-drawn:has([data-lab-pinning]):not(.lab-shift-cur, .lab-ctl):not(.lab-dragging) body, html.lab-drawn:has([data-lab-pinning]):not(.lab-shift-cur, .lab-ctl):not(.lab-dragging) body *${plain}:not(${top}) { cursor: none; } ` +
      // Holding Shift (drag to quote words): the drawn I-beam with a low ink band at its foot (C3, Leo 18 Nov; text where a cursor image isn't drawn) over the page's content, back to the pin when it's let go.
      `html:has([data-lab-pinning]).lab-shift-cur:not(.lab-dragging) body *${plain}:not(img, svg, video, canvas) { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect x='5' y='15.5' width='14' height='5' rx='1.5' fill='%23f0b70a' fill-opacity='.6'/%3E%3Cpath d='M9 4h6M12 4v16M9 20h6' stroke='white' stroke-width='4' stroke-linecap='round' fill='none'/%3E%3Cpath d='M9 4h6M12 4v16M9 20h6' stroke='%23141414' stroke-width='1.5' stroke-linecap='round' fill='none'/%3E%3C/svg%3E") 12 12, text; } ` +
      // The pointer is inherited, so places that aren't commented on name theirs: editable text a text cursor, a part
      // marked data-uncommentable the plain arrow (a pin pointer there would promise a comment that won't come).
      `html:has([data-lab-pinning]) body :is([contenteditable], [contenteditable] *) { cursor: text; } html:has([data-lab-pinning]) body :is(${OFF}, ${OFF} *) { cursor: auto; } }` +
      // Holding Option (Alt) pins links and controls too: the drawn pin shows over them (the system pointer hides).
      `html.lab-alt body, html.lab-alt body *:not([data-lab-comments], [data-lab-comments] *, ${OFF}, ${OFF} *) { cursor: crosshair !important; }` +
      `html.lab-drawn.lab-alt body, html.lab-drawn.lab-alt body *:not([data-lab-comments], [data-lab-comments] *, ${OFF}, ${OFF} *, ${top}) { cursor: none !important; }`;
  }
  // Computers, comments on: a click or drag doesn't select the page's text; hold Shift to select (and quote) words.
  // Fields and editable text stay selectable.
  pageStyle.textContent += `@media (pointer: fine) { html:has([data-lab-pinning]):not(.lab-shift, .lab-lit) body > :not([data-lab-comments]), html:has([data-lab-pinning]):not(.lab-shift, .lab-lit) body > :not([data-lab-comments]) :not(input, textarea, select, [contenteditable], [contenteditable] *) { -webkit-user-select: none; user-select: none; } }`;
  bindKeys(W);
  pageStyle.textContent += 'html.lab-dragging, html.lab-dragging * { user-select: none !important; -webkit-user-select: none !important; cursor: crosshair !important; }';
  // While a sheet is open, a swipe down is the sheet's, not the browser's pull-to-refresh.
  pageStyle.textContent += 'html.lab-sheet, html.lab-sheet body { overscroll-behavior-y: none; }';
  // The agent's ring draws its arc in (lab C2): an arc length that can animate has to be registered on the page itself.
  pageStyle.textContent += '@property --lab-arc { syntax: "<percentage>"; inherits: false; initial-value: 66%; }';
  // The room a phone's sheet made below the page's end (see goTo) stays after the sheet closes, so the page doesn't jump
  // up at the end of the slide; it shrinks away as you scroll back up.
  pageStyle.textContent += "html.lab-room body::after { content: ''; display: block; height: var(--lab-room, 0px); }";
  // Phones: the page is scrolled in one step for a new comment's pin and drawn where it was, then let go as the keyboard
  // comes (sheets.ts revealDraft): its own blocks, not what it holds to the screen itself, nor the widget or a board's view.
  pageStyle.textContent += 'html.lab-moved body > :not([data-lab-comments], [data-lab-board-view], [data-lab-still]) { translate: 0 var(--lab-shift, 0px) !important; transition: translate var(--lab-shift-t, 0s) var(--lab-shift-e, ease) !important; }';
  addEventListener('scroll', () => {
    if (!document.documentElement.classList.contains('lab-room') || host.hasAttribute('data-sheet')) return;
    roomFor(scrollY, true);
  }, { passive: true });
  // Phones: and the page behind stays put, even when the part of the sheet you drag on has nothing to scroll.
  // On the one element whose overflow is the screen's: body when the page leaves html's alone (the browser takes body's for
  // the screen, and body is laid out as before), else html. On both, body got an overflow of its own and its first
  // child's top margin stopped collapsing through it: the whole page moved down by that margin (21 px under an h1) each
  // time a sheet opened and back up when it closed (Leo, 21 Nov: the page jumps when the chat opens or closes).
  pageStyle.textContent += '@media (pointer: coarse) { html.lab-hold-b body, html.lab-hold-h { overflow: hidden; } }';
  // Holding a finger on a link pins it (see Phones above): no link preview while comments are on.
  pageStyle.textContent += `html:has([data-lab-pinning]) body, html:has([data-lab-pinning]) body * { -webkit-touch-callout: none; }`;
  // Phones: with comments on, a hold is labit's (a pin), not the start of a text selection: iOS would cancel the touch
  // for its selection, and the lift that lets the box open the keyboard would never come. Only while a finger is down
  // (lab-press): Safari paints the quoted words' green (::highlight) over whole blocks of text that can't be selected,
  // so with the page unselectable all the time an open comment tinted half the page (iOS 27 simulator, 17 Nov).
  // Nor the start of a drag: iOS lifts a held link or image to drag it, which cancels the touch the same way.
  // On a phone there is no Shift, so its text is never selected (Leo, 21 Nov: "text selection only with shift remember";
  // a hold with a sheet open, or on the dimmed page, still selected it): all the time, but for the frames a quote is lit
  // in (lab-lit, as on a computer) and never while a finger is down.
  pageStyle.textContent += `@media (pointer: coarse) { html:has([data-lab-pinning]):not(.lab-lit) body > :not([data-lab-comments]), html:has([data-lab-pinning]).lab-press body > :not([data-lab-comments]) { -webkit-user-select: none; user-select: none; } html:has([data-lab-pinning]) body > :not([data-lab-comments]), html:has([data-lab-pinning]) body > :not([data-lab-comments]) * { -webkit-user-drag: none; } }`;

  // The section bar (src/widget/sections.ts) is its own file, loaded when the page may show one: the lab kept its room
  // (the file clears that again), or a lab page (or one that says so) has 3 or more headings. Asked again when a route
  // or a reload changes the page, a read comes from another device, comments come back, or headings are drawn late;
  // those call these until the file is there and takes its own place.
  /** @type {Promise<void> | null} */
  let sectionsAsked = null;
  const maybeSections = () => {
    if (sectionsAsked || !document.body) return;
    if (document.querySelector('style[data-lab="section-bar"]') || (document.querySelector('meta[name="lab-sections"], [data-lab-sections], link[href*="/_lab/lab."]') && document.querySelectorAll('h1, h2, h3').length > 2)) {
      sectionsAsked = part('sections').then((m) => (m.bindSections(W), m.startSections())).catch(() => (sectionsAsked = null));
    }
  };
  S.checkSections = S.syncSections = S.routed = maybeSections;
  /** @param {any} n */
  const heady = (n) => n?.nodeType === 1 && (n.matches('h1, h2, h3') || n.querySelector('h1, h2, h3'));
  new MutationObserver((list, o) => {
    if (sectionsAsked) return o.disconnect();
    if (list.some((/** @type {{ target: any, addedNodes: NodeList }} */ m) => heady((m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest('h1, h2, h3')) || [...m.addedNodes].some(heady))) maybeSections();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const start = () => {
    document.head.append(pageStyle, pinCursorStyle);
    refreshPinCursor();
    document.body.append(host);
    fit();
    // The page's own selection while commenting, and the quoted words of an open text comment.
    // A soft green, so the quoted words stay readable in the page's own colour, on light and dark pages.
    const paint = 'background-color: rgba(52, 199, 89, .3); color: inherit;';
    pageStyle.textContent += `html:has([data-lab-pinning]) ::selection { ${paint} } ::highlight(lab-quote) { ${paint} }`;
    bindActions(W); // data-lab-action buttons leave a pin the agent acts on
    load();
    maybeSections(); // the section bar: what is new or updated on the page since you read it
    scanForFramework();
    if (!S.components) {
      addEventListener('load', scanForFramework, { once: true });
      addEventListener('pointerover', overFramework, { capture: true, passive: true });
    }
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  bindBoardCam(W);
  startLive();
  // ⌘K / Control-K from anywhere but a field of the page's own (where it may mean "add a link"): the first press loads
  // labs & pages and opens it once it is there.
  if (LABS) document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'k') return;
    const typing = e.composedPath().some((n) => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) && n.getRootNode() !== root);
    if (typing) return;
    e.preventDefault();
    void switcher().then((m) => m && (m.switcherSheet() ? m.closeSwitcher() : m.openSwitcher()));
  });
})();
