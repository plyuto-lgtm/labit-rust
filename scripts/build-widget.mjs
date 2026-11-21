// Builds the page script: src/comments.js and its modules, bundled and minified into public/_lab/comments.js (and the
// parts it loads later, below, and lab.css). The
// stylesheet (src/widget/styles.css) goes in as text, minified too: esbuild's command line can't minify CSS it loads
// as text, so this runs esbuild's API instead.
//
// labit has no dependencies: package.json runs this through `npx -p esbuild@<pinned> -p terser@<pinned> node …`, which
// puts both on PATH for this process only, and their APIs are found next to those commands.
//   node scripts/build-widget.mjs --outfile=<file> [--watch]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outfile = arg('outfile') || 'public/_lab/comments.js';
const watch = process.argv.includes('--watch');

import { tool } from './npx-tools.mjs';

const esbuild = tool('esbuild');
const terser = tool('terser');

// esbuild leaves the spaces inside what it can't read: a custom property's value (`--_ease: var(--lab-ease, cubic-bezier(.2, .8, .2, 1))`)
// and a var() fallback. They only separate; taking them out (outside strings) leaves every value the same.
const tighten = (css) => css.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/).map((part, i) => (i % 2 ? part : part.replace(/(--[\w-]+):\s+/g, '$1:').replace(/,\s+/g, ','))).join('');
// The stylesheet as text, minified (comments and spaces out). Everything else as the plain command line did it.
const minifiedCss = {
  name: 'minified-css-text',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (a) => {
      const { code } = await esbuild.transform(await fs.promises.readFile(a.path, 'utf8'), { loader: 'css', minify: true });
      return { contents: tighten(code.trim()), loader: 'text' };
    });
  },
};
// Each built file has its local names given again by terser, and nothing else (no rewriting of the code, the same
// escapes for letters outside ASCII, the licence comment kept). esbuild numbers a nested function's names after its
// parents', so deep code gets two-letter names; terser gives each function the shortest names it does not itself
// use, the same few letters over and over, which gzip packs about 4% smaller (the page script: 3 KB).
const shortNames = {
  name: 'short-names',
  setup(build) {
    const { format } = build.initialOptions;
    build.onEnd(async (result) => {
      for (const file of result.outputFiles || []) {
        const { code } = await terser.minify(file.text, { compress: false, mangle: true, module: format === 'esm', format: { comments: /^!/, ascii_only: true } });
        await fs.promises.mkdir(path.dirname(file.path), { recursive: true });
        await fs.promises.writeFile(file.path, code + '\n');
      }
    });
  },
};
const options = {
  entryPoints: ['src/comments.js'],
  bundle: true,
  format: 'iife',
  legalComments: 'inline',
  minify: true,
  logLevel: 'warning',
  outfile,
  write: false, // shortNames writes each file
  plugins: [minifiedCss, shortNames],
  define: { 'globalThis.__LAB_DEBUG__': 'false' },
};
// Parts the page script loads only when they are used (part(name) in src/comments.js): each one an ES module beside
// it, <name>.js, with its own styles in it. The lab serves them with the script (public/_lab/*.js), and its widget
// version covers them (widgetRev in local.mjs), so a change to one reloads open pages too.
// boardview is the one board: a view over the page that links it, and the board's own page (/_lab/board/<name>) loads
// the same file.
const PARTS = { components: 'src/widget/components.ts', switcher: 'src/widget/switcher.ts', draw: 'src/widget/draw.ts', sections: 'src/widget/sections.ts', motion: 'src/widget/motion.ts', boardview: 'src/board/overlay.ts', pics: 'src/widget/pics.ts', attach: 'src/widget/attach.ts' };
const builds = [
  options,
  ...Object.entries(PARTS).map(([name, entry]) => ({ ...options, entryPoints: [entry], format: 'esm', outfile: path.join(path.dirname(outfile), `${name}.js`) })),
];
// The lab's design system for pages (src/lab.css) is served as /_lab/lab.css, minified the same way: the commented source
// stays here, the package carries the small one (the comments were 40% of the file).
const labCss = async () => {
  const { code } = await esbuild.transform(await fs.promises.readFile('src/lab.css', 'utf8'), { loader: 'css', minify: true });
  await fs.promises.mkdir(path.dirname(outfile), { recursive: true });
  await fs.promises.writeFile(path.join(path.dirname(outfile), 'lab.css'), tighten(code.trim()) + '\n');
};
await labCss();
if (watch) {
  for (const o of builds) await (await esbuild.context(o)).watch();
  fs.watch('src/lab.css', () => void labCss());
} else {
  await Promise.all(builds.map((o) => esbuild.build(o)));
  // The npm package carries each script brotli-packed (<name>.js.br, package.json "files"): npm's gzip leaves 8 KB more in
  // it. The lab sends the packed bytes as they are to a browser that takes brotli and unpacks them for one that doesn't
  // (sendPacked in lib/dev.ts); a checkout serves the plain .js beside them. Same bytes in, same bytes out, so a repeat
  // build writes identical files.
  for (const o of builds) {
    const plain = fs.readFileSync(o.outfile);
    const params = { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: plain.length };
    fs.writeFileSync(`${o.outfile}.br`, zlib.brotliCompressSync(plain, { params }));
  }
}
