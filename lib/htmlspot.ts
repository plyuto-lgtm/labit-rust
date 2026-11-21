// Where an element of a page is in the page's own file, for the one thing the lab writes into a page: a board added with
// +board, as a <lab-board> section after the element the person pinned (Leo, 21 Nov: "add board section into page", "its
// html like artifact why it would be deployed"). The element is named the way the browser has it: its tag and place among
// its kind, from <body> down (path). The file is read as a browser would, near enough for a page written by hand or by an
// agent: comments, scripts and styles skipped, void elements, a <p> or <li> left open closed by the next. Anything that
// doesn't match (another tag there, other words in it) is no spot: the lab writes nothing then.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'svg']);
const OUTER = new Set(['html', 'head', 'body']); // the browser makes these anyway: the path starts inside <body>
const BLOCK = /^(address|article|aside|blockquote|details|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/;
// What a new tag closes when the one open is left open (a page's <p> and <li> without their end tags).
const closes = (open: string, tag: string) =>
  (open === 'p' && BLOCK.test(tag)) || (open === 'li' && tag === 'li') || (/^(dt|dd)$/.test(open) && /^(dt|dd)$/.test(tag)) ||
  (open === 'option' && tag === 'option') || (open === 'tr' && tag === 'tr') || (/^(td|th)$/.test(open) && /^(td|th|tr)$/.test(tag));
const bare = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

type Open = { tag: string; at: number; kinds: Map<string, number>; on: number }; // on: how much of the path it is (-1: off it)
/** The end of the element at `path` ([tag, place among its kind from 1] from <body> down) in a page's file, and where its
 * line starts (for the indent). An empty path is the end of <body>. Null when the file has no such element, or its words
 * aren't `words` (the browser's first few, so the file is the page that was pinned). */
function spotIn(src: string, path: [string, number][], words = ''): { end: number; line: number } | null {
  const root: Open = { tag: '', at: 0, kinds: new Map(), on: 0 };
  const stack: Open[] = [root];
  const tok = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
  const done = (o: Open, end: number) => {
    if (o.on !== path.length || !path.length) return null;
    // Letters and digits only: the browser's words run together across tags ("Motion that fitsSmall, calm"), and the
    // file has entities where the browser has their characters.
    const w = bare(words).slice(0, 30);
    return !w || bare(src.slice(o.at, end).replace(/<[^>]*>|&[#\w]+;/g, '')).includes(w) ? { end, line: src.lastIndexOf('\n', o.at) + 1 } : null;
  };
  let bodyEnd = -1;
  for (let m: RegExpExecArray | null; (m = tok.exec(src)); ) {
    const [all, shut, name, self] = m;
    if (shut) {
      const tag = shut.toLowerCase();
      if (tag === 'body') bodyEnd = m.index;
      if (OUTER.has(tag)) continue;
      const i = stack.map((o) => o.tag).lastIndexOf(tag);
      if (i < 1) continue; // an end tag with nothing open for it: the browser drops it
      for (let k = stack.length - 1; k >= i; k--) {
        const o = stack.pop() as Open;
        const hit = done(o, k === i ? m.index + all.length : m.index);
        if (hit) return hit;
      }
      continue;
    }
    if (!name) continue;
    const tag = name.toLowerCase();
    if (OUTER.has(tag)) continue;
    while (stack.length > 1 && closes(stack[stack.length - 1].tag, tag)) {
      const hit = done(stack.pop() as Open, m.index);
      if (hit) return hit;
    }
    const top = stack[stack.length - 1];
    const n = (top.kinds.get(tag) || 0) + 1;
    top.kinds.set(tag, n);
    const want = path[top.on];
    const el: Open = { tag, at: m.index, kinds: new Map(), on: top.on >= 0 && want && want[0] === tag && want[1] === n ? top.on + 1 : -1 };
    if (VOID.has(tag) || self) {
      const hit = done(el, m.index + all.length);
      if (hit) return hit;
      continue;
    }
    if (RAW.has(tag)) {
      const end = src.toLowerCase().indexOf(`</${tag}`, tok.lastIndex);
      const close = end < 0 ? src.length : src.indexOf('>', end) + 1 || src.length;
      tok.lastIndex = close;
      const hit = done(el, close);
      if (hit) return hit;
      continue;
    }
    stack.push(el);
  }
  for (let k = stack.length - 1; k > 0; k--) {
    const hit = done(stack[k], src.length);
    if (hit) return hit;
  }
  if (path.length) return null;
  const end = bodyEnd >= 0 ? bodyEnd : src.length;
  return { end, line: end };
}

/** The file with a <lab-board name> after the element at `path`, on a line of its own at the element's indent; null when
 * there is no such spot. Once: a file that has that board already is given back as it is. */
export function withBoard(src: string, name: string, path: [string, number][], words = ''): string | null {
  if (src.includes(`<lab-board name="${name}"`)) return src;
  const at = spotIn(src, path, words);
  if (!at) return null;
  const indent = path.length ? /^[ \t]*/.exec(src.slice(at.line))?.[0] || '' : '';
  const tag = `<lab-board name="${name}"></lab-board>`;
  return path.length ? `${src.slice(0, at.end)}\n${indent}${tag}${src.slice(at.end)}` : `${src.slice(0, at.end).replace(/\s*$/, '')}\n${tag}\n${src.slice(at.end)}`;
}
