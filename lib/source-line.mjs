// A pin made on a framework's page says where its element is written (`written at: src/pages/index.astro:12:5`): the file
// and line the framework gave the widget when the pin was made. An edit that moves lines makes that line stale, so the
// agent's text is checked against the file as it is now, when the text is read: the element's tag and its first words must
// still start on that line. Still there: said as it was. Moved: the new line, only when the words are found once. Anything
// else says what could not be checked, and never a guessed line.
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE = 2e6;
const flat = (t) => t.replace(/=>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * @param {string} text the agent's text for a page
 * @param {string} root the project folder (paths in `written at:` are relative to it)
 * @returns {string} the same text, each `written at:` line that names a line checked against its file
 */
export function sourceLines(text, root) {
  const files = new Map(); // a file's lines, read once per text
  const read = (file) => {
    if (!files.has(file)) {
      let rows = null;
      try {
        const full = path.resolve(root, file);
        const rel = path.relative(root, full);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.statSync(full).size <= MAX_FILE) rows = fs.readFileSync(full, 'utf8').split('\n');
      } catch {} // not there, not a file, or not readable
      files.set(file, rows);
    }
    return files.get(file);
  };
  let tag = '';
  let words = '';
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('## ')) [tag, words] = ['', ''];
      else if (line.startsWith('element: ')) tag = /^<([a-z][\w:.-]*)/i.exec(line.slice(9))?.[1] || '';
      else if (line.startsWith('element text: "')) words = flat(line.slice(15, line.lastIndexOf('"')).replace(/…$/, '')).slice(0, 30).trim();
      const at = line.startsWith('written at: ') && /^written at: ([^\s:]+):(\d+)(?::\d+)?$/.exec(line);
      if (!at) return line;
      const [, file, n] = at;
      const rows = read(file);
      if (!rows) return `${line} (line from when it was pinned; the file was not found here to check)`;
      return `written at: ${said(rows, file, Number(n), tag, words.length >= 4 ? words : '', line.slice(12))}`;
    })
    .join('\n');
}

// Where the element starts now: its tag on a line, and its words right after the tag.
function said(rows, file, n, tag, words, stored) {
  const open = tag && new RegExp(`<${tag.replace(/[.]/g, '\\.')}(?![\\w-])`, 'i');
  const starts = (i) => {
    const row = rows[i];
    const at = open ? row.search(open) : 0;
    if (at < 0) return false;
    return flat([row.slice(at), ...rows.slice(i + 1, i + 4)].join(' ')).startsWith(words);
  };
  if (words && n >= 1 && n <= rows.length && starts(n - 1)) return stored;
  const there = words ? rows.flatMap((_, i) => (starts(i) ? [i + 1] : [])) : [];
  if (there.length === 1) return `${file}:${there[0]} (the pin recorded line ${n}, which the file no longer has there; found again by its tag and words)`;
  if (there.length > 1) return `${file} (the pin recorded line ${n}; the file changed and the element's words now start on lines ${there.slice(0, 5).join(', ')}: check which)`;
  // Nothing to find it by, or its words are not written out in the file (a variable, a loop): the line can't be told right or wrong.
  if (!words || !flat(rows.join(' ')).includes(words)) {
    if (open && n >= 1 && n <= rows.length && open.test(rows[n - 1])) return `${stored} (line from when it was pinned; not checked: ${words ? 'its words are not written out in the file' : 'it has no words to find it by'})`;
  }
  return `${file} (the pin recorded line ${n}; the file changed and the element was not found again: moved, edited or gone)`;
}
