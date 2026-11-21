// The page script (public/_lab/*.js) is built from src/, not kept in git (Leo, 20 Nov: two PRs that touched the widget
// always clashed in the built file). A lab run from a checkout builds it when it's missing or older than its source; the
// npm package ships it built (prepack), and CI builds it before testing. Nothing happens outside a checkout.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** The built files, as scripts/build-widget.mjs writes them (lab.css from src/lab.css). */
const BUILT = ['comments.js', 'components.js', 'switcher.js', 'draw.js', 'sections.js', 'motion.js', 'boardview.js', 'pics.js', 'attach.js', 'lab.css'];

const newest = (dir: string): number => {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};

/** Is the page script in this checkout missing or older than src/ (or the build script)? */
function stale(repo: string): boolean {
  const src = path.join(repo, 'src');
  if (!fs.existsSync(src) || !fs.existsSync(path.join(repo, 'scripts/build-widget.mjs'))) return false; // the npm package
  const out = BUILT.map((f) => path.join(repo, 'public/_lab', f));
  if (out.some((f) => !fs.existsSync(f))) return true;
  const built = Math.min(...out.map((f) => fs.statSync(f).mtimeMs));
  return Math.max(newest(src), fs.statSync(path.join(repo, 'scripts/build-widget.mjs')).mtimeMs) > built;
}

/** Build the page script when it's stale. Returns false when the build failed (the lab says so and goes on). */
export function ensureBuilt(repo: string): boolean {
  if (!stale(repo)) return true;
  console.log('[lab] building the page script from src/ (npm run build)…');
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', 'build'], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
    return true;
  } catch {
    console.error('[lab] the page script did not build: run npm run build in this folder to see why');
    return false;
  }
}
