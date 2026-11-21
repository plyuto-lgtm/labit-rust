// Where a pinned element is in a page's file (lib/htmlspot.ts), for the board section +board writes after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBoard } from '../lib/htmlspot.ts';

const PAGE = `<!doctype html>
<html><head><style>p { color: red }</style><script>if (a<b) {}</script></head>
<body>
  <main>
    <section><p>One<p>Two</section>
    <section>
      <h2>Plans</h2>
      <ul><li>a<li>b</ul>
      <img src=x.png>
    </section>
  </main>
</body></html>`;
const tag = (n) => `<lab-board name="${n}"></lab-board>`;

test('after the element, on its own line at its indent', () => {
  assert.match(withBoard(PAGE, 'x', [['main', 1], ['section', 2], ['h2', 1]], 'Plans'), /<h2>Plans<\/h2>\n {6}<lab-board name="x"><\/lab-board>\n {6}<ul>/);
});
test('a <p> left open ends where the browser ends it', () => {
  assert.match(withBoard(PAGE, 'x', [['main', 1], ['section', 1], ['p', 2]], 'Two'), /<p>Two\n {4}<lab-board name="x"><\/lab-board><\/section>/);
});
test('a void element, and the end of the page for a pin on no element', () => {
  assert.match(withBoard(PAGE, 'x', [['main', 1], ['section', 2], ['img', 1]]), /<img src=x\.png>\n {6}<lab-board/);
  assert.match(withBoard(PAGE, 'x', []), new RegExp(`</main>\\n${tag('x')}\\n</body>`));
});
test('other words or no such element: no spot', () => {
  assert.equal(withBoard(PAGE, 'x', [['main', 1], ['section', 2], ['h2', 1]], 'Pricing'), null);
  assert.equal(withBoard(PAGE, 'x', [['main', 1], ['section', 3]]), null);
});
test('a page with no <body> tag, and one that has the board already', () => {
  assert.equal(withBoard('<title>T</title><h1>Hi</h1>', 'x', [['h1', 1]], 'Hi'), `<title>T</title><h1>Hi</h1>\n${tag('x')}`);
  const once = withBoard(PAGE, 'x', [['main', 1]]);
  assert.equal(withBoard(once, 'x', [['main', 1], ['section', 1]]), once);
});
test('words that run together across tags, and entities, still match', () => {
  const page = '<main><h2>What you get</h2><div class="grid"><div class="card"><h3>Motion that fits</h3><p>Small, calm &amp; quiet.</p></div><div class="card"><h3>Don&rsquo;t</h3></div></div></main>';
  assert.match(withBoard(page, 'x', [['main', 1], ['div', 1]], 'Motion that fitsSmall, calm & quiet.Don’t'), /<\/div><\/div>\n<lab-board name="x"><\/lab-board><\/main>/);
});
