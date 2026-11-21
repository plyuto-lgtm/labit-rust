// Boards: a board is a set of frames, each a lab page at a device size. It lives in .lab/boards/<name>.json
// and owns no page content. Variants are copies of a page in .lab/boards/<name>/<frame>.html, served by the lab at
// /_lab/board/<name>/<frame>. The lab places frames; callers only give an order.
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_FILE, imageInfo } from './images.mjs';

export type Frame = { id: string; src: string; kind?: 'image'; file?: string; iw?: number; ih?: number; guest?: boolean; w: number; h: number; x?: number; y?: number; label?: string; variantOf?: string; state?: 'live' | 'picked' | 'archived'; auto?: boolean };
export type Board = { v: 1; name: string; rev: number; title?: string; of?: string; frames: Frame[] };

// (the commands: lib/boardact.ts)
export const NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const FRAME = /^[a-z][a-z0-9]{0,5}$/;
export const MAX_FRAMES = 60;
/** The frames that count toward MAX_FRAMES: an archived picture does not (frames can't be taken off a board, and pictures pile up). */
export const counted = (frames: { kind?: string; state?: string }[]) => frames.filter((f) => !(f?.kind === 'image' && f.state === 'archived')).length;
export const SIZES: Record<number, number> = { 390: 844, 820: 1180, 1280: 800, 1440: 900 }; // phone, tablet, laptop, desktop
const GAP = 80;
const ROW = 4800;

/** The name of the board of a page: /a/b is a--b, / is index. The file also says `of`, so the name is never read back. */
export const nameOf = (page: string) => page.replace(/^\/+|\/+$/g, '').replace(/\//g, '--').slice(0, 80) || 'index';
/** The height a width gets: its preset, else the nearest one's. */
export const heightFor = (w: number) => SIZES[w] ?? (w <= 500 ? 844 : w <= 1000 ? 1180 : w <= 1360 ? 800 : 900);
const idOf = (n: number) => (n < 26 ? String.fromCharCode(97 + n) : `z${n - 24}`);
/** The next free frame id (a, b, … z, z2, …), skipping any `taken` one too. */
export const nextId = (frames: Frame[], taken?: (id: string) => boolean) => {
  for (let n = frames.length; ; n++) if (!frames.some((f) => f.id === idOf(n)) && !taken?.(idOf(n))) return idOf(n);
};
export const one = (t: unknown, max: number) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const px = (v: unknown, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v as number), lo), hi) : undefined);
/** A page on this lab: a path, never another origin. */
export const labPath = (s: unknown) => typeof s === 'string' && s.length <= 300 && /^\/(?!\/)[^\\\s<>"']*$/.test(s) && !/(^|\/)\.\.?(\/|$)/.test(s);

/** The board a request describes, or the reason it is refused. `was` is the stored one: no frame may go. */
export function check(raw: any, name: string, was?: Board | null): Board | string {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.frames)) return 'a board is {"v":1,"frames":[…]}';
  if (counted(raw.frames) > MAX_FRAMES) return `at most ${MAX_FRAMES} frames`;
  const frames: Frame[] = [];
  for (const f of raw.frames) {
    if (!f || typeof f.id !== 'string' || !FRAME.test(f.id) || frames.some((g) => g.id === f.id)) return `frame ids are lowercase letters and digits, each once (got ${JSON.stringify(f?.id)})`;
    if (!labPath(f.src)) return `frame ${f.id}: src is a path on this lab, like /pricing (got ${String(JSON.stringify(f.src)).slice(0, 60)})`;
    if (f.src.startsWith('/_lab/') && !f.src.startsWith(`/_lab/board/${name}/`)) return `frame ${f.id}: src may only be a page or one of this board's own variants`;
    const image = f.kind === 'image';
    if (image && (f.src !== `/_lab/board/${name}/${f.id}` || typeof f.file !== 'string' || !IMAGE_FILE.test(f.file) || f.file.split('.')[0] !== f.id)) return `frame ${f.id}: an image frame is its own file <id>.<ext>`;
    const w = px(f.w, 200, 4000) ?? 1280;
    const out: Frame = { id: f.id, src: f.src, w, h: px(f.h, 200, 4000) ?? heightFor(w) };
    if (image) Object.assign(out, { kind: 'image', file: f.file, iw: px(f.iw, 1, 16384), ih: px(f.ih, 1, 16384), ...(f.guest === true ? { guest: true } : {}) });
    const auto = f.auto === true || !Number.isFinite(f.x) || !Number.isFinite(f.y);
    if (!auto) [out.x, out.y] = [px(f.x, -1e6, 1e6)!, px(f.y, -1e6, 1e6)!];
    if (one(f.label, 80)) out.label = one(f.label, 80);
    if (typeof f.variantOf === 'string' && FRAME.test(f.variantOf)) out.variantOf = f.variantOf;
    out.state = f.state === 'picked' || f.state === 'archived' ? f.state : 'live';
    frames.push(out);
  }
  for (const f of frames) if (f.variantOf && !frames.some((g) => g.id === f.variantOf)) delete f.variantOf;
  const gone = was?.frames.find((f) => !frames.some((g) => g.id === f.id));
  if (gone) return `frame ${gone.id} cannot be removed: archive it (state "archived")`;
  const board: Board = { v: 1, name, rev: (was?.rev ?? 0) + 1, frames };
  if (one(raw.title, 80)) board.title = one(raw.title, 80);
  if (raw.of !== undefined) {
    const of = typeof raw.of === 'string' ? raw.of.split('#')[0] : '';
    if (!labPath(of)) return '"of" is the page the board is about, like /pricing or /pricing#hero';
    board.of = one(raw.of, 200);
  }
  return board;
}

/** Every frame that is drawn gets x and y: its own, or the next spot in the rows (array order, 80 px apart). */
export function place(board: Board): Board {
  let x = 0;
  let y = 0;
  let row = 0;
  const frames = board.frames.map((f) => {
    if (f.state === 'archived') return { ...f, x: undefined, y: undefined };
    if (Number.isFinite(f.x) && Number.isFinite(f.y)) return f;
    if (x && x + f.w > ROW) [x, y, row] = [0, y + row + GAP * 2, 0];
    const at = { ...f, x, y, auto: true };
    x += f.w + GAP;
    row = Math.max(row, f.h);
    return at;
  });
  return { ...board, frames };
}

// ---------- the files ----------
export const dirOf = (root: string) => path.join(root, '.lab', 'boards');
// A name becomes a path here and nowhere else, and only a plain one does: "../../package" (from a command, or from the
// board a pin says it was made on) reached any .json file of the project, which read() then moved aside as damaged.
const safeName = (name: string) => {
  if (!NAME.test(name)) throw new Error(`not a board name: ${String(name).slice(0, 80)}`);
  return name;
};
const fileOf = (root: string, name: string) => path.join(dirOf(root), `${safeName(name)}.json`);
export const frameFile = (root: string, name: string, id: string) => path.join(dirOf(root), safeName(name), `${id}.html`);
/** An image frame's file, in its board's folder: a plain <id>.<ext> and nothing else. */
export const imageFile = (root: string, name: string, file: string) => {
  if (!IMAGE_FILE.test(file)) throw new Error(`not an image file name: ${String(file).slice(0, 40)}`);
  return path.join(dirOf(root), safeName(name), file);
};
const ser = (b: Board) => `{"v":1,"name":${JSON.stringify(b.name)},"rev":${b.rev}${b.title ? `,"title":${JSON.stringify(b.title)}` : ''}${b.of ? `,"of":${JSON.stringify(b.of)}` : ''},\n"frames":[\n${b.frames.map((f) => '  ' + JSON.stringify({ ...f, auto: undefined })).join(',\n')}\n]}\n`;
/** Writes a whole file or none of it (through a .tmp beside it), making its folder first. Also the settings' and the
 *  reply rules' writer. */
export const writeAtomic = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
};
/** The stored board; null when there is none; a file that can't be read is put aside (never overwritten) and counts as none. */
export function read(root: string, name: string): Board | null {
  if (!NAME.test(name)) return null; // no board has such a name
  const file = fileOf(root, name);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const b = (() => {
    try {
      return check(JSON.parse(text), name);
    } catch {
      return 'not json';
    }
  })();
  if (typeof b === 'string') {
    fs.renameSync(file, `${file}.broken-${Date.now()}`);
    console.log(`[lab] board ${name} was damaged (${b}); moved it aside`);
    return null;
  }
  return { ...b, rev: Number(JSON.parse(text).rev) || 1 };
}
export const save = (root: string, b: Board) => writeAtomic(fileOf(root, b.name), ser(b));
export const names = (root: string): string[] => {
  try {
    return fs.readdirSync(dirOf(root)).filter((n) => n.endsWith('.json') && NAME.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort();
  } catch {
    return [];
  }
};

/** Puts a frame after the one named, or last. */
export const insert = (b: Board, f: Frame, after?: string) => {
  const at = after ? b.frames.findIndex((g) => g.id === after) : -1;
  b.frames.splice(at < 0 ? b.frames.length : at + 1, 0, f);
};

// ---------- pictures ----------
/** What a file's first 64 KB say it is (never its name): lib/images.mjs imageInfo, null when it is no picture. */
export const imageAt = (file: string) => {
  const head = Buffer.alloc(65536);
  const fd = fs.openSync(file, 'r');
  const n = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  return imageInfo(head.subarray(0, n));
};
/** A picture as a new frame of a stored board: its file is written, the frame put (at the given centre, or placed by the lab),
 *  rev and file saved. All of it is synchronous, so nothing can come between the read and the write. */
export function addImage(root: string, b: Board, bytes: Buffer, info: { ext: string; w: number; h: number }, at?: { x: number; y: number }, opts?: { label?: string; after?: string; guest?: boolean }): { frame: Frame } | { error: string } {
  if (counted(b.frames) >= MAX_FRAMES) return { error: `A board holds at most ${MAX_FRAMES} frames.` };
  const dir = path.join(dirOf(root), safeName(b.name));
  const left = (id: string) => { try { return fs.readdirSync(dir).some((n) => n.startsWith(`${id}.`)); } catch { return false; } };
  const id = nextId(b.frames, left);
  const file = `${id}.${info.ext}`;
  // The size it is drawn at: its long side up to 1440 world px, the aspect kept, each side held to 200..4000.
  const k = Math.min(1, 1440 / Math.max(info.w, info.h));
  const w = px(info.w * k, 200, 4000)!;
  const h = px(info.h * k, 200, 4000)!;
  const f: Frame = { id, src: `/_lab/board/${b.name}/${id}`, kind: 'image', file, iw: info.w, ih: info.h, w, h, state: 'live', ...(opts?.guest ? { guest: true } : {}), ...(opts?.label ? { label: one(opts.label, 80) } : {}) };
  if (at) [f.x, f.y] = [px(at.x - w / 2, -1e6, 1e6)!, px(at.y - h / 2, -1e6, 1e6)!];
  writeAtomic(imageFile(root, b.name, file), bytes);
  insert(b, f, opts?.after);
  b.rev++;
  save(root, b);
  return { frame: f };
}
