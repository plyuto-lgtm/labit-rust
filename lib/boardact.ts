// What the board commands do (labit board new / add / move / pick / list), on the stored board. Loaded by local.mjs when
// one is run, so a lab that only serves boards does not read it.
import fs from 'node:fs';
import path from 'node:path';
import { imageInfo, MAX_IMAGE } from './images.mjs';
import { MAX_FRAMES, NAME, addImage, counted, heightFor, insert, nextId, labPath, names, nameOf, one, read, save, frameFile, writeAtomic, type Board, type Frame } from './board.ts';

export const MAX_VARIANTS = 6;
/** The query parameter that tells a live page which variant it is drawing (boards of a page that cannot be copied). */
export const VARIANT = 'lab-variant';
const live = (f: Frame) => f.src.includes(`?${VARIANT}=`);
const LIVE_SAID = `Each variant frame is the live page with ?${VARIANT}=<frame>; branch on new URLSearchParams(location.search).get('${VARIANT}') in the page's source (frame a is the page as it is: leave it). Remove the branching when one is picked.`;
/** The text a person gave, as a board name: "Pricing hero" is pricing-hero. */
export const slug = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'board';
const route = (name: string, id: string) => `/_lab/board/${name}/${id}`;

/** A plain page as a variant: the same page, its relative links kept by a base at the page's own folder. */
export const seed = (html: string, rel: string) => {
  if (/<base\b/i.test(html)) return html;
  const dir = path.posix.dirname(rel.split(path.sep).join('/'));
  const tag = `<base href="${dir === '.' ? '/' : `/${dir.split('/').map(encodeURIComponent).join('/')}/`}">`;
  const at = /<head(\s[^>]*)?>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
  return at ? html.slice(0, at.index + at[0].length) + tag + html.slice(at.index + at[0].length) : tag + html;
};

// ---------- what an agent reads ----------
/** What a frame is called to an agent: a picture says its file, a copy its .html, a page its path. */
export const shown = (b: Board, f: Frame) => (f.kind === 'image' ? `pasted image .lab/boards/${b.name}/${f.file}${f.guest ? ' from a wifi guest' : ''}` : f.src.startsWith('/_lab/') ? `${f.id}.html` : f.src);
/** A frame's size: a picture says its file's own pixels first. */
export const sized = (f: Frame) => `${f.kind === 'image' ? `${f.iw}×${f.ih} px shown at ` : ''}${f.w}×${f.h}`;
/** Where a board is opened: over its page when it is about one this lab has (one set of pins, the page's), else at its own address. */
export const where = (origin: string, b: Board, home?: boolean) => (home && b.of ? `${origin}${b.of.split('#')[0]}#board=${b.name}` : `${origin}/_lab/board/${b.name}`);
/** The board as plain text: one line per frame, in order. `pins(frame)` is its open pins. */
export function text(b: Board, o: { origin: string; file?: string | null; json?: boolean; home?: boolean; pins?: (f: Frame) => number }): string {
  const lines = [`# Board ${b.name}${b.title ? ` · ${b.title}` : ''}`, `url: ${where(o.origin, b, o.home)}${o.home ? ' (the board opens over its page: its pins are that page\'s)' : ''}`];
  if (b.of) lines.push(`of: ${b.of.replace('#', ' #')}${o.file ? ` (file ${o.file})` : ''}`);
  if (o.json) lines.push(`file: .lab/boards/${b.name}.json`);
  if (b.frames.some((f) => f.src.startsWith('/_lab/') && f.kind !== 'image')) lines.push(`folder: .lab/boards/${b.name}/ (edit a frame's file; it reloads)`);
  if (b.frames.some(live)) lines.push(LIVE_SAID);
  for (const f of b.frames) {
    const open = o.pins?.(f) || 0;
    lines.push([f.id, shown(b, f), `${f.w}×${f.h}`, f.label && `"${f.label}"`, f.variantOf && `variant of ${f.variantOf}`, f.state && f.state !== 'live' && f.state, open && `${open} open`].filter(Boolean).join('  '));
  }
  return lines.join('\n') + '\n';
}
/** The line a pin on a frame carries: which frame, of which board. A picked frame also says what to do. */
export const frameLine = (b: Board, f: Frame, file?: string | null) => {
  const beside = b.frames.filter((g) => g.id !== f.id && g.state !== 'archived').map((g) => g.id);
  const gone = b.frames.filter((g) => g.state === 'archived').map((g) => g.id);
  const line = `frame: ${f.id} of board ${b.name} (${[b.of && `variant of ${b.of.replace('#', ' #')}`, sized(f), f.guest && 'from a wifi guest', f.state === 'archived' && 'archived', f.label && `"${f.label}"`, beside.length && `beside ${beside.slice(0, 6).join(', ')}`].filter(Boolean).join(', ')})`;
  const copy = (g: Frame) => g.src.startsWith('/_lab/') && g.kind !== 'image';
  const others = b.frames.filter((g) => g.id !== f.id);
  const page = file || b.of?.split('#')[0] || 'the page';
  // What to do about the pick. A copy's change goes into the page; a live variant's code is a branch in the page's own
  // source (keep that one, drop the branching); frame a, the page as it is now, is the page itself: nothing to put in, the
  // others' files or branching to clean up.
  const gonecopies = b.frames.filter((g) => g.state === 'archived' && copy(g)).map((g) => g.id);
  const gonelive = b.frames.some((g) => g.state === 'archived' && live(g));
  const done = 'resolve it with no words (resolve <id>).';
  const put = f.kind === 'image'
    ? `${f.id} is a pasted image (${shown(b, f).slice('pasted image '.length)}): make ${page} match it, then ${done}`
    : live(f)
    ? `Keep the ${f.id} branch (?${VARIANT}=${f.id}) in ${page}'s source and remove the ${VARIANT} branching, then ${done}`
    : copy(f) || !others.some((g) => copy(g) || live(g))
      ? `Put ${f.id}'s change into ${page}, then ${done}`
      : `Keep ${page} as it is: change nothing in it.${gonecopies.length ? ` Delete the variant files (.lab/boards/${b.name}/${gonecopies.map((i) => `${i}.html`).join(', ')}).` : ''}${gonelive ? ` Remove any ${VARIANT} branching you added to its source.` : ''} Then ${done}`;
  const kept = gonecopies.length ? ', files kept' : '';
  return f.state === 'picked' ? `${line}\npicked: ${gone.length ? `${gone.join(', ')} archived${kept}. ` : ''}${b.of ? put : ''}`.trimEnd() : line;
};

// ---------- the changes ----------
type Ask = { name?: string; topic?: string; of?: string; variants?: number; widths?: string; flow?: string; target?: string; label?: string; width?: number; after?: string; first?: boolean; frame?: string; frames?: string[] };
type Env = { root: string; origin: string; open: (key: string) => number; titleOf: (page: string) => string; fileOf: (page: string) => string | null; proxied: boolean };
export type Done = { text: string; board?: Board; picked?: Frame; error?: string };

const no = (error: string): Done => ({ text: error, error });
const frameOf = (b: Board, id: unknown) => b.frames.find((f) => f.id === id);
const copyIn = (e: Env, name: string, id: string, html: string) => writeAtomic(frameFile(e.root, name, id), html);

/** One command's work (new, add, move, pick) on the stored board; the answer is what the agent reads. */
export function act(action: string, a: Ask, e: Env): Done {
  const view = (b: Board, file: string | null) => text(b, { origin: e.origin, file, json: true, home: Boolean(b.of && (file || e.proxied)), pins: (f) => (f.src.startsWith('/_lab/') ? e.open(`/_board/${b.name}/${f.id}`) : 0) });
  if (action === 'list') {
    if (!a.name) return { text: names(e.root).map((n) => { const b = read(e.root, n); return b ? `${n}  ${b.frames.filter((f) => f.state !== 'archived').length} frames${b.of ? `  of ${b.of}` : ''}  ${where(e.origin, b, Boolean(b.of && (e.proxied || e.fileOf(b.of.split('#')[0]))))}` : ''; }).filter(Boolean).join('\n') || 'No boards yet. Make one: labit board new "<topic>" --of /page --variants 3' };
    const b = read(e.root, a.name);
    return b ? { text: view(b, b.of ? e.fileOf(b.of.split('#')[0]) : null), board: b } : no(`No board ${a.name}. See: labit board list`);
  }
  if (action === 'new') {
    const topic = one(a.topic, 80);
    const name = a.name || (a.of && !topic ? nameOf(a.of.split('#')[0]) : slug(topic));
    if (!NAME.test(name)) return no('Give the board a topic: labit board new "Pricing hero" --of /pricing --variants 3');
    // A board asked for by its name (a pin's own, made from its card) that is already there is that board, never a new one over it.
    const had = a.name ? read(e.root, a.name) : null;
    if (had) return { text: view(had, had.of ? e.fileOf(had.of.split('#')[0]) : null), board: had };
    let into = name;
    for (let n = 2; read(e.root, into) && !a.name; n++) into = `${name}-${n}`;
    const of = a.of ? one(a.of, 200) : '';
    const page = of.split('#')[0];
    if (of && !labPath(page)) return no(`--of is a page of this lab, like /pricing (got ${of.slice(0, 60)})`);
    const b: Board = { v: 1, name: into, rev: 0, ...(topic ? { title: topic } : {}), ...(of ? { of } : {}), frames: [] };
    const add = (f: Omit<Frame, 'id' | 'h'> & { h?: number }) => b.frames.push({ ...f, id: nextId(b.frames), h: f.h ?? heightFor(f.w), state: 'live' });
    if (a.variants !== undefined) {
      const n = Math.round(Number(a.variants));
      if (!of || !(n >= 1 && n <= MAX_VARIANTS)) return no(`--variants takes 1 to ${MAX_VARIANTS} and goes with --of /page: labit board new "<topic>" --of /pricing --variants 3`);
      const rel = e.fileOf(page);
      if (!e.proxied && !rel) return no(`${page} is not a page of this lab. Use a page from: labit list`);
      add({ src: page, w: 1280, label: 'now' }); // frame a: the page as it is now (the real page, not a copy), the variants beside it
      if (e.proxied || !/\.html?$/i.test(rel!)) {
        // Behind a dev server (or a page that is no plain .html file) it cannot be copied: each variant is the live page
        // itself with ?lab-variant=<frame>, and the page's own source branches on it.
        for (let i = 0; i < n; i++) add({ src: `${page}?${VARIANT}=${nextId(b.frames)}`, w: 1280 });
      } else {
        const html = fs.readFileSync(path.join(e.root, rel!), 'utf8');
        for (let i = 0; i < n; i++) {
          const id = nextId(b.frames);
          copyIn(e, into, id, seed(html, rel!));
          add({ src: route(into, id), w: 1280 });
        }
      }
    } else if (a.widths) {
      const ws = String(a.widths).split(',').map((s) => Math.round(Number(s))).filter((w) => w >= 200 && w <= 4000);
      if (!of || !ws.length || ws.length > MAX_VARIANTS) return no(`--widths goes with --of /page and takes up to ${MAX_VARIANTS} widths: --widths 390,820,1280`);
      for (const w of ws.sort((x, y) => x - y)) add({ src: page, w });
    } else if (a.flow) {
      const pages = String(a.flow).split(',').map((s) => s.trim()).filter(Boolean);
      if (!pages.length || pages.length > MAX_FRAMES || pages.some((p) => !labPath(p))) return no('--flow takes pages of this lab in order: --flow /cart,/checkout,/thanks');
      pages.forEach((p, i) => add({ src: p, w: 1280, label: `${i + 1} ${e.titleOf(p) || p.slice(1) || 'home'}` }));
    } else if (page) add({ src: page, w: 1440, h: 900 });
    save(e.root, { ...b, rev: 1 });
    const done = read(e.root, into)!;
    return { text: view(done, page ? e.fileOf(page) : null), board: done };
  }
  const b = a.name ? read(e.root, a.name) : null;
  if (!b) return no(a.name ? `No board ${a.name}. See: labit board list` : 'Name the board first: labit board <new|add|move|pick> <board> …');
  const done = (t: string, extra: Partial<Done> = {}): Done => {
    b.rev++;
    save(e.root, b);
    return { text: t, board: b, ...extra };
  };
  if (action === 'add') {
    const t = String(a.target || '');
    const had = frameOf(b, t);
    if (a.after && !frameOf(b, a.after)) return no(`No frame ${a.after} on ${b.name}.`);
    const w = a.width === undefined ? undefined : Math.round(Number(a.width));
    if (w !== undefined && !(w >= 200 && w <= 4000)) return no('--width is 200 to 4000.');
    if (had) {
      if (a.label !== undefined) had.label = one(a.label, 80) || undefined;
      if (w) [had.w, had.h] = [w, heightFor(w)];
      if (a.after) {
        b.frames.splice(b.frames.indexOf(had), 1);
        insert(b, had, a.after);
      }
      return done(`Changed ${had.id}.`);
    }
    if (counted(b.frames) >= MAX_FRAMES) return no(`A board holds at most ${MAX_FRAMES} frames.`);
    const id = nextId(b.frames);
    const f: Frame = { id, src: '', w: w ?? 1280, h: 0, state: 'live', ...(a.label ? { label: one(a.label, 80) } : {}) };
    // /cart is a path on this lab, below the lab's folder (path.resolve would read it from the disk's root: "/" always exists there).
    const file = t.startsWith('/') ? path.join(e.root, t) : path.resolve(e.root, t);
    const isFile = Boolean(t) && fs.existsSync(file) && fs.statSync(file).isFile();
    // A picture: its bytes say what it is (never the name), read once. The lab copies it into the board's folder as a frame of its own.
    const size = isFile ? fs.statSync(file).size : 0;
    if (isFile && size > MAX_IMAGE && /\.(png|jpe?g|webp|gif)$/i.test(t)) return no(`${t}: a picture is at most ${MAX_IMAGE / 1048576} MB.`);
    const bytes = isFile && size <= MAX_IMAGE ? fs.readFileSync(file) : null;
    const pic = bytes && imageInfo(bytes);
    if (bytes && pic) {
      const added = addImage(e.root, b, bytes, pic, undefined, { label: a.label, after: a.after });
      return 'error' in added ? no(added.error) : { text: `Added ${added.frame.id} (${shown(b, added.frame)})${a.after ? ` after ${a.after}` : ''}.`, board: b };
    }
    if (labPath(t) && !isFile) f.src = t;
    else {
      if (!t || !/\.html?$/i.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return no(`${t || 'nothing'}: give a frame id, a page like /cart, or an .html file to copy in.`);
      copyIn(e, b.name, id, fs.readFileSync(file, 'utf8'));
      f.src = route(b.name, id);
    }
    f.h = heightFor(f.w);
    insert(b, f, a.after);
    return done(`Added ${id} (${f.src.startsWith('/_lab/') ? `${id}.html` : f.src})${a.after ? ` after ${a.after}` : ''}.`);
  }
  if (action === 'move') {
    const f = frameOf(b, a.frame);
    if (!f) return no(`No frame ${a.frame} on ${b.name}.`);
    if (!a.first && !frameOf(b, a.after)) return no('Say where: labit board move <board> <frame> --after <frame> (or --first).');
    if (a.after === f.id) return no('A frame cannot go after itself.');
    b.frames.splice(b.frames.indexOf(f), 1);
    if (a.first) b.frames.unshift(f);
    else insert(b, f, a.after);
    delete f.x;
    delete f.y;
    return done(`${f.id} is now ${a.first ? 'first' : `after ${a.after}`}.`);
  }
  if (action === 'pick') {
    const ids = [...new Set(a.frames || [])];
    const bad = ids.find((i) => !frameOf(b, i));
    if (!ids.length || bad) return no(bad ? `No frame ${bad} on ${b.name}.` : 'Name the frame to keep: labit board pick <board> <frame>');
    const same = b.frames.every((f) => f.state === (ids.includes(f.id) ? (ids.length === 1 ? 'picked' : 'live') : 'archived'));
    if (same) return { text: `${ids.join(', ')} is already ${ids.length === 1 ? 'picked' : 'kept'}.`, board: b };
    for (const f of b.frames) f.state = ids.includes(f.id) ? (ids.length === 1 ? 'picked' : 'live') : 'archived';
    const gone = b.frames.filter((f) => f.state === 'archived').map((f) => f.id);
    return done(`${ids.length === 1 ? `Picked ${ids[0]}` : `Kept ${ids.join(', ')}`}.${gone.length ? ` Archived ${gone.join(', ')}${b.frames.some((f) => gone.includes(f.id) && f.src.startsWith('/_lab/') && f.kind !== 'image') ? ' (files kept)' : ''}.` : ''}`, ids.length === 1 ? { picked: frameOf(b, ids[0]) } : {});
  }
  return no(`Unknown board action ${action}. Use new, add, move, pick or list.`);
}
