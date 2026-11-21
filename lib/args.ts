// The command line: one list of flags for every command, the pages a wait listens on, and how answers should read.

/** Options by name: switches are true, valued ones their value (or true when the value is left out). */
export type Opts = Record<string, any>;

// The pages a wait listens on (--pages /a,/b, or wait --page /a): page keys as the lab writes them ("/router-fixes").
export function listenPages(opts: Opts, forWait = false): string[] | null {
  const raw = opts.pages || (forWait ? opts.page : '');
  if (!raw) return null;
  return String(raw).split(',').map((p) => '/' + p.trim().replace(/^\/+/, '').replace(/\.html?$/i, '')).filter((p) => p !== '/');
}
// One list of flags for every command: anything else starting with -- is refused, so a typo
// (`reply abc "Done" --resolv`) stops instead of landing in the reply's text. After a bare --, all is words.
const SWITCHES = ['--wifi', '--no-wifi', '--no-open', '--resolve', '--wait', '--new', '--all', '--bg', '--dev', '--fast', '--no-fast', '--done', '--on-it', '--question', '--first', '--no-check', '--native'];
/** What an agent's reply is, from its flag (reply --done / --on-it / --question): the thread's state is read from it.
 *  undefined when none is given; an error when more than one is. */
export function replyIntent(opts: Opts): 'done' | 'working' | 'question' | undefined | Error {
  const given = (['done', 'on-it', 'question'] as const).filter((f) => opts[f]);
  if (given.length > 1) return new Error(`Give one of --done, --on-it, --question, not ${given.map((f) => `--${f}`).join(' and ')}.`);
  return given[0] === 'on-it' ? 'working' : given[0];
}
/** The choices of a question (reply --choice "…" [--hint "…"] --choice "…" [--recommend B]): their words, a short
 *  description under each (--hint, right after the --choice it describes, optional), and which one the agent would take
 *  (0-based), or an error to show. undefined when no --choice is given. 2 to 6 choices, each one line. */
const MAX_CHOICES = 6;
const MAX_HINT = 120;
export function replyChoices(opts: Opts): { choices: string[]; recommend?: number; hints?: string[] } | undefined | Error {
  const given: unknown[] = Array.isArray(opts.choice) ? opts.choice : [];
  if (!given.length) {
    if (opts.hint !== undefined) return new Error('--hint goes with --choice: reply <id> "question" --choice "A" --hint "why A" --choice "B"');
    return opts.recommend !== undefined ? new Error('--recommend goes with --choice: reply <id> "question" --choice "A" --choice "B" --recommend B') : undefined;
  }
  if (given.some((c) => typeof c !== 'string' || !c.trim())) return new Error('Each --choice needs its text: --choice "the words of this version"');
  const choices = (given as string[]).map((c) => c.replace(/\s+/g, ' ').trim());
  if (choices.length < 2) return new Error('Give at least two choices (--choice "A" --choice "B"), or ask without --choice.');
  if (choices.length > MAX_CHOICES) return new Error(`At most ${MAX_CHOICES} choices.`);
  if (choices.some((c) => c.length > 300)) return new Error('A choice is at most 300 characters.');
  // --hint "…" describes the --choice just before it (parseArgs notes which one each follows).
  let hints: string[] | undefined;
  if (opts.hint !== undefined) {
    const said: unknown[] = Array.isArray(opts.hint) ? opts.hint : [];
    const at: number[] = Array.isArray(opts['hint-for']) ? opts['hint-for'] : [];
    hints = choices.map(() => '');
    for (const [i, h] of said.entries()) {
      if (typeof h !== 'string' || !h.trim()) return new Error('Each --hint needs its text: --choice "Tabs" --hint "less scrolling"');
      const n = at[i] ?? -1;
      if (n < 0) return new Error('--hint goes right after the --choice it describes: --choice "Tabs" --hint "less scrolling"');
      if (hints[n]) return new Error('One --hint for each --choice.');
      hints[n] = h.replace(/\s+/g, ' ').trim();
      if (hints[n].length > MAX_HINT) return new Error(`A hint is at most ${MAX_HINT} characters.`);
    }
    if (!hints.some(Boolean)) hints = undefined;
  }
  const more = hints ? { hints } : {};
  if (opts.recommend === undefined) return { choices, ...more };
  // --recommend B, or b, or 2 (counted from 1, as the letters are).
  const r = String(opts.recommend).trim();
  const n = /^[a-z]$/i.test(r) ? r.toUpperCase().charCodeAt(0) - 65 : /^\d+$/.test(r) ? Number(r) - 1 : -1;
  if (n < 0 || n >= choices.length) return new Error(`--recommend takes the letter of one of the choices (A to ${String.fromCharCode(64 + choices.length)}) or its number.`);
  return { choices, recommend: n, ...more };
}
/** Choices that seem to reach past the quoted words they stand in for (the page tries each one in their place): one
 *  that repeats the word just before or after the quote, or puts a word of its own in front of the quote's first word
 *  ("pins the review…" for "the review…" after "puts"). Each as a short note with how its sentence would read. */
export function choiceSpills(quote: { exact?: string; prefix?: string; suffix?: string } | undefined, choices: string[]): string[] {
  if (!quote?.exact) return [];
  const words = (t = ''): string[] => t.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || [];
  const q = words(quote.exact);
  const before = words(quote.prefix).pop();
  const next = words(quote.suffix)[0];
  return choices.flatMap((c, n) => {
    const w = words(c);
    const spills = (before && w[0] === before && q[0] !== before) || (next && w[w.length - 1] === next && q[q.length - 1] !== next) || (w.length > 1 && w[1] === q[0] && w[0] !== q[0] && !q.includes(w[0]));
    if (!spills) return [];
    const reads = `…${(quote.prefix || '').slice(-30)}${c}${(quote.suffix || '').slice(0, 30)}…`.replace(/\s+/g, ' ');
    return [`Choice ${letter(n)} goes in place of "${quote.exact}" only, so it reads "${reads}". Give each choice as the quoted words' stand-in.`];
  });
}
/** The letter of a choice: A, B, C… */
export const letter = (n: number) => String.fromCharCode(65 + n);
/** The longest a wait sits open when nobody has said it is running in the background. */
export const FOREGROUND_CAP = 60;
/** The wait's own default, when no --timeout is given. */
export const WAIT_DEFAULT = 1500;

/** How many seconds a wait may sit open.
 *
 *  A wait run in the foreground of an agent's turn holds that turn open for its whole timeout: the person can't say
 *  anything to their agent until it ends, and the message they do send kills the command. From inside the process the
 *  two look the same -- same environment, same stdin, same stdout -- so a foreground run can't be spotted, only
 *  promised against: an agent that puts the command in the background says so with --bg and gets the full wait.
 *  Without that promise the wait is capped at a minute: long enough to catch a pin, short enough that nobody is held
 *  up. Someone at a terminal (a tty) is not inside anybody's turn, so they keep the full wait. */
export function waitSeconds(opts: Opts, isTTY = false): { seconds: number; capped: boolean } {
  const asked = Number(opts.timeout) || WAIT_DEFAULT;
  if (opts.bg || isTTY || process.env.LABIT_BACKGROUND === '1') return { seconds: asked, capped: false };
  return { seconds: Math.min(asked, FOREGROUND_CAP), capped: asked > FOREGROUND_CAP };
}

// --fast / --no-fast switched the quick model, removed 15 Nov: still accepted, so older scripts keep working; they do nothing.
// How answers should read, said with every pin (the page shows short blocks and '- ' lists as such).
export const WRITE_SHORT = "Write answers short: they're read in a small window, often on a phone. One point per line or two, a blank line between points, '- ' lines for lists.";
const VALUED = ['--port', '--name', '--page', '--pages', '--timeout', '--dir', '--proxy', '--model', '--suggest-rule', '--at', '--progress', '--choice', '--hint', '--recommend', '--of', '--variants', '--widths', '--flow', '--label', '--width', '--after', '--quote', '--file', '--board', '--frame'];
// Flags given more than once, each time adding one (reply --choice "A" --choice "B"): a list, in the order given.
const REPEATED = ['--choice', '--hint'];
// The command line's words (pos) and options (opts), and any --flag it doesn't know.
export function parseArgs(argv: string[]): { opts: Opts; pos: string[]; unknownFlags: string[] } {
  const opts: Opts = {};
  const pos: string[] = [];
  const unknownFlags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') {
    pos.push(...argv.slice(i + 1));
    break;
  }
  if (a === '--help' || a === '-h') opts.help = true;
  else if (a === '--version' || a === '-v') opts.version = true;
  else if (SWITCHES.includes(a)) opts[a.slice(2)] = true;
  else if (a.startsWith('--') && !VALUED.includes(a)) unknownFlags.push(a);
  else if (VALUED.includes(a)) {
    // --proxy on its own means "find the dev server yourself".
    const v = argv[i + 1];
    if (REPEATED.includes(a)) {
      // A choice may start with a dash ("-20% off"): whatever follows --choice is its text, unless nothing does.
      // A --hint belongs to the --choice before it: which one is kept beside it (hint-for, -1: none before).
      if (a === '--hint') opts['hint-for'] = [...(opts['hint-for'] || []), (opts.choice?.length ?? 0) - 1];
      if (v === undefined) opts[a.slice(2)] = [...(opts[a.slice(2)] || []), true];
      else opts[a.slice(2)] = [...(opts[a.slice(2)] || []), argv[++i]];
    } else if (v === undefined || (v.startsWith('-') && !/^-\d/.test(v))) opts[a.slice(2)] = true; // a negative number is a value (--at -300,50)
    else opts[a.slice(2)] = argv[++i];
  }
  else pos.push(a);
  }
  return { opts, pos, unknownFlags };
}
