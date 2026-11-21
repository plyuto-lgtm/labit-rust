# Spec: paste or drop an image into a pin comment

> **As built (local branch `local-paste-comment`, stacked on `local-paste-board`), where this spec changed.** Read these first; the sections below are the original text.
>
> - **One upload route, one sniffer, one prepare function (Leo):** the upload is `POST /_lab/api/image` with no `board` (the board's paste uses the same route with `?board=`); the sniffer is `lib/images.mjs`; the client's draw-smaller-and-encode and the POST are `src/widget/pics.ts` (`public/_lab/pics.js`), loaded by both features. Nothing is copied. No AVIF: PNG, JPEG, WebP, GIF only (the browser draws anything else again; GIF passes as it is).
> - **Cut (Leo): no per-address 429, no 200 MB disk cap / 507 and no startup scan, no move of pictures when a comment is archived, no sweep of unreferenced files (only `.staged/` older than 20 min is swept, at start and daily), no 409 re-upload path.** On a failed send the client uploads the pictures again once and sends again, then shows the error (`attach.ts` `send`); no 5-minute upload retry. Guests with a pass may upload (same 25 MB, 413 beyond); the agent is refused (403 on upload, 400 on `attachments`).
> - **Kept:** 25 MB per request (413 before reading), the magic-byte sniff and type check (415), 16384 px / 50 MP sanity, 4 pictures per message (needed by the `-<n>` name), staged tokens valid 15 min and kept on disk (survive a restart), nonce replay skips the tokens, `x-lab-stamp` carries the verified `images` (the body's are never read), served with `nosniff`, a `sandbox` CSP, `cross-origin-resource-policy`, `immutable`.
> - **Page script: only the listener.** `composer.ts` gets the paste/drop listener, the `attach` option, and a small change to `go()` (`wrap.dataset.att` then `part('attach').send(...)`); `thread.ts` one line that loads the part for a message with `images`. The strip, the ✕, uploads, the retry and thumbnails are in `src/widget/attach.ts` + `attach.css` (`public/_lab/attach.js`). The record's names are built in the part from the comment id, never read from the record.
> - **Changed from the text below:** delete cleanup runs at the delete action in `local.mjs` (not `logChanges`), because archived comments keep their files; the `Pictures:` header line is printed only when a picture is on the page (every other agent text stays byte-identical); a box holding only a picture does not hold reloads (`saysWriting` unchanged).
> - **Not done / unclear:** the nonce lookup uses the body's own `page` spelling, not `pagePath()`; a retried send with a new nonce after a lost answer can duplicate (as any `send()` retry can).
> - **Tests:** `test/attachments.test.mjs` (5), a guest test in `test/security.test.mjs`, `test/browser/attach.mjs` (WebKit + Chromium: strip, ✕, 3000×2000 sent as 2000×1333, thread thumbnail loaded, drop on a reply, a failed send keeps words and pictures).
> - **Size (measured on top of the board branch):** page script +229 B gzip (450 B asked, 2,048 B per PR), `comments.js.br` +137 B, `attach.js.br` +1,200 B (new), `dist/local.mjs` +1.2 KB gzip, pack +2,656 B of 4,096 B. Both together vs main: pack +6,405 B (over one PR's 4,096 B: two PRs, or `size-approved`).

Status: proposal · base `dbdb606` · scope: the new-pin composer and the thread reply composer.

## What it does

A person pastes an image (⌘V while a comment box has focus) or drops an image file on the box. It shows as a removable thumbnail above the text. On send, the image goes with that message. The thread shows a small thumbnail that opens the full image. The comment stays plain text for the agent, plus one line for each image:

```
comment: the header overlaps here, see screenshot
image: .lab/attachments/3f2a9c1b7d0e-1.png (1440×900)
```

The path is relative to the lab folder (the same base as `file:`), so a coding agent can open it with its file-read tool. The size uses `×`, as the other agent lines do.

## Storage and record

**Files.** Each image is stored as `.lab/attachments/<comment-id>-<n>.<ext>`, with n from 1 to 4 and ext one of `png|jpg|webp|gif|avif`. This differs from the brief, which suggested a `<page-key>/` folder. Comment ids are already unique across the lab (12 hex characters from `crypto.randomUUID`). A folder per page would have to be moved whenever `rehome()` or `gather()` moves a page's comments to another key (`local.mjs` ~652, ~1390). With a flat folder nothing moves. `.lab/` is never served (dot segments return 404), so a dedicated route serves the images.

**Record.** The new field sits on the message that carries the images. That can be a root comment or a reply.

```js
images?: { n: 1|2|3|4, type: 'png'|'jpg'|'webp'|'gif'|'avif', w: number, h: number, size: number }[]  // ≤ 4, in paste order
```

The record never stores a path. The path and URL are built from the comment id and `n`/`type` by one helper in `lib/schema.mjs`. The API, `local.mjs` and the widget all use it, and the widget already bundles schema.mjs:

```js
export const IMAGE_TYPES = ['png', 'jpg', 'webp', 'gif', 'avif'];
export const imagesOf = (c) => (Array.isArray(c?.images) && /^[a-f0-9]{12}$/.test(c.id) ? c.images.filter((i) => Number.isInteger(i?.n) && i.n >= 1 && i.n <= 4 && IMAGE_TYPES.includes(i.type)) : []);
export const imageName = (c, i) => `${c.id}-${i.n}.${i.type}`;            // file under .lab/attachments/, URL under /_lab/attachments/
export const imageLine = (c, i) => `image: .lab/attachments/${imageName(c, i)} (${i.w | 0}×${i.h | 0})`;
```

A hand-edited record with `n: 9`, `type: 'svg'` or `id: '../x'` is skipped. No path from disk ever reaches `fs` or the agent text.

**Schema.** The field is only added, so `VERSION` stays 2. This follows the precedent of `choices`/`hints`/`picked`. Add an "Added in 2, nothing to upgrade" note in `lib/schema.mjs`. `upgrade()` does not change. `test/schema-tag.test.mjs` does not change. An older widget that receives the field shows the words and ignores the images. Bumping VERSION would force every open page to reload (`live.ts:585`) for no gain.

**Image-only message.** `text` may be `''` only when `images` is non-empty. The API check (`comments-api.mjs:476`) becomes `if (!name || (!text && !images.length))`. The load filter in `local.mjs` (~548) already accepts `''`, because it is a string. The agent text writes `comment: (a picture, no words)`.

## Server

### Upload: `POST /_lab/api/attachments`

- **Request:** the raw image bytes in the body, with `Content-Type` set to one of `image/png`, `image/jpeg`, `image/webp`, `image/gif` or `image/avif`. Send `x-lab-admin` when the browser has it. The route does not require it: guests may upload.
- **Front gate in `handler` (`local.mjs` ~2219).** Writes outside this route must still be `application/json`. Exempt only this exact route: `url.pathname === '/_lab/api/attachments' && /^image\/(png|jpeg|webp|gif|avif)$/.test(content-type)`. Everything else stays as it is: `allowedHost`, `nearby`, `sameOrigin` (Origin host, or `sec-fetch-site: same-origin`), and the `mayIn()` guest gate with its cookie renewal. `image/*` is not a CORS-safelisted type, so another site can't send it without a preflight, which the lab never answers. This is the same protection the JSON-only rule gives.
- **Refused:**
  - `403` for `isAgent(req)`: an agent cannot attach.
  - `415` for any other content type, including `image/svg+xml`.
  - `413` with `connection: close` when `content-length` is over `IMAGE_MAX = 8 MiB`, refused before reading. A body that grows past the cap gets the same answer, using the existing read-and-drop of `sentWithin`. Generalise it to `bytesWithin(req, max) → Buffer | null` and keep `sentWithin` as `.toString()` over it.
  - `415 {error:'not a png'}` when the declared type and the magic bytes disagree.
  - `422` for a 0 or unreadable size, a long side over 4096 px, or more than 16.7 M pixels.
  - `429` for more than 60 uploads per hour per non-loopback address (an in-memory counter, like `lab:rate:` in the API).
  - `507 {error:'the lab’s pictures are full'}` when `attachedBytes + size > ATTACH_MAX`.
- **Disk cap.** `ATTACH_MAX` is 200 MB by default, or `LAB_ATTACH_MAX_BYTES`, which tests use. `attachedBytes` is summed once at startup with `readdir` and `stat` on `.lab/attachments/` (`.staged/` included), then kept up to date on every write and removal.
- **Sniffing.** New file `lib/images.mjs`, about 60 lines, no dependencies. `imageInfo(buf) → { type, w, h } | null` reads:
  - PNG: signature and IHDR.
  - GIF: `GIF87a`/`GIF89a` and the logical screen size.
  - JPEG: walk the segments to the first SOF0–SOF15 (except C4, C8, CC).
  - WebP: RIFF/WEBP with VP8, VP8L or VP8X.
  - AVIF: `ftyp` brand `avif`/`avis`, then the `ispe` box inside `meta/iprp/ipco`. Bound the box walk to the first 64 KB.

  The size the record stores comes from this sniff, never from the client.
- **Success:** write the bytes to `.lab/attachments/.staged/<token>.<ext>` with `writeAtomic`, mode 0600. `token` is `randomBytes(12).toString('hex')`. Reply `201 {token, w, h, type, size}` with `cache-control: no-store`.
- **Staged files stay on disk, with no in-memory map.** That way they survive a lab restart, and `labit --wifi` restarts the lab in place (`handOver`). A token is valid while `.staged/<token>.<ext>` exists and its mtime is under 15 min old, which matches the nonce window.

### Comment POST (`/_lab/api/comments`, `local.mjs` ~2695)

- `callApi` (`lib/dev.ts`) gets an optional pre-read `body?: Buffer`, so the lab can read the body once.
- For a POST whose body contains `"attachments"`:
  - The lab parses it and expects `attachments: string[]`. Refuse with `400` when there are more than 4, a token fails `/^[a-f0-9]{24}$/`, or the request is from the agent.
  - **Nonce replay.** If `db.has(\`lab:nonce:${page}:${nonce}\`)`, the body is a retry of a comment already saved. Skip the tokens and pass the body on unchanged; the API returns the earlier comment.
  - Otherwise resolve each token to its staged file. Missing or expired gives `409 {error:'pictures expired', tokens:[…]}`. Re-sniff each file (head bytes only) to get `{type, w, h, size}`.
  - Add `images` to the existing trusted stamp: `x-lab-stamp: {from, images:[…]}`. The stamp is already signed with `LAB_STAMP_KEY`, so a page cannot forge it.
- **API (`comments-api.mjs` POST).** Take `images` only from `wrote` (the verified stamp) and only when `!agent`. Clean each entry: `n` is assigned 1 to 4 in order, `type` must be in `IMAGE_TYPES`, `w`/`h` go through `int(v, 4096)`, `size` through `int(v, IMAGE_MAX)`. Put `...(images.length ? { images } : {})` on `comment`. `body.images` is ignored, so a page can never name files.
- **After 201, synchronously, before `persist()` and `broadcast()`.** Rename `.staged/<token>.<ext>` to `<comment.id>-<n>.<ext>`. Other devices only learn of the comment from the broadcast that follows, so the file is in place before any of them asks for it. If a rename fails, log it and keep the record. The agent line then points at a missing file, which is acceptable.

### Serve: `GET|HEAD /_lab/attachments/<name>`

- Match `^/_lab/attachments/([a-f0-9]{12}-[1-4]\.(png|jpg|webp|gif|avif))$`. Anything else, `.staged` included, gives `404`.
- Place the route before the `/_lab/` static branch and after `mayIn()`. Guests on `--wifi` can then see images exactly when they can see comments. The phone and the laptop both load images from the lab's own origin, behind `--proxy` too, because `/_lab/*` is always served by the lab.
- Headers: `res.setHeader` for `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`, `cross-origin-resource-policy: same-origin` and `cache-control: private, max-age=31536000, immutable`. Then call `sendFile`, which already maps the five types, does the ETag and range work, and does not compress images. Names are never reused, so `immutable` is safe.

### Cleanup

- **Delete** (the admin action, the starter's undo or `takeBack`, a thread deleted with its replies). In `logChanges`, for each `del` id, parse `was.get(id)` and remove its files with `fs.rmSync(…, {force:true})`. Only do this when the id is in no live page. `rehome()` and `gather()` show up as a delete on one page and a set on another, and must keep the files.
- **Archive.** In `archiveOld`, after the archive file is written and before `h.delete`, move each archived message's images to `.lab/archive/attachments/`. They then leave the cap and are not served. The `logChanges` remove that follows finds nothing. Archived images are kept and never pruned (non-goal).
- **Sweeps** at startup and with the daily `setInterval`:
  - delete `.staged/*` files older than 20 min (5 min beyond the 15-min token TTL, so nothing is swept while it can still be used)
  - delete `.lab/attachments/<id>-n.*` files whose id is in no live comment and that are older than 1 day. This covers a crash between the API write and the save.

### Agent text (what `wait`, `pins`, `/_lab/agent/<page>` and `comments.md` print)

- **`asText` (`comments-api.mjs`):**
  - root: after the `comment:` line, push `imagesOf(c).map((i) => imageLine(c, i))`
  - reply: after each `reply:` line, push the same lines indented by two spaces
- **`threadText` (`local.mjs` ~1575, the reply-wait form):** after each message line, push `    ${imageLine(r, i)}` for each image. This includes the root.
- `comments.md` is built from `agentText`, so it needs no change of its own. The lean `RARE` filter in `threadsText` keeps `image:` lines.
- Add one line to the header of `asText`: `Pictures: an "image:" line is a file the person attached; open it to see what they mean.`
- `skills/labit/SKILL.md` gets the same sentence. Neither the CLI nor `labit reply` has an attach flag, and the API refuses images from the agent.

## Client

### Stays in `comments.js` (target ≤ 700 B gzip)

- **`composer.ts`:**
  - New option `attach?: boolean`, set to true by the two callers: the new pin (`comments.js` ~1190) and the reply (`thread.ts` ~477). The chat leaves it off.
  - `Deps` gains `part`, passed in by `bindComposer`.
  - When `attach` is set:
    - A `paste` listener on the textarea, so only a focused box receives it. It collects `[...e.clipboardData.files].filter((f) => /^image\//.test(f.type) && f.type !== 'image/svg+xml')`. If any are found, it calls `preventDefault()` and reads `getData('text/plain')` synchronously, because clipboard data is gone after the event. Then it runs `d.part('attach').then((m) => m.add(wrap, files, text, field))`.
    - `dragover` and `drop` listeners on `box`. They call `preventDefault()` only when `dataTransfer.types` includes `Files`.
  - In `go()`: `const att = wrap.dataset.att && await d.part('attach').then((m) => m.ready(wrap))`. This awaits uploads in flight, throws an Error with a message on failure, and returns `{ attachments: [...] }`. Change `said || empty` to allow "no words, images present". Call `onSubmit(name, said, att)`. Both callers spread `...att` into `send()`. After a send, `m.clear(wrap)` empties the strip.
  - `saysWriting` also counts `wrap.dataset.att`, so a box holding only an image still holds reloads (`hold.ts`).
- **`thread.ts` `itemEl`:** for each `imagesOf(item)`, add `<a class="att" href=URL target=_blank rel=noopener><img src=URL width height loading=lazy decoding=async alt="picture W×H"></a>` after `readable(text)`. `URL = new URL('/_lab/attachments/' + imageName(item, i), W.script.src)`, which is the lab's origin from the page script's own URL. Pass the real `width` and `height`, so the card does not shift while the image loads (`stick.ts`).
- **`styles.css`:** `.att img{max-width:160px;max-height:120px;border-radius:…;object-fit:cover}`, using the existing radius token.

Estimate: listeners and the `go` change about 380 B, thumbnails about 170 B, CSS about 80 B, schema helpers about 60 B. That is about 690 B gzip, 76.7 → about 77.4 KB, inside the +2 KB per-PR budget.

### Lazy part `src/widget/attach.ts` → `public/_lab/attach.js`

- **Build and packaging:** add it to `PARTS` in `scripts/build-widget.mjs`, add `public/_lab/attach.js.br` to package.json `files`, and list it in `ci/parts.json` with a one-line description.
- **`add(wrap, files, text, field)`:**
  - If text came with the images, insert it at the cursor with `setRangeText`. Skip the text when it is only a file name (`/^[^\n]+\.(png|jpe?g|gif|webp|heic|avif)$/i`).
  - Cap at 4 images per message. Extra images are dropped with a note in the box's `.error` line.
  - For each image, prepare it (below), show its thumbnail at once from an object URL with a ✕ button (removing an image only drops it from the list), and start the upload straight away.
- **Prepare:**
  - Animated GIFs go as they are when ≤ 8 MB.
  - Everything else is decoded with `createImageBitmap(file)`, which applies the EXIF orientation. That covers HEIC in Safari too.
  - If the long side is over 2000 px, scale it down to 2000 px.
  - Draw it on a canvas and re-encode. Re-encoding strips EXIF and GPS, which matters for phone photos.
    - PNG source: PNG when the result is ≤ 4 MB, else WebP at 0.9. Check `blob.type`: Safari falls back to PNG when it can't encode WebP, and then the image goes as JPEG at 0.9.
    - Other sources: WebP or JPEG at 0.85.
- **Upload:** `fetch('/_lab/api/attachments', {method:'POST', headers:{'content-type': blob.type, …admin}, body: blob})`. While the lab can't be reached, retry every 2 s for up to 5 minutes, as `send()` does. A 4xx error shows its `error` on the thumbnail and keeps the image out of `ready()`.
- **`ready(wrap)`:** waits for all uploads, then returns the tokens.
- **409 `pictures expired` from the comment POST.** The callers' `send()` rethrows. `go()` catches the 409, re-uploads the blobs it still holds (`m.reupload(wrap)`) and retries the send once with the same nonce.
- The strip's styles go into the shadow root once, as `switcher.ts` does.

## Edge cases

| Case | Behaviour |
|---|---|
| Text and image pasted together (copying from a web page gives `text/html` + image; Finder gives a file and its name) | The image is attached. Plain text is inserted unless it is only the file name. |
| A huge image (12000 px, a 30 MB photo) | Downscaled to 2000 px in the browser. A browser that can't decode it shows "couldn't read this picture". The server cap is still 8 MB / 4096 px. |
| An SVG or another non-image is pasted | Ignored by the listener (default paste). The server would answer 415. |
| Offline or the lab restarting | Uploads and the send retry for 5 min. Staged files survive the restart. After that: an error, and the words and images stay in the box. |
| Upload succeeds, then the send fails | The text and the images are kept. The tokens stay valid for 15 min. A later send reuses them. Expired tokens give 409, then a re-upload. Unused staged files are swept after 20 min. |
| Lost answer, then a retry | The nonce is known, so the tokens are skipped and the same comment comes back. No 409, no duplicate files. |
| Page reload with images in the box | The words come back from the draft. The images are lost (blobs are not kept). Non-goal. |
| A guest without a cookie on `--wifi` | Gate on both routes, as for comments. |
| A comment deleted or archived while a phone is showing it | The image gives 404. The `<img>` shows its alt text. |

## Tests

- **`test/attachments.test.mjs`** (node --test, `spawnLab` from `harness.mjs`). Small PNG, GIF, JPEG and WebP fixtures are built in the test (base64 constants).
  - The happy path: upload `201`, then a comment with `attachments`, then the record's `images`, the file at `.lab/attachments/<id>-1.png`, then `GET /_lab/attachments/…` returns 200 with `image/png`, `nosniff` and the CSP. The `image: … (1×1)` line shows in `/_lab/agent/<page>`, in `.lab/comments.md` and in `wait` output.
  - A reply with an image. An image-only message. The nonce replay.
  - A restart between the upload and the post still works.
  - Delete and undo remove the files. A rehome keeps them. Archive moves them (load old dated comments before start, as the archive tests do).
- **Refusals in the same file:** SVG 415, a type mismatch 415, HTML bytes declared as PNG 415, 8 MiB + 1 413, a foreign `Origin` or `sec-fetch-site: cross-site` 403, the agent key on upload 403, the agent posting `attachments` 400, five tokens 400, expired or reused token 409, `LAB_ATTACH_MAX_BYTES=100` 507, `/_lab/attachments/..%2fcomments` 404, `.staged/<token>.png` 404. Extend `invite-wifi.test.mjs`: a guest with a cookie may upload and view, a guest without one gets the gate.
- **Unit tests in `edge-agent-text.test.mjs`:** `imageInfo` on truncated and malformed headers returns null, and `imagesOf` skips bad entries (n 9, type svg, id `../x`).
- **`test/browser/attach.mjs`** (WebKit and Chromium, the `draw.mjs` style).
  - Fire a `paste` on the focused textarea with a `DataTransfer` holding a canvas-made 3000×2000 PNG. Check the thumbnail strip, that ✕ removes, and that sending gives a record of `2000×1333` and a thread `<img>` with `naturalWidth > 0`. Check text plus image inserts the text, a drop on the box, and an aborted upload (`page.route`) keeping words and images.
- **CI wiring:** add `attach` to a group in `test.yml`. Add `'src/widget/attach.ts'` and `'public/_lab/attach.js': ['attach']` to `REACH` in `ci/affected.mjs`. `composer.ts` and `thread.ts` are not in REACH, so every browser test runs, as they should. Extend `packed.test.mjs`'s part list.

## Size budget

| Metric | Now | Cap and per-PR budget | This change |
|---|---|---|---|
| `pageScriptGzipBytes` | ~76.7 KB | 80 KB, +2 KB | +~0.7 KB |
| `attach.js` (lazy, not in the page-script metric) | — | — | ~3 KB gzip, ~2.6 KB br |
| `npmPackBytes` | — | 180 KB, +4096 B | +~4.2 KB in all: `attach.js.br` ~2.6, the server side (`images.mjs` + routes) ~1.0 compressed, the `comments.js.br` growth ~0.6 |

The pack figure is at the edge of its per-PR budget: keep `attach.ts` lean, or ask for the `size-approved` label. The change adds no npm dependencies, client or server.

## Non-goals

- The agent attaching images (refused by the API and by the lab). The agent only reads the file at its path.
- A file-picker button for phones (paste from Photos works in iOS Safari).
- Images in the page chat (it uses `attach: false`).
- Server-side thumbnails or re-encoding (no image library). The thread shows the full file scaled down with CSS.
- Keeping pending images across a reload. Pruning archived images. Editing a sent message's images.
