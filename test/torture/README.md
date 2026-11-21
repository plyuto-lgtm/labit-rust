# Torture test

Thousands of random, replayable cases against real labs (this checkout's `local.mjs`), in three areas (and two more, below). Each case gets a
lab, a folder and a port of its own, does a random sequence of steps, lets things settle, and compares what every
observer holds with the case's own model of what should be there. The headline is how often labit goes wrong **without
saying so**.

A fourth area, **dev-servers**, puts the lab in front of real frameworks' dev servers (Vite, React, Vue, Astro,
webpack-dev-server, Next.js, a static server). It needs the frameworks installed (once, outside this checkout), so it
runs only when asked for: see "The fourth area" below.

A fifth area, **context**, is about what the agent is told with a pin: the element and its words, the heading over it,
the page and the window it was made in, the source file and line, what went wrong on the page. It is part of
`--area all` (a fifth of the cases): see "The fifth area" below.

Not part of `npm test` (that runs `test/*.test.mjs`). It only observes: it never changes `lib/`, `src/`, `public/` or
`local.mjs`.

## Run

```sh
node test/torture/run.mjs --smoke                       # ~60 cases, under 2 minutes
node test/torture/run.mjs --cases 3000 --area all --seed 1 --concurrency 12 --json out.json
node test/torture/run.mjs --replay hotswap:3539705355 --no-browser          # one case again, every step printed
node test/torture/run.mjs --replay hotswap:3539705355:1,7,8 --no-browser    # only steps 1, 7 and 8 of it
node test/torture/run.mjs --replay agent-sync:865886972 --no-browser --times 30   # 30 runs; the first that fails is printed
node test/torture/run.mjs --smoke --area dev-servers                    # ~20 cases on real dev servers, under 4 minutes
node test/torture/run.mjs --area dev-servers --cases 120 --concurrency 5 --json out.json
node test/torture/run.mjs --area all --with-dev-servers                 # the areas as always, and 120 dev-servers cases beside them
node test/torture/run.mjs --replay dev-servers:2388338421 --browser-share 1   # one dev-servers case again, in real browsers
node test/torture/run.mjs --smoke --area context                        # 20 cases of pin context, about a minute
node test/torture/run.mjs --area context --cases 300 --concurrency 8 --json out.json
node test/torture/run.mjs --area all --context-cases 1000               # the three areas share --cases, context has 1,000 of its own
node test/torture/run.mjs --replay context:423741371 --browser-share 1  # one context case again (a raw one: --no-browser)
```

| flag (or environment) | default | |
| --- | --- | --- |
| `--cases N` (`TORTURE_CASES`) | 3000 | how many cases; `--area all` shares them 28% dev-sync, 24% hotswap, 28% agent-sync, 20% context (600 of 3,000) |
| `--area X` (`TORTURE_AREA`) | all | `dev-sync`, `hotswap`, `agent-sync`, `context`, `dev-servers`, several with commas, or `all` (the first four) |
| `--context-cases N` | 600 | context gets this many cases of its own, and the other areas share `--cases` as 35 : 30 : 35 (smoke: 20). Named alone (`--area context`), `--cases` is its count |
| `--context-browser-concurrency N`, `--context-dev-concurrency N` | 6, 4 | context cases with real browsers at once, and with a dev server at once, whatever `--concurrency` says (smoke: 5, 3) |
| `--context-frameworks a,b` | all | context: only these frameworks behind its dev-server cases (`react`, `astro`, `vue`, `vite`, `next`, `static`, `webpack`), or `none` (those cases run on plain pages). A replay needs the same flag |
| `--with-dev-servers` | | with `--area all`: the dev-servers area too, with its own count (the other areas' counts stay as they are) |
| `--dev-server-cases N` | 120 | how many dev-servers cases beside other areas (smoke: 20). Named alone (`--area dev-servers`), `--cases` is its count |
| `--dev-concurrency N` | 5 | dev-servers cases at once, whatever `--concurrency` says (smoke: 4): dev servers are heavy |
| `--dev-browser-share F` | 0.4 | the share of dev-servers cases in real browsers (a laptop, a phone, and a control tab straight on the dev server) |
| `--frameworks a,b` | all | dev-servers: only these (`vite`, `react`, `astro`, `webpack`, `next`, `vue`, `static`). A replay needs the same flag |
| `--seed N` (`TORTURE_SEED`) | 1 | the run's seed: the same seed makes the same cases |
| `--concurrency N` (`TORTURE_CONCURRENCY`) | 12 | cases at once |
| `--json file` (`TORTURE_JSON`) | none | everything the report says, and every failing case with its steps |
| `--smoke` | | 60 cases (12 of them context), 8 at once, browsers in 10%, one rerun to confirm, little shrinking (none after the first minute; with context a minute and a half). `--smoke --area context`: 20 cases |
| `--confirm N` | 2 | a failing case is run again this many times (see Flaky) |
| `--shrink N` | 12 | at most this many more runs to make the first case of a new signature smaller; 0: off |
| `--browser-share F` / `--no-browser` | 0.06 | the share of hotswap and agent-sync cases that also drive a real browser (context: 70% of its cases are in real browsers whatever F is; with `--no-browser` all of them are hand-built pins) |
| `--slow F` | 1 | every bound and settle time times F, for a slow or loaded machine |
| `--replay area:seed[:steps]`, `--times N` | | one case again |
| `--verbose` | | a line per case that did not pass, as it happens |

Real browsers need the `playwright` package: from this checkout, from `NODE_PATH`, or from `../.labit-pw-scratch/node_modules`
(where this machine keeps it for labit's browser tests). Without it the run says "no browsers" and goes on with raw
clients only. Phones come in through this computer's wifi address (the lab is started with `--wifi` and each phone
redeems a one-time link, as a real one does); with no such address they come in as this computer and the run says so.

The run exits 0 when it ran; what it found is in the report. Every lab, command, browser and temp folder a case
started is ended and removed when the case ends, when the run ends, and on ctrl-c. Ports come from 23000–24799 through
the tests' own port locks (`test/browser/port.mjs`), so nothing collides with other tests or labs on the machine.

## What a case is

A case is made from its seed alone: `plan(rng)` gives a list of steps (the "plan"), and `run(plan)` does them against a
new lab. Steps with the same round go at the same moment (several clients writing at once, a save while a page loads);
rounds go one after another. A case's seed is `hash(run seed, area, index)`, so a failing case is replayed by its own
seed, whatever run it came from. A step left out (`--replay area:seed:0,3,4`, or the shrinker) is skipped, and so is a
step that refers to it.

Each case ends in one of:

- **pass**: every check held.
- **loud**: the product said something went wrong: a status that is no 2xx where the rules say yes, a command that
  exits 1, a lab that does not start and says why, a damaged file it reports.
- **silent**: nothing said anything, and an observer holds the wrong thing: a comment answered 201 that a device, the
  agent's text or `.lab` does not have; a page that still shows old bytes; a reload nobody asked for; a status that says
  what is not so.
- **flaky**: it failed, and did not fail again when the same case was run `--confirm` more times. Counted apart, never
  as silent. A race in labit lands here too: the report lists flaky signatures with how many cases hit them, and a
  signature hit by many different cases is a race, not noise (`--replay … --times 30` shows how often).
- **unclear** is a note, not an outcome: the documented contract does not say what should happen there. The case
  still passes; the report counts the passes that carry such a note and lists the notes.
- **harness**: this test's own trouble (a lab that did not start on a clean folder, a browser that did not launch, a
  case over its 90 s). Never counted against labit.

A case that finds a silent and a loud thing counts as silent.

## Signatures

Every finding has a signature: `area | class | check | tags`. The tags are a few words chosen by the check to tell one
bug from another (`res=css`, `cond=before-first-live-message`, `sig=SIGKILL`, `browser=webkit`); ids, numbers and text
are in the detail, never in the signature. So one bug seen in 400 cases is one line with a count. For the first case of
each signature that came back on a rerun, the shrinker drops steps (halves, then smaller pieces) while the signature
still shows, within its budget, and the report prints that small list of steps and the exact `--replay` line for it.
Two signatures can be one bug seen from two sides (the tags differ): the small step lists make that easy to see.

## The three areas

Each has its own file with the plan, the steps and the checks; `lib.mjs` has what they share.

**dev-sync** (`dev-sync.mjs`): the lab and its folder in step. Kinds of case: *writers* (clients writing at one
moment: pins, replies, replies to replies, resolve, reopen, move, delete, progress, the agent's `--done`, one pin sent
several times with one nonce, requests that must be refused, a stop and start in between), *crash* (the lab killed with
SIGKILL or SIGTERM some ms into a burst of writes; whatever was answered 2xx must be there after the start),
*damaged* (files in `.lab` cut short, garbled, emptied, of another shape, with entries that are no comments, odd dates,
the same id on two pages, an old shape, a stray `.tmp`, a garbled `state.json` or key, a stale `server.json` or lock),
*two-labs* (a second lab on the folder while one runs, two or three started at once, one after a crash), *rename*
(pages moved under their comments, lab running or stopped), *proxy* (a dev server behind the lab: pages sent in random
pieces, raw and packed bytes, a websocket, the dev server gone). Checks: the lab's lists, the files in
`.lab/comments/`, the delta a page gets from `/_lab/api/changes`, the agent text and `.lab/comments.md` all say what
the model holds; pins never share a number; nothing is lost over a restart.

**hotswap** (`hotswap.mjs`): pages, stylesheets, scripts (plain and modules that import another), pictures and
unrelated files are written in place, replaced through a temp file, appended to, cut short, touched, written again with
the same bytes, changed with the same size and time, swapped in by a rename, turned into links, deleted and made again
after 0 ms to 2.5 s, saved 20 to 80 at once, while one to three devices hold pages open (at `/`, with and without
`.html`, in folders, with spaces and marks in the name, in another letter case), go offline and back, reload, hold a
draft open, and the lab stops and starts. The oracle is the disk: after the last step each device must show the bytes
on disk for its page and for every file the page loads, within the bound. Then nothing-to-do-with-it saves follow (a
`.md`, a dot folder, `node_modules`, another page's script, a source file, a comment), and no device may reload.

**agent-sync** (`agent-sync.mjs`): a laptop and a phone (sometimes a third device) on the same pages, one to three
agent sessions (some through `labit wait` / `reply` / `resolve` / `pin`, some speaking the same API). Steps: pins (on a
spot, the page chat, a drawing, an action), replies, a reply sent twice with one nonce, resolve and reopen, move,
delete, the agent's answers (plain, `--done`, `--on-it`, `--question`, `--resolve`), progress lines, its own pins, a
reply command killed part-way, a wait killed, a session that dies holding a hand-off without confirming it, devices
offline and back or reloading, the lab restarted (SIGTERM or SIGKILL). The pages have been open a moment when the
steps begin (each has heard its live stream's first message); what lands while a page is still loading is tried by
the reload steps and carries `cond=made-while-the-page-loaded`. Checks: the lab holds exactly what was said yes
to, each thread in the state the steps leave it in; each device's own list (kept up by the live stream alone) equals
what the lab tells that device now, in the same order, nothing twice; `.lab` equals the lab; the agent text names
every open thread and message; everything a person wrote in an open thread reached some wait, nothing unknown did, and
the counts the hand-offs state add up to each message once; a pin marked "the agent has it" was handed to a wait that
confirmed it; the "waiting" count the page list shows is the number of threads whose last word is a person's.

## The fourth area: dev-servers

`dev-servers.mjs` (the plan, the steps, the checks) and `dev-servers-templates.mjs` (the projects and their installs).
The lab is started in front of a real dev server (`labit . --proxy <port>`; in a tenth of the cases with no flag, so
the lab has to find the dev server itself), on a small project written by hand for each framework. Not in `--area all`
unless `--with-dev-servers` is given: it installs packages from npm the first time.

| framework | project | exact versions | share of the cases |
| --- | --- | --- | --- |
| `vite` | two HTML pages, a module that draws, a module it imports, a stylesheet (no framework) | vite 8.3.8 | 20% |
| `react` | Vite + React 18 with fast refresh, a router of its own (pushState), a component per route | vite 8.3.8, @vitejs/plugin-react 6.3.0, react 18.3.1, react-dom 18.3.1 | 22% |
| `astro` | `.astro` pages in a layout with the client router, a component, a stylesheet, a client script | astro 7.4.13 | 18% |
| `webpack` | webpack 5 with webpack-dev-server and HMR, one page from an HTML template | webpack 5.113.0, webpack-cli 7.3.1, webpack-dev-server 6.1.0, html-webpack-plugin 5.6.8, style-loader 4.0.0, css-loader 7.1.5 | 14% |
| `next` | Next.js app router (Turbopack): a layout with `next/link`, a page per route, a server and a client component | next 16.4.6, react 19.3.1, react-dom 19.3.1 | 12% |
| `vue` | Vite + Vue 3 single-file components, the same shape as the React project | vite 8.3.8, @vitejs/plugin-vue 6.0.11, vue 3.5.46 | 8% |
| `static` | plain pages behind `python3 -m http.server` (no build, no live reload of its own) | none (python3) | 6% |

Svelte and `npx serve` / `http-server` are not covered (the static server stands for servers without live reload).
Astro's "island" here is the page's own client script, bundled by Astro, with no UI framework in it.

**Installs.** Each framework's packages are installed once, with `npm install` and exact versions, into
`<os tmpdir>/labit-torture-devservers/<framework>/` (on this Mac `/private/var/folders/…/T/labit-torture-devservers`;
`TORTURE_DEVSERVERS_CACHE` moves it), with a `.stamp` file that names the versions, the Node major and the platform.
A later run finds the stamp and installs nothing; a changed version in `dev-servers-templates.mjs` installs again.
A case's project is only its source files, in `<cache>/<framework>/cases/<id>/`, removed when the case ends; it finds
`node_modules` one folder up, as a package in a monorepo does, so a case starts in the time its dev server takes
(Vite ~0.3 s, Astro ~1.5 s, webpack ~0.5 s, Next ~2 s). Nothing is installed into this checkout. To clear the cache:
`rm -rf "$(node -p 'require("os").tmpdir()')/labit-torture-devservers"` (719 MB: next 337, astro 188, webpack 80,
vue 48, react 35, vite 30; the installs took 10 s here with a warm npm cache, expect a minute or two without).

**Runtime** (this Mac, 18 cores): `--smoke --area dev-servers` 20 cases in 2 min 12 s; 120 cases at 5 at once in
15 min 17 s with the default two confirming reruns and at most 6 shrinking runs per new signature. One case: half
within 10 s, the slowest 73 s (a case may take 240 s; an error left showing costs 4 s each time). Dev servers are
started in a process group of their own and ended with it; a ctrl-c leaves no dev server, lab or case folder behind.
Astro 7 would put its dev server in the background by itself when it sees an agent's shell; cases start it with
`--ignore-lock` and a clean environment, so it stays in the foreground and ends with the case.

**What a case is.** One dev server, one lab in front of it, a laptop and a phone on its pages, one agent session. In
40% of the cases both devices are real browsers (Chromium or WebKit; the phone with a phone's viewport, let in over
the wifi address with a one-time link), and a third tab, the **control**, holds the same page straight on the dev
server with no lab: it gets the same clicks and reloads and says what the framework does by itself. In the other cases
the devices are the raw clients of `lib.mjs`. Every case has a burst of saves, a dev-server restart under the lab, a
lab restart over the dev server, and an agent that is handed a pin and answers; the other steps are drawn: a source
file saved (in place or through a temp file), a file saved with a syntax error and fixed later, a route's file made,
renamed, deleted and made again, pins and replies through the widget (click, type, Enter) and the API, resolve and
reopen, reload, a click on the page's own link (a client-side navigation in React, Vue, Astro and Next), back, a draft
left open while files are saved, clicks on a counter the page keeps in memory, the same request asked of the dev
server directly and through the lab (as a page load, as a script's fetch, with `Accept-Encoding`, `Range`,
`If-None-Match`, `If-Modified-Since`, HEAD, POST, a path that is not there), and the dev server's own live-reload
websocket opened directly and through the lab around a save. Some cases have a `Content-Security-Policy` header
(vite, webpack) or no favicon.

**The oracle.** Every file a step saves holds one version token; each page shows the tokens of the files its route
uses (`#tok-page`, `#tok-comp`, `#tok-mod`, `--v` on `:root`), so what a page must show is read from the disk. What a
browser shows wrong through the lab is only counted against the lab when the control shows it right (a framework that
is stale by itself is an "unclear" note). A request through the lab must be the dev server's answer byte for byte; a
page is the dev server's bytes plus the lab's reload holder and one widget tag. Comments are the ones said yes to,
each on the page whose address the device showed.

| check | class | what it means |
| --- | --- | --- |
| `widget-missing`, `widget-mounted-twice` | silent | a page the framework serves has no widget, or more than one: after a load, a save, a fixed error, a client-side navigation, a restart; also counted in the HTML as served |
| `stale-through-proxy`, `page-blank-or-error-through-proxy` | silent | after the bound (10 s, Next 15 s) the page through the lab does not show the disk, and the control does |
| `reload-loop` | silent | the page through the lab loads again with nothing saved (3 s, quiet), or loads at least twice more than the control while an error shows |
| `state-lost-through-proxy` | silent | the page's counter is gone through the lab and still there on the control (not after a lab restart: unclear) |
| `draft-lost` | silent | words typed into a new comment are gone after saves |
| `page-click-swallowed` | silent | a click on the page's own link or button did nothing through the lab and worked on the control |
| `comment-on-wrong-page`, `browser-pins-differ` | silent | a pin sent from the widget was saved on another page than the address shown; the pins drawn are not the open threads of the address shown (`reached=client-side`: after a navigation with no page load) |
| `pin-lost-anchor` | silent | a pin on the heading no step changes is off its element (`jumped`), or off the page (`detached`) |
| `acknowledged-comment-missing`, `comment-moved-to-another-page`, `files-differ-from-the-lab`, `thread-state-wrong` | silent | what was said yes to is not what the lab and `.lab` hold at the end (after both restarts) |
| `route-comments-did-not-follow-the-file` | silent | a route's file was renamed and its comments stayed on the old address |
| `comment-missing-on-device`, `agent-reply-missing-on-device`, `message-never-reached-a-wait` | silent | a device or the agent's wait does not hold what the lab holds |
| `proxy-mangled-response` | silent | a request answered differently through the lab than directly (`field=`: status, body, a header, content-length; `what=`: which kind of request) |
| `hmr-message-lost-through-proxy`, `hmr-socket-closed-through-proxy` | silent | the dev server's socket says less through the lab |
| `dev-server-not-found`, `wrong-dev-server-found` | silent | started with no `--proxy`, the lab serves the folder as plain pages, or goes in front of another server |
| `hmr-socket-refused`, `request-dropped-by-the-lab`, `page-left-on-the-labs-502`, `console-error-only-through-proxy`, `write-refused`, `agent-command-failed` | loud | the lab or the browser says so |
| `page-reloaded-by-a-lab-restart`, `page-state-lost-over-a-lab-restart`, `pin-shown-as-moved-after-its-words-changed`, `page-fetched-by-a-script-gets-the-widget`, `framework-stale-without-the-lab`, `framework-keeps-not-found-after-the-route-came-back`, `framework-reloads-when-quiet`, `widget-script-tag-twice`, `static-server-not-put-in-front` | unclear | the contract does not say |

Signatures of this area carry no framework: the report prints `seen with: react 3, astro 2` under each, and a table
"dev-servers by framework" (pass, loud, silent, flaky per framework; `byKind` in the JSON).

**What the model knows (so these are not reported).**

- Next's HMR socket speaks to each page on its own: only "something arrives after a save, as directly" is judged
  there. Vite and webpack-dev-server say the same to every page: there the kinds of message must be the same.
- A restarted lab's pages reload (the dev server's client lost its socket through the lab; the widget catches up by a
  reload): noted as unclear, and neither page state nor the quiet window is judged until seconds after one.
- A page that loaded while a file held a syntax error and did not recover after the fix: unclear, whether or not the
  control loaded then too. Vite tells a page about the error only when that page's socket is already connected, and
  keeps it for the next page only when no page at all is connected (`vite/dist/node/chunks/node.js`: `!wss.clients.size`),
  so of two tabs that reload together (a dev-server restart), the one that asks for the broken file first recovers and the
  other is blank for good, with no overlay. Two tabs straight on the dev server do the same in Chromium and WebKit
  (a tab ended blank in 4 of 5 runs here), a lone tab through the lab recovers every time (3 of 3).
- A tab that sat on a route when its file was deleted shows the framework's "not found"; when the file comes back Astro's
  does not reload (the same address straight on the dev server shows the same). Unclear when a reload through the lab then
  shows the page.
- webpack-dev-server loses a reload for its HTML template while a page loads; the webpack project's page version is
  a hot module for that reason. Astro's error page reloads itself several times a second while an error shows, with
  and without the lab.
- A pin on a mark whose words hold the version is "moved" for the widget once a save changes them: unclear. Pins on
  `#anchor-a`, which no step changes, are the ones judged.
- A page that reloaded while the dev server was away shows the lab's "no answer from the dev server" page: loud (the
  lab says so), and the test reloads it as a person would.
- Console errors while a file is broken or a server is down are the framework's own on each page at its own moment.

**Signatures seen so far** (none has a number in `known-bugs.mjs` yet; all are reported as NEW):

| signature | what it is |
| --- | --- |
| `browser-pins-differ` with `reached=client-side`, `comment-on-wrong-page` | after a client-side navigation the widget still holds the first page: it draws that page's pins and saves new ones there (`src/comments.js` `pageNow` reads the script tag's `data-page`, which the lab sets once per page load) |
| `proxy-mangled-response` with `what=html-piece-fetched-by-a-script` | HTML a script fetches (not a page load) comes back with the reload holder and the widget tag in it (`lib/proxy.ts`: what gets the widget is decided by the answer's content type alone) |
| `dev-server-not-found` | started with no `--proxy` in a project that holds an `.html` file (every Vite project's `index.html`, webpack's template), the lab serves the folder as plain pages (`local.mjs`: `pkg?.scripts?.dev && !hasPage(ROOT)`) |
| `route-comments-did-not-follow-the-file` | in front of a dev server a renamed route file's comments stay on the old address (`local.mjs` `rehome()` leaves a proxied lab alone); the skill's rule ("comments follow the file") names no exception |
| `console-error-only-through-proxy` with `kind=favicon-asked-for-by-the-widget` | the widget asks for `/favicon.ico` (`src/widget/live.ts`); a project without one gets a 404 line in the console on every page load |
| `console-error-only-through-proxy` with `kind=hydration-mismatch` | Next: the widget's `lab-pinning` class on `<html>` (`src/comments.js` `setPinning`) lands before React hydrates, and React reports a hydration mismatch |
| `page-left-on-the-labs-502` | a page that reloads while the dev server restarts gets the lab's plain-text 502 and stays there (`lib/proxy.ts`) |

**Limits.** HMR is checked over websockets (all these frameworks use one); no framework here uses server-sent events
for it. A phone has no control tab: its console errors are judged by the laptop's. After a lab restart the pages
reload by design of the frameworks' clients and the widget, so page state and "no reload" are not judged across one.

## The fifth area: context

`context.mjs` (the plan, the steps, the checks) and `context-fixtures.mjs` (the pages it pins on). What it tortures is
the context labit finds for a pin and hands to the agent: `element:` and `element text:`, `section:`, `inside:`, what
kind of thing it is on (words, a picture, a canvas, a code line, an area, a drawing), `where on element:`, `from:` and
`viewport:` (the device), `page:` and `file:`, `in file: <file>:<line>`, `component:` / `written at:` /
`component used at:` where a framework says them, `spot changed:` after an edit, and the page's
`Page errors (…):` line. It reads it where the agent does: the text of `labit wait` (or `/_lab/wait`),
`/_lab/agent/<page>`, the same thread handed a second time after a reply, `.lab/comments/*.json` and
`.lab/comments.md`; and it reads on each device where the widget draws the pin.

| kind of case | share | what it does |
| --- | --- | --- |
| `shapes` | 16% | real browser, plain pages: 4 to 7 pins on many kinds of element, each by a way it can be pinned, on two pages (and a page shown in an `<iframe>`), a reload, a thread answered (the second read) |
| `changes` | 10% | pins, then the file is saved under them: a word edited, every word rewritten, a class changed, the block moved to another section, the element removed, a copy put beside it, comment lines or a new section put above, a reload, the file renamed; the agent reads after each |
| `errors` | 8% | errors thrown on the page (an uncaught error, a rejected promise, a picture that fails to load, a failed fetch, `console.error`, eleven in a row, the same twice, a 400 character one, one with line breaks and a fake heading) before a pin and after it, on this page and another, on one device and two; then a reload, a second device, the page asked for once more, the file saved |
| `devices` | 6% | a laptop and a phone (a phone's viewport, let in over the wifi address with a one-time link) on one page: both pin, the phone by a held finger |
| `raw` | 30% | no browser: anchors built by hand with odd and hostile words in every field (fake headings and fields after line breaks of every kind, 5,000 characters, an emoji across the place a field is cut, control characters, right-to-left marks, numbers and objects where words belong, a field the lab does not know), pins moved, answered, resolved, told as changed or gone by a "browser", errors posted as a page would |
| `fw-react`, `fw-astro`, `fw-vue`, `fw-vite`, `fw-next`, `fw-static`, `fw-webpack` | 30% (8, 7, 4, 4, 3, 2, 2) | real browser, the lab in front of that framework's dev server (the installs and projects of the fourth area, with route files of this area's own): pins on elements whose file and line the test wrote, the app's own link to another route (no page load in React, Vue, Astro and Next), an error, then lines put at the top of the route's file (a hot update, or a reload) and a pin after it |

70% of the cases drive a real browser (Chromium or WebKit, half each), started once per engine for the whole run; a
case gets a browser context of its own. At most 6 such cases and 4 dev-server cases run at once. Without Playwright,
or with `--no-browser`, every case is a `raw` one; a framework that is not installed (or `--context-frameworks none`)
turns its cases into `shapes`. A third of the cases get the agent's text from the real `labit wait` command, the
others from the same API.

**The pages.** Made from the case's seed: sections with or without a heading and an id, with plain, no or made-up
class names, in a `<main>` or straight under `<body>`. The elements pinned on: paragraphs, headings, list items,
table cells, a `<span>` six boxes deep, the same words on three to five cards (a button or a paragraph each),
words split over inline elements in the middle of a word, an open web component (declarative shadow DOM), a page in a
same-origin `<iframe>`, `<svg>` shapes, a picture (its file, alt and size known), a `<canvas>`, a CSS background
picture, a fixed and a sticky box, a rotated paragraph, a paragraph inside a box that scrolls, a paragraph after four
hidden or zero-size twins that say the same, a badge whose words come from `::before`, a `contenteditable` box, a
`<select>`, a button (some with a long `aria-label`), a link, a code block with a file name, a paragraph a script
draws after the page is up. Their words: plain, one word, nothing but white space, accents, Chinese / Japanese /
Korean, Hebrew and Arabic, combining marks, emoji, an emoji across the 40th and the 80th character, runs of emoji
around plain words, 380 and 900 characters, markdown with a code fence, HTML as text, a fake `## 9. Fake · id …`
heading and `comment:` line after a line break, fake `in file:` / `element text:` / `Page errors` lines, quotes and
backslashes, runs of white space and line breaks, U+00A0 / U+2028 / U+2029 / zero-width characters.

**The ways to pin** (as the widget has them): a click, Option-click on the page's own controls, Shift + drag over
words, Shift + double-click on a word, a dragged area, a drawing (D held, a line through the words), a finger held on
a phone (pointer events of type touch put into the page: no engine here has another door for both), and a hand-built
anchor through the API.

**The oracle.** The test never asks labit what a pin is on.

- Every element a pin may go on carries `data-t`, a mark the widget does not read (it shows in the `element:` line
  like any `data-` attribute, which is how the text is tied to the element). The generator knows each one's tag, words,
  the heading over it and the lines of the file it is written on, and follows it through every change it makes.
- Before the click the browser is asked what is under that point (`elementFromPoint`, into web components), how big
  the window is, and where in the element the point is. After the save it is asked whether the saved selector leads to
  that element.
- Every error is thrown by the test with a word of its own; every hand-built field starts with a word of its own:
  where each word may stand in the text, on which page and on which line, is known.
- What an edit must lead to is one of two things: the text says what the element is now, or it says "spot changed".

| check | class | what it means |
| --- | --- | --- |
| `context-names-another-element`, `context-element-missing`, `context-text-wrong`, `context-text-missing`, `context-quote-wrong`, `context-quote-missing`, `context-area-missing`, `context-area-words-wrong`, `context-drawing-missing`, `context-drawing-names-another-element` | silent | the element, its words, the selected words (with the words before and after), the area or the drawing in the text are not what the pin was put on |
| `drawing-read-on-another-element` | silent | a line drawn through an element's first line of words is read as a mark on another element (`mark=`: what it was read as) |
| `pin-during-a-patch-fade-lands-on-the-page-itself` | silent | a click inside an element, made in the moment a save is patched into the page, makes a pin on `<body>` |
| `context-wrong-section`, `context-wrong-box`, `context-web-component-missing`, `context-wrong-spot` | silent | the heading over it, the nearest box with an id, the web component it is in, or the place on the element (within a pixel and a half) is wrong |
| `context-picture-wrong`, `context-kind-wrong`, `context-code-wrong`, `context-css-words-missing`, `context-chosen-option-wrong` | silent | a picture's file, alt, size or spot; a canvas, svg or background; a code block's file, line number and line; words CSS adds; a select's chosen option |
| `context-wrong-device`, `context-wrong-viewport`, `context-viewport-missing`, `comment-by-another-name`, `comment-words-differ` | silent | `from:` and `viewport:` are not the device's that made it; the name or the comment's own words differ |
| `context-on-another-page`, `agent-text-wrong-page-line`, `file-line-names-another-file`, `file-line-missing` | silent | the pin is listed on another page than the address the device showed (`reached=client-side`: after the app went there itself); the page's `page:` or `file:` line is wrong |
| `selector-names-another-element`, `selector-leads-nowhere` | silent (unclear inside a web component when it leads nowhere) | `selector (at comment time)` led to another element, or to none, the moment the pin was saved |
| `line-hint-wrong` | silent | `in file: <file>:<line>` names another file, or a line the element is not written on |
| `source-missing`, `source-names-another-file`, `source-line-missing`, `source-line-wrong`, `source-line-stale-after-edit`, `source-line-false-alarm`, `component-missing`, `component-wrong` | silent | behind a framework: no `written at`, another file (`names=a-built-file`: a compiled chunk), a line that is wrong now or as pinned (the text must say which: see "the `written at:` contract" below), a line right when pinned and stale now with nothing saying so, "not found again" said of an element that did not move; the component missing or another |
| `context-holds-the-widgets-own-attribute` | silent | the `element:` line holds a `data-lab-…` attribute the widget itself put on the page's element |
| `context-stale-after-change`, `context-on-another-element-after-change`, `removed-element-not-told` | silent | after an edit the text still gives the old words, heading or class (or another element) with no "spot changed" line; a removed element is not told |
| `spot-changed-said-with-nothing-changed` | silent | the agent is told "your edit changed the spot" and nothing on the page changed (`spot-changed-said-of-an-untouched-element`, unclear: the page changed elsewhere) |
| `page-errors-missing` | silent | an error thrown on a page that is still open, not reloaded, is not in the page's text (`cause=`: what happened since: `the-page-was-opened-on-another-device`, `a-save-patched-the-page-in-place`, `the-page-was-asked-for-again-by-something-else`, `another-device-reported-its-own-errors`, `none`) |
| `page-errors-on-another-page`, `page-errors-stale`, `page-errors-twice`, `page-errors-more-than-eight`, `page-errors-more-than-the-last-eight`, `page-errors-entry-too-long`, `page-errors-differ-from-what-was-posted` | silent | an error listed on a page that did not throw it (`reached=client-side`), after its page load was replaced, twice, beyond the last eight or 200 characters |
| `hand-off-leaves-out-the-page-errors`, `hand-off-errors-differ-from-the-agent-text`, `hand-off-differs-from-the-agent-text`, `hand-off-holds-a-line-it-leaves-out` | silent | what `labit wait` printed for a pin is not `/_lab/agent/<page>` at that moment without the lines a hand-off leaves out (looks, CSS rules, box, colours, viewport, selector) |
| `context-differs-between-two-reads` | silent | the thread handed again after a reply gives another spot than the first hand-off, with nothing changed on the page (`line=`: which) |
| `agent-text-malformed` | silent | the text holds a line that is no field's (`what=a-line-…`), a heading that is no pin's, a broken character (U+FFFD: half an emoji) or a line separator (U+2028 / U+2029) inside a line |
| `agent-text-field-broke-out`, `agent-text-field-twice`, `context-field-missing`, `unknown-anchor-field-kept`, `spot-change-not-told`, `pin-move-not-told` | silent | a hand-built field's word stands outside its pin's block or on another line than its field's, twice, or not at all; a field the lab does not know is kept; a change or a move a browser told is not in the text |
| `agent-text-pins-differ`, `agent-text-numbers-out-of-order`, `pin-missing-from-the-agent-text`, `pin-never-reached-the-wait`, `reply-never-reached-the-wait` | silent | the text does not list the page's open threads, oldest first; a pin or a reply reached no wait |
| `files-differ-from-the-lab`, `comments-md-differs-from-the-agent-text` | silent | `.lab/comments/<page>.json` is not what the lab gives; `.lab/comments.md` does not say what the agent's text says (`what=`: a pin's line, or the page's errors) |
| `pin-shown-as-moved-on-an-unchanged-page`, `pin-not-drawn`, `pin-drawn-off-its-element` | silent | a device lists a pin as moved, does not draw it, or draws it more than 16 px off its element, on a page nobody changed (`made=on-the-other-device`: the pin came from the other device) |
| `pin-not-saved`, `write-refused` | loud | Enter was pressed and no page holds the comment; the lab refused a write it should take |
| `no-comment-box-opened`, `pin-inside-a-frame-is-the-framed-pages`, `console-error-not-in-page-errors`, `agent-text-holds-a-control-character`, `spot-changed-said-of-an-untouched-element` | unclear | the contract does not say |
| `a-press-of-the-test-moved-an-earlier-pin`, `step-threw`, `framework-not-installed`, `dev-server-did-not-start`, `lab-did-not-start`, `browser-did-not-start`, `phone-not-let-in` | harness | this test's own trouble |

**What the model knows (so these are not reported).**

- A hand-off (`labit wait`) leaves out `looks`, `css rules reaching it`, `box`, `colours`, `viewport` and
  `selector`: they are judged in `/_lab/agent/<page>`.
- An element with 400 characters or more has no `element text` line; a pin on selected words or on a code line has a
  `text:` or `line:` line instead.
- A pin inside a page shown in an `<iframe>` is the framed page's (that page's widget takes the click), and its
  viewport is the frame's: noted as unclear, then judged as that page's pin.
- After an edit the widget tells the lab half a second after a patch in place, and 3 s after a page load: a read is
  asked again until then before anything is called stale. At the end of every browser case the test waits until 3.7 s
  after the last page load, so what the widget says of an untouched pin is in.
- `console.error` is not among what the widget listens for (uncaught errors, failed loads, rejected promises, blocked
  scripts): its absence is an unclear note. A failed fetch counts when nothing catches it (it is a rejected promise).
- A click's place is a whole pixel in some engines: `where on element` is given a pixel and a half of room.
- A press that starts on the widget is not a press on the page (its bar at the window's edge; an earlier pin, which a
  drag moves; an earlier drawing, which opens its thread): a drag starts at a point of the element that is free of it,
  or the step is skipped with a note.
- A pin made at once after a save (a third of the pins that follow one) is made before anything else is read; the
  others wait until the patch's cross-fade is over.
- A click made inside the cross-fade is made on a point the browser hits as `<html>`; the widget waits for the
  transition (#393), so what it pins is the element under that point once the fade is over. The test reads that
  moment (`settle`, started before the click) and judges the element, its words, its box and the place on it
  against it, not against the transient `<html>` hit.
- Next draws the test's elements on the server: no `written at` is fine there; one that names a file must name the
  route's.
- Vue writes markup with nothing bound in it as one piece of HTML: two of the four targets of a Vue route have a
  bound attribute (`markup=bound`), two stand in such a piece (`markup=static`).
- NEL, vertical tab, form feed, NUL and ESC inside a pin's words are not line ends for JavaScript or the lab's own
  tests: unclear. U+2028 and U+2029 are (`lib/comments-api.mjs` says so of a comment's words): silent.
- Errors are thrown from code the test sends with each call, in a timer. (WebKit hides the words of an error thrown
  by a function put into the page before its scripts, "Script error.", and the widget rightly leaves those out.)

**Frameworks.** The `fw-…` cases use the fourth area's installs (`<os tmpdir>/labit-torture-devservers/<framework>/`,
installed once by `prepare`; nothing goes into this checkout) and its project files, with route files of this area's
own: every route has four marked elements on lines the test wrote (`h1`…`h4` on the home route, `a1`…`a4` on about).
What a pin must say there: React (Vite, React 18): `component: Home (in App)` and `written at: src/pages/Home.jsx:<line>`;
Vue: the component and `written at: src/pages/Home.vue` (no line); Astro: `written at: src/pages/index.astro:<line>:<col>`
(from `data-astro-source-file` / `-loc`, which Astro's dev toolbar takes off the elements after load: the widget keeps their
values as they are removed, `bindAnchoring` in `src/widget/anchoring.ts`); Next (app router, server components): nothing has to be said, what is said
must name `app/page.jsx`; Vite without a framework, webpack and the static server: no source, and `file:` /
`in file:` as for plain pages. Then lines are put at the top of the route's file: a pin made before must not give the
old line as if it were today's, a pin made after (the page updated hot, or loaded again) must give the new one.

**The `written at:` contract.** The widget reads a pin's source (file and line) once, when the pin is made. The agent's text
(`labit wait`, `/_lab/agent/<page>`, `comments.md`) checks it against the file as it is when the text is read
(`lib/source-line.mjs`, called from `agentText` in `local.mjs`): the element's tag and its first words must start on that line.
So a `written at:` line is one of: `file:line[:col]` (checked, right now); `file:line (line from when it was pinned; not
checked: …)` (the file was not found here, the element has no words to find it by, or its words are not written out in the
file: a variable, a loop); `file:line (the pin recorded line N, which the file no longer has there; found again by its tag and
words)` (moved: the new line, only when the element is found exactly once); `file (the pin recorded line N; … now start on lines
a, b: check which)`; `file (the pin recorded line N; … not found again: moved, edited or gone)` (no line named, never a guess).
The check says "the pin recorded line N" and not "was on line N when pinned": the line the widget recorded can itself be wrong
(React hands a pin made after a hot update the line from before it, see below), and the server then corrects it. The test holds
a line without a note to the element's line now, a line "from when it was pinned" to the line it had then, a moved line to the
element's own line now, and "not found again" to an element that really did move. What cannot be told stays said as such:
`component used at:` and a Vue file (no line) are not re-checked; React 19's "line N as served, may differ from the source" is
the served module's line, not the file's; Astro names a source only on elements its compiler wrote (not on what a script adds,
or on text from `set:html`), and only if the page was open before the toolbar took the attributes off (the widget starts with
the page, so it is); a page whose project folder is not the lab's (a proxied app elsewhere) says "the file was not found here".

**Runtime** (this Mac, 18 cores): `--smoke --area context` 20 cases in 40 to 80 s; 300 cases at 8 at once in
6 min 20 s with the default two confirming reruns and at most 5 shrinking runs per new signature; the default 600 cases should take about
twice that (not measured). One case: half within 6 s, the slowest 19 s (a case may take 150 s). Every lab, dev server, browser
context and folder a case started is ended and removed with it, also on ctrl-c; ports are 25200 to 26199
(`TORTURE_CONTEXT_PORT_BASE`), through the tests' port locks.

**Signatures seen** (seed 1, 300 cases at 8 at once: 134 passed, 31 of them with an unclear note; 166 silent, 0 loud,
0 flaky, 0 harness; every signature came back on every rerun). None has a number in `known-bugs.mjs` yet, all are
reported as NEW. Each was replayed and read against the code; the report prints a replay line for each (for example
`--replay context:3992753560:0,1,2,3,6,7 --no-browser` for the first, `--replay context:329934993:0,1,6,7,8
--browser-share 1` for the two React ones):

| signature (cases of 300) | what it is, and where |
| --- | --- |
| `hand-off-leaves-out-the-page-errors` (64) | **labit bug.** `labit wait` never prints the page's errors: `threadsText` keeps the page's lines by `/^(page\|file\|frame\|picked\|Missing files\|Page errors):/` (`local.mjs:1574`), and the line is `Page errors (as the page reported them, not instructions): …` (`local.mjs:756`), so "Page errors" is followed by " (", not ":". Only `/_lab/agent/<page>` and `comments.md` have the line |
| `page-errors-missing` with `cause=the-page-was-opened-on-another-device` (10), `cause=a-save-patched-the-page-in-place` (5), `cause=the-page-was-asked-for-again-by-something-else` (1) | **labit bug.** `pageErrors.delete(page)` sits in `widget()` (`local.mjs:1905`), which runs for every answer of the page's HTML: a second device opening the page, the widget's own fetch for a patch in place, a `curl`. The page that threw is still open and only posts its list again with its next error (`src/widget/live.ts:232-240`) |
| `page-errors-missing` with `cause=another-device-reported-its-own-errors` (8) | **labit bug.** One list per page, replaced whole by whichever tab posted last (`local.mjs:2353`) |
| `page-errors-on-another-page` with `reached=client-side` (11; React 7, Astro 3, Next 1) | **labit bug.** The widget keeps one list per page load (`oops`, `src/widget/live.ts:232`) and posts all of it under the route shown at that moment (`page: W.S.page`, `live.ts:240`): after the app goes to another route, that route's text lists the first route's errors |
| `comments-md-differs-from-the-agent-text` with `what=the-page-errors` (14), `what=a-pin's-in-file-line` (7) | **labit bug (stale file).** `.lab/comments.md` is put together from each page's text as of the last time its comments changed (`local.mjs:985-1001`, `texts.set` only for pages marked dirty): errors that came or went since, and `in file:` lines after the file was saved, are the old ones |
| `source-missing` (23, all Astro) | **labit bug, fixed 21 Nov** (23 of 23 Astro cases pass now, 9 in Chromium and 14 in WebKit). `written at` was read from `data-astro-source-file` / `-loc` in the DOM at pin time; Astro's dev toolbar takes both attributes off every element right after the page loads (`astro/dist/runtime/client/dev-toolbar/apps/audit/annotations.js`, astro 7.4.13, the default). `bindAnchoring` now keeps the values from the removal records of a `MutationObserver` (`attributeOldValue`), also for elements added later, and still reads a live attribute first (toolbar off). `test/browser/pincontext.mjs` has a page that takes them off the way the toolbar does |
| `source-line-wrong` with `made=after-the-edit` (25, all React) | **labit bug, still there in the widget; the text is right since 21 Nov** (the server re-reads the file, see the contract above: it names the element's line now). `componentAt` reads the fiber the DOM node was made with (`src/widget/components.ts:30`); after a hot update React keeps the new `_debugSource` on its `alternate`. A pin made after a save names the line from before it (measured: line 6 on the node's fiber, 9 on its alternate after 3 lines were put above) |
| `source-line-stale-after-edit` (25, all React) | **by design, now said and mostly corrected (21 Nov).** The source is read once when the pin is made (`anchoring.ts`) and was printed as `written at:` (`lib/comments-api.mjs`) with nothing saying so. Since then `lib/source-line.mjs` checks it against the file at every read (the contract above): 0 of the 300 cases of seed 1 have a stale line without a note. `in file:` for plain pages is worked out anew at every read (`lineHints`, `local.mjs`) and stays right |
| `source-names-another-file` with `names=a-built-file` (7, all Next) | **labit bug.** For React 19 the first stack frame outside `node_modules` is taken (`components.ts:20-26`); for a server component under Next 16 that is `.next/dev/server/chunks/ssr/[root-of-the-server]__….js`. `repoPath` (`components.ts:12`) takes the leading slash off, so the lab's root is not cut from it (`local.mjs:763`), and the cut at 200 takes the end of the "(line N as served, may differ…" note. The page's own `file: app/page.jsx` line is right |
| `source-missing` with `markup=static` (8, all Vue) | **a limit of labit.** `components.ts:45` reads `__vueParentComponent` of the clicked element only; Vue writes markup with nothing bound in it as one piece of HTML, whose elements carry none. Elements with a bound attribute get their component and file |
| `context-holds-the-widgets-own-attribute` with `attr=data-lab-anchor` (11), `context-differs-between-two-reads` with `line=element` (1) | **labit bug, small.** A pin on a sticky, fixed or transformed element is held by CSS anchoring: the widget writes `data-lab-anchor` on the page's element (`src/widget/pinhold.ts:104`), and the tag a pin saves takes every `data-*` attribute (`anchoring.ts:517`). The next pin on it, and the next "found" report, carry `data-lab-anchor="lab3"` |
| `pin-shown-as-moved-on-an-unchanged-page` (7 over three device tags), `spot-changed-said-with-nothing-changed` (5), `selector-names-another-element` with `where=web-component` (4), all `shape=shadow` | **labit bug.** A pin inside an open web component has no fingerprint (`anchoring.ts:682`), a selector that says `body > p:nth-of-type(1)` though its path starts at the shadow root (`selectorFor`, `anchoring.ts:115-135`: on a page with a paragraph straight under `<body>` it leads there), and is looked for in the light DOM only (`prove`, `anchoring.ts:943`; `kin`, `anchoring.ts:789`). Three seconds after any page load the widget reports it gone (`src/comments.js:410-429`): the page lists it as moved and the agent reads "your edit changed the spot … its words or element are gone" (`lib/comments-api.mjs:279`) |
| `pin-during-a-patch-fade-lands-on-the-page-itself` (7) | **labit bug, a narrow window.** A save is patched in inside `document.startViewTransition` (`src/widget/live.ts:609`); for the cross-fade (about 250 ms; in WebKit only when the page is not scrolled) the browser hits nothing but `<html>`, and a click in that time makes a pin on `<body>` ("on the page itself, no element") |
| `agent-text-malformed` with `what=a-broken-character`: `line=element` (8), `line=text` (4), `line=page-errors` (10, hand-built posts) | **labit bug, small.** Half an emoji (U+FFFD in the text): an attribute's value is cut at 60 inside the tag (`anchoring.ts:520`); the 40 characters before and after selected words are cut by count (`src/widget/drag.ts:175-176`, `lib/comments-api.mjs:195`); an error is cut at 200 (`local.mjs:2353`, and `live.ts:234` before it). `lib/comments-api.mjs:83` only mends a cut at a field's end |
| `agent-text-malformed` with `what=a-line-separator` (8, hand-built posts) | **labit bug, small, only by a direct POST.** `/_lab/errors` takes control characters out (`\p{Cc}`, `local.mjs:2353`); U+2028 and U+2029 are not among them. The widget's own report squashes them (`\s+`, `live.ts:234`); a page's script that posts to `/_lab/errors` itself can put a line end, and a `## …` heading after it, into the line |
| `drawing-read-on-another-element` with `mark=underlined` (1) | **labit bug, fixed 21 Nov.** A straight line is "crossed out" only when a letter stands within 3 px of its exact middle (`letterAt`, `src/widget/draw.ts`); the caret stands at the nearer edge of a letter, so on the far half of a wide one (Chinese, Japanese, Korean, an emoji; 4 px of a 16 px glyph, 1 px of an ordinary letter) it was the next letter's edge, more than 3 px off, and the line was read as "underlined": the area grew up to the line above and the drawing landed on the list. Measured with 12 wobbly (±2.5 px) strokes per line: 11/12 (Latin), 8-9/12 (CJK), 10/12 (emoji) crossed out before, 12/12 everywhere after. A second cause, also fixed: a drawing's 28 px hit area lies over its words, so a second line through the same words found the page's overlay under the point and read as "underlined" (`letterAt` lets the line through while it asks). A third is the test's: an element with only white space has no words to go through, and a line across its box is an underline of the words above it (not drawn on any more) |
| unclear: `agent-text-holds-a-control-character` (45), `pin-inside-a-frame-is-the-framed-pages` (7), `selector-leads-nowhere` with `where=web-component` (3), `spot-changed-said-of-an-untouched-element` with `shape=hidden-twins` (1) | NUL, ESC, NEL and the like in a hand-built field reach the text (one line still); a pin in a framed page is that page's, with the frame's size as its viewport; a web component's selector matches nothing on a page with a `<main>`; a paragraph with four hidden twins is told as "may have moved" after the page changed elsewhere |

Harness artifacts found on the way and fixed (none is left in the run): errors thrown by a function the test had put
into the page were hidden by WebKit ("Script error."); a drag that began on an earlier pin moved that pin, one that
began on the widget's bar made a plain pin, a press on an earlier drawing wrote a reply; D and Shift never reached a
frame without the focus; a pin moved by a step was compared with its first hand-off; `…n1` matched `…n10` in the
errors; a space at the end of a cut text; a click's place rounded to a whole pixel; a line drawn on the page after a pin inside an
`<iframe>` (the frame still had the focus, so D reached only the frame's widget and the line was a plain box: `context-drawing-missing`;
the draw step now takes the focus to the page it draws in); a line through the empty box of a white-space element
(`drawing-read-on-another-element`, and the phone's `pin-drawn-off-its-element` that followed from the area being the list's).

**Limits.** A phone is a phone's viewport in a desktop engine, its held finger made of pointer events put into the
page (`isTrusted` false). Pins inside a frame are made by click and by area only (keys go to the page that has the
focus). Drawings are one kind (a line through the words). Video, CSS animation moments (`moment:`) and boards are not
pinned. `looks`, `css rules reaching it`, `box` and `colours` are checked for where they stand (the full text, never
a hand-off), not for what they say. A lab restart (the errors list is in memory) is not in the steps.

## Devices

A device (`lib.mjs` `Device`) is a raw HTTP client that speaks as the widget does: it loads a page, reads the widget
tag the lab put in, opens `/_lab/live`, and follows the same rules as `src/widget/live.ts` and `src/comments.js` (when
to reload, when to patch the page, which stylesheets to fetch again, when to ask `/_lab/api/changes` and how to apply
it, what each sender does with its own answer, a browser's "changed?" asks with ETags). It keeps what a browser would be
showing. A phone is the same client coming in through the wifi address with its one-time link's cookie, so the lab sees
a guest. The checks never read these rules: they compare what the device ends up holding with the disk and the lab.

In a share of the cases one device is a real browser instead (Chromium as this computer's, WebKit as this computer's
or, in agent-sync, as an iPhone over the wifi address): what its page really shows (its `<main>`, the stylesheets'
custom properties, what its scripts set, its pins' labels, a draft's words) is read from the page. Some bugs only show
there (anything about the page's own elements), and the raw devices' rules are checked against it.

In a quarter of the agent-sync cases the phone is "held": each answer and live message reaches it up to 15, 40 or
80 ms late, each by its own amount, as on a slow wifi. Failures that need that carry `held=answers-held`.
A device asks `/_lab/api/changes` one at a time, in the order asked, as the widget does; `TORTURE_SERIAL_CHANGES=0` makes it
ask them all at once and apply each answer as it arrives (the widget's old way), to see what asking in order fixes.

## Known bugs and their signatures

The report tags every signature with `known bug N (name)` or `NEW: matches no known bug`, and ends with a table of the
bugs below: how many signatures and cases each showed in the run, or `not seen` (after a fix: that bug is gone), then the
NEW signatures. The mapping is by the signature's text only and lives in `known-bugs.mjs` (the `signatures` in the JSON
carry the number as `knownBug`).

| bug | what | shows as (signature text) |
| --- | --- | --- |
| 1 | js-import | `stale-content` with `res=js-import` |
| 2 | dead page | `dead-page` (any tags) |
| 3 | css stale after restart | `stale-content` with `cause=lab-stopped-or-restarted-around-the-save` and `res=css` or `res=css-import` |
| 4 | first live message / NaN catch-up | `stale-content` with `cause=saved-before-the-page's-first-live-message` |
| 5 | more than 50 files | `stale-content` with `cause=saved-among-over-50-files` |
| 6 | letter case | `stale-content` with `cause=page-opened-in-another-letter-case` |
| 7 | same size and mtime (ETag) | `stale-content` with `cause=same-size-and-time-as-before` |
| 8 | comments follow a move | `comments-did-not-follow-the-page` |
| 9 | comment made during page load missing | `comment-missing-on-device` / `agent-reply-missing-on-device` with `cond=made-while-the-page-loaded` |
| 10 | waitingOn name | `waiting-count-wrong` |
| 11 | hand-off record flush | `message-handed-out-twice` (with `restart=`) |
| 12 | duplicate own bubble | `device-shows-a-comment-twice` |

A signature that matches none (for instance `device-shows-old-state`, `agent-reply-missing-on-device` without the
page-load tag, `stale-content` with `res=img` or `res=js` after a restart) is listed as NEW: either a new bug, or one of
the above seen from another side (the small step lists of the report make that easy to see). Add a line to
`known-bugs.mjs` once it is understood.

## What the model knows about the lab (so these are not reported)

- Any POST a session makes that the lab answers 2xx (pin, reply, progress, resolve, answer) confirms what it was handed
  (`local.mjs`: "An answer or a resolve from a session is proof it has what it was handed"). A session that "dies holding
  its hand-off" and then acts again has confirmed it; the "handed but no wait has it" check follows that.
- Resolving and reopening a thread both clear its status line (`lib/comments-api.mjs`).
- After a restart a raw device finds the lab again some seconds later and catches up, as a real browser does: the quiet
  saves' "spurious reload" check is skipped for it (and for real browsers, whose whole quiet phase is skipped).
- A page file cut inside a tag has no place for the widget tag the lab appends: no "dead page" is reported for it.
- A deleted-and-written-again file's gap is measured (delete to written), not taken from the step's plan: the
  `gone=` bucket and the failure's detail use the measured gap.

## Bounds, and how they were picked

- A save reaches a device ~100 ms after it (the lab waits 80 ms for a burst of saves to end). The bound is 5 s for a
  raw device and 9 s for a real browser (it holds a reload 1.5 s after a key or a click, then looks again every 500 ms).
- Comments reach a device within a few ms of the answer; the bound is 5 s. The files in `.lab` follow within a few ms;
  the bound is 2.5 s.
- A lab answers ~130 ms after it is started; the bound is 10 s.
- The lab's own timers are set short where a case needs them to fire and long where it must not: pins go to a wait
  after 120 ms of quiet (`LAB_SETTLE_MS`, 2 s in a real lab), an unconfirmed hand-off is taken back after 1.2 s
  (`LAB_ACK_MS`, 20 s), "not answered" and "still waiting" (2 and 3 minutes) are out of reach (`LAB_ANSWER_MS`,
  `LAB_REMIND_MS` at 10 minutes).

The report ends with how long these really took in the run (half of them within, 99% within, the slowest), so a bound
that is too tight for a machine shows as flaky cases with settle times near the bound: run with `--slow 2`.
