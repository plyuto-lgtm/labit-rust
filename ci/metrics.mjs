#!/usr/bin/env node
// The judge for labit: deterministic metrics, measured the same way in CI and locally.
//
//   collect <out.json>                                 measure the current tree
//   compare <current.json> <reference.json> [--must-improve <metric>]
//                                                      exit 1 if the gate fails
//   pick <current.json> [<reference.json>]             choose a target metric for the agent
//   types                                              list TypeScript errors (npm run typecheck)
//
// Fails closed: if a tool can't run, that's an error, never "0 problems".

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const OXLINT = "oxlint@1.93.0"; // pinned, so the count only changes when the code or the rules do
const TYPES = ["typescript@5.9.3", "@types/node@22.20.5"]; // pinned for the same reason
const LINTED = "lib local.mjs src"; // the commented sources (JS and TS); the shipped file is generated
const PAGE_SCRIPT = "public/_lab/comments.js"; // what pages load: built from src/comments.js by npm run build

// ratchet: may never get worse. budget: may grow by perPr per PR, never past max.
// ALLOW_GROWTH=1 (the size-approved label) lifts perPr; raising max means editing this file.
// agent: false = the agent may not fix it (it would have to edit a protected file); a human decides.
const METRICS = {
  pageScriptGzipBytes: {
    kind: "budget", dir: "down", perPr: 2048, max: 80_000,
    hint: "Shrink src/comments.js without changing behaviour: remove dead code and duplication, then npm run build. No new dependencies.",
  },
  npmPackBytes: {
    kind: "budget", dir: "down", perPr: 4096, max: 190_000,
    hint: "Shrink the published package (npm pack): remove dead code from the shipped files.",
  },
  oxlintProblems: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: `Fix oxlint problems (npx --yes ${OXLINT} ${LINTED}), starting with the file that has the most.`,
  },
  runtimeDependencies: {
    kind: "ratchet", dir: "down", ideal: 0, agent: false,
    hint: "labit promises zero dependencies. Remove the new one, or decide to drop the promise.",
  },
  typeErrors: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: "Fix TypeScript errors in the JS (npm run typecheck lists them) with JSDoc types, e.g. /** @type {HTMLTextAreaElement} */ (el). Start with the file that has the most. Never any, @ts-ignore or @ts-nocheck.",
  },
  staleBuild: {
    kind: "ratchet", dir: "down", ideal: 0,
    hint: "public/_lab/comments.js doesn't match a fresh build of src/comments.js. Run npm run build (the built files are not kept in git).",
  },
  readmeClaimsWrong: {
    kind: "ratchet", dir: "down", ideal: 0, agent: false,
    hint: "README size claims no longer match. Shrink back, or update the README.",
  },
};

const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const write = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
const fail = (msg) => { console.error(msg); process.exit(2); };

function run(cmd) {
  try {
    return { out: execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), err: "", status: 0 };
  } catch (e) {
    return { out: e.stdout ?? "", err: e.stderr ?? "", status: e.status ?? 1 };
  }
}

// Size and count claims in the README, checked against what was measured.
// Sizes may be off by 10% (rounding, "about"); file counts must be exact.
function checkReadme(m) {
  const text = readFileSync("README.md", "utf8");
  const claims = [];
  for (const [, n] of text.matchAll(/(\d+(?:\.\d+)?)\s*KB gzipped/gi)) {
    claims.push({ claim: `${n} KB gzipped`, claimed: +n, measured: m.pageScriptGzipBytes / 1000, unit: "KB", tolerance: 0.1 });
  }
  for (const [, n] of text.matchAll(/about (\d+(?:\.\d+)?)\s*kB on npm/gi)) {
    claims.push({ claim: `about ${n} kB on npm`, claimed: +n, measured: m.npmPackBytes / 1000, unit: "kB", tolerance: 0.1 });
  }
  for (const [, n] of text.matchAll(/kB on npm, (\d+) files/gi)) {
    claims.push({ claim: `${n} files`, claimed: +n, measured: m.npmPackFiles, unit: "files", tolerance: 0 });
  }
  return claims
    .filter((c) => Math.abs(c.claimed - c.measured) > c.measured * c.tolerance)
    .map((c) => `"${c.claim}" in README.md, measured ${Math.round(c.measured * 10) / 10} ${c.unit}`);
}

function collect() {
  const m = {};

  // The script every commented page loads, gzipped.
  m.pageScriptGzipBytes = gzipSync(readFileSync(PAGE_SCRIPT), { level: 9 }).length;

  // What npm users download.
  // The package ships the built server (dist/, from build:cli): build it so the size is what npm users get.
  if (read("package.json").scripts?.["build:cli"]) run("npm run --silent build:cli");
  const pack = run("npm pack --dry-run --json --ignore-scripts");
  let packInfo;
  try { packInfo = JSON.parse(pack.out)[0]; } catch { fail(`npm pack did not run:\n${pack.err}`); }
  m.npmPackBytes = packInfo.size;
  m.npmPackFiles = packInfo.entryCount; // informational, used by the README check

  // Runtime dependencies (devDependencies don't reach users).
  const pkg = read("package.json");
  m.runtimeDependencies = ["dependencies", "optionalDependencies", "peerDependencies"]
    .reduce((n, k) => n + Object.keys(pkg[k] ?? {}).length, 0);

  // oxlint, one line per diagnostic in unix format.
  const ox = run(`npx --yes ${OXLINT} ${LINTED} --format unix`);
  const oxCount = ox.out.split("\n").filter((l) => /^.+:\d+:\d+: /.test(l)).length;
  if (ox.status !== 0 && oxCount === 0) fail(`oxlint did not run cleanly:\n${ox.out}${ox.err}`);
  m.oxlintProblems = oxCount;

  // TypeScript over the plain JS (tsconfig.json). Counted only where the tree has a tsconfig.
  if (existsSync("tsconfig.json")) {
    const out = typeCheck();
    m.typeErrors = out.split("\n").filter((l) => /error TS\d+/.test(l)).length;
  }

  // The shipped script must be exactly what npm run build makes from the source.
  m.staleBuild = 0;
  const build = read("package.json").scripts?.build ?? "";
  if (existsSync("src/comments.js") && build.includes(`--outfile=${PAGE_SCRIPT}`)) {
    const fresh = join(mkdtempSync(join(tmpdir(), "build-")), "comments.js");
    const b = run(build.replace(`--outfile=${PAGE_SCRIPT}`, `--outfile=${fresh}`));
    if (!existsSync(fresh)) fail(`npm run build did not run:\n${b.out}${b.err}`);
    // …and so must the parts it loads later, built beside it (public/_lab/<part>.js).
    const parts = readdirSync(dirname(fresh)).filter((f) => f !== "comments.js");
    m.staleBuild = [readFileSync(fresh).equals(readFileSync(PAGE_SCRIPT)), ...parts.map((f) => existsSync(join(dirname(PAGE_SCRIPT), f)) && readFileSync(join(dirname(fresh), f)).equals(readFileSync(join(dirname(PAGE_SCRIPT), f))))].every(Boolean) ? 0 : 1;
  }

  m.readmeClaims = checkReadme(m);
  m.readmeClaimsWrong = m.readmeClaims.length;
  return m;
}

// Pinned TypeScript, installed once into a temp folder (labit itself has no dependencies).
function typeCheck() {
  const dir = join(tmpdir(), `labit-ci-${TYPES.join("_").replace(/[^\w.-]/g, "-")}`);
  const tsc = join(dir, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tsc)) {
    const i = run(`npm install --prefix "${dir}" --no-save --no-audit --no-fund --silent ${TYPES.join(" ")}`);
    if (!existsSync(tsc)) fail(`could not install ${TYPES.join(", ")}:\n${i.err}`);
  }
  const r = run(`node "${tsc}" -p tsconfig.json --pretty false --typeRoots "${join(dir, "node_modules", "@types")}"`);
  // tsc exits 2 when it finds errors; anything without error lines but a failure is a broken setup.
  if (r.status !== 0 && !/error TS\d+/.test(r.out)) fail(`TypeScript did not run:\n${r.out}${r.err}`);
  if (/error TS(2688|5\d{3}|6\d{3}):/.test(r.out)) fail(`TypeScript setup is broken:\n${r.out.split("\n").filter((l) => /error TS(2688|5\d{3}|6\d{3})/.test(l)).join("\n")}`);
  return r.out;
}

const isBetter = (name, cur, ref) => (METRICS[name].dir === "down" ? cur < ref : cur > ref);

// null if the metric passes the gate, or the reason it fails.
function gateProblem(name, cur, ref) {
  const def = METRICS[name];
  if (cur === undefined) return "missing";
  if (def.kind === "ratchet") return isBetter(name, ref, cur) ? `worse than ${ref}` : null;
  if (cur > def.max) return `over the hard cap of ${def.max}`;
  if (process.env.ALLOW_GROWTH !== "1" && cur > ref + def.perPr) return `grew ${cur - ref}, budget is +${def.perPr} per PR`;
  return null;
}

function compare(curFile, refFile, mustImprove) {
  const cur = read(curFile);
  const ref = read(refFile);
  let ok = true;

  console.log("| metric | reference | current | verdict |\n|---|---|---|---|");
  for (const name of Object.keys(METRICS)) {
    if (!(name in ref)) continue;
    const c = cur[name];
    const problem = gateProblem(name, c, ref[name]);
    let verdict;
    if (problem) { verdict = `**FAIL**: ${problem}`; ok = false; }
    else if (isBetter(name, c, ref[name])) verdict = "better";
    else if (c === ref[name]) verdict = "same";
    else if (c - ref[name] > METRICS[name].perPr) verdict = `approved growth (+${c - ref[name]})`;
    else verdict = `within budget (+${c - ref[name]})`;
    console.log(`| ${name} | ${ref[name]} | ${c ?? "missing"} | ${verdict} |`);
  }

  if (cur.readmeClaims?.length) {
    console.log("\nREADME claims that don't match:");
    for (const line of cur.readmeClaims) console.log(`- ${line}`);
  }
  if (mustImprove) {
    if (!(mustImprove in METRICS)) fail(`unknown metric: ${mustImprove}`);
    const c = cur[mustImprove];
    const r = ref[mustImprove];
    if (c === undefined || r === undefined || !isBetter(mustImprove, c, r)) {
      console.log(`\nTarget \`${mustImprove}\` did not improve (${r} → ${c ?? "missing"}).`);
      ok = false;
    }
  }
  if (process.env.ALLOW_GROWTH === "1") console.log("\nPer-PR growth budgets lifted by the size-approved label. Hard caps still apply.");
  process.exit(ok ? 0 : 1);
}

// With a reference: target the first metric that fails the gate (that's what blocks the PR).
// Otherwise rotate through agent-fixable metrics that still have room, one per UTC day.
function pick(curFile, refFile) {
  const cur = read(curFile);
  if (refFile) {
    const ref = read(refFile);
    const failing = Object.keys(METRICS).find((n) => n in ref && gateProblem(n, cur[n], ref[n]));
    if (failing && METRICS[failing].agent === false) {
      fail(`This PR fails the gate on ${failing}, which needs a human: ${METRICS[failing].hint}`);
    }
    if (failing) {
      console.log(`${failing}\tThis PR fails the gate on ${failing} (${cur[failing]} vs base ${ref[failing]}). Bring it back within the gate. ${METRICS[failing].hint}`);
      return;
    }
  }
  const open = Object.keys(METRICS)
    .filter((n) => METRICS[n].agent !== false && n in cur && cur[n] !== METRICS[n].ideal);
  if (open.length === 0) fail("nothing left for the agent to improve");
  const name = open[Math.floor(Date.now() / 86_400_000) % open.length];
  console.log(`${name}\t${METRICS[name].hint}`);
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

switch (cmd) {
  case "collect": write(args[0] ?? fail("usage: collect <out.json>"), collect()); break;
  case "compare": compare(args[0], args[1], flag("--must-improve")); break;
  case "pick": pick(args[0], args[1]); break;
  case "types": { const out = typeCheck(); process.stdout.write(out || "No type errors.\n"); process.exit(/error TS\d+/.test(out) ? 1 : 0); }
  default: fail("commands: collect | compare | pick | types");
}
