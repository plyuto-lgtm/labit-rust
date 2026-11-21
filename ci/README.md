# ci/: a deterministic gate, plus an agent that works to it

Agents propose. A deterministic judge decides. You merge. CI has no secrets.

## The gate (`.github/workflows/gates.yml`)

Every PR, forks included, is measured against its own base commit. Takes seconds; tests stay in `test.yml`.

| Metric | Rule | Why |
|---|---|---|
| `pageScriptGzipBytes` | may grow 2 KB per PR, never past 80 KB | every commented page loads `comments.js` |
| `npmPackBytes` | may grow 4 KB per PR, never past 190 KB | what `npx` users download |
| `oxlintProblems` | never more | pinned `oxlint@1.93.0` over lib, api, local.mjs, src/comments.js |
| `typeErrors` | never more | TypeScript (pinned 5.9.3) over the plain JS via `tsconfig.json`; `npm run typecheck` lists them |
| `staleBuild` | must be 0 | `public/_lab/comments.js` must equal a fresh `npm run build` of `src/comments.js` |
| `runtimeDependencies` | never more (it's 0) | the README promises none |
| `readmeClaimsWrong` | never more | the README's size and file-count claims vs what was measured |

- Over a per-PR budget on purpose? Add the `size-approved` label. Hard caps still apply;
  raising one means editing `ci/metrics.mjs`.
- Both sides are measured with the **base** branch's `ci/`, so a PR can't change how it's judged.
- Both sides use the **PR's** `.oxlintrc.json`, so adding a rule doesn't fail the PR that adds it.

## Waste check (`.github/workflows/waste.yml`)

On every release tag (and on demand), `npm run waste` reports duplicated blocks, long functions, unused CSS custom
properties, listeners added per redraw, state nothing reads, and the page script's gzip size with its biggest files. It
only reports; it fails when `comments.js` is over its gzip cap. `ci/waste-review.sh` adds an AI review of the report (see AGENT.md).

## The agent (run from your machine, from an up-to-date main)

```bash
ci/agent-improve.sh --pr 31   # fix what makes PR #31 fail the gate, push to it
ci/agent-improve.sh           # improve one metric, open a PR
ci/meta-improve.sh            # weekly: repeated review feedback → lint rules, as a PR
```

Needs `gh` and `claude` logged in; no API keys. Every run prints a folder with its prompts, patches
and logs. The agent must pass the gate *and* `npm test` *and* move its target. It can't edit
`ci/`, tests, `bench/`, `package.json` or the README, and can't add lint suppressions.
Dependency and README-claim failures are left to you.

## Numbers when this was set up (2026-11-16)

| | before | now |
|---|---|---|
| `comments.js` gzipped | 67.7 KB | 49.4 KB (code comments stripped from the shipped file; minified with its stylesheet since, see the CHANGELOG) |
| npm package | 139 kB | 121 kB, 11 files |
| oxlint problems | 27 | 0 |
| type errors | — | 180 (from here only down) |
| runtime dependencies | 0 | 0 |
| README claims that don't match | 4 | 0 |

## Native features (`ci/native.mjs`, in `test.yml`)

What Safari's engine (WebKit) and Chrome's (Chromium) can do natively that labit could use: 36 features (anchor
positioning, popover, invoker commands, field-sizing, scroll-driven animations, `if()`, customizable select…), each
probed in both engines and searched for in `src/`. The table goes to the job's summary, with two lists: in both
engines and not used yet (candidates), and used but missing in an engine. Only the second fails the job. Run it
locally with `node ci/native.mjs` (needs playwright). A new candidate is one line in `FEATURES`.
