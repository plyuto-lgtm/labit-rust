// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import { pillLine } from './list.ts';

import { aroundMorph } from './trial.ts';
import { cut } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindLive(w: unknown) {
  W = w;
}
export const MARK_PATHS = '<g transform="translate(-1 -.5)" fill="currentColor">' +
  '<path class="e1" d="M18.9 24.67L24.4 3h11.5L31.28 21.2A22.8 22.8 0 0 0 18.9 24.67Z"/>' +
  '<path class="e2" d="M37.07 22.02L41.9 3h11.5L47.1 27.85A22.8 22.8 0 0 0 37.07 22.02Z"/>' +
  '<path d="M31 26a18 18 0 0 1 18 18 18 18 0 0 1-18 18H15.57a2.57 2.57 0 0 1-2.57-2.57V44A18 18 0 0 1 31 26Z"/>' +
  '<circle class="eye" cx="31" cy="45" r="6.2"/></g>';
const span = (t: string, className = '') => Object.assign(document.createElement('span'), { textContent: t, className });

// Local mode (local.mjs sets data-live): one event stream for all of a lab's tabs (see startLive), so many tabs
// don't use up the browser's connections. The page reloads when its files change, keeping the scroll position, and the
// comments refresh when someone else, like an agent, changes them. A label says which Claude session listens.
export function startLive() {
  if (W.script?.dataset.live) {
    // sessionStorage is shared by every frame of a tab: a board's frames of one page each keep their own (the board names them).
    const key = 'lab-scroll:' + (window.name.startsWith('lab:') ? window.name + ':' : '') + location.pathname;
    // The page's own state that a reload would lose, each with its element (by id, or its place among its kind): a
    // scrolled box, an opened <details>, words typed in a field, a tick, a choice, the field with the cursor.
    // A form with a field named "id" answers `form.id` with that field, so the id is read as the attribute it is.
    const idOf = (x: any) => (x.nodeType === 1 && x.getAttribute('id')) || '';
    // A select changed since its file: a lone select always shows its first option, which isn't a change.
    const selDirty = (n: any) => (n.multiple ? [...n.options].some((o) => o.selected !== o.defaultSelected) : n.selectedIndex !== Math.max(0, [...n.options].findIndex((o) => o.defaultSelected)));
    const ofKind = (t: string) => [...document.getElementsByTagName(t)].filter((n) => n !== W.host);
    const pageState = () => {
      const out: any[] = [];
      for (const n of document.querySelectorAll('*') as NodeListOf<any>) {
        if (n === W.host || n === document.documentElement || n === document.body) continue;
        const add = (kind: string, v: any) => out.length < 200 && out.push([idOf(n) ? '#' + idOf(n) : n.localName + ':' + ofKind(n.localName).indexOf(n), kind, v]);
        if (n.scrollTop || n.scrollLeft) add('s', [n.scrollTop, n.scrollLeft]);
        if (n.localName === 'details' && n.open) add('o', 1);
        if (!/^(input|textarea|select)$/.test(n.localName) || /^(password|file|hidden)$/.test(n.type)) continue;
        // Only what you changed: a field as its file has it follows the file after the reload.
        if (n.localName === 'select') {
          if (selDirty(n)) add('m', [...n.options].flatMap((o, i) => (o.selected ? [i] : [])));
        } else if (/^(checkbox|radio)$/.test(n.type)) {
          if (n.checked !== n.defaultChecked) add('c', n.checked);
        } else if (n.value !== n.defaultValue && n.value.length < 5000) add('v', n.value);
        if (n === document.activeElement) add('f', [n.selectionStart, n.selectionEnd]);
      }
      return out;
    };
    // Each is put back and says whether it's done: a box (or the page) that isn't long enough yet is not.
    const putBack = ([k, kind, v]: [string, string, any]) => () => {
      const n: any = k[0] === '#' ? document.getElementById(k.slice(1)) : ofKind(k.split(':')[0])[+k.split(':')[1]];
      if (!n) return false;
      if (kind === 's') {
        n.scrollTop = v[0];
        n.scrollLeft = v[1];
        return Math.abs(n.scrollTop - v[0]) < 2 && Math.abs(n.scrollLeft - v[1]) < 2;
      }
      if (kind === 'o') n.open = true;
      else if (kind === 'c') n.checked = v;
      else if (kind === 'm') [...(n.options || [])].forEach((o, i) => (o.selected = v.includes(i)));
      else if (kind === 'v') n.value = v;
      else {
        n.focus({ preventScroll: true });
        try {
          n.setSelectionRange(v[0], v[1]);
        } catch {} // a field without a text cursor (a number, a date)
      }
      return true;
    };
    let touchedAt = 0;
    try {
      // The scroll position and the open thread come back after a reload, so an answer shows where you left it. So does
      // what you did to the page itself (pageState). A page that builds itself after it loads is still short then, and
      // its fields aren't there yet: what can't be put back is tried again for 3 s, until you touch the page.
      const kept = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (kept !== null) {
        sessionStorage.removeItem(key);
        if (kept.open) W.S.openId = kept.open;
        if (kept.chat) W.S.chatOpen = true;
        // The section bar's room (sections.ts) may not be kept yet on a page that builds itself late: the scroll is
        // put back without it, and stays right when the room comes (the bar holds what is in view).
        const pad = () => parseFloat(getComputedStyle(document.documentElement).paddingTop) || 0;
        const y = () => +(kept.y ?? kept) - (+kept.pad || 0) + pad();
        const x = +kept.x || 0;
        let todo = [...(kept.page || []).map(putBack), () => (scrollTo(x, y()), Math.abs(scrollY - y()) < 2 && Math.abs(scrollX - x) < 2)];
        let tries = 0;
        const go = () => {
          todo = todo.filter((job) => !job());
          if (todo.length && tries++ < 30 && !touchedAt) setTimeout(go, 100);
        };
        if (document.readyState === 'complete') go();
        else addEventListener('load', go);
      }
    } catch {}
    // Hold a reload while anything is open (a thread, a new comment) or a box has focus or text: the page
    // reloads once you close it, where you were.
    // A newer version reloads the page when it's safe: not while you read a thread or the chat (it waits
    // until they're closed, so nothing moves under you), type, have words in a box, place a new comment, have a phone's
    // keyboard up or have just touched the page.
    for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, () => (touchedAt = performance.now()), { capture: true, passive: true });
    const frame = Boolean(W.S.frame); // a board's frame (frame.ts): the board holds the stream and says when it is busy
    // A board page (its key is /_board/<name>) holds its frames, which name the files it "uses": a save of a page, a .json
    // or anything else is the frames' to follow (they patch or reload themselves), never the board's. It still reloads
    // for a new widget script or comments schema, and follows the lab's comments and the board file.
    const board = Boolean(W.S.board); // exactly /_board/<name>: a variant opened by itself is a page like any other
    const busy = () =>
      frame ? W.S.busy() || performance.now() - touchedAt < 1500 : W.S.draft || W.S.grabbing || W.S.openId || W.S.chatOpen || (W.coarse && /^(textarea|input)$/.test(W.root.activeElement?.localName || '')) ||
      [...W.root.querySelectorAll('textarea')].some((t) => t.value.trim()) || performance.now() - touchedAt < 1500;
    let reloadWhenShown = false;
    let reloadTimer: any = 0;
    // A held reload is invisible otherwise: the page sits old while you read, then jumps the moment you close the
    // thread. A "!" on the labit mark says one is ready (owner, 19 Nov: "move it to rabbit status"), and a tap on the
    // mark takes it now. Where no mark shows (no agent news yet, a phone before its chat button got the mark), the ⋯
    // button carries it. The badge floats over its corner, so nothing moves when it comes or goes.
    const upd = Object.assign(document.createElement('span'), { className: 'upd', textContent: '!', hidden: true });
    upd.setAttribute('aria-hidden', 'true');
    let held = false;
    let updOn: HTMLElement | null = null;
    const UPD_LABEL = 'update waiting, tap to load';
    const shows = (n: Element | null) => Boolean(n && !(n as HTMLElement).hidden && n.getClientRects().length);
    const showUpd = (on: boolean) => {
      held = on;
      if (!on) {
        upd.hidden = true;
        if (updOn) {
          const was = updOn.dataset.updLabel;
          if (was) updOn.setAttribute('aria-label', was);
          else updOn.removeAttribute('aria-label');
          delete updOn.dataset.updLabel;
          updOn.classList.remove('has-upd');
        }
        updOn = null;
        return;
      }
      const markOn = W.coarse ? W.chatBtn : who;
      const host: HTMLElement = shows(markOn) && markOn.querySelector('.mark') ? markOn : W.root.querySelector('.more');
      if (!host) return;
      if (updOn !== host) {
        showUpd(false);
        held = true;
        updOn = host;
        host.dataset.updLabel = host.getAttribute('aria-label') || '';
        host.setAttribute('aria-label', UPD_LABEL);
        host.classList.add('has-upd');
        host.append(upd);
      }
      upd.hidden = false;
      // On the mark's top right corner (or the ⋯'s), measured, so the badge sits on the mark wherever it is.
      const m = host.querySelector('.mark') || host;
      const hr = host.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      Object.assign(upd.style, { left: `${mr.right - hr.left - 6}px`, top: `${mr.top - hr.top - 6}px` });
    };
    const take = (e: Event) => {
      if (!held || e.currentTarget !== updOn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      clearTimeout(reloadTimer);
      reloadTimer = 0;
      now();
    };
    // The page is asked for first: with its dev server down the lab answers a plain 502, and with its file gone its page
    // list or "not found" (200 for a folder): none of them has a widget, and a reload would leave the tab there for good.
    // This page stays, and asks again in a moment.
    const now = () =>
      fetch(location.href, { cache: 'no-store', headers: { accept: 'text/html', 'x-lab': '1' } })
        .then((r) => r.ok && r.text().then((t) => t.includes('data-live')), () => false)
        .then((up) => {
          if (!up) return void (reloadTimer ||= setTimeout(() => ((reloadTimer = 0), reload()), 2000));
          try {
            sessionStorage.setItem(key, JSON.stringify({ y: scrollY, x: scrollX, pad: parseFloat(getComputedStyle(document.documentElement).paddingTop) || 0, open: W.S.openId, chat: W.S.chatOpen, page: pageState() }));
          } catch {}
          location.reload();
        });
    const reload = () => {
      // A tab in the background doesn't reload on every save: it reloads once, when you come back to it.
      if (document.hidden) return void (reloadWhenShown = true);
      if (busy()) {
        showUpd(true);
        if (!reloadTimer) reloadTimer = setTimeout(() => ((reloadTimer = 0), reload()), 500); // one waiting reload, not one per message
        return;
      }
      showUpd(false);
      now();
    };
    const who = document.createElement('a');
    who.className = 'listener';
    // The labit mark, in place of the old dot: our pin as a head, two slabs as ears (the cut for small sizes: a wider
    // gap and a bigger dot, so neither closes up at 16 px). Its parts are separate so the styles can move them: the
    // dot blinks now and then while an agent listens, the ears twitch while one works. The words sit in .lbl, so
    // changing them never rebuilds (and restarts) the mark.
    const MARK = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">' + MARK_PATHS + '</svg>';
    who.innerHTML = MARK + '<span class="cb"></span><div class="lbl"></div>';
    const lbl = who.querySelector('.lbl') as HTMLElement;
    const cb = who.querySelector('.cb') as HTMLElement;
    // The pill's label, kept aside while it says "update waiting" (the "!" badge) and put back after.
    const whoLabel = (t: string) => (updOn === who ? (who.dataset.updLabel = t) : who.setAttribute('aria-label', t));
    who.hidden = true;
    W.root.querySelector('.left').prepend(who);
    // Capture, so a tap that takes the update never also opens the chat, the ⋯ menu or the session's link.
    for (const n of [who, W.chatBtn, W.root.querySelector('.more')]) n?.addEventListener('click', take, { capture: true });
    // Files a save can mean for this page: the page itself, anything it loads, and data it may fetch as it runs.
    // Everything else -- a README, another page's script, the project's own server code -- leaves it alone.
    performance.setResourceTimingBufferSize(3e3); // the page's own list of what it loaded (a fetch, a module, a worker): 250 is too few for a big app
    const loaded = (p, by = /./) => performance.getEntriesByType('resource').some((e: any) => by.test(e.initiatorType) && samePath(e.name, [p]));
    const tidy = (u) => decodeURIComponent(u).replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '').toLowerCase();
    const usedHere = (p) => {
      if (tidy(location.pathname) === tidy(p)) return true;
      for (const n of document.querySelectorAll('script[src], link[href], iframe[src], object[data], embed[src]')) {
        if (W.host.contains(n)) continue;
        const v = n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('data');
        if (v && samePath(v.split('#')[0], [p])) return true;
      }
      // Anything else the page fetched while it ran: an ES module's imports, a worker, a script a script added, its data.
      return loaded(p);
    };
    // A page with no tab icon of its own gets labit's: only in a local lab (this block), only when the page names
    // none and the project serves no /favicon.ico (a dev server may answer any path with its HTML, so the type counts).
    if (!frame && !board && !document.querySelector('link[rel~="icon"]')) {
      fetch('/favicon.ico', { method: 'HEAD' })
        .then((r) => r.ok && (r.headers.get('content-type') || '').startsWith('image/'))
        .catch(() => false)
        .then((has) => {
          if (has || document.querySelector('link[rel~="icon"]')) return;
          document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: '/_lab/favicon.svg' }));
        });
    }
    // What goes wrong on the page, for the agent that fixes it (the lab shows it with the page's text): an uncaught error, a
    // file that failed to load, a rejected promise, a script the page's policy blocked. The last 8, each once, sent a
    // second after the last one. The widget's own are not the page's. (A file that failed while the page was still loading
    // is the lab's to say: the page's text lists the files it asked for that the lab did not have.)
    // Each route keeps its own list (the app can go to another route with no page load): posted under the route it was thrown on.
    const oops: Record<string, string[]> = {};
    const told = new Set<string>();
    let oopsTimer: any = 0;
    const tell = (t: string) => {
      t = cut(t.replace(/\s+/g, ' '), 200);
      const page = W.S.page, list = (oops[page] ||= []);
      if (list.includes(t) || /^Script error\.?/.test(t)) return;
      list.push(t);
      if (list.length > 8) list.shift();
      told.add(page);
      clearTimeout(oopsTimer);
      oopsTimer = setTimeout(() => {
        for (const page of told) fetch(W.script.dataset.live.replace(/live$/, 'errors'), { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, list: oops[page], tab }) }).catch(() => {});
        told.clear();
      }, 1000);
    };
    if (!board) {
      addEventListener('error', (e: any) => e.filename?.includes('/_lab/') || tell(e.message ? `${e.message} (${(e.filename || '').split('/').pop() || 'page'}:${e.lineno})` : `failed to load ${e.target?.src || e.target?.href}`), true);
      addEventListener('unhandledrejection', (e) => tell(`unhandled rejection: ${e.reason?.message || e.reason}`));
      addEventListener('securitypolicyviolation', (e) => tell(`blocked by the page's policy: ${e.violatedDirective} ${e.blockedURI}`));
    }
    let stream = null;
    let beat = 0;
    // The pill is the mark, with its status as a badge on the mark's corner (Leo, 20 Nov: "lets try this", icon only; "like we had
    // with !"): how many pins wait, or a sign: ! the agent went quiet, … it isn't answering, - nobody listens, ~ reconnecting. Its
    // words show in a box above the pill the moment the pointer is on it (the .w box, like a pin's: no browser tooltip, which waits
    // a second, and the pill never grows): "talking to Claude", the status line, "no update for 6 min · last: …", and under
    // them what the state means (.d). The words stay in the pill's label for screen readers. From the lab's state (mode, agent)
    // and the agent's work on this page (list.ts pillLine).
    let pill = null;
    const SIGNS = { '!': 'M6 3.25v3.25M6 8.75h.01', '…': 'M3.4 6h.01M6 6h.01M8.6 6h.01', '-': 'M3.75 6h4.5', '~': 'M8.6 6.6A2.6 2.6 0 1 1 6.3 4M5.1 2.8l1.3 1.2-1.3 1.2' };
    const TONE = { '!': 'amber', '…': 'amber', '-': 'grey', '~': 'grey' };
    // The box: line 1 (.t), what else is worth knowing (.d, muted), and a command to copy (.c).
    const show = (head: string, n = '', more: string[] = [], cmd = '') => {
      const sig = [head, n, ...more, cmd].join('|');
      if (lbl.dataset.sig === sig) return;
      lbl.dataset.sig = sig;
      lbl.replaceChildren(span('', 'w'));
      lbl.firstElementChild.append(span(head, 't'), ...(more.length ? [span(more.join('\n'), 'd')] : []), ...(cmd ? [span(cmd, 'c')] : []));
      cb.className = `cb ${TONE[n] || ''}`;
      cb.innerHTML = SIGNS[n] ? `<svg viewBox="0 0 12 12" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor"/><path d="${SIGNS[n]}" stroke="var(--_bg)" stroke-width="${n === '…' ? 2.4 : 1.8}"/></svg>` : n ? `<span>${n}</span>` : '';
      if (n) who.dataset.n = n;
      else delete who.dataset.n;
    };
    // What a screen reader gets: the first line, and the count the badge shows.
    const said = () => (lbl.querySelector('.t')?.textContent || '') + (/^\d+$/.test(who.dataset.n || '') ? ` · ${who.dataset.n} waiting` : '');
    const paintWho = () => {
      if (!pill) return;
      const { mode, agent, away, name, resume } = pill;
      const { text, last, stale, waiting } = mode === 'working' ? pillLine() : { text: '', last: '', stale: false, waiting: 0 };
      const n = mode === 'working' ? (stale ? '!' : waiting ? String(Math.min(waiting, 99)) : '') : mode === 'quiet' ? '…' : mode === 'away' ? '-' : '';
      const [who2, model] = agent.split(' · ');
      const lines = [];
      const how = `labit wait --page ${W.S.page}`;
      let head = '';
      if (mode === 'listening') {
        head = `${who2} is listening`;
        if (model) lines.push(model);
      } else if (mode === 'quiet') {
        head = `${who2} isn't answering`;
        lines.push('Pins go to the next agent that listens.');
      } else if (mode === 'working') {
        head = text || `${who2} is working`;
        if (last) lines.push(last);
        if (waiting) lines.push(`${waiting} waiting`);
      } else {
        head = away[0].toUpperCase() + away.slice(1);
        lines.push(`Tell an agent: listen for pins on ${location.origin}${W.S.page}`);
      }
      if (name) lines.push(`Session ${name}`);
      show(head, n, lines, mode === 'away' ? how : resume || '');
      whoLabel(said());
    };
    W.paintWho = paintWho;
    // The status pill says "reconnecting" while the live connection is down; the next message puts it right.
    // A dropped connection isn't "nobody listening": the badge keeps its last state, faded, and says reconnecting
    // (Leo, 18 Nov: the black rabbit came and went at random, from these).
    const showAway = (word) => {
      pill = null; // the pill's own words are not painted over it until the next state
      lbl.dataset.sig = '';
      show(word, '~');
      whoLabel(word);
      who.classList.add('stale');
      W.chatBtn.classList.add('stale');
      if (!who.classList.contains('working') && !last) who.classList.add('idle');
      who.hidden = false;
    };
    let commentsRev = null; // the lab's comments version this page has (not the read marks, `seen`)
    let readsAt = null;
    let sectionsAt = null;
    let hotAt = W.script.dataset.hot ? +W.script.dataset.hot : null; // the lab's hot count when this page was served: a save since then is still caught up
    // A CSS save: load the new stylesheet next to the old one and drop the old one once it's in, so nothing flashes,
    // moves or closes. The saved file's own <link>s, or every same-site one when it's pulled in another way (@import).
    let swapN = 0;
    const swapCss = (files) => {
      if (restyled) return reload(); // a sheet loaded again would bring the old picture's address back
      // A clone still loading from an earlier save is skipped (its original is swapped instead) and dropped once a newer one is in.
      const links = [...(document.querySelectorAll('link[rel~="stylesheet"][href]:not([data-lab-swap])') as NodeListOf<HTMLLinkElement>)].filter((l) => new URL(l.href, location.href).origin === location.origin);
      const own = (l: HTMLLinkElement) => decodeURIComponent(new URL(l.href, location.href).pathname);
      const named = links.filter((l) => files.includes(own(l)));
      // A saved file no link names is pulled in by @import: every sheet is swapped then, not only the ones named.
      for (const s of document.querySelectorAll('style')) if (/@import/.test(s.textContent) && !W.host.contains(s)) s.textContent += ''; // an @import in a style block is read again
      for (const link of named.length && files.every((f) => named.some((l) => own(l) === f)) ? named : links) {
        const url = new URL(link.href, location.href);
        url.searchParams.set('lab-v', Date.now().toString(36));
        const next = (link.cloneNode() as HTMLLinkElement);
        next.href = url.href;
        const n = ++swapN;
        next.dataset.labSwap = '' + n; // newer saves have higher numbers: a clone never removes one newer than itself
        const path = url.pathname;
        // The old one goes a frame after the new one has loaded, not in the same task: livereload-js waits a few ms there in WebKit.
        next.addEventListener('load', () => requestAnimationFrame(() => {
          if (!next.isConnected) return; // another clone of the same file took it out first
          for (const l of (document.querySelectorAll('link[rel~="stylesheet"][href]') as NodeListOf<HTMLLinkElement>)) if (l !== next && !(+l.dataset.labSwap! > n) && new URL(l.href, location.href).pathname === path) l.remove();
          delete next.dataset.labSwap;
        }), { once: true });
        next.addEventListener('error', () => next.remove(), { once: true });
        link.after(next);
      }
    };
    // The address as the file wrote it, with a version on the end: a later patch of the page knows it for the same one.
    const plain = (u) => u.replace(/[?&]lab-v=\w+/g, '');
    const fresh = (u) => plain(u) + (plain(u).includes('?') ? '&' : '?') + 'lab-v=' + Date.now().toString(36);
    const samePath = (u, paths) => {
      try {
        const url = new URL(u, location.href);
        return url.origin === location.origin && (!paths || paths.includes(decodeURIComponent(url.pathname)));
      } catch {
        return false;
      }
    };
    // A picture or SVG: every element that shows it gets the new file (img, srcset, poster, SVG image/use, the tab
    // icon). With no paths: every picture. Returns how many it swapped (none: it's a CSS background, so the stylesheets are).
    const swapImages = (paths) => {
      let hit = 0;
      for (const n of document.querySelectorAll('img, input, object, embed, source, video[poster], image, use, link[rel~="icon"]')) {
        if (W.host.contains(n)) continue;
        for (const attr of ['src', 'href', 'data', 'poster', 'xlink:href']) {
          const v = n.getAttribute(attr);
          if (!v || !samePath(v.split('#')[0], paths)) continue;
          // The new file is loaded and decoded first, then shown: the picture never blinks empty.
          const next = fresh(v.split('#')[0]);
          (n as any)['lab' + attr] = next;
          const im = new Image();
          const ready = new Promise((ok) => ((im.onload = () => ok(true)), (im.onerror = () => ok(false))));
          im.src = next;
          // A file that is not there (deleted, about to be written again) leaves the old picture showing.
          void ready.then(async (ok) => {
            if (ok) await im.decode?.().catch(() => {});
            if (ok && (n as any)['lab' + attr] === next) n.setAttribute(attr, next + (v.includes('#') ? v.slice(v.indexOf('#')) : ''));
          });
          hit++;
        }
        const set = n.getAttribute('srcset');
        if (set && set.split(',').some((c) => samePath(c.trim().split(/\s+/)[0], paths))) {
          n.setAttribute('srcset', set.split(',').map((c) => {
            const [u, ...rest] = c.trim().split(/\s+/);
            return [samePath(u, paths) ? fresh(u) : u, ...rest].join(' ');
          }).join(', '));
          hit++;
        }
      }
      return hit;
    };
    // A picture only a stylesheet shows (a CSS background, a ::before, a variable): the browser keeps its copy under the old address,
    // so every url() in the page's CSS that names it gets a new version, in place. The next save of a stylesheet loads the old address
    // again, so that one reloads the page (`restyled`).
    let restyled = false;
    const restyle = (paths) => {
      const urls = new Map(); // old address -> new address
      const fix = (text, base) =>
        text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q, u) => {
          try {
            const abs = new URL(u, base).href;
            if (!samePath(abs.split('#')[0], paths)) return m;
            if (!urls.has(abs)) urls.set(abs, fresh(abs));
            return `url("${urls.get(abs)}")`;
          } catch {
            return m;
          }
        });
      // One pass finds them (and changes nothing), the new pictures load, then a second pass puts the new addresses in: no blank between.
      const pass = (apply) => {
        const walk = (rules, base) => {
          for (const r of rules || []) {
            try {
              const css = r.style?.cssText;
              if (css && css.includes('url(')) {
                const t = fix(css, base);
                if (apply && t !== css) r.style.cssText = t;
              }
              if (r.styleSheet) walk(r.styleSheet.cssRules, r.styleSheet.href || base);
              else walk(r.cssRules, base);
            } catch {} // another site's sheet, or a rule that can't be read
          }
        };
        for (const sheet of document.styleSheets) {
          try {
            if (!W.host.contains(sheet.ownerNode as Node)) walk(sheet.cssRules, sheet.href || location.href);
          } catch {} // another site's sheet
        }
        for (const n of document.querySelectorAll('[style*="url("]')) {
          const t = W.host.contains(n) ? '' : fix(n.getAttribute('style'), location.href);
          if (apply && t && t !== n.getAttribute('style')) n.setAttribute('style', t);
        }
      };
      pass(false);
      if (!urls.size) return 0;
      restyled = true;
      void Promise.all([...urls.values()].map((u) => new Promise((done) => Object.assign(new Image(), { onload: done, onerror: done, src: u })))).then(() => pass(true));
      return urls.size;
    };
    // A font: each @font-face that uses it is loaded again as a new face, which takes over from the old one.
    const reloadFonts = (paths) => {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // another site's stylesheet
        }
        const all = (rs, out = []) => { for (const r of rs || []) { out.push(r); try { all(r.styleSheet ? r.styleSheet.cssRules : r.cssRules, out); } catch {} } return out; };
        for (const r of all(rules)) {
          if (!(r instanceof CSSFontFaceRule)) continue;
          const src = r.style.getPropertyValue('src');
          const base = r.parentStyleSheet.href || location.href;
          if (!/url\(/.test(src) || ![...src.matchAll(/url\(["']?([^"')]+)/g)].some((m) => samePath(new URL(m[1], base).href, paths))) continue;
          const again = src.replace(/url\(["']?([^"')]+)["']?\)/g, (all, u) => (samePath(new URL(u, base).href, paths) ? `url("${fresh(new URL(u, base).href)}")` : all));
          const d = (k) => r.style.getPropertyValue(k) || undefined;
          try {
            const face = new FontFace(d('font-family').replace(/^["']|["']$/g, ''), again, ({ weight: d('font-weight'), style: d('font-style'), stretch: d('font-stretch'), unicodeRange: d('unicode-range'), display: d('font-display') } as any));
            face.load().then((f) => document.fonts.add(f)).catch(() => {});
          } catch {}
        }
      }
    };
    // An HTML page: fetch it and change only what differs, in place (scroll, open things and typed text stay). A
    // changed script or stylesheet list can't be patched safely: then it's a normal reload.
    const ownStyles = () => new Set([W.pageStyle, W.pinCursorStyle]);
    const scriptsOf = (doc) => [...doc.querySelectorAll('script:not([data-lab])')].filter((x) => !/\/_lab\/comments\.js/.test(x.getAttribute('src') || '')).map((x) => x.getAttribute('src') || x.textContent);
    const sheetsOf = (doc) => [...doc.querySelectorAll('link[rel~="stylesheet"]:not([data-lab-swap])')].map((l) => { try { return new URL(l.getAttribute('href'), location.href).pathname; } catch { return ''; } });
    // What the morph touched, to be outlined for a moment: the person sees what the agent's save changed.
    const touched = new Set<Element>();
    const hit = (n) => (n?.nodeType === 1 ? touched.add(n) : touched.add(n?.parentNode));
    // Labit's own (the widget, an open board's view: +board writes the page's file while its board is open) and scripts.
    const keepOut = (n) => n === W.host || (n.nodeType === 1 && (n.localName === 'script' || n.hasAttribute('data-lab-board-view')));
    // Old and new children are paired in order, looking a few ahead, so an added or removed element doesn't shift
    // everything after it (an open <details> further down stays the same element, and stays open).
    const same = (o, n) => o.nodeType === n.nodeType && o.nodeName === n.nodeName && idOf(o) === idOf(n);
    const alike = (o, n) => same(o, n) && (o.nodeType === 1 ? Boolean(idOf(o)) || o.getAttribute('class') === n.getAttribute('class') : o.nodeType !== 3 || o.data === n.data);
    const morphKids = (a, b) => {
      const olds = [...a.childNodes].filter((n) => !keepOut(n));
      const news = [...b.childNodes].filter((n) => !(n.nodeType === 1 && n.localName === 'script'));
      let j = 0;
      let prev = null;
      const put = (n) => {
        const c = document.importNode(n, true);
        a.insertBefore(c, prev ? prev.nextSibling : olds[j] || a.firstChild);
        hit(c);
        return c;
      };
      news.forEach((n, i) => {
        const o = olds[j];
        if (!o) return void (prev = put(n));
        // The same kind of node as many left on both sides: it is the same one, whatever changed on it (a row whose class changed
        // keeps what was typed in it).
        const left = (l, x) => l.filter((m) => same(m, x)).length;
        if (alike(o, n) || (same(o, n) && left(olds.slice(j), n) === left(news.slice(i), n))) return void ((prev = morphNode(o, n)), j++);
        // The old one comes back a little later: this new one was added before it.
        if (news.slice(i + 1, i + 8).some((m) => alike(o, m))) return void (prev = put(n));
        // This new one is a little further on among the old ones: the ones before it were removed.
        const k = olds.slice(j + 1, j + 8).findIndex((m) => alike(m, n));
        if (k >= 0) {
          for (const gone of olds.slice(j, j + 1 + k)) gone.remove();
          j += k + 1;
          return void (prev = morphNode(olds[j], n), j++);
        }
        prev = morphNode(o, n);
        j++;
      });
      for (const o of olds.slice(j)) o.remove();
    };
    const morphNode = (o, n) => {
      if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName || idOf(o) !== idOf(n)) {
        const c = document.importNode(n, true);
        o.replaceWith(c);
        hit(c);
        return c;
      }
      if (o.nodeType === 3 || o.nodeType === 8) {
        if (o.data !== n.data) {
          o.data = n.data;
          hit(o);
        }
        return o;
      }
      if (o.nodeType !== 1) return o;
      if (o.isEqualNode(n)) return o; // the same inside and out: nothing to walk (Eleventy's dev server does this)
      // An opened <details> or <dialog> stays open (you opened it; the file doesn't say so).
      for (const { name } of Array.from(o.attributes as NamedNodeMap)) if (!n.hasAttribute(name) && !(name === 'open' && /^(details|dialog)$/.test(o.localName))) {
        o.removeAttribute(name);
        hit(o);
      }
      for (const { name, value } of Array.from(n.attributes as NamedNodeMap)) if (!o.hasAttribute(name) || plain(o.getAttribute(name)) !== value) {
        o.setAttribute(name, value);
        hit(o);
      }
      // A playing video, a canvas, a field's own value, a web component's insides: left as they are. What you typed stays,
      // because only the file's text under a <textarea> and the options of a <select> follow it.
      if (o.isContentEditable || o.shadowRoot || /^(iframe|canvas|video|audio|input|noscript)$/.test(o.localName)) return o;
      const picked = o.localName === 'select' && selDirty(o) ? [...o.options].filter((x) => x.selected).map((x) => x.value) : null;
      morphKids(o, n);
      if (picked) for (const x of o.options) x.selected = picked.includes(x.value);
      return o;
    };
    // A page with scripts of its own is reloaded instead: patching it toward its file would undo what its scripts built.
    const ownScripts = () => scriptsOf(document).length > 0;
    let morphRun = 0;
    const morphPage = async () => {
      if (board) return;
      const run = ++morphRun;
      try {
        const res = await fetch(location.href, { cache: 'no-store', headers: { accept: 'text/html', 'x-lab': '1' } });
        const html = await res.text();
        if (run !== morphRun) return; // a newer save is already being fetched: only the latest is applied
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // The file is gone for now (a build that clears its folder): the lab answers with its own screen, which has no
        // widget and nobody to hear the file come back. This page stays and follows the file when it is saved again.
        if (!res.ok || !doc.querySelector('script[data-live]')) return;
        if (ownScripts() || scriptsOf(doc).join('\n') !== scriptsOf(document).join('\n') || sheetsOf(doc).join('\n') !== sheetsOf(document).join('\n')) return reload();
        // What you're looking at stays put: an element a third down the window keeps its place on screen. Found before
        // the change (during a cross-fade the page can't be hit-tested).
        let mark = null;
        for (const y of [Math.min(innerHeight / 3, 240), innerHeight / 2, 80]) {
          const e = document.elementFromPoint(innerWidth / 2, y);
          if (e && e !== document.body && e !== document.documentElement && !W.host.contains(e) && e !== W.host) {
            mark = e;
            break;
          }
        }
        const markTop = mark?.getBoundingClientRect().top;
        // The browser cross-fades the old page into the new one (View Transitions, Safari 18+ and Chrome; others just swap).
        const apply = () => {
          // The page's own new title, with the "(3)" of new messages kept in front.
          if (doc.title !== W.tabTitle.base) {
            W.tabTitle.base = doc.title;
            document.title = doc.title; // drawList puts the "(3)" back in front
            W.drawList();
          }
          const mine = ownStyles();
          // The lab's own (data-lab: the section bar's room, sections.ts) are the widget's, not the page's.
          const olds = [...document.head.querySelectorAll('style:not([data-lab])')].filter((x) => !mine.has(x));
          const news = [...doc.head.querySelectorAll('style:not([data-lab])')];
          news.forEach((n, i) => (olds[i] ? olds[i].textContent !== n.textContent && (olds[i].textContent = n.textContent) : document.head.append(document.importNode(n, true))));
          for (const o of olds.slice(news.length)) o.remove();
          for (const { name, value } of Array.from(doc.body.attributes)) if (document.body.getAttribute(name) !== value) document.body.setAttribute(name, value);
          for (const { name } of Array.from(document.body.attributes)) if (!doc.body.hasAttribute(name)) document.body.removeAttribute(name);
          const H = document.documentElement;
          for (const { name, value } of Array.from(doc.documentElement.attributes)) {
            const v = name === 'class' ? [value, ...[...H.classList].filter((c) => c.startsWith('lab-'))].join(' ') : value;
            if (name !== 'style' && H.getAttribute(name) !== v) H.setAttribute(name, v);
          }
          aroundMorph(() => morphKids(document.body, doc.body)); // a choice tried in the page: its words back first (thread.ts)
          // The elements that changed are outlined for a moment (not for someone who asked for less motion).
          if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (const e of [...touched].slice(0, 12)) if (e?.isConnected && e !== document.body) e.animate?.([{ outline: '2px solid Highlight' }, { outline: '2px solid transparent' }], 1200);
          touched.clear();
          if (mark?.isConnected) {
            const moved = mark.getBoundingClientRect().top - markTop;
            if (Math.abs(moved) > 1) scrollBy(0, moved);
          }
          W.reflow();
          W.relook();
          W.S.checkSections?.(); // the section bar follows the new page
        };
        // An error inside the cross-fade would go unseen: any failure falls back to a reload.
        const safe = () => {
          try {
            apply();
          } catch {
            reload();
          }
        };
        // WebKit shifts the whole page by scrollY for ~250 ms under a view transition when scrolled: it only fades there when at the top.
        const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
        if (document.startViewTransition && !W.still.matches && !(webkit && scrollY > 0)) {
          // Under the cross-fade the browser hits nothing but <html> (a click then pinned the page): W.fade is what a click waits for (comments.js, pinned).
          const fade: Promise<void> = (W.fade = Promise.race([document.startViewTransition(safe).finished.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]).then(() => void (W.fade === fade && (W.fade = null))));
        } else safe();
      } catch {
        reload();
      }
    };
    // Away for a while (a lab that restarted, saves missed): the page, every stylesheet and every picture again.
    const catchUp = () => {
      morphPage();
      swapCss([]);
      swapImages(null);
    };
    const hotUpdate = (files) => {
      const of = (kind) => files.filter((f) => f.kind === kind).map((f) => f.path);
      // Only a save of this page's own file patches it (another page saved in the lab changes nothing here).
      const here = decodeURIComponent(location.pathname).replace(/\/$/, '/index').replace(/\.html?$/i, '').toLowerCase();
      if (of('html').some((p) => !p || p.replace(/\.html?$/i, '').toLowerCase() === here)) morphPage();
      else if (of('html').some((p) => loaded(p, /fetch|xml/))) reload(); // a page a script fetched
      // A picture only a stylesheet shows (a CSS background): its addresses in the CSS get a new version; when none is found but the page loaded it, it reloads.
      if (of('img').length && !swapImages(of('img')) && !restyle(of('img')) && of('img').some((p) => loaded(p))) reload();
      if (of('css').length) swapCss(of('css')); // after the pictures: one that was restyled makes this a reload
      if (of('font').length) reloadFonts(of('font'));
    };
    // One live stream per browser for this lab, shared by its tabs: the tab holding the lock "labit-live" (locks and
    // channels are per origin, so per lab) opens it and passes each message to the lab's other tabs over a
    // BroadcastChannel; they listen there. When it closes, the next tab takes the lock and opens the stream. So a tab
    // in the background stays live (its title count and pins update at once), and any number of tabs use one of the
    // browser's 6 connections to a lab. (Before, each tab held its own and let it go 30 s into the background, asking
    // for the state every 20 s instead.) Without locks or channels a tab opens its own stream.
    const tab = Math.random().toString(36).slice(2, 12); // the lab counts open tabs by their streams; bye on close
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('labit-live') : null;
    const shared = Boolean(bc && navigator.locks);
    let leading = !shared;
    let release: (() => void) | null = null;
    let last = null; // the last state, for a tab that joins
    const got = (v) => {
      beat = Date.now();
      last = v;
      dispatchEvent(new CustomEvent('lab-state', { detail: v })); // the board page follows the board file from this
      onState(v);
    };
    if (bc)
      bc.onmessage = ({ data: d }) => {
        if (d.t === 'hello' && stream?.readyState === 1 && last) bc.postMessage({ t: 'state', v: last }); // a tab joined: it gets the state now
        if (stream) return; // a tab with its own stream listens to that
        if (d.t === 'state') got(d.v);
        if (d.t === 'beat') beat = Date.now();
        if (d.t === 'down') showAway('Reconnecting');
      };
    const connect = () => {
      if (stream) return;
      stream = new EventSource(`${W.script.dataset.live}?tab=${tab}`);
      beat = Date.now();
      stream.addEventListener('beat', () => {
        beat = Date.now();
        if (leading) bc?.postMessage({ t: 'beat' });
      });
      stream.onerror = () => {
        showAway('Reconnecting');
        if (leading) bc?.postMessage({ t: 'down' });
      };
      stream.onmessage = (e) => {
        const v = JSON.parse(e.data);
        got(v);
        if (leading) bc?.postMessage({ t: 'state', v });
      };
    };
    // Waits for the lock (another tab may hold it), then opens the stream and keeps the lock until the page goes.
    const lead = () =>
      navigator.locks.request('labit-live', () => new Promise<void>((r) => {
        release = r;
        leading = true;
        connect();
      }));
    function onState(v) {
      {
        // A new widget script: this page needs it, so it reloads (when it's safe, as always). While the reload waits
        // (a chat, a thread or a draft is open) the rest still runs: replies keep arriving and the pill stays true.
        if (v.widget && W.script.dataset.widget && v.widget !== W.script.dataset.widget) reload();
        // Comments stored in a new shape (lib/schema.mjs VERSION): this page reads them with the widget that knows it.
        if (v.schema && W.script.dataset.schema && String(v.schema) !== W.script.dataset.schema) return reload();
        // The lab restarted (its counters start again): catch up in place instead of reloading. The page is fetched
        // and patched (only if its file changed does anything move), and the comments are loaded again.
        if (v.lab && W.script.dataset.lab && v.lab !== W.script.dataset.lab) {
          W.script.dataset.lab = v.lab;
          W.script.dataset.version = String(v.files);
          hotAt = v.hot || 0;
          commentsRev = v.comments;
          catchUp(); // files saved while it was down are not in any list
          W.load();
        }
        if (String(v.files) !== W.script.dataset.version) {
          // The lab says which files changed (no list: a burst too big to judge, so reload as before).
          if (board || (v.files - +W.script.dataset.version === 1 && Array.isArray(v.changed) && v.changed.length && !v.changed.some(usedHere))) W.script.dataset.version = String(v.files);
          else reload(); // held while something is open: the comments below still come in (the agent's answer, read marks)
        }
        // Missed more than one hot update while away (asleep, offline): patch the page and refresh every stylesheet
        // and picture, instead of only the last batch of files.
        const hot = v.hot || 0;
        if (!board && hotAt !== null && hot !== hotAt) {
          if (hot - hotAt > 1) catchUp();
          else hotUpdate(v.hotFiles || []);
        }
        hotAt = hot;
        commentsRev ??= W.S.rev ?? null; // the list's own version: what was written since it was read is fetched below, not lost
        // One version on and it names the pages it changed, none of them this one: nothing to fetch. (An older lab sends
        // no commentPages; more than one version on, the pages in between aren't known.)
        const elsewhere = v.comments === commentsRev + 1 && Array.isArray(v.commentPages) && !v.commentPages.includes(W.S.page);
        if (commentsRev !== null && v.comments !== commentsRev && !elsewhere) W.loadChanges(commentsRev); // keeps typed text: it adds replies in place
        commentsRev = v.comments;
        // read on another device with your name
        if (v.reads !== readsAt) {
          readsAt = v.reads;
          W.syncReads();
        }
        // a section read on another device with your name
        if (v.sections !== sectionsAt) {
          sectionsAt = v.sections;
          W.S.syncSections?.();
        }
        // listening: a wait is open · working: Claude got comments and is on them · away: nobody will hear a comment now.
        const s = v.session;
        // A lab with listeners can still have none for this page (a wait with --page for another one): this page says
        // so, instead of "talking to Claude" while its pins wait for nobody. An older lab doesn't send heard.
        const h = v.heard;
        const here = !h || h.pages.includes(W.S.page) || (h.all && !h.except.includes(W.S.page));
        // The session listening here was handed pins and answered none of them (local.mjs silentNow): the pill says
        // "Claude isn't answering" instead of "talking to Claude", until it answers anything.
        const quiet = (v.silent || []).find((q) => !q.pages || q.pages.includes(W.S.page));
        const mode = s && here ? (quiet ? 'quiet' : v.mode || 'listening') : 'away';
        W.S.unheard = mode === 'away';
        // "Claude · Sonnet 5.5": the agent, and the model the session said it runs on (the box says "Claude is listening", then the
        // model). The session's name is its own line there.
        const agent = quiet && mode === 'quiet' ? quiet.label : s?.model ? `${s.agent || 'Claude'} · ${s.model}` : s?.agent || 'Claude';
        const name = s && s.name !== (s.agent || 'Claude') ? s.name : '';
        pill = { mode, agent, name, resume: s?.resume || '', away: s && !here ? 'no agent on this page' : 'no agent listening' };
        paintWho();
        who.classList.remove('stale');
        W.chatBtn.classList.remove('stale');
        who.classList.toggle('idle', mode === 'away' || mode === 'quiet');
        who.classList.toggle('working', mode === 'working');
        W.listBtn.dataset.agent = mode;
        W.chatBtn.dataset.agent = mode; // phones: with the list parked, the chat button carries the agent's mark
        if (W.coarse && !W.chatBtn.querySelector('.mark')) W.chatBtn.insertAdjacentHTML('afterbegin', MARK);
        if (W.coarse) W.chatBtn.title = said(); // phones: the light on the chat button says who's listening
        whoLabel(said()); // the words stay for screen readers when only the light shows
        if (s?.url && mode !== 'away') Object.assign(who, { href: s.url, target: '_blank' });
        else who.removeAttribute('href');
        // A tap doesn't copy the resume command any more (Leo, 16 Nov: it made no sense): the pill only says who listens.
        who.hidden = false;
      }
    }
    // Back in front: a save that waited reloads now; a stream that went quiet while hidden is checked at once.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (reloadWhenShown) return reload();
      check();
    });
    addEventListener('pagehide', () => {
      stream?.close();
      stream = null;
      release?.(); // the next tab takes over the stream
      release = null;
      leading = !shared;
      if (!frame) fetch(W.script.dataset.live.replace(/live$/, 'bye'), { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab }) }).catch(() => {});
    });
    addEventListener('pageshow', (e) => e.persisted && start()); // back from the back-forward cache
    // Back from sleep, or the stream went quiet: catch up (the first message after it says what changed). A clock that
    // jumped (the laptop slept) or 40 s without a beat both count. A tab without a stream whose sharing tab went
    // quiet (frozen, asleep) opens its own.
    let tick = Date.now();
    const freshStream = () => {
      stream?.close();
      stream = null;
      showAway('Reconnecting');
      connect();
    };
    const check = (slept = false) => {
      const stale = Date.now() - beat > 40000;
      if (stream && (slept || stale)) freshStream();
      else if (!stream && stale && !(frame && bc)) connect();
      else if (!stream && (slept || stale)) bc?.postMessage({ t: 'hello' });
    };
    // Hidden tabs' timers are slowed to about once a minute, which would look like sleep: only a tab in front checks.
    setInterval(() => {
      const now = Date.now();
      const slept = now - tick > 20000;
      tick = now;
      if (!document.hidden) check(slept);
    }, 5000);
    addEventListener('online', () => !document.hidden && check(true));
    const start = () => {
      if (frame && bc) return bc.postMessage({ t: 'hello' }); // a frame only listens: the board's stream is the one
      if (!shared) return connect();
      beat = Date.now(); // a joining tab waits up to 40 s for the shared stream before opening its own
      lead();
      bc.postMessage({ t: 'hello' });
    };
    start();
  }
}
