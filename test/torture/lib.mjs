// What the three torture areas share: the seeded random numbers, a case's folders, ports and processes (and their
// cleanup, also on ctrl-c), the lab under test, plain HTTP and the live stream, a "device" (the widget's sync rules
// spoken by a raw client), and the findings a case reports. Nothing here knows what a correct answer is: the areas
// keep their own model of what should exist and compare it with what each observer sees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { claimPort, LAB, tmp, rm, sleep as harnessSleep, spawnLab } from '../harness.mjs';

// Never a time below 1: Node prints a TimeoutNegativeWarning for a negative one (a clamped wait computed from the clock).
const sleep = (ms) => harnessSleep(Math.max(1, ms));
export { LAB, sleep };

// ---------- seeded random numbers ----------
/** A 32-bit number from any values (the same values always give the same number). */
export const hashSeed = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest().readUInt32LE(0);

/** A random source that depends on its seed alone (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    float: next,
    /** 0 … n-1 */
    int: (n) => Math.floor(next() * n),
    /** lo … hi, both included */
    between: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    bool: (p = 0.5) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** One value from [[weight, value], …]. */
    weighted: (table) => {
      let at = next() * table.reduce((n, [w]) => n + w, 0);
      for (const [w, v] of table) if ((at -= w) < 0) return v;
      return table[table.length - 1][1];
    },
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    id: (n = 8) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(next() * 36)]).join(''),
  };
  return rng;
}

// Words people (and tests) put in comments: plain, long, other scripts, emoji, text that looks like the agent text's
// own headings, shell and HTML marks, line ends of every kind. `tag` makes each text unique, so the oracle can tell
// two comments apart by their words alone.
const ODD = [
  'plain words', 'Tighten this heading', 'ü ö ä ß — “quotes” and ‘more’', 'שלום עולם', 'مرحبا بالعالم', '日本語のコメント', '👩‍👩‍👧‍👦 family 🏳️‍🌈 flag 🎧',
  'é combining', '## 9. Fake · heading · id deadbeef0000', 'reply: Claude · id 000000000000: Done', '<script>alert(1)</script>', '`rm -rf /` $(whoami) ; echo',
  'line one\nline two\r\nline three line four', '  padded  ', 'tab\tseparated', '"quoted" \'single\' \\backslash', '- one\n- two\n- three', '1) first\n2) second',
  'http://localhost:3000/x?y=1#z', 'null', 'undefined', '0', 'a'.repeat(300),
];
export const oddText = (rng, tag) => `${tag} ${rng.pick(ODD)}`;
/** Names of people: some contain an agent's name inside another word, which the lab must not take for an agent. */
export const PEOPLE = ['Leo', 'Mira', 'Zoë 🎧', 'Campbell', 'Dana', 'O\'Neil', 'Æsa', 'Ravi', 'Noor'];

// ---------- findings ----------
/** What one check found. cls: 'loud' (the product said so), 'silent' (it diverged and said nothing), 'unclear' (the
 *  contract doesn't say), 'harness' (this test's own trouble: never counted against labit). tags: a few words that tell
 *  one bug from another; they are part of the signature, the detail is not. */
export const finding = (cls, check, detail, tags = {}) => ({ cls, check, detail: String(detail).slice(0, 1200), tags });
export const signatureOf = (area, f) => `${area} | ${f.cls} | ${f.check}${Object.keys(f.tags).length ? ` | ${Object.entries(f.tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`;

// ---------- ports, folders, processes: one case's, and their cleanup ----------
// Ports come from this file's own range through the tests' port locks (test/browser/port.mjs) and are used again by
// later cases: a claim is only let go when the whole run exits, and a run makes thousands of labs.
const PORT_BASE = Number(process.env.TORTURE_PORT_BASE || 23000);
const PORT_SPAN = Number(process.env.TORTURE_PORT_SPAN || 1800);
const freePorts = [];
export const takePort = () => freePorts.pop() ?? claimPort(PORT_BASE, PORT_SPAN);
export const givePort = (p) => void freePorts.push(p);

/** This computer's address on the local network, if it has one: where a "phone" comes from. */
export const LAN = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address || '';

// What labit reads from the environment to tell which agent runs it: a run started from inside an agent's shell (this
// one was written in one) must not hand its own session to the labs and commands it starts.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX|AMP_|CURSOR|GEMINI|OPENCODE|ANTIGRAVITY|LAB_|LABIT_|AI_AGENT$|AGENT$|ANTHROPIC_MODEL$|PORT$)/.test(k)));

const live = new Set(); // every case still running, for the exit handlers
/** One case's own world: a temp root with the served folder, a LABIT_HOME and a settings folder, its ports and every
 *  process it started. dispose() ends them all and removes the folders, whatever happened in between. */
export class Ctx {
  constructor(area, seed) {
    this.area = area;
    this.seed = seed;
    this.root = fs.realpathSync(tmp(`torture-${area}`));
    this.dir = path.join(this.root, 'site');
    this.home = path.join(this.root, 'home');
    this.cfg = path.join(this.root, 'cfg');
    for (const d of [this.dir, this.home, this.cfg]) fs.mkdirSync(d);
    this.procs = new Set();
    this.ports = [];
    this.closers = [];
    this.findings = [];
    this.trace = [];
    this.t0 = Date.now();
    live.add(this);
  }
  /** The environment of this case's labs and commands. */
  env(extra = {}) {
    return { ...CLEAN_ENV, LABIT_HOME: this.home, XDG_CONFIG_HOME: this.cfg, LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1', LABIT_IDLE_MS: '0', LABIT_NO_FOLLOW: '1', PORT: '', ...extra };
  }
  port() {
    const p = takePort();
    this.ports.push(p);
    return p;
  }
  track(proc) {
    this.procs.add(proc);
    proc.once('exit', () => this.procs.delete(proc));
    return proc;
  }
  /** Something to close when the case ends (a stream, a server, a browser context). */
  onEnd(fn) {
    this.closers.push(fn);
  }
  add(cls, check, detail, tags) {
    this.findings.push(finding(cls, check, detail, tags));
  }
  /** A measured time (how long something took to settle), for the report. */
  time(name, ms) {
    ((this.timings ||= {})[name] ||= []).push(Math.round(ms));
  }
  /** One line of what happened, with its time: printed on a replay. */
  note(...words) {
    this.trace.push(`${String(Date.now() - this.t0).padStart(6)} ms  ${words.join(' ')}`);
  }
  killAll() {
    for (const p of this.procs) {
      try {
        p.kill('SIGKILL');
      } catch {}
    }
  }
  async dispose() {
    for (const fn of this.closers.splice(0).reverse()) {
      try {
        await fn();
      } catch {}
    }
    const going = [...this.procs].map((p) => new Promise((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r))));
    this.killAll();
    await Promise.race([Promise.all(going), sleep(3000)]);
    try {
      rm([this.root], { maxRetries: 5, retryDelay: 50 });
    } catch {}
    for (const p of this.ports.splice(0)) givePort(p);
    live.delete(this);
  }
}
// Nothing is left running, and no folder left behind, when the run ends: at its end, on ctrl-c, on a crash.
let ending = false;
const endAll = () => {
  for (const c of live) {
    c.killAll();
    try {
      fs.rmSync(c.root, { recursive: true, force: true });
    } catch {}
  }
};
process.on('exit', endAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => {
    if (ending) return;
    ending = true;
    endAll();
    process.exit(130);
  });

// ---------- the lab under test ----------
/** A lab on a folder, started from this checkout's local.mjs (test/harness.mjs spawnLab). */
export class Lab {
  constructor(ctx, { dir = ctx.dir, flags = ['--new'], args = [], env = {}, port } = {}) {
    Object.assign(this, { ctx, dir, flags, args, extraEnv: env, port: port ?? ctx.port(), proc: null, log: '', starts: 0 });
  }
  get base() {
    return `http://localhost:${this.port}`;
  }
  /** Starts it and waits until it answers. { ok, exited, code }: a lab that never answers is the caller's to judge. */
  async start({ ms = 10000 } = {}) {
    this.starts++;
    const proc = this.ctx.track(spawnLab(this.dir, this.port, { flags: this.flags, args: this.args, env: this.ctx.env(this.extraEnv), stdio: ['ignore', 'pipe', 'pipe'] }));
    this.proc = proc;
    const take = (d) => {
      this.log = (this.log + d).slice(-60000);
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    let code = null;
    proc.once('exit', (c, s) => (code = c ?? s ?? 0));
    for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) {
      if (code !== null) return { ok: false, exited: true, code };
      const r = await rq(this, { path: '/_lab/state', timeout: 1000 }).catch(() => null);
      if (r?.status !== 200) continue;
      // The lab moves to the next port when its own is taken: then it isn't where this case talks to it.
      let on = 0;
      try {
        const sj = this.serverJson();
        on = sj.pid === proc.pid ? sj.port : 0;
      } catch {}
      if (on === this.port) return { ok: true };
    }
    return { ok: false, exited: code !== null, code };
  }
  /** Ends it and waits until it is gone. SIGTERM is the lab's own way out; SIGKILL is a crash. */
  async stop(signal = 'SIGTERM') {
    const p = this.proc;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    await new Promise((r) => {
      p.once('exit', r);
      p.kill(signal);
      setTimeout(() => p.kill('SIGKILL'), 4000).unref();
    });
  }
  serverJson() {
    return JSON.parse(fs.readFileSync(path.join(this.dir, '.lab/server.json'), 'utf8'));
  }
  /** The comments as the lab keeps them on disk: { page: { id: comment } }, read as the lab's own commands read them. */
  store() {
    const out = {};
    const dir = path.join(this.dir, '.lab/comments');
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : []) {
      try {
        const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (typeof file.page === 'string' && file.comments) out[file.page] = file.comments;
      } catch {}
    }
    return out;
  }
}

// ---------- plain HTTP, as a browser on this computer or as another device on the wifi ----------
/** One request to a lab. from 'local' is this computer (127.0.0.1); 'lan' comes in through the wifi address, which is
 *  how the lab tells a phone (a guest) from the browser here. No connection is kept: each lab's port is used again by
 *  a later case. Rejects when the lab can't be reached. */
export function rq(lab, { from = 'local', method = 'GET', path: p, headers = {}, body, cookie, timeout = 8000, signal, raw } = {}) {
  return new Promise((resolve, reject) => {
    const host = from === 'lan' ? LAN : '127.0.0.1';
    const name = `${from === 'lan' ? LAN : 'localhost'}:${lab.port}`;
    const data = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
    const req = http.request(
      { host, port: lab.port, path: p, method, agent: false, signal, timeout,
        headers: { host: name, ...(data ? { 'content-type': 'application/json', 'content-length': data.length, origin: `http://${name}` } : {}), ...(cookie ? { cookie } : {}), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          // Packed answers are unpacked, as a browser does (a device asks for them packed: the lab keeps packed copies).
          try {
            if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
            else if (res.headers['content-encoding'] === 'br') buf = zlib.brotliDecompressSync(buf);
          } catch (e) {
            return reject(Object.assign(new Error(`could not unpack the answer: ${e.message}`), { code: 'EUNPACK' }));
          }
          resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8')) });
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(data || undefined);
  });
}

/** What the agent's commands send (lib/labcall.ts): the agent's key from .lab/server.json and its session. */
export const agentHeaders = (lab, session) => ({ 'x-lab-admin': lab.serverJson().agent, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify(session)) });
export const agentRq = async (lab, session, p, body, more = {}) => rq(lab, { method: 'POST', path: p, body, headers: agentHeaders(lab, session), ...more });

/** A labit command run in the lab's folder to its end: { code, out }. `killAfter` ms ends it early (SIGKILL), as an
 *  agent's cancelled command does. */
export function runCli(ctx, lab, args, { env = {}, killAfter } = {}) {
  let proc;
  const done = new Promise((resolve) => {
    proc = ctx.track(spawn(process.execPath, [LAB, ...args], { cwd: lab.dir, env: ctx.env(env), stdio: ['ignore', 'pipe', 'pipe'] }));
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    const timer = killAfter === undefined ? null : setTimeout(() => proc.kill('SIGKILL'), killAfter);
    proc.once('close', (code, sig) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, killed: Boolean(sig), out });
    });
  });
  done.proc = proc;
  return done;
}

/** A lab's live stream (server-sent events), as a page holds it: onState gets every state the lab says. */
export function openLive(lab, { from = 'local', tab, cookie, onState, onEnd } = {}) {
  const host = from === 'lan' ? LAN : '127.0.0.1';
  const s = { ended: false, states: 0, close: () => {} };
  const req = http.get({ host, port: lab.port, path: `/_lab/live${tab ? `?tab=${tab}` : ''}`, agent: false, headers: { host: `${from === 'lan' ? LAN : 'localhost'}:${lab.port}`, accept: 'text/event-stream', ...(cookie ? { cookie } : {}) } }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      s.ended = true;
      s.status = res.statusCode;
      return void onEnd?.(res.statusCode);
    }
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (!data || /^event: beat/m.test(block)) continue;
        s.states++;
        try {
          onState?.(JSON.parse(data.slice(6)));
        } catch {}
      }
    });
    res.on('close', () => {
      if (s.ended) return;
      s.ended = true;
      onEnd?.(0);
    });
  });
  req.on('error', () => {
    if (s.ended) return;
    s.ended = true;
    onEnd?.(0);
  });
  s.close = () => {
    s.ended = true;
    req.destroy();
  };
  return s;
}

// ---------- a device ----------
// A page of the lab held open by one browser, spoken as a raw client: the same requests the widget makes, by the same
// rules (src/widget/live.ts onState, hotUpdate, morphPage, reload; src/comments.js load, loadChanges, send and what
// each sender does with its answer). It keeps what a browser would be showing: the page's HTML, each stylesheet,
// script and picture as last fetched, and the comments list as the widget holds it. The oracle never reads these
// rules: it compares what the device ends up showing with what is on disk and in the lab.
const FETCHED = /\.(json|wasm|csv|tsv|xml|txt|map|woff2?)$/i;
// Which widget the device speaks like: the FIXED one (default; src/widget/live.ts and src/comments.js of branch
// fix/torture-all) or the OLD one (TORTURE_WIDGET=old), so the same harness is a before/after baseline. Read at each
// use, so a run can set it before it starts. The rules that differ are marked "fixed:" / "old:" below.
export const widgetFixed = () => process.env.TORTURE_WIDGET !== 'old';
// The device asks "changes since" one at a time, in the order asked (src/comments.js loadChanges does too), so a newer answer
// can't be overtaken on the way and then overwritten by an older one (wifi). TORTURE_SERIAL_CHANGES=0 asks them all at
// once and applies each answer as it arrives (how the widget did before): a run with it shows what the serial asking fixes.
const SERIAL_CHANGES = process.env.TORTURE_SERIAL_CHANGES !== '0';
const tidy = (u) => {
  const t = decodeURIComponent(u).replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '');
  return widgetFixed() ? t.toLowerCase() : t; // fixed: a page opened in another letter case is the same page
};
const attr = (tag, name) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);
export class Device {
  /**
   * @param {Lab} lab
   * @param {{ id: string, kind?: 'laptop' | 'phone', name?: string, url?: string, cookie?: string, jitter?: () => number }} o
   *   url: the address it opens (/, /a.html, /sub/). jitter: ms each answer is held before the device sees it (a
   *   phone on wifi); none on this computer.
   */
  constructor(lab, { id, kind = 'laptop', name = 'Leo', url = '/', cookie = '', jitter = null }) {
    Object.assign(this, { lab, id, kind, name, url, cookie, jitter });
    this.from = kind === 'phone' ? 'lan' : 'local';
    this.S = { comments: [], loaded: false, isAdmin: false, rev: null };
    this.edits = new Map(); // the keys of the pins this browser started (lab-edit:<id>)
    this.res = new Map(); // served path -> what it shows of it: { status, text }
    this.cache = new Map(); // served path -> { etag, text }: the browser's own copies, asked about again on a reload
    this.attrs = {}; // the widget tag's data-* as served
    this.html = null;
    this.status = 0;
    this.stream = null;
    this.gen = 0; // page loads: answers to an older page's requests are dropped, as a reloaded page drops them
    this.busy = 0; // requests on the way
    this.work = Promise.resolve();
    this.reloads = 0;
    this.morphs = 0;
    this.held = false; // something is open (a draft): a reload waits
    this.waiting = false; // a reload is waiting
    this.dead = false; // on a page with no widget (the lab's "not found"): nothing will ever update it
    this.offline = false;
    this.log = [];
    this.tabN = 0;
    this.loads = []; // [from, to]: each page load, until its live stream said its first message
  }
  note(...w) {
    this.log.push(`${Date.now() % 100000} ${w.join(' ')}`);
    if (this.log.length > 400) this.log.shift();
  }
  // One request of the page's; its answer comes after the device's delay, and never to a page that has since reloaded.
  async ask(o) {
    this.busy++;
    const gen = this.gen;
    try {
      const r = await rq(this.lab, { from: this.from, cookie: this.cookie, ...o });
      const wait = this.jitter ? this.jitter() : 0;
      if (wait) await sleep(wait);
      if (o.page !== true && gen !== this.gen) throw Object.assign(new Error('page reloaded'), { code: 'RELOADED' });
      return r;
    } finally {
      this.busy--;
    }
  }
  // Runs a piece of the page's work and remembers it, so a check can wait until the device has nothing on the way.
  go(fn) {
    const p = Promise.resolve().then(fn).catch((e) => this.note('error', e?.code || e?.message || e));
    this.work = Promise.allSettled([this.work, p]);
    return p;
  }
  /** Waits until nothing the page started is still on the way. */
  async idle(ms = 4000) {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      await Promise.race([this.work, sleep(ms)]);
      if (!this.busy && !(this.waiting && !this.held)) return true; // a reload that waits is still on its way
      await sleep(10);
    }
    return false;
  }

  // ----- the page -----
  get path() {
    return new URL(this.url, 'http://x').pathname;
  }
  /** Opens (or reloads) the page: its HTML, what it loads, its comments, then its live stream. */
  async open() {
    this.opening = true;
    try {
      await this.navigate();
    } finally {
      this.opening = false;
    }
  }
  async navigate() {
    this.gen++;
    this.loadFrom = Date.now();
    this.touchedAt = Date.now();
    clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.heard = 0; // live messages since this page load: the first one only sets where the page stands
    this.stream?.close();
    this.stream = null;
    this.commentsRev = null;
    this.hotAt = null;
    this.S = { comments: [], loaded: false, isAdmin: false, rev: null };
    this.waiting = false;
    let r = null;
    // A lab that is starting again answers in a moment: the person would press reload; here it is tried for 3 s.
    for (let n = 0; !r; n++) {
      try {
        r = await this.ask({ path: this.url, headers: { accept: 'text/html' }, page: true });
      } catch (e) {
        if (n >= 12 || this.closed) {
          this.dead = true;
          this.status = 0;
          return void this.note('open failed', e.code || e.message);
        }
        await sleep(250);
      }
    }
    this.status = r.status;
    this.html = r.text;
    this.res = new Map();
    const tag = /<script\b[^>]*\bsrc="\/_lab\/comments\.js"[^>]*>/.exec(r.text)?.[0];
    this.dead = !tag;
    if (!tag) return void this.note('open', this.url, r.status, 'no widget');
    this.attrs = { version: attr(tag, 'data-version'), hot: attr(tag, 'data-hot'), lab: attr(tag, 'data-lab'), widget: attr(tag, 'data-widget'), schema: attr(tag, 'data-schema'), page: attr(tag, 'data-page'), admin: attr(tag, 'data-admin') || '' };
    // fixed: the lab's hot count when this page was served (`data-hot`, "0" counts): a save since then is still caught
    // up. old: no such tag, the first live message sets where the page stands (so a save before it is never seen).
    this.hotAt = widgetFixed() && this.attrs.hot !== undefined && this.attrs.hot !== '' ? +this.attrs.hot : null;
    this.note('open', this.url, r.status, `files ${this.attrs.version}`, `lab ${this.attrs.lab}`);
    // What the page loads: stylesheets, scripts, pictures (its own, not the lab's).
    await Promise.all(this.uses().map((u) => this.fetchRes(u.path)));
    await this.load();
    if (!this.offline) this.connect();
  }
  /** What the page as shown loads from the lab's folder: [{ kind, path }]. */
  uses(html = this.html) {
    const out = [];
    const own = (v) => {
      try {
        const u = new URL(v.split('#')[0], `http://x${this.path}`);
        return u.host === 'x' && !u.pathname.startsWith('/_lab/') ? decodeURIComponent(u.pathname) : null;
      } catch {
        return null;
      }
    };
    for (const m of html.matchAll(/<(link|script|img)\b[^>]*>/gi)) {
      const kind = m[1].toLowerCase();
      if (kind === 'link' && !/\brel=["']?[^"'>]*stylesheet/i.test(m[0])) continue;
      const p = own(attr(m[0], kind === 'link' ? 'href' : 'src') || '');
      if (p) out.push({ kind: kind === 'link' ? 'css' : kind === 'script' ? 'js' : 'img', path: p });
    }
    return out;
  }
  // One file the page loads. A browser keeps a copy with its ETag and asks "changed?" on the next page load (a 304
  // keeps the copy); a hot swap asks under a new address (?lab-v=…), so `fresh` takes nothing from the copy. What a
  // stylesheet or a script pulls in itself (@import, import) is fetched with it.
  async fetchRes(p, fresh = false, seen = new Set()) {
    if (seen.has(p)) return;
    seen.add(p);
    const kept = fresh ? null : this.cache.get(p);
    try {
      const r = await this.ask({ path: p.split('/').map(encodeURIComponent).join('/') + (fresh ? `?lab-v=${Date.now().toString(36)}` : ''), headers: { 'accept-encoding': 'gzip', ...(kept ? { 'if-none-match': kept.etag } : {}) } });
      const text = r.status === 304 ? kept.text : r.status === 200 ? r.text : '';
      this.res.set(p, { status: r.status === 304 ? 200 : r.status, text });
      if (r.status === 200 && r.headers.etag) this.cache.set(p, { etag: r.headers.etag, text });
      this.note('got', p, r.status, text.length);
      const pulls = /\.css$/i.test(p) ? [...text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)] : /\.m?js$/i.test(p) ? [...text.matchAll(/\bimport\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+)["']/g)] : [];
      await Promise.all(pulls.map((m) => {
        try {
          const u = new URL(m[1], `http://x${p}`);
          return u.host === 'x' ? this.fetchRes(decodeURIComponent(u.pathname), false, seen) : null; // by its own address: the browser asks "changed?"
        } catch {
          return null;
        }
      }));
    } catch (e) {
      if (e.code !== 'RELOADED') this.res.set(p, { status: 0, text: '' });
    }
  }
  connect() {
    if (this.stream && !this.stream.ended) return;
    const tab = `${this.id}-${++this.tabN}`;
    const gen = this.gen;
    // A held device hears each live message late too, in the order they were said (one connection never reorders).
    let due = 0;
    const hear = (v) => gen === this.gen && !this.offline && this.onState(v);
    const late = (v) => {
      due = Math.max(due, Date.now() + this.jitter());
      setTimeout(hear, Math.max(1, due - Date.now()), v); // never below 1: Node warns on a negative time
    };
    this.stream = openLive(this.lab, { from: this.from, tab, cookie: this.cookie, onState: this.jitter ? late : hear, onEnd: () => {
      // A stream that drops (the lab went away, the wifi blinked) is opened again, as EventSource does.
      if (gen !== this.gen || this.offline || this.closed) return;
      setTimeout(() => gen === this.gen && !this.offline && !this.closed && ((this.stream = null), this.connect()), 150);
    } });
    this.stream.tab = tab;
  }
  /** The device loses its connection (sleep, a tunnel, the wifi off): it hears nothing until online(). */
  goOffline() {
    this.offline = true;
    this.stream?.close();
    this.stream = null;
  }
  online() {
    this.offline = false;
    if (!this.dead) this.connect();
  }
  /** The tab is closed: it says bye, as the widget does on pagehide. */
  async close() {
    this.closed = true;
    clearTimeout(this.reloadTimer);
    this.gen++;
    const tab = this.stream?.tab;
    this.stream?.close();
    if (tab) await rq(this.lab, { from: this.from, cookie: this.cookie, method: 'POST', path: '/_lab/bye', body: { tab }, timeout: 1500 }).catch(() => {});
  }

  // src/widget/live.ts onState, the parts that fetch.
  onState(v) {
    if (!this.heard++) this.loads.push([this.loadFrom, Date.now()]); // from the page's request to its first live message
    this.note('state', `files ${v.files}`, `hot ${v.hot}`, `comments ${v.comments}`, v.changed ? `changed ${JSON.stringify(v.changed).slice(0, 80)}` : '', v.hotFiles ? `hotFiles ${v.hotFiles.length}: ${v.hotFiles.slice(0, 3).map((f) => f.path).join(' ')}` : '');
    if (v.lab && this.attrs.lab && v.lab !== this.attrs.lab) {
      this.note('lab restarted', v.lab);
      this.attrs.lab = v.lab;
      this.attrs.version = String(v.files);
      this.commentsRev = v.comments;
      if (widgetFixed()) {
        this.hotAt = v.hot || 0;
        this.catchUp(); // fixed: files saved while it was down are not in any list
      } else {
        this.hotAt = v.hot;
        this.go(() => this.morphPage());
      }
      this.go(() => this.load());
    }
    if (String(v.files) !== this.attrs.version) {
      if (Array.isArray(v.changed) && v.changed.length && !v.changed.some((p) => this.usedHere(p))) this.attrs.version = String(v.files);
      else this.reload(`files ${v.files}`);
    }
    if (widgetFixed()) {
      const hot = v.hot || 0; // fixed: `|| 0` everywhere, never NaN
      if (this.hotAt !== null && hot !== this.hotAt) {
        if (hot - this.hotAt > 1) this.catchUp();
        else this.hotUpdate(v.hotFiles || []);
      }
      this.hotAt = hot;
      this.commentsRev ??= this.S.rev ?? null; // fixed: the list's own version: what was written since it was read is fetched below
    } else {
      if (this.hotAt !== null && v.hot !== this.hotAt) {
        if (v.hot - this.hotAt > 1) this.hotUpdate([{ kind: 'html' }, { kind: 'css', path: '' }]);
        else this.hotUpdate(v.hotFiles || []);
      }
      this.hotAt = v.hot;
    }
    const elsewhere = v.comments === this.commentsRev + 1 && Array.isArray(v.commentPages) && !v.commentPages.includes(this.attrs.page);
    if (this.commentsRev !== null && v.comments !== this.commentsRev && !elsewhere) {
      const since = this.commentsRev;
      this.go(() => this.loadChanges(since));
    }
    this.commentsRev = v.comments;
    this.state = v;
  }
  usedHere(p) {
    if (tidy(this.path) === tidy(p) || FETCHED.test(p)) return true;
    if (this.uses().some((u) => (u.kind === 'css' || u.kind === 'js') && u.path === p)) return true;
    // fixed: anything else the page fetched while it ran (the widget reads the browser's resource entries): what a
    // script imports, what a stylesheet @imports, what a script added. The device has fetched exactly those, with
    // each file it loaded, in `res` (never emptied until the page loads again, as the entries are not).
    return widgetFixed() && this.res.has(p);
  }
  // A reload waits while something is open (a draft, a thread) and for 1.5 s after the last touch, which a page's
  // first 1.5 s count as (live.ts busy(): touchedAt starts at 0); it is looked at again every 500 ms.
  reload(why) {
    if (this.held || Date.now() - this.touchedAt < 1500) {
      this.waiting = true;
      const gen = this.gen;
      this.reloadTimer ||= setTimeout(() => {
        this.reloadTimer = null;
        if (gen === this.gen && this.waiting && !this.closed) this.reload(why);
      }, 500);
      return;
    }
    if (this.opening) return; // one navigation, however many times it is asked for
    this.reloads++;
    this.note('reload', why);
    this.go(async () => {
      if (widgetFixed()) {
        // fixed (live.ts now): the page is asked for first. With its dev server down the lab answers a plain 502, with its file
        // gone its page list (200, for a folder) or "not found": none has a widget. The page stays where it is and asks again
        // in 2 s, instead of reloading onto that.
        this.opening = true;
        const r = await this.ask({ path: this.url, headers: { accept: 'text/html' }, page: true }).catch(() => null);
        if (!r || r.status >= 400 || !/<script\b[^>]*\bdata-live\b/i.test(r.text)) {
          this.opening = false;
          this.waiting = true;
          const gen = this.gen;
          this.reloadTimer ||= setTimeout(() => {
            this.reloadTimer = null;
            if (gen === this.gen && this.waiting && !this.closed) this.reload(why);
          }, 2000);
          return;
        }
      }
      await this.open();
    });
  }
  /** A draft is opened (true), or sent or closed (false): a reload that waited happens once the page is left alone. */
  hold(on) {
    this.held = on;
    this.touchedAt = Date.now();
  }
  hotUpdate(files) {
    const of = (kind) => files.filter((f) => f.kind === kind).map((f) => f.path);
    const low = (t) => (widgetFixed() ? t.toLowerCase() : t); // fixed: the page's path is compared without letter case
    const here = low(decodeURIComponent(this.path).replace(/\/$/, '/index').replace(/\.html?$/i, ''));
    if (of('html').some((p) => !p || low(p.replace(/\.html?$/i, '')) === here)) this.go(() => this.morphPage());
    if (of('css').length) this.swapCss(of('css'));
    if (of('img').length && !this.swapImages(of('img'))) this.swapCss([]);
  }
  /** Every element that shows one of these pictures (all pictures with no paths) gets the file again; how many it swapped. */
  swapImages(paths) {
    const hit = this.uses().filter((u) => u.kind === 'img' && (!paths || paths.includes(u.path)));
    for (const u of hit) this.go(() => this.fetchRes(u.path, true));
    return hit.length;
  }
  /** fixed: away for a while (a lab that restarted, saves missed): the page, every stylesheet and every picture again. */
  catchUp() {
    this.go(() => this.morphPage());
    this.swapCss([]);
    this.swapImages(null);
  }
  swapCss(files) {
    const links = this.uses().filter((u) => u.kind === 'css');
    const named = links.filter((l) => files.includes(l.path));
    // a saved file no link names is pulled in by @import: every sheet is swapped then (src/widget/live.ts swapCss)
    for (const l of named.length && (!widgetFixed() || files.every((f) => named.some((n) => n.path === f))) ? named : links) this.go(() => this.fetchRes(l.path, true));
  }
  async morphPage() {
    const ownScripts = () => this.uses().some((u) => u.kind === 'js') || /<script\b(?![^>]*\/_lab\/)(?![^>]*data-lab)[^>]*>/i.test(this.html);
    const fixed = widgetFixed();
    if (!fixed && ownScripts()) return this.reload('morph: page has scripts'); // old: before it even looks at the file
    const run = (this.morphRun = (this.morphRun || 0) + 1);
    let r;
    try {
      r = await this.ask({ path: this.url, headers: { accept: 'text/html' } });
    } catch (e) {
      if (e.code === 'RELOADED') return;
      return this.reload('morph: fetch failed');
    }
    if (!fixed && r.status !== 200) return this.reload(`morph: ${r.status}`);
    if (run !== this.morphRun) return;
    // fixed: the file is gone for now (a build that clears its folder): the lab answers with its own screen, which has
    // no widget. This page stays, and follows the file when the next 'html changed' comes.
    if (fixed && (r.status !== 200 || !/<script\b[^>]*\bdata-live\b/i.test(r.text))) return void this.note('morph: stays', r.status);
    if (fixed && ownScripts()) return this.reload('morph: page has scripts');
    const list = (html, kind) => this.uses(html).filter((u) => u.kind === kind).map((u) => u.path).join('\n');
    if (list(r.text, 'js') !== list(this.html, 'js') || list(r.text, 'css') !== list(this.html, 'css') || /<script\b(?![^>]*\/_lab\/)(?![^>]*data-lab)[^>]*>/i.test(r.text)) return this.reload('morph: scripts or stylesheets changed');
    // Patched in place: the page's own content is the new file's; a picture it didn't have is fetched.
    const had = new Set(this.uses().map((u) => u.path));
    this.html = r.text;
    this.morphs++;
    this.note('morph');
    for (const u of this.uses()) if (!had.has(u.path)) this.go(() => this.fetchRes(u.path));
  }

  // ----- the comments, as the widget holds them (src/comments.js) -----
  headers() {
    return this.attrs.admin ? { 'x-lab-admin': this.attrs.admin } : {};
  }
  async load() {
    try {
      const r = await this.ask({ path: `/_lab/api/comments?page=${encodeURIComponent(this.attrs.page)}`, headers: this.headers() });
      if (r.status !== 200) throw new Error(String(r.status));
      const data = r.json();
      this.S.comments = data.comments || [];
      // fixed: the lab's comments version this list is as of (x-lab-rev); none from an older lab
      if (widgetFixed()) this.S.rev = r.headers['x-lab-rev'] !== undefined ? Number(r.headers['x-lab-rev']) : null;
      this.S.isAdmin = Boolean(data.admin);
      this.S.loaded = true;
      this.note('load', this.S.comments.length);
    } catch (e) {
      this.note('load failed', e.message); // keeps what is already on screen
    }
  }
  loadChanges(since) {
    if (!SERIAL_CHANGES) return this.changesSince(since);
    return (this.changesChain = (this.changesChain || Promise.resolve()).then(() => this.changesSince(since)));
  }
  async changesSince(since) {
    try {
      this.asked = [...(this.asked || []).slice(-5), since]; // the versions it last asked the changes since
      const r = await this.ask({ path: `/_lab/api/changes?${new URLSearchParams({ page: this.attrs.page, since: String(since) })}` });
      const data = r.status === 200 ? r.json() : { full: true };
      if (data.full || !this.S.loaded) return this.load();
      const gone = new Set(data.del);
      const fresh = new Map(data.set.map((c) => [c.id, c]));
      this.S.comments = this.S.comments.filter((c) => !gone.has(c.id)).map((c) => fresh.get(c.id) || c);
      const had = new Set(this.S.comments.map((c) => c.id));
      for (const c of data.set) if (!had.has(c.id)) this.S.comments.push(c);
      this.S.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this.note('delta', since, `to ${data.rev}`, `+${data.set.map((c) => c.id.slice(0, 6)).join(',')} -${data.del.length}`);
    } catch (e) {
      if (e.code === 'RELOADED') return;
      return this.load();
    }
  }
  // send(): a new comment or reply carries a nonce and is sent again while the lab can't be reached (the widget tries
  // every 2 s, 150 times; here every 250 ms, for `tries`).
  async send(payload, tries = 24) {
    if (!payload.action && !payload.nonce) payload = { ...payload, nonce: `${this.id}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.replace(/[^\w-]/g, '').slice(0, 40) };
    let r = null;
    const gen = this.gen;
    for (let n = 0; !r; n++) {
      try {
        r = await this.ask({ method: 'POST', path: '/_lab/api/comments', headers: this.headers(), body: { page: this.attrs.page, ...payload }, page: true });
      } catch (e) {
        if (n >= tries) throw Object.assign(new Error("couldn't reach the lab"), { status: 0 });
        await sleep(250);
      }
    }
    let data = {};
    try {
      data = r.json();
    } catch {}
    if (r.status >= 300) throw Object.assign(new Error(data.error || `could not save (${r.status})`), { status: r.status });
    // The page reloaded while this was on its way: the lab has it, the page that sent it is gone and never sees the answer.
    return { ...data, stale: gen !== this.gen };
  }
  find(id) {
    return this.S.comments.find((c) => c.id === id);
  }
  /** The sender's own answer goes in once: the fixed widget skips an id it already holds (torture bug 12, addComment in
   *  comments.js). The old one pushed blindly. Default follows TORTURE_WIDGET; TORTURE_OWN_PUSH_DEDUPE=0/1 overrides. */
  addOwn(comment) {
    const dedupe = process.env.TORTURE_OWN_PUSH_DEDUPE !== undefined ? process.env.TORTURE_OWN_PUSH_DEDUPE !== '0' : widgetFixed();
    if (dedupe && this.find(comment.id)) return;
    this.S.comments.push(comment);
  }
  /** A new pin (composer onSubmit). */
  async pin(text, anchor, nonce) {
    const { comment, edit, stale } = await this.send({ name: this.name, text, anchor, ...(nonce ? { nonce } : {}) });
    if (edit) this.edits.set(comment.id, edit);
    if (!stale) this.addOwn(comment);
    return comment;
  }
  /** A reply in a thread this device shows (thread.ts onSubmit). */
  async reply(c, text, nonce) {
    const { comment, stale } = await this.send({ name: this.name, text, parent: c.id, ...(nonce ? { nonce } : {}) });
    if (!stale) this.addOwn(comment);
    if (c.resolved) c.resolved = false;
    return comment;
  }
  async toggleResolved(c) {
    const edit = this.edits.get(c.id);
    const { comment } = await this.send({ action: c.resolved ? 'reopen' : 'resolve', id: c.id, ...(edit ? { edit } : {}) });
    Object.assign(c, comment);
    return comment;
  }
  async move(c, anchor) {
    const before = c.anchor;
    c.anchor = anchor;
    try {
      const { comment } = await this.send({ action: 'move', id: c.id, anchor, edit: this.edits.get(c.id) || undefined });
      Object.assign(c, comment);
      return comment;
    } catch (e) {
      c.anchor = before;
      throw e;
    }
  }
  async remove(c) {
    const edit = this.edits.get(c.id);
    const { stale } = await this.send({ action: 'delete', id: c.id, ...(edit && !this.S.isAdmin ? { edit } : {}) });
    if (!stale) this.S.comments = this.S.comments.filter((x) => x.id !== c.id && x.parent !== c.id);
  }
}

// ---------- small helpers for the areas ----------
/** Waits until ok() is true: true when it was within `ms`. */
export async function until(ok, ms = 3000, step = 25) {
  for (const end = Date.now() + ms; ; await sleep(step)) {
    if (await ok()) return true;
    if (Date.now() >= end) return false;
  }
}
/** A file written through a temp file and a rename, as the lab itself and many editors save. */
export const writeAtomicly = (file, text) => {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
};
/** The lab's file name for a page's comments (local.mjs storeName; a key under 180 bytes). */
export const storeName = (page) => ([...Buffer.from(page.replace(/^\//, ''))].map((b) => (/[a-z0-9-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `_${b.toString(16).padStart(2, '0')}`)).join('') || '_') + '.json';
/** What differs between two lists of comments, by id: { missing (in a, not b), extra, changed: [[id, field]] }. */
export function diffComments(want, got, fields = null) {
  const a = new Map(want.map((c) => [c.id, c]));
  const b = new Map(got.map((c) => [c.id, c]));
  const changed = [];
  for (const [id, c] of a) {
    const d = b.get(id);
    if (!d) continue;
    for (const k of fields || new Set([...Object.keys(c), ...Object.keys(d)])) if (JSON.stringify(c[k]) !== JSON.stringify(d[k])) changed.push([id, k]);
  }
  return { missing: [...a.keys()].filter((id) => !b.has(id)), extra: [...b.keys()].filter((id) => !a.has(id)), changed };
}
/** [50th, 99th, highest] of some numbers, for the report's "how long did it take" lines. */
export const spread = (ns) => {
  const s = [...ns].sort((a, b) => a - b);
  return s.length ? [s[Math.floor(s.length * 0.5)], s[Math.floor(s.length * 0.99)], s[s.length - 1]] : [0, 0, 0];
};
