// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import { stickToEnd } from './stick.ts';
import { choicesEl } from './thread.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindChat(w: unknown) {
  W = w;
}

// The chat: the page's whole conversation in time order (messages about the page as a whole, pins and every reply;
// a pin's say what they're on). An agent's question with choices shows its rows, as in a thread (thread.ts). New messages are about the page; on phones swipe one to answer it instead.
// The time in a bubble's corner, as in messengers (no hover tooltip over the text), and on yours ✓ sent, ✓✓ handed to
// the agent (its thread went to the agent at or after you wrote it). Chat and threads alike.
// The time and its mark sit pinned in the bubble's bottom-right corner, as WhatsApp and Telegram do: an invisible
// copy at the end of the last line keeps room for it there, so it shares that line when it fits and gets a line of
// its own when it doesn't. Smaller than the words, it sits a touch below their line: a stamp on the bubble.
export const stamped = (bubble, stamp) => {
  const room = stamp.cloneNode(true);
  room.classList.replace('stamp', 'stamp-room'); // its other classes stay, so it keeps the stamp's width
  room.setAttribute('aria-hidden', 'true');
  room.querySelector('.state')?.remove(); // the words go under the bubble: no room for them in it
  bubble.classList.toggle('waits', Boolean(stamp.querySelector('.state')));
  for (const n of room.querySelectorAll('[role]')) n.removeAttribute('role');
  const last = [...bubble.children].reverse().find((n) => n.classList?.contains('p'));
  (last || bubble).append(room);
  bubble.append(stamp);
};

export function drawChat() {
  const byId = new Map(W.S.comments.map((c) => [c.id, c]));
  // Only the chat's own messages (about the page as a whole) and the replies to them: pins live on the page and in the list.
  const msgs = W.S.comments
    .filter((c) => W.isPage(c) || (c.parent && W.isPage(byId.get(c.parent) || {})))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-150);
  if (W.S.on && W.S.chatOpen && W.chatEl.hidden) W.S.newFrom = msgs.find(W.isNew)?.id || null; // opening: a "new" line above the first unread
  if (!W.S.chatOpen) W.S.newFrom = null;
  if (W.S.on && W.S.chatOpen) W.markSeen(msgs.filter(W.isNew)); // open: what's there is read
  const fresh = msgs.filter(W.isNew).length;
  W.chatBtn.hidden = !W.S.on;
  // "chat" with a count (kept in place, grey 0, when there's nothing new); phones the same, without the key letter.
  {
    // Phones: the agent's mark sits first on this button (live.ts puts it there). It stays where it is across renders,
    // so its blink or twitch isn't restarted every time the count is redrawn.
    const mark = W.chatBtn.querySelector('.mark');
    while (W.chatBtn.lastChild && W.chatBtn.lastChild !== mark) W.chatBtn.lastChild.remove();
    W.chatBtn.append(W.coarse ? 'chat' : W.keyLabel('chat', W.KEYS.chat), W.el('b', { class: `cnt${fresh ? '' : ' zero'}` }, String(fresh)));
    W.chatBtn.setAttribute('aria-label', `chat, ${fresh} new`);
    W.chatBtn.setAttribute('aria-keyshortcuts', W.KEYS.chat);
  }
  W.placeBar(); // the chat button may have just shown: the segment lines follow
  const opening = W.chatEl.hidden;
  W.chatEl.hidden = !W.S.on || !W.S.chatOpen;
  if (W.chatEl.hidden) W.chatEl.classList.remove('full'); // opens at its lower height again
  if (W.chatEl.hidden && W.chatEl.contains(W.root.activeElement)) (W.root.activeElement as HTMLElement).blur(); // a closed chat keeps no focus, so keys work again
  if (W.chatEl.hidden) return;
  const box = W.$('.msgs', W.chatEl);
  // Opens at the newest; later it follows new messages only while you're at the bottom, not while you read back (nor
  // when a fold row was just tapped: the messages it opens are not new, and the row stays where it is).
  const atEnd = opening || (!W.S.foldToggle && box.scrollHeight - box.scrollTop - box.clientHeight < 48);
  const before = new Set(opening ? [] : [...(box.children as HTMLCollectionOf<HTMLElement>)].map((n) => n.dataset.id));
  // A message already on screen that hasn't changed keeps its own node: a redraw for one new message used to rebuild
  // every bubble (a phone showed the chat blink as messages arrived).
  const kept = new Map([...(box.children as HTMLCollectionOf<HTMLElement>)].filter((n) => n.dataset.id).map((n) => [n.dataset.id, n]));
  const same = (n) => {
    const old = kept.get(n.dataset?.id);
    return old && old.outerHTML.replace(' fresh', '') === n.outerHTML ? old : n;
  };
  const unfolded: Set<string> = (W.S.unfolded ||= new Set());
  const rootId = (m) => m.parent || m.id;
  // The agent's "on it" messages fold into one muted row once an answer follows them (as in a thread).
  const slots = W.foldStatus(msgs, rootId, unfolded).flatMap((s) => (s.fold ? [s, ...(s.open ? s.items.map((m) => ({ m })) : [])] : [s]));
  W.patchKids(box, slots.flatMap((slot) => {
    if (slot.fold) return [W.foldRow(slot, unfolded)];
    const m = slot.m;
    const root = m.parent ? byId.get(m.parent) : m;
    const b = W.el('div', { class: `msg${W.mine(m) && !m.session ? ' mine' : ''}${before.size && !before.has(m.id) && !W.S.foldToggle ? ' fresh' : ''}`, 'data-id': m.id, ...(W.agentOf(m) ? { 'data-agent': W.agentOf(m) } : {}) });
    // No done mark by the agent's name (Leo, 15 Nov): your own message's green ✓ already says it was answered, and a
    // "Done" answer closes the thread.
    b.append(W.nameLine(m.name));
    // A reply shows what it answers, as in Telegram: the name and the start of that message; a tap there jumps to it.
    if (m.parent && root) {
      const q = W.el('div', { class: 'quote' });
      q.append(W.el('b', {}, String(root.name || '').replace(/\s*·\s*session\s+\S+$/i, '')), document.createTextNode(root.text.replace(/\s+/g, ' ').slice(0, 90)));
      q.addEventListener('click', (e) => {
        e.stopPropagation();
        const box = W.$('.msgs', W.chatEl);
        const to = W.$(`[data-id="${root.id}"]`, box);
        if (!to) return;
        box.scrollTo({ top: to.offsetTop - box.offsetTop - 12, behavior: W.still.matches ? 'auto' : 'smooth' });
        to.animate?.([{ boxShadow: `0 0 0 2px ${getComputedStyle(to).getPropertyValue('--_green').trim()}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: W.ms('hold') });
      });
      b.append(q);
    }
    b.append(...W.readable(m.text));
    if (m.images) W.part('attach').then((a) => a.show(b.appendChild(W.el('div')), m)); // pictures, as in a thread (thread.ts)
    // The agent's question with choices: its rows under it, as in a thread's card (thread.ts), nothing tried in the page.
    if (m.session && Array.isArray(m.choices) && m.choices.length && root) {
      b.classList.add('asks');
      b.append(choicesEl(root, m, W.chatEl, true));
    }
    stamped(b, W.stampOf(m, root));
    return m.id === W.S.newFrom && m !== msgs[0] ? [W.el('div', { class: 'newline' }, 'new'), b] : [b];
  }).map(same));
  if (!box.firstChild) box.append(W.el('div', { class: 'none' }, 'say something about the page as a whole'));
  const chat = W.chatEl.querySelector('.chat');
  if (!chat.firstChild) {
    // At its newest it stays at its newest while it gets shorter (the keyboard coming up as you write), as a thread
    // does; scrolled back to read, it stays put (Leo, 19 Nov: "opening keyboard in chat scrolls content so I can't
    // see the latest message").
    const end = stickToEnd(box);
    // Going to write: the last message comes into view, so you write under it.
    chat.addEventListener('focusin', (e) => (e.target as Element).localName === 'textarea' && end.pin());
  }
  if (!chat.firstChild)
    chat.append(
      W.composer({
        placeholder: 'message',
        draftKey: `lab-typing:${W.S.page}:chat`,
        attach: true,
        onSubmit: async (name, text, att) => {
          const { comment } = await W.send({ name, text, ...att, anchor: { kind: 'page', width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 } });
          W.addComment(comment);
          W.markSeen([comment]);
          box.scrollTop = box.scrollHeight;
          W.S.stayAtEnd?.(box);
          W.render();
          return { keep: true }; // the same box stays, with the cursor in it: the phone's keyboard stays up
        },
      }),
    );
  if (atEnd) {
    box.scrollTop = box.scrollHeight;
    W.S.stayAtEnd?.(box); // and stays at the newest while the sheet and its words settle (comments.js)
  }
}
