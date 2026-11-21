// Which browser tests a pull request needs (Leo, 20 Nov: PR CI should run only the tests a change can break). The
// browser jobs run on Leo's Mac; this picks, from the files a PR changes, which test/browser files they run.
//
// Rules, first match per changed file:
// - Never affects a browser: docs, skills, hooks, examples, unit tests, the phone kit, the size gate's ci/ scripts,
//   workflows other than test.yml. Nothing runs for these.
// - A browser test that a group in test.yml runs: that test.
// - A widget module with a known reach (REACH below): the tests listed for it.
// - public/_lab/*.js built from src/: nothing of its own when the PR also changes src/ (it is the build of those
//   files, and the size gate's staleBuild check already holds it to them); everything when it changes alone.
// - Everything else, including anything not listed here: every test. So src/comments.js, styles.css, the server
//   (local.mjs, lib/), package.json, the build script, test.yml, this file, test helpers, and new folders all run the
//   full set. Unknown means all: a missed test costs more than a run.
// A merge to main (--main) runs nothing unless it bumps the version, a release, which runs everything; a run started by
// hand runs everything (--all).
//
//   node ci/affected.mjs <base> <head>    prints {"tests":"all"|"a b c","native":bool,"bench":bool,"why":[…]}
//   node ci/affected.mjs --main <before> <after>
//   node ci/affected.mjs --all
// In CI the same JSON goes to $GITHUB_OUTPUT as tests=…, native=…, bench=…, and the reasons to the job summary.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

// Paths that no browser test reads.
const NO_BROWSER = [
  /\.md$/, /^LICENSE$/, /^docs\//, /^examples\//, /^skills\//, /^hooks\//, /^plugin\.json$/, /^\.claude-plugin\//,
  /^knip\.json$/, /^\.oxlintrc\.json$/, /^tsconfig\.json$/, /^\.gitignore$/,
  /^test\/[^/]+\.test\.mjs$/, /^test\/harness\.mjs$/, /^test\/setup\.mjs$/, /^test\/phone\//,
  /^ci\/(metrics|reuse)\.mjs$/, /^ci\/parts\.json$/, /^ci\/[^/]+\.sh$/,
  /^\.github\/workflows\/(?!test\.yml$)/,
];

// What a widget module reaches, as the test files that exercise it. A module missing here runs everything.
// Built from what each test does (its selectors, flags and routes); when in doubt a test is listed.
const REACH = {
  // The parts moved out of src/comments.js (motion, drag, keys, board camera). framework.ts has no test of
  // its own (components.js loads only on React, Vue or Svelte pages), so it runs everything.
  'src/widget/motion.ts': ['motionreach', 'moment', 'update'],
  'src/widget/motion.css': ['motionreach', 'moment', 'update'],
  'src/widget/drag.ts': ['pincontext', 'selection', 'draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'shortcuts', 'shiftkeys'],
  'src/widget/keys.ts': ['shiftkeys', 'selection'],
  'src/widget/boardcam.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection'],
  'src/widget/actions.ts': ['actions'],
  'src/widget/chat.ts': ['behaviours', 'boardclose', 'connection', 'fluid', 'native', 'progress', 'sections', 'shortcuts', 'update', 'updbadge', 'zoom'],
  'src/widget/draw.ts': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'src/widget/fluid.ts': ['behaviours', 'fluid', 'nativepins', 'select', 'selection', 'shortcuts'],
  'src/widget/frame.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/widget/ink.ts': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'src/widget/messages.ts': ['behaviours', 'boardclose', 'boardhalf', 'boardpins', 'connection', 'draw', 'edge-draw2', 'fluid', 'moment', 'native', 'progress', 'sections', 'selection', 'shortcuts', 'undo', 'update', 'updbadge', 'zoom'],
  'src/widget/pinhold.ts': ['actions', 'behaviours', 'boardclose', 'boardhalf', 'boardpins', 'boardview', 'boxfits', 'connection', 'draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'fluid', 'moment', 'moved', 'native', 'nativeboard', 'nativepins', 'progress', 'sections', 'select', 'selection', 'shortcuts', 'undo'],
  'src/widget/sections.ts': ['boardview', 'edge-draw3', 'sections', 'shortcuts'],
  'src/widget/sections.css': ['boardview', 'edge-draw3', 'sections', 'shortcuts'],
  'src/widget/select.ts': ['select'],
  'src/widget/stick.ts': ['behaviours', 'boardclose', 'boardhalf', 'boardpins', 'connection', 'draw', 'edge-draw2', 'fluid', 'moment', 'native', 'progress', 'sections', 'selection', 'shortcuts', 'undo', 'update', 'updbadge', 'zoom'],
  'src/widget/switcher.ts': ['behaviours', 'boardhalf', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'src/widget/switcher.css': ['behaviours', 'boardhalf', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'src/widget/trial.ts': ['anchoring', 'behaviours', 'native', 'progress', 'selection', 'shortcuts'],
  'src/board/camera.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/board/mount.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/board/overlay.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection'],
  'public/_lab/boardview.js': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection'],
  'public/_lab/draw.js': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'public/_lab/motion.js': ['motionreach', 'moment', 'update'],
  'src/widget/attach.ts': ['attach'],
  'src/widget/attach.css': ['attach'],
  'public/_lab/attach.js': ['attach'],
  'src/widget/pics.ts': ['attach', 'boardimage'],
  'public/_lab/pics.js': ['attach', 'boardimage'],
  'public/_lab/sections.js': ['boardview', 'edge-draw3', 'sections', 'shortcuts'],
  'public/_lab/switcher.js': ['behaviours', 'boardhalf', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'lib/actions.ts': ['actions', 'behaviours', 'fluid', 'nativepins', 'select', 'selection', 'shortcuts'],
  'lib/agents.ts': ['behaviours', 'connection', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'moment', 'moved', 'native', 'progress', 'shortcuts', 'updbadge'],
  'lib/board.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'sections'],
  'lib/boardact.ts': ['board', 'boardarrange', 'boardclose', 'boardhalf', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'lib/commands.ts': ['behaviours', 'connection', 'moved', 'progress'],
  'lib/labcall.ts': ['behaviours', 'connection', 'moved', 'progress'],
  'lib/proxy.ts': ['devroutes', 'sections'],
  'lib/update.ts': ['update'],
};

// The browser tests CI runs: every file named in a `files:` line of test.yml's groups.
export function groupTests(yml = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8')) {
  const names = new Set();
  for (const m of yml.matchAll(/files:\s*([\w\- ]+?)\s*\}/g)) for (const n of m[1].split(/\s+/)) if (n) names.add(n);
  return names;
}

// test.yml changes that only move test files between groups, add or drop them, or edit comments: the tests added to a
// group, else null (the change is to how CI runs, so every test runs).
export function groupEdit(diff) {
  const lines = diff.split('\n').filter((l) => /^[+-](?![+-]{2} )/.test(l));
  const added = new Set();
  const dropped = new Set();
  for (const l of lines) {
    const body = l.slice(1).trim();
    if (body === '' || body.startsWith('#')) continue;
    const names = body.match(/files:\s*([\w\- ]+?)\s*\}/)?.[1] ?? body.match(/^- ([\w\- ]+)$/)?.[1];
    if (!names) return null;
    for (const n of names.split(/\s+/)) if (n) (l[0] === '+' ? added : dropped).add(n);
  }
  return [...added].filter((n) => !dropped.has(n));
}

export function affected(files, { tests = groupTests(), reach = REACH, diffOf = () => '' } = {}) {
  const why = [];
  const pick = new Set();
  let all = false;
  let native = false;
  let bench = false;
  const srcChanged = files.some((f) => f.startsWith('src/'));
  for (const f of files) {
    if (NO_BROWSER.some((r) => r.test(f))) {
      why.push(`${f}: no browser test reads it`);
      continue;
    }
    const t = f.match(/^test\/browser\/([\w-]+)\.mjs$/)?.[1];
    if (t && tests.has(t)) {
      pick.add(t);
      why.push(`${f}: runs ${t}`);
      continue;
    }
    if (f === 'ci/native.mjs') {
      native = true;
      why.push(`${f}: runs the native check`);
      continue;
    }
    if (f.startsWith('bench/')) {
      bench = true;
      why.push(`${f}: runs the bench`);
      continue;
    }
    if (f === '.github/workflows/test.yml') {
      const moved = groupEdit(diffOf(f));
      if (moved) {
        for (const n of moved) pick.add(n);
        why.push(`${f}: only its groups changed, runs ${moved.join(' ') || 'nothing new'}`);
        continue;
      }
    }
    if (reach[f]) {
      for (const r of reach[f]) if (tests.has(r)) pick.add(r);
      why.push(`${f}: runs ${reach[f].filter((r) => tests.has(r)).join(' ') || 'nothing (its tests left the groups)'}`);
      continue;
    }
    if (/^public\/_lab\/[^/]+\.js$/.test(f) && srcChanged) {
      why.push(`${f}: the build of the src/ files changed here`);
      continue;
    }
    all = true;
    why.push(`${f}: runs every test`);
  }
  if (all) return { tests: 'all', native: true, bench: true, why };
  // The native check probes the engines for what the widget uses; it follows any widget change.
  if (srcChanged) native = true;
  return { tests: [...pick].sort().join(' '), native, bench, why };
}

// A merge to main was already tested in its PR, so main runs browser tests only for a release: a merge that changes
// package.json's version (Leo, 20 Nov: "test whole only on tags"; the tag comes from that merge).
export function onMain(packageDiff) {
  return /^[+-]\s*"version"\s*:/m.test(packageDiff)
    ? { tests: 'all', native: true, bench: true, why: ['package.json: a new version, a release runs every test'] }
    : { tests: '', native: false, bench: false, why: ['main: tested in its PR; only a release (a version bump) runs the browsers'] };
}

function changedFiles(base, head) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', base, head], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const main = process.argv[2] === '--main';
  const [a, b] = process.argv.slice(main ? 3 : 2);
  const diffOf = (f) => execFileSync('git', ['diff', '-U0', a, b, '--', f], { cwd: ROOT, encoding: 'utf8' });
  const out = a === '--all' || !a || !b ? { tests: 'all', native: true, bench: true, why: ['full run'] }
    : main ? onMain(diffOf('package.json'))
    : affected(changedFiles(a, b), { diffOf });
  console.log(JSON.stringify(out, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tests=${out.tests}\nnative=${out.native}\nbench=${out.bench}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const head = out.tests === 'all' ? 'Every browser test' : out.tests ? `Browser tests: ${out.tests}` : 'No browser tests';
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${head}\n\n${out.why.map((w) => `- ${w}`).join('\n')}\n`);
  }
}
