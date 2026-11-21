// What every browser test starts and ends with: Playwright, a lab of its own in a temp folder, check() and the exit.
// A test still picks its own port range (port.mjs), pages, labit.json and engines; what differs per file is an option here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
/** labit's own entry file, for a test that runs a command of it. */
export const LAB = fileURLToPath(new URL('../../local.mjs', import.meta.url));

/** The playwright package, from here or from NODE_PATH. Without it the test is skipped (exit 0); with `ciFails`, on CI
 *  it fails instead: a skip there would pass with nothing run. */
export function playwright({ ciFails = false } = {}) {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  const fails = ciFails && process.env.CI;
  console.log(`playwright is not installed: ${fails ? 'failed (CI)' : 'skipped'}`);
  process.exit(fails ? 1 : 0);
}

/** The engines to run, from ENGINES (comma separated). */
export const engines = (fallback = 'webkit,chromium') => (process.env.ENGINES || fallback).split(',');

// ⌥ held for fn: on a board a click (or a drag) comments only with ⌥ (Leo, 21 Nov: "regular cursor to operate on boards opt
// to call comment").
export const withAlt = async (p, fn) => { await p.keyboard.down('Alt'); try { return await fn(); } finally { await p.keyboard.up('Alt'); } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A new temp folder whose name starts with `prefix`. */
export const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** What a test's lab runs with: a LABIT_HOME of its own, no update check, and it ends with the test. With `settings`
 *  (the default) also a settings folder of its own, and PORT cleared so labit.json or --port decides. `extra` is laid
 *  over these; a key given as undefined stays as this process has it. */
export function labEnv(extra = {}, { settings = true } = {}) {
  const own = {
    ...(settings ? { PORT: '', XDG_CONFIG_HOME: extra.XDG_CONFIG_HOME ?? tmp('labit-cfg-') } : {}),
    LABIT_HOME: extra.LABIT_HOME ?? tmp('labit-home-'),
    LABIT_NO_UPDATE_CHECK: '1',
    LABIT_EXIT_WITH_PARENT: '1',
    ...extra,
  };
  return { ...process.env, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)) };
}

/** Starts a new lab in `dir` (`labit [root] --new --no-open [--port port] [...args]`); returns the process. Its output
 *  is piped and not read unless `stdio` says otherwise: a lab that logs a lot needs 'ignore', a full pipe would stop it. */
export const startLab = (dir, env, { root, port, args = [], stdio } = {}) =>
  spawn(process.execPath, [LAB, ...(root ? [root] : []), '--new', '--no-open', ...(port ? ['--port', String(port)] : []), ...args], { cwd: dir, env, stdio });

/** Waits until the lab at `base` answers, 8 s at most (one that never does shows in the checks that follow). */
export async function labUp(base) {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(base + '/');
      return;
    } catch {
      await sleep(100);
    }
  }
}

let failed = 0;
/** One line per check: ok or FAIL, the engine, the check's name and a detail. */
export function check(eng, name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
}

/** Ends the test: exit code 1 if a check failed. Says how many failed, or `passed` (pass '' for no last line). */
export function finish(passed = 'all passed') {
  if (passed) console.log(failed ? `${failed} failed` : passed);
  process.exit(failed ? 1 : 0);
}
