// Shared by local.mjs and bench/serve.mjs: the comments API on an in-memory store, and plain file serving.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';

/** The in-memory store: keys, each a Map of comments or a counter / string. */
type Db = Map<string, any>;
type Handler = (req: Request) => Promise<Response>;

// The comments API (lib/comments-api.mjs) keeps each page's comments in `db`, a Map of Maps (and the nonces and hourly
// counts beside them). Returns the API module.
export async function apiOn(db: Db): Promise<any> {
  // The key the lab sends with who wrote a comment (x-lab-stamp), so the API saves it in the same write.
  process.env.LAB_STAMP_KEY ||= (await import('node:crypto')).randomBytes(16).toString('hex');
  const api = await import('./comments-api.mjs');
  api.useStore(db);
  return api;
}

/** The most a request to the lab may carry. A comment is at most a few KB; the last looks have their own, larger cap. */
export const BODY_MAX = 256 * 1024;

// Runs a Node request through a Web-style handler (the API's GET / POST).
export async function callApi(fn: Handler, req: IncomingMessage, url: string, extraHeaders: Record<string, string> = {}, read?: Buffer): Promise<Response> {
  const chunks: Buffer[] = [];
  let size = 0;
  // `read`: the body, when the lab has already taken it off the request. The rest of a long one is read and dropped, so the sender gets its answer.
  for await (const c of read ? [read] : req) if ((size += c.length) <= BODY_MAX) chunks.push(c);
  if (size > BODY_MAX) return new Response('too big', { status: 413 });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, String(v));
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  // Always the socket's own address: a forwarded-for header from the client would let it pick its own rate-limit key.
  headers.set('x-forwarded-for', req.socket.remoteAddress || 'unknown');
  return fn(new Request(url, { method: req.method, headers, body: /GET|HEAD/.test(req.method || '') ? undefined : Buffer.concat(chunks) }));
}

// Whether an IPv4 address is a device on the same network as this computer: the same subnet as one of its own
// interfaces (a hotspot or an office may hand out addresses that are not the private ranges), or in 100.64.0.0/10
// (Tailscale, carrier NAT). A subnet wider than a /16 does not count, so a computer with a public address on a big
// network does not let the neighbourhood in.
const num = (ip: string) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
export function onLan(addr: string, nets: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr)) return false;
  if ((num(addr) >>> 22) === num('100.64.0.0') >>> 22) return true;
  return Object.values(nets).flat().some((n) => {
    if (!n || n.family !== 'IPv4' || n.internal) return false;
    const mask = num(n.netmask);
    return mask >= num('255.255.0.0') && (num(addr) & mask) === (num(n.address) & mask);
  });
}

// A page's text is read in the charset it says it has (the Content-Type's, else its own <meta>): a page saved as
// iso-8859-1 and read as UTF-8 showed every é as a replacement mark. What the lab sends on is always UTF-8, with a header
// that says so (a header outranks the page's <meta>). `head` is the start of the bytes; a name nobody knows reads as UTF-8.
export function decoderFor(head: Uint8Array, type = ''): TextDecoder {
  const meta = /<meta[^>]*charset=["']?([\w-]+)/i.exec(Buffer.from(head.subarray(0, 1024)).toString('latin1'))?.[1];
  try {
    // A <meta> that says utf-16 is read as utf-8 by browsers too (the bytes it sits in are ASCII-like).
    return new TextDecoder(/charset=["']?([\w-]+)/i.exec(type)?.[1] || (/^utf-?16/i.test(meta || '') ? '' : meta) || 'utf-8');
  } catch {
    return new TextDecoder();
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
  '.ts': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

// Text goes compressed when the browser takes it (brotli, else gzip), and every file carries an ETag: the browser
// keeps a copy but asks each time ("no-cache"), so a reload gets a 304 "not changed" in place of the file, and a file
// that changed is always sent fresh. (15 Nov: a page view on this lab was ~460 kB plus every picture again.)
const SQUEEZE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;
export const encodingFor = (req: IncomingMessage): '' | 'br' | 'gzip' => {
  const a = String(req.headers['accept-encoding'] || '');
  return /\bbr\b/.test(a) ? 'br' : /\bgzip\b/.test(a) ? 'gzip' : '';
};
const squeeze = (buf: Buffer, enc: string): Buffer =>
  enc === 'br' ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(buf, { level: 6 });
// The bytes and headers sendBody sends for this request, without sending them: for a body worth keeping (local.mjs
// keeps each page's comments list until the page changes, so it isn't compressed again for every request).
export function packBody(req: IncomingMessage, headers: OutgoingHttpHeaders, body: Buffer | string): { out: Buffer; headers: OutgoingHttpHeaders } {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const enc = buf.length > 1024 && SQUEEZE.test(String(headers['content-type'] || '')) ? encodingFor(req) : '';
  const out = enc ? squeeze(buf, enc) : buf;
  return { out, headers: { ...headers, vary: 'accept-encoding', ...(enc ? { 'content-encoding': enc } : {}), 'content-length': out.length } };
}
// A body made for this request (a page with the widget added, the comments list): compressed when worth it.
export function sendBody(req: IncomingMessage, res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: Buffer | string): void {
  const { out, headers: head } = packBody(req, headers, body);
  res.writeHead(status, head);
  res.end(req.method === 'HEAD' ? undefined : out);
}
const squeezed = new Map<string, Buffer>(); // file + etag + encoding → compressed bytes, so a file is compressed once per change
let squeezedBytes = 0;
const SQUEEZED_MAX = 10e6; // at most 10 MB kept: the oldest go first (a busy evening held ~25 MB of old versions)
const keepSqueezed = (key: string, out: Buffer): Buffer => {
  squeezed.set(key, out);
  squeezedBytes += out.length;
  for (const [k, v] of squeezed) {
    if (squeezedBytes <= SQUEEZED_MAX) break;
    squeezed.delete(k);
    squeezedBytes -= v.length;
  }
  return out;
};
// A page script the npm package ships brotli-packed (<name>.js.br, scripts/build-widget.mjs) and a checkout has plain: the
// answer sendFile gives for <name>.js, made from the packed file. To a browser that takes brotli the packed bytes go as they
// are; to one that doesn't they are unpacked (once per file) and sent plain or gzipped. No range answers: a script goes whole.
// The validator for a file's bytes: size, mtime, inode and ctime. A file saved with the same size and mtime (cp -p, rsync -t, two
// saves in one millisecond) still differs in its ctime, and one replaced through a temp file in its inode.
const etagOf = (stat: fs.Stats): string => `W/"${[stat.size, Math.round(stat.mtimeMs), stat.ino, Math.round(stat.ctimeMs * 1000)].map((n) => n.toString(36)).join('-')}"`;
export function sendPacked(req: IncomingMessage, res: ServerResponse, file: string): void {
  const stat = fs.statSync(`${file}.br`);
  const etag = etagOf(stat);
  if (req.headers['if-none-match'] === etag) return void res.writeHead(304, { 'cache-control': 'no-cache', etag }).end();
  const enc = encodingFor(req);
  const key = `${file} ${etag} `;
  const unpacked = () => squeezed.get(`${key}plain`) ?? keepSqueezed(`${key}plain`, zlib.brotliDecompressSync(fs.readFileSync(`${file}.br`)));
  const out = squeezed.get(`${key}${enc || 'plain'}`) ?? keepSqueezed(`${key}${enc || 'plain'}`, enc === 'br' ? fs.readFileSync(`${file}.br`) : enc === 'gzip' ? squeeze(unpacked(), 'gzip') : unpacked());
  res.writeHead(200, { 'content-type': TYPES['.js'], 'accept-ranges': 'bytes', 'cache-control': 'no-cache', etag, vary: 'accept-encoding', ...(enc && { 'content-encoding': enc }), 'content-length': out.length });
  res.end(req.method === 'HEAD' ? undefined : out);
}
// One file, with byte ranges (video seeking). A bad range gets 416, never a crash.
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, extra?: Record<string, string>): void {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const stat = fs.statSync(file);
  const size = stat.size;
  const etag = etagOf(stat);
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': /\.(css|m?js)$/i.test(file) ? 'no-store' : 'no-cache', etag, ...extra }; // no-store: Back shows what is on disk, not a script from the cache
  if (req.headers['if-none-match'] === etag) return void res.writeHead(304, { 'cache-control': 'no-cache', etag }).end();
  const enc = !req.headers.range && size > 1024 && size < 8e6 && SQUEEZE.test(type) ? encodingFor(req) : '';
  if (enc) {
    const key = `${file} ${etag} ${enc}`;
    let out = squeezed.get(key);
    if (!out) {
      out = squeeze(fs.readFileSync(file), enc);
      keepSqueezed(key, out);
    }
    res.writeHead(200, { ...head, vary: 'accept-encoding', 'content-encoding': enc, 'content-length': out.length });
    return void res.end(req.method === 'HEAD' ? undefined : out);
  }
  let start = 0;
  let end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) [start, end] = [+range[1], range[2] ? Math.min(+range[2], size - 1) : size - 1];
    else start = Math.max(size - +range[2], 0);
    if (start > end || start >= size) return void res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  } else res.writeHead(200, { ...head, 'content-length': size });
  if (!size) return void res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}
