// The shape a comment is stored in, and how an older one is read. Used by the comments API (lib/comments-api.mjs) and
// by the lab (local.mjs) as it loads .lab/comments/: one place, so both read old records alike.
//
// v is the version a record was saved in; a record without one is 0. upgrade() brings any record up to VERSION, filling
// new fields from the old ones, so an old file means exactly what it meant before.
//   1 (17 Nov): agent replies say what they are with intent ('done' | 'working' | 'question'), read before from the
//     text ("Done: …", "On it"); a thread says when it was resolved (resolvedAt); replies no longer carry resolved:false
//     (only a thread can be resolved).
//   2 (17 Nov): a rule the agent offers is one field, suggest: { text, state } (state 'kept' | 'no' | 'undone', none
//     while it is only offered), where it was four (suggest, suggestDone, rule, ruleUndone). The marks of what a wait
//     was handed (deliveredAt, deliveredTo, remindedAt) left the comment: a local lab keeps them in .lab/state.json (handed).
//     A pin on a word from before quotes ("…before [word] after…" in anchor.text) has the word as anchor.quote.
//     A reply has no anchor (it was null). An agent's session on a comment is id, name, agent, kind and model.
//   Added in 2, nothing to upgrade (18 Nov): an agent's question may carry choices: string[] (2–6, one line each) and
//     recommend (its own pick, 0-based); the person's answer to it carries picked: { of: <the question's id>, n } (n -1:
//     none, keep the words). A question may also carry
//     hints: string[] (20 Nov), one short line (up to 120 characters) under each choice, parallel to choices,
//     '' for none. All optional and only added: a record without them means what it did, and an older lab or widget
//     reading one shows the question and the "Picked B: …" words as plain messages, and ignores hints.
//   Added in 2, nothing to upgrade: images, the pictures a message carries (a pasted or dropped image in the comment box):
//     [{ n: 1..4, type: 'png'|'jpg'|'webp'|'gif', w, h, size }], their files .lab/attachments/<comment id>-<n>.<type>.
//     A record never holds a path: the name is built from the id and the entry (imageName), and an entry that doesn't
//     fit (n 9, type svg, an id that isn't 12 hex digits) is skipped (imagesOf).
export const IMAGE_TYPES = ['png', 'jpg', 'webp', 'gif'];
export const MAX_IMAGES = 4;
/** The pictures a message carries that are well-formed: nothing from disk reaches a path or the agent's text unchecked. */
export const imagesOf = (c) => (Array.isArray(c?.images) && /^[a-f0-9]{12}$/.test(c.id) ? c.images.filter((i) => Number.isInteger(i?.n) && i.n >= 1 && i.n <= MAX_IMAGES && IMAGE_TYPES.includes(i.type)) : []);
export const imageName = (c, i) => `${c.id}-${i.n}.${i.type}`; // the file under .lab/attachments/, and the URL under /_lab/attachments/
/** A message's words, or that it is only a picture: what every text the agent reads says for a message with no words. */
export const wordsOf = (c) => c.text || (imagesOf(c).length ? '(a picture, no words)' : '');
/** Said once in any text that has an image: line. */
export const IMAGES_SAID = 'Pictures: an "image:" line is a file the person attached; open it to see what they mean.';
export const imageLine = (c, i) => `image: .lab/attachments/${imageName(c, i)} (${i.w | 0}×${i.h | 0})`;
export const VERSION = 2;
/** How long a status line (labit reply --progress, or the plugin's) counts as a sign the agent is on the pin: renewed or it lapses. */
export const PROGRESS_MS = 180000;
export const INTENTS = ['done', 'working', 'question'];
/**
 * A pin's number on its page. `num` is set when the pin is made (the page's highest + 1, never one a resolved pin had),
 * so two pins never share a number. A pin from before has none: its place among the open ones without (1, 2, 3…).
 * @param {{ num?: number, createdAt: string }} c
 * @param {{ parent?: string, resolved?: boolean, num?: number, createdAt: string }[]} all every comment of the page
 */
export const numberOf = (c, all) =>
  c.num || all.filter((x) => !x.parent && !x.resolved && !x.num).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).indexOf(c) + 1;
/** What the agent reads when a browser found nothing for its pin's selector. */
export const UNMATCHED = (id, page, selector) => `pin ${id} matched nothing on ${page}: ${selector}`;
/** What the agent reads after a "Do it" reply on its own pin. */
export const DO_IT = (name) => ` (${String(name).replace(/\s+/g, ' ')} said: do it. Go ahead with what your pin proposes, then reply --done)`;

// An agent reply's intent from its words, for records (and agents) that don't say it: the rule the lab and the widget
// went by before intent existed.
// "On it" is a status only when it reads like one (one short line, no full stop: "On it", "On it, rebuilding"): a real
// answer that starts with it ("On it, fixed by moving the header. Reload.") stays an answer, so it is never folded away
// or kept from counting as unread.
export const intentFromText = (text) => {
  const t = String(text ?? '').trim();
  return /^done\b/i.test(t) ? 'done' : /^on it\b[^.\n]{0,60}$/i.test(t) ? 'working' : undefined;
};

// handed: where a local lab collects the old hand-off marks, { id: [deliveredAt, deliveredTo, remindedAt] }.
// What a comment keeps of the session that wrote it: who, not how to reach it (the link and resume command change, and
// nothing reads them from a comment).
export const slim = (s) => Object.fromEntries(Object.entries(s).filter(([k, v]) => v && k !== 'url' && k !== 'resume'));
export function upgrade(record, handed) {
  if (!record || typeof record !== 'object' || (Number(record.v) || 0) >= VERSION) return record;
  const c = { ...record, v: VERSION };
  if (c.parent) {
    if (c.resolved === false) delete c.resolved;
    if (c.anchor === null) delete c.anchor;
    // An agent's answer (it carries session) from before intent, or from before the lab filled it in from the words.
    if (c.session && !c.intent) {
      const intent = intentFromText(c.text);
      if (intent) c.intent = intent;
    }
  }
  const text = c.rule || c.suggest;
  if (typeof text === 'string') c.suggest = { text, ...(c.rule ? { state: c.ruleUndone ? 'undone' : 'kept' } : c.suggestDone === 'no' ? { state: 'no' } : {}) };
  if (handed && c.deliveredAt) handed[c.id] = [c.deliveredAt, c.deliveredTo ?? null, ...(c.remindedAt ? [c.remindedAt] : [])];
  for (const k of ['suggestDone', 'rule', 'ruleUndone', 'deliveredAt', 'deliveredTo', 'remindedAt']) delete c[k];
  if (c.session) c.session = slim(c.session);
  const a = c.anchor;
  const word = a && !a.quote && /^(?:element|text|)$/.test(a.kind || '') && /^(…?)(.*?)\[([^\]]+)\](.*?)(…?)$/s.exec(a.text || '');
  if (word && (word[1] || word[5])) c.anchor = { ...a, kind: 'text', quote: { exact: word[3], prefix: word[2].slice(-40), suffix: word[4].slice(0, 40) } };
  return c;
}
