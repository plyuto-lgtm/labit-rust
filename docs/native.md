# labit for a native app

A native app (GPUI, SwiftUI, anything that draws its own window) puts pins on itself through labit's plain HTTP API.
The agent answers them as it does on the web: `labit wait`, `labit reply <id> --done "…"`.

Everything below is what labit does as built; the tests are in `test/native.test.mjs`.

## Start the lab

```
labit --native [--name "o11 app"] [--port 4436] [--no-open]
```

- No dev server and no HTML folder are needed. The folder you run it in only holds `.lab/` (the comments, saved across restarts).
- Default port 4436 (labit's own is 4400); if it is taken, labit takes the next free one and says so: read it from the
  `[lab] http://localhost:<port>` line, or from `.lab/server.json`. `--port` pins it.
- `labit pages`, `labit list` and the lab switcher (⌘K) list the pages pins were made on (`/app`, `/gallery/inspector`),
  though no HTML exists for them. `labit wait` hands the agent pins from them as from any page.
- The lab opens its page list in the browser unless `--no-open`.

## What the lab checks on a request

The lab answers this computer only (no `--wifi`). A request must:

- come from loopback, with a `Host` of `localhost`, `127.0.0.1` or `[::1]` (the port may be there);
- for a POST: have `Content-Type: application/json`, and either no `Origin` header (and no `Sec-Fetch-Site`) or an `Origin` whose host equals `Host`.
  A non-browser client sends neither and passes. No cookie, token or CSRF header is needed.

Anything else is `403 forbidden` (a wrong content type too).

A client without the admin key is "a person": its pins and replies are from `this computer`, it can start threads and reply,
and it can resolve or reopen a thread only with that thread's `edit` key (below). The agent's own key never reaches the client.

## The calls

`PAGE` is the page key: `/` then segments of `[A-Za-z0-9._~-]`, the first of `[a-z0-9_-]` (lowercase start), at most 300
characters, no `.` or `..` segment: `/app`, `/app/settings`, `/gallery/inspector`. Anything else is `400 {"error":"bad page"}`.

### Create a pin

```
POST /_lab/api/comments
Content-Type: application/json

{ "page": "/gallery/inspector", "name": "Alex", "text": "This stepper is too tight",
  "nonce": "k12345678-0001",
  "anchor": {
    "kind": "element",
    "selector": "gpui:k12345678",
    "element": "Stepper",
    "text": "Tempo 120",
    "component": "Stepper",
    "source": "bridge/crates/ui/src/stepper.rs:88",
    "usedAt": "bridge/app/src/board.rs:120",
    "x": 0.5, "y": 0.4,
    "width": 1280, "height": 800, "dpr": 2,
    "scheme": "dark" } }
```

- `name` and `text` are required (name up to 60, text up to 2000 characters), else `400 {"error":"name and text are required"}`.
- `nonce` is optional (8 to 40 of `[\w-]`): the same nonce again within 15 minutes gives back the first comment (status 200) instead of a second pin. Use it when retrying a lost answer.
- Answer: `201 {"comment": {...}, "edit": "<key>"}`. Keep `edit`: it is the key for resolving this thread later.
  (It is not stored by labit; it is derived from the lab's key, so it stays valid across restarts of the lab.)
- The comment: `id` (12 hex), `num` (the pin's number on its page, 1, 2, …), `name`, `text`, `createdAt` (ISO), `resolved: false`,
  `anchor`, `from: "this computer"`, `v: 2`.

Anchor fields kept (everything else is dropped; each is cut to its cap, whitespace folded to single spaces):

| field | meaning | cap |
|---|---|---|
| `selector` | the element's stable key, `gpui:<key>` | 600 |
| `kind` | `element` (default meaning), `text`, `page` (about the page, no spot), … | one of labit's kinds |
| `element` | what it is, one line (component or tag name) | 200 |
| `text` | the words on it | 80 |
| `component` | the component's name; the agent reads `component: Stepper` | 200 |
| `source` | where it is written, `file:line`; read as `written at: …` (a `.rs:N` source adds the GPUI hint) | 200 |
| `usedAt` | where the component is used, `file:line`; read as `component used at: …` | 200 |
| `x`, `y` | where on the element, 0 to 1 across and down (clamped; missing is 0) | numbers |
| `docX`, `docY` | the spot on the whole page: `docX` 0 to 1 across, `docY` px down | |
| `width`, `height`, `dpr` | the window's size (px) and scale | |
| `scheme` | `light` or `dark` | |
| `inside`, `section` | what it is inside (a panel's name), the heading it sits under | 100 |
| `build` | the app's build or commit | 40 |

A page of your own key such as `gpui:k12345678` is only text to labit: the agent is told `selector (at comment time): gpui:k12345678`.

### List a page's pins

```
GET /_lab/api/comments?page=/gallery/inspector
```

`200 {"comments": [...], "admin": false}`: every thread and reply of the page, oldest first, resolved ones included.
The header `x-lab-rev` says which version of the lab's comments this is (a number that grows with every change on any page).

- A thread has `parent: null`, `anchor`, `num`, `resolved`, and, once resolved, `resolvedBy` (`agent`, `owner` or `author`) and `resolvedAt`.
- A reply has `parent: "<thread id>"`, no `anchor`, no `resolved`.
- The agent's replies have `session` (an object: its name and agent), `intent` (`done`, `working` or `question`) and `name` (its name);
  a person's have `from: "this computer"` and no `session`. So "from the agent" is `session != null`.
- A reply with `intent: "done"` also resolves its thread (`resolved: true`, `resolvedBy: "agent"`).
- `progress` on a thread (`{text, at}`) is the agent's one line on what it is doing now (shown while it works).
- A thread the agent asks a question on has `choices` (strings), `hints`, `recommend` (0-based), `intent: "question"`;
  the person's answer is a reply with `picked: {of, n}` (see below).

An unknown page lists as `{"comments": []}`.

### Reply

```
POST /_lab/api/comments
{ "page": "/gallery/inspector", "parent": "<thread id>", "name": "Alex", "text": "Wider, please" }
```

`201 {"comment": {...}}` (a reply has no `edit` key). A reply to a reply is filed under its thread. A reply from a person
on a resolved thread reopens it. Without `name` or `text`: 400; unknown parent: `404 {"error":"thread not found"}`.

To answer one of the agent's questions with choices, post the reply with the question's id as `parent` and
`"picked": n` (0-based index of the choice, `-1` for none); `text` is still required (the choice's words). It is filed under the
thread (its `parent` is the thread's id) with `picked: {of: <question id>, n}`.

### Resolve, reopen

```
POST /_lab/api/comments
{ "page": "/gallery/inspector", "action": "resolve", "id": "<thread id>", "edit": "<the key create gave>" }
```

`200 {"comment": {...resolved: true, resolvedBy: "author"}}`. `"action": "reopen"` with the same fields makes it open again.
Without the right `edit` key: `403 {"error":"forbidden"}`; unknown id: 404. The key is for a thread the client made;
for pins made by an earlier run, resolve from the browser or let the agent resolve (`labit resolve`).

### What changed since

Poll cheaply instead of listing every second:

```
GET /_lab/api/changes?page=/gallery/inspector&since=<rev>
```

`200 {"rev": <number>, "set": [<comments added or changed>], "del": [<ids deleted>]}`, or `{"full": true}` when labit can't
give a delta (an old `since`, one from before the lab started or later than its own rev): then list the page again. Take the first `rev` from the `x-lab-rev` header of
a list; keep the `rev` of every answer. An answer with an empty `set` and `del` costs nothing to ignore.

### Live stream

```
GET /_lab/live            (Server-Sent Events)
```

Sends `retry: 500` and then `data: {...}` lines: the lab's state as JSON, again whenever anything changes (a pin, a reply, a
resolve, the agent starting or stopping to listen). `comments` in it is the rev that `/_lab/api/changes` counts;
`mode` (`working`, `idle`, `away`) and `listening` say whether an agent is on the lab. A client that sees `comments` go up
asks `/_lab/api/changes?page=…&since=<its rev>`. Reconnect after a drop (a restarted lab sends `full`).

## The agent's side

- `labit wait` (from the folder the lab was started in) ends with the next pin, with lines like:

  ```
  ## 1. Alex · 2026-11-21 12:00 UTC · id 3f2a…
  comment: This stepper is too tight
  component: Stepper
  written at: bridge/crates/ui/src/stepper.rs:88
  component used at: bridge/app/src/board.rs:120
  selector (at comment time): gpui:k12345678
  ```

  and, for a `.rs` source, `Drawn by GPUI: "written at" is the Rust file and line that built the element; open it there.`
- `labit reply <id> --done "…"` (or `--on-it`, `--question`, `--choice …`) answers; it shows in the list with `intent`.
- `labit resolve <id>` resolves from the agent's side.
