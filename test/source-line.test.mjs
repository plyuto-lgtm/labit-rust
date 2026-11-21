// lib/source-line.mjs: a `written at: file:line` is checked against its file when the text is read. Right: kept. Moved: the
// new line. Anything else says what could not be checked, never a guessed line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceLines } from '../lib/source-line.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-srcline-'));
const write = (name, lines) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), lines.join('\n'));
};
const pin = (tag, words, at) => ['## 1. tester · now · id x', 'comment: hi', `element: <${tag} class="a">`, ...(words ? [`element text: "${words}"`] : []), `written at: ${at}`, 'looks: x'].join('\n');
const said = (text) => /^written at: (.*)$/m.exec(sourceLines(text, root))[1];

test('written at: the line is kept while the element still starts there', () => {
  write('src/a.astro', ['---', '---', '<main>', '  <p class="a">Alpha words here</p>', '  <p class="a">Beta words here</p>', '</main>']);
  assert.equal(said(pin('p', 'Beta words here', 'src/a.astro:5:3')), 'src/a.astro:5:3');
  assert.equal(said(pin('main', '', 'src/a.astro:3:1')), 'src/a.astro:3:1 (line from when it was pinned; not checked: it has no words to find it by)');
});

test('written at: lines put above move it: the new line, found by its tag and words', () => {
  write('src/a.astro', ['---', '// one', '// two', '---', '<main>', '  <p class="a">Alpha words here</p>', '  <p class="a">Beta words here</p>', '</main>']);
  assert.match(said(pin('p', 'Beta words here', 'src/a.astro:5:3')), /^src\/a\.astro:7 \(the pin recorded line 5,/);
  // the neighbour of the same tag now on the stored line is not taken for it
  assert.doesNotMatch(said(pin('p', 'Beta words here', 'src/a.astro:6:3')), /^src\/a\.astro:6/);
});

test('written at: the words on several lines: no line named as the one', () => {
  write('src/b.jsx', ['<ul>', '  <li>Same words</li>', '</ul>', '<ol>', '  <li>Same words</li>', '</ol>']);
  const s = said(pin('li', 'Same words', 'src/b.jsx:9:3'));
  assert.match(s, /^src\/b\.jsx \(the pin recorded line 9; .* lines 2, 5: check which\)$/);
});

test('written at: gone from the file, or words that are variables', () => {
  write('src/c.jsx', ['export const A = () => (', '  <section>', '    <h2>{title}</h2>', '  </section>', ');']);
  assert.match(said(pin('p', 'Gone words', 'src/c.jsx:3:5')), /^src\/c\.jsx \(the pin recorded line 3; .*not found again/);
  assert.match(said(pin('h2', 'Page title', 'src/c.jsx:3:5')), /^src\/c\.jsx:3:5 \(line from when it was pinned; not checked: its words are not written out/);
  assert.match(said(pin('h2', 'Page title', 'src/c.jsx:4:5')), /not found again/, 'the line holds another tag: moved or changed');
});

test('written at: an arrow function in the tag does not hide its words', () => {
  write('src/d.jsx', ['<div>', '  <button onClick={() => go(1)}>Go on now</button>', '</div>']);
  assert.equal(said(pin('button', 'Go on now', 'src/d.jsx:2:3')), 'src/d.jsx:2:3');
});

test('written at: a file that is not there, or outside the project, is said so; served-line and file-only forms stay', () => {
  assert.match(said(pin('p', 'x words', 'src/none.jsx:3:1')), /^src\/none\.jsx:3:1 \(line from when it was pinned; the file was not found here to check\)$/);
  assert.match(said(pin('p', 'x words', '../outside.jsx:3')), /file was not found here to check/);
  const same = pin('p', 'x words', 'src/App.jsx (line 3 as served, may differ from the source)');
  assert.equal(sourceLines(same, root), same);
  const vue = pin('p', 'x words', 'src/App.vue');
  assert.equal(sourceLines(vue, root), vue);
});

test('written at: only its own line of the pin it belongs to; a pin without words has none to look for', () => {
  write('src/e.astro', ['<a>', '  <p>First words</p>', '</a>']);
  const two = `${pin('p', 'First words', 'src/e.astro:2:3')}\n${pin('a', '', 'src/e.astro:1:1')}`;
  const out = sourceLines(two, root).split('\n').filter((l) => l.startsWith('written at'));
  assert.equal(out[0], 'written at: src/e.astro:2:3');
  assert.match(out[1], /^written at: src\/e\.astro:1:1 \(line from when it was pinned; not checked/);
});
