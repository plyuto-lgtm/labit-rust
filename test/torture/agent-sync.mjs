// Area 3, SYNC WITH AGENTS: a laptop and a phone (and sometimes a third device) hold the same lab open while one to
// three agent sessions wait, get pins, answer, note progress, resolve, pin, get killed and come back, and the lab is
// restarted in between. Afterwards every observer must hold the same thing: each device's own list (kept up by the
// widget's rules, lib.mjs Device), the lab's answer to a fresh ask, the files in .lab, the agent's text, and what the
// waits were handed.
//
// The oracle is this file's own model: what was said yes to (each comment's id from its 2xx answer, who wrote it, its
// thread, whether the thread should be open), built from the steps and the documented rules, never from the lab's
// bookkeeping. Where the rules don't say (two things at one moment on one thread), the model holds "unknown" and that
// check is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { Lab, Device, rq, agentRq, runCli, sleep, until, oddText, PEOPLE, diffComments, LAN } from './lib.mjs';

export const name = 'agent-sync';
const PAGES = ['/index', '/other'];
const AGENT_WORDS = /amp|codex|cursor|gemini|opencode|copilot|claude|\bagy\b|antigravity/i; // lib/agents.ts agentKind: a name holding one reads as an agent's

// ---------- the plan ----------
export function plan(rng, opts) {
  const roll = rng.float();
  const engine = rng.pick(['chromium', 'webkit']);
  const browser = opts.browser && roll < opts.browserShare ? engine : null;
  const kind = rng.weighted([[45, 'mixed'], [20, 'restart'], [20, 'kills'], [15, 'offline']]);
  const names = rng.shuffle(PEOPLE);
  const devices = [
    { kind: 'laptop', page: '/index', name: names[0] },
    { kind: 'phone', page: rng.bool(0.75) ? '/index' : '/other', name: names[1] },
    ...(rng.bool(0.4) ? [{ kind: rng.pick(['laptop', 'phone']), page: rng.pick(PAGES), name: rng.bool(0.5) ? names[0] : names[2] }] : []),
  ];
  const jitter = rng.bool(0.25) ? rng.pick([15, 40, 80]) : 0; // a phone on a slow wifi: each answer and live message reaches it up to this many ms late
  const sessions = Array.from({ length: rng.weighted([[5, 1], [4, 2], [2, 3]]) }, (_, i) => ({ id: `sess-${'abc'[i]}`, name: `s${'ABC'[i]}`, pages: i > 0 && rng.bool(0.6) ? ['/other'] : null, cli: rng.bool(0.35) }));
  const ops = [];
  let r = 0;
  const threads = []; // { op, d, page, gone, busy: the round it was last touched alone }
  // Steps of one round go at the same moment. A thread takes several plain replies in a round, or one step of any
  // other kind alone: only what gives the same end whatever the order. A restart and a pause are rounds of their own.
  let solo = false;
  const push = (op, same) => {
    const joins = Boolean(same && r && !solo);
    ops.push({ ...op, r: joins ? r : ++r, delay: joins ? rng.int(30) : 0 });
    solo = op.t === 'restart' || op.t === 'wait';
  };
  const mark = (t, plain) => Object.assign(t, { round: r, plain });
  sessions.forEach((s, i) => push({ t: 'listen', s: i }, i > 0));
  const steps = rng.between(5, 16);
  const off = new Set();
  for (let k = 0; k < steps; k++) {
    const d = rng.int(devices.length);
    const s = rng.int(sessions.length);
    const what = rng.weighted([
      [20, 'pin'], [16, 'reply'], [14, 'areply'], [6, 'resolve'], [4, 'move'], [4, 'delete'], [5, 'progress'], [4, 'aresolve'], [3, 'apin'], [3, 'retry'], [6, 'wait'],
      [kind === 'kills' ? 14 : 2, 'unlisten'], [kind === 'kills' ? 8 : 1, 'killreply'], [kind === 'kills' ? 6 : 1, 'dropnext'], [6, 'listen'],
      [kind === 'restart' ? 12 : 0, 'restart'], [kind === 'offline' ? 14 : 2, 'offline'], [kind === 'offline' ? 6 : 1, 'reload'],
    ]);
    if (what === 'pin' || !threads.some((t) => !t.gone)) {
      const same = rng.bool(0.4);
      push({ t: 'pin', d, as: rng.weighted([[6, 'spot'], [2, 'page'], [1, 'draw'], [1, 'action']]), text: oddText(rng, `m${ops.length}`) }, same);
      threads.push({ op: ops.length - 1, d, page: devices[d].page, round: r, plain: false });
      continue;
    }
    if (['reply', 'areply', 'resolve', 'move', 'delete', 'progress', 'aresolve', 'killreply', 'retry'].includes(what)) {
      // A device acts on the threads of the page it shows; an agent on any.
      const onPage = ['reply', 'resolve', 'move', 'delete', 'retry'].includes(what) ? threads.filter((t) => !t.gone && t.page === devices[d].page) : threads.filter((t) => !t.gone);
      if (!onPage.length) continue;
      const t = rng.pick(onPage);
      const plain = what === 'reply' || (what === 'areply');
      const intent = what === 'areply' ? rng.weighted([[5, null], [4, 'done'], [2, 'working'], [2, 'question']]) : null;
      const reallyPlain = plain && intent !== 'done';
      const same = t.round === r ? reallyPlain && t.plain && rng.bool(0.7) : rng.bool(0.35); // its round is taken by something else: this one goes after
      const base = { to: t.op, text: oddText(rng, `m${ops.length}`) };
      if (what === 'reply') push({ t: 'reply', d, ...base }, same);
      else if (what === 'retry') push({ t: 'retry', d, ...base }, same);
      else if (what === 'areply') push({ t: 'areply', s, ...base, intent, cli: rng.bool(0.35), andResolve: intent === null && rng.bool(0.15) }, same);
      else if (what === 'killreply') push({ t: 'killreply', s, ...base, after: rng.pick([0, 20, 60, 110, 160]) }, same);
      else if (what === 'progress') push({ t: 'progress', s, to: t.op, text: `on it ${ops.length}`, cli: rng.bool(0.35) }, same);
      else if (what === 'aresolve') push({ t: 'aresolve', s, to: t.op, cli: rng.bool(0.35) }, same);
      else push({ t: what, d, to: t.op }, same);
      mark(t, reallyPlain && (what === 'reply' || what === 'areply'));
      if (what === 'delete' && devices[d].kind === 'laptop') t.gone = true; // the laptop may delete any; a phone mostly may not
      continue;
    }
    if (what === 'apin') {
      push({ t: 'apin', s, page: rng.pick(PAGES), text: `agent point ${ops.length}` }, rng.bool(0.3));
      threads.push({ op: ops.length - 1, d: -1, page: ops[ops.length - 1].page, round: r, plain: false });
    } else if (what === 'wait') push({ t: 'wait', ms: rng.pick([40, 150, 300, 700, 1400]) });
    else if (what === 'listen' || what === 'unlisten' || what === 'dropnext') push({ t: what, s }, rng.bool(0.3));
    else if (what === 'restart') push({ t: 'restart', sig: rng.pick(['SIGTERM', 'SIGTERM', 'SIGKILL']) });
    else if (what === 'offline') {
      if (off.has(d)) (off.delete(d), push({ t: 'online', d }));
      else (off.add(d), push({ t: 'offline', d }));
    } else if (what === 'reload') push({ t: 'reload', d }, rng.bool(0.3));
  }
  return { kind, browser, devices, sessions, jitter, ops };
}
export const planLine = (p) => `devices: ${p.devices.map((d, i) => `d${i} ${d.kind} "${d.name}" on ${d.page}`).join(', ')}${p.jitter ? `; phone answers held up to ${p.jitter} ms` : ''}; sessions: ${p.sessions.map((s) => `${s.name}${s.pages ? ` (wait --pages ${s.pages})` : ''}${s.cli ? ' [labit wait]' : ''}`).join(', ')}`;
export const describe = (op) => {
  if (!op) return '(left out)';
  const at = op.delay ? ` +${op.delay}ms` : '';
  const say = op.text ? ` ${JSON.stringify(op.text.slice(0, 28))}` : '';
  return op.t === 'pin' ? `d${op.d} pins (${op.as})${say}${at}`
    : op.t === 'reply' ? `d${op.d} replies in the thread of step ${op.to}${say}${at}`
    : op.t === 'retry' ? `d${op.d} sends one reply twice (same nonce) in the thread of step ${op.to}${at}`
    : op.t === 'resolve' ? `d${op.d} resolves or reopens the thread of step ${op.to}${at}`
    : op.t === 'move' ? `d${op.d} moves the pin of step ${op.to}${at}`
    : op.t === 'delete' ? `d${op.d} deletes the thread of step ${op.to}${at}`
    : op.t === 'areply' ? `session ${op.s} ${op.cli ? 'labit reply' : 'answers'} step ${op.to}${op.intent ? ` --${op.intent}` : ''}${op.andResolve ? ' --resolve' : ''}${at}`
    : op.t === 'killreply' ? `session ${op.s} labit reply on step ${op.to}, killed after ${op.after} ms${at}`
    : op.t === 'progress' ? `session ${op.s} ${op.cli ? 'labit reply --progress' : 'notes progress'} on step ${op.to}${at}`
    : op.t === 'aresolve' ? `session ${op.s} ${op.cli ? 'labit resolve' : 'resolves'} step ${op.to}${at}`
    : op.t === 'apin' ? `session ${op.s} labit pin on ${op.page}${at}`
    : op.t === 'listen' ? `session ${op.s} listens${at}`
    : op.t === 'unlisten' ? `session ${op.s}'s wait is killed${at}`
    : op.t === 'dropnext' ? `session ${op.s} will die holding its next hand-off (no ack)${at}`
    : op.t === 'restart' ? `the lab restarts (${op.sig})`
    : op.t === 'wait' ? `wait ${op.ms} ms`
    : `d${op.d} ${op.t}${at}`;
};

const ANCHORS = {
  spot: () => ({ selector: '#p1', x: 0.2, y: 0.5, docX: 0.2, docY: 120, width: 1000, element: '<p id="p1">', text: 'A paragraph' }),
  page: () => ({ kind: 'page', width: 390, height: 800 }),
  draw: () => ({ selector: '#t', x: 0.1, y: 0.1, zw: 0.4, zh: 0.5, docW: 300, docH: 80, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">', ink: { mark: 'circled', pts: [[0, 0, 500, 500, 1000, 0]] } }),
  action: () => ({ selector: '#t', x: 0.5, y: 0.5, docX: 0.5, docY: 20, width: 1000, element: '<h1 id="t">', act: 'Fix this: it is broken or wrong.' }),
};
// What a wait printed: the ids on its own lines (a comment's words can't start one: they follow "comment: " or "  | ").
const idsIn = (text, lines = null) => {
  const ids = new Set();
  for (const line of text.split('\n')) {
    const m = /^## \d+\. .* · id ([0-9a-f]{12})$/.exec(line) || /^reply: .*? · id ([0-9a-f]{12}): /.exec(line) || /^- .*? · id ([0-9a-f]{12}): /.exec(line);
    if (m) (ids.add(m[1]), lines?.set(m[1], line));
  }
  return ids;
};
const countsIn = (text) => {
  const line = /^In this message: (.*?)\. Read all of it/m.exec(text)?.[1] || '';
  const n = (re) => Number(re.exec(line)?.[1] || 0);
  return { fresh: n(/(\d+) new/) + n(/(\d+) repl/), waiting: n(/(\d+) still waiting/) };
};

// ---------- one case ----------
export async function run(plan, ctx, opts) {
  const ACK_MS = 1200;
  const BOUND = 5000 * opts.slow; // how long the devices may take to hold what the lab holds: ~50 ms is usual
  for (const p of PAGES) fs.writeFileSync(path.join(ctx.dir, `${p.slice(1)}.html`), `<!doctype html><html><head><meta charset="utf-8"><title>${p}</title></head><body><h1 id="t">Page ${p}</h1><p id="p1">A paragraph to pin on.</p></body></html>`);
  const wifi = Boolean(LAN) && plan.devices.some((d) => d.kind === 'phone');
  // Pins go to a wait after 120 ms of quiet (2 s in a real lab); a hand-off nobody confirms is taken back after 1.2 s
  // (20 s); the "not answered" and "still waiting" timers (2 and 3 minutes) are out of a case's reach.
  const lab = new Lab(ctx, { flags: ['--new', ...(wifi ? ['--wifi'] : [])], env: { LAB_SETTLE_MS: '120', LAB_ACK_MS: String(ACK_MS), LAB_ANSWER_MS: '600000', LAB_REMIND_MS: '600000' } });
  if (!(await lab.start()).ok) return ctx.add('harness', 'lab-did-not-start', lab.log.slice(-400));
  const sessOf = (s) => ({ id: s.id, name: s.name, agent: 'Claude', kind: 'claude' });
  const cliEnv = (s) => ({ CLAUDE_CODE_SESSION_ID: s.id, LABIT_BACKGROUND: '1' });
  const signed = (s) => `Claude · ${s.name}`;

  // ----- devices: this computer's browser, and phones let in with a one-time link -----
  const devices = [];
  for (const [i, spec] of plan.devices.entries()) {
    const phone = spec.kind === 'phone' && wifi;
    let cookie = '';
    if (phone) {
      const inv = await agentRq(lab, sessOf(plan.sessions[0]), '/_lab/invite', { name: spec.name });
      const link = inv.status === 200 ? inv.json().links.find((l) => l.includes(`//${LAN}:`)) : null;
      const got = link && (await rq(lab, { from: 'lan', path: new URL(link).pathname + new URL(link).search }));
      cookie = (got?.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      if (!cookie) return ctx.add('harness', 'phone-not-let-in', `invite ${inv.status} ${inv.text.slice(0, 200)}; link ${got?.status}`);
    }
    const delay = phone && plan.jitter ? () => Math.floor(Math.random() * plan.jitter) : null;
    devices.push(Object.assign(new Device(lab, { id: `d${i}`, kind: phone ? 'phone' : 'laptop', name: spec.name, url: `${spec.page}.html`, cookie, jitter: delay }), { spec, off: false }));
  }
  ctx.onEnd(() => Promise.all(devices.map((d) => d.close())));
  await Promise.all(devices.map((d) => d.open()));
  if (devices.some((d) => d.dead)) return ctx.add('harness', 'device-did-not-open', devices.map((d) => `${d.id} ${d.status}`).join(' '));
  // The pages have been open a moment when the steps begin: each has heard its live stream's first message. (What
  // lands while a page is still loading is tried by the reload steps, and named so in the signature.)
  if (!(await until(() => devices.every((d) => d.heard > 0), 4000, 10))) return ctx.add('harness', 'device-heard-nothing', devices.map((d) => `${d.id} ${d.heard}`).join(' '));

  // A real browser beside them, in the cases that ask for one: this computer's (Chromium) or a phone's (WebKit as an
  // iPhone, let in over the wifi address with its own one-time link). It only watches /index.
  let real = null;
  if (plan.browser) {
    let taken;
    try {
      taken = await opts.browser.take(plan.browser);
    } catch (e) {
      return ctx.add('harness', 'browser-did-not-start', `${plan.browser}: ${e.message}`);
    }
    const phone = plan.browser === 'webkit' && wifi;
    const bctx = await taken.browser.newContext(phone ? { ...taken.devices['iPhone 13'] } : { viewport: { width: 1000, height: 700 } });
    const page = await bctx.newPage();
    ctx.onEnd(async () => {
      await page.goto('about:blank').catch(() => {});
      await bctx.close().catch(() => {});
      taken.release();
    });
    await bctx.addInitScript(() => {
      try {
        localStorage.setItem('lab-name', 'Watcher');
        localStorage.setItem('lab-on', '1');
      } catch {}
    });
    let url = `${lab.base}/index.html`;
    if (phone) {
      const inv = await agentRq(lab, sessOf(plan.sessions[0]), '/_lab/invite', { name: 'Watcher', page: 'index.html' });
      url = inv.status === 200 ? inv.json().links.find((l) => l.includes(`//${LAN}:`)) : null;
      if (!url) return ctx.add('harness', 'phone-not-let-in', `invite for the browser: ${inv.status}`);
    }
    await page.goto(url, { waitUntil: 'load' }).catch(() => {});
    await sleep(500);
    real = { page, as: phone ? 'phone' : 'laptop' };
  }

  // ----- the model -----
  const M = new Map(); // id -> { id, op, page, parent, agent, text, name, gone, by (device or session index) }
  const T = new Map(); // thread id -> { resolved: true | false | null (unknown), progress: true | false | null, chat }
  const byOp = new Map(); // a step's index -> the thread it made
  const unsure = new Set(); // texts of answers that may or may not have landed (a killed command, a restart under it)
  let restarts = 0;
  let lastSig = '';
  let labDown = false;
  let upAt = 0;
  let kills = 0;
  let moved = false;
  let lastKill = 0;
  const loud = (check, detail, tags) => (ctx.note(`LOUD ${check}: ${detail}`), ctx.add('loud', check, detail, tags));
  const add = (c, op, page, agent, by) => {
    M.set(c.id, { id: c.id, op, page, parent: c.parent || null, agent, text: c.text, name: c.name, gone: false, by, at: Date.now() });
    if (!c.parent) T.set(c.id, { resolved: false, progress: false, chat: c.anchor?.kind === 'page', said: 0, at: Date.now() });
  };
  const said = (root, agent, intent) => {
    const t = T.get(root);
    if (!t) return;
    t.said++;
    if (t.progress !== false) t.progress = false; // any message ends the status line
    if (!agent) t.resolved = false; // a person writing reopens
    else if (intent === 'done' && !t.chat) t.resolved = true; // --done closes it (a page chat stays open)
  };
  const drop = (root) => {
    for (const m of M.values()) if (m.id === root || m.parent === root) m.gone = true;
  };

  // ----- the agent's sessions: their waits and what they were handed -----
  const S = plan.sessions.map((s) => ({ ...s, wanted: false, open: null, dropNext: false, ended: [] }));
  const handed = []; // { s, text, ids, fresh, acked }
  const took = (s, text, acked) => {
    const lines = new Map();
    const ids = idsIn(text, lines);
    handed.push({ s: s.name, text, ids, lines, acked, at: Date.now(), ...countsIn(text) });
    ctx.note(`wait of ${s.name} got ${[...ids].join(' ')} (${acked === true ? 'confirmed' : acked ? 'killed after printing it' : 'NOT confirmed'})`);
  };
  let ending = false;
  const listen = (s) => {
    if (s.open || ending || !s.wanted) return;
    const mine = (s.open = { stop: () => {} });
    const again = (ok) => {
      if (s.open === mine) s.open = null;
      if (ok && s.wanted && !ending) setTimeout(() => listen(s), 5);
    };
    if (s.cli) {
      const run = runCli(ctx, lab, ['wait', '--bg', '--timeout', '40', '--name', s.name, ...(s.pages ? ['--pages', s.pages.join(',')] : [])], { env: cliEnv(s) });
      mine.stop = () => run.proc.kill('SIGKILL');
      run.then(({ code, killed, out }) => {
        // Killed after it printed a hand-off: the agent has seen it, and whether its ack went out nobody knows.
        if (killed) return /^In this message: /m.test(out) && took(s, out, 'maybe'), again(false);
        if (/^In this message: /m.test(out)) return took(s, out, true), again(true);
        s.ended.push(out.trim().slice(0, 120));
        // Started in the moment the lab was down: the command says so (as it should), and the agent runs it again.
        if (code !== 0 && /No lab server|isn't running/.test(out) && (labDown || Date.now() - upAt < 1500)) return void setTimeout(() => again(true), 250);
        if (code !== 0) loud('wait-failed', `labit wait of ${s.name} ended ${code}: ${out.trim().slice(0, 300)}`, { restart: restarts ? 1 : 0 });
        again(/No new comments yet/.test(out)); // told to stop (another session took the pages, the page was closed): it stops
      });
      return;
    }
    const abort = new AbortController();
    mine.stop = () => abort.abort();
    (async () => {
      let r;
      try {
        r = await agentRq(lab, sessOf(s), '/_lab/wait', { timeout: 40, pages: s.pages || undefined, ack: true }, { signal: abort.signal, timeout: 60000 });
      } catch {
        // The lab went away under it: the command waits a moment and asks again, as labit wait does.
        if (abort.signal.aborted) return again(false);
        await sleep(200);
        return again(true);
      }
      if (r.status === 200) {
        const dies = s.dropNext;
        s.dropNext = false;
        if (dies) {
          lastKill = Date.now();
          kills++;
          took(s, r.text, false);
          s.wanted = false; // it died with them in hand: no ack, no more waits until it is told to listen again
          return again(false);
        }
        took(s, r.text, true);
        await agentRq(lab, sessOf(s), '/_lab/ack', { id: r.headers['x-lab-delivery'] }).catch(() => {});
        return again(true);
      }
      s.ended.push(`${r.status} ${r.text.slice(0, 80)}`);
      if (![204, 409, 410, 423].includes(r.status)) loud('wait-failed', `the wait of ${s.name} answered ${r.status}: ${r.text.slice(0, 200)}`, { status: r.status });
      again(r.status === 204);
    })();
  };
  const unlisten = (s) => {
    s.wanted = false;
    if (s.open) {
      lastKill = Date.now();
      kills++;
      s.open.stop();
      s.open = null;
    }
  };
  ctx.onEnd(() => {
    ending = true;
    for (const s of S) s.open?.stop();
  });

  // ----- the steps -----
  // A device acts on a comment it shows: a person can't answer what their screen doesn't have yet.
  const shown = async (d, id) => {
    await until(() => d.find(id), 1500, 20);
    return d.find(id);
  };
  // What the lab should answer a person's step with, by who they are (local.mjs isOwner, #397): this computer's browser (the
  // key) and a device that holds a pass (the cookie of its one-time link) are the owner and may resolve, reopen, move and
  // delete any pin. A device without a pass would keep the old limits: only its own pin, with that pin's key. Every phone
  // here is let in with a link above, so it holds one (d.cookie); the old rule stays for a device that doesn't.
  const owner = (d) => d.kind === 'laptop' || Boolean(d.cookie);
  const mayChange = (d, root) => owner(d) || d.edits.has(root);
  const human = async (op, i, act, okWhen) => {
    try {
      const out = await act();
      if (okWhen() === false) ctx.add('silent', 'accepted-what-should-be-refused', `step ${i} (${describe(op)}) was taken though the rules refuse it`, { step: op.t, device: devices[op.d].kind });
      return out;
    } catch (e) {
      if (okWhen() === true) loud('step-refused', `step ${i} (${describe(op)}): ${e.message}`, { step: op.t, device: devices[op.d].kind, status: e.status || 0 });
      else ctx.note(`step ${i} refused as it should be: ${e.message}`);
      return null;
    }
  };
  // The agent's commands print one line and exit 0, or say why not and exit 1.
  // Any POST a session makes that the lab answers 2xx counts there as proof the session has what it was handed
  // (local.mjs: "An answer or a resolve from a session is proof it has what it was handed"), so a session that "died holding
  // its hand-off" and then acts again has confirmed it. The model follows that: hand-offs the session was given before the
  // request went out are confirmed; ones given while it was in flight may or may not have been ('maybe', which the checks
  // count as confirmed). A command killed part-way may or may not have got its request through: 'maybe' for all.
  const proof = (s, t0, ok) => {
    if (!ok) return;
    for (const h of handed) if (h.s === s.name && h.acked === false) h.acked = h.at <= t0 ? true : 'maybe';
  };
  const cli = async (s, args) => {
    const t0 = Date.now();
    const r = await runCli(ctx, lab, [args[0], '--name', s.name, ...args.slice(1)], { env: cliEnv(s) });
    proof(s, t0, r.code === 0);
    return r;
  };
  const agentPost = async (s, body) => {
    const t0 = Date.now();
    const r = await agentRq(lab, sessOf(s), '/_lab/api/comments', body);
    proof(s, t0, r.status >= 200 && r.status < 300);
    return r;
  };

  const step = async (op, i) => {
    if (op.delay) await sleep(op.delay);
    ctx.note(`${i}: ${describe(op)}`);
    const d = devices[op.d];
    const s = S[op.s];
    const root = op.to === undefined ? null : byOp.get(op.to);
    if (op.to !== undefined && !root) return void ctx.note(`   (its thread was never made: skipped)`);
    const page = root ? M.get(root)?.page : null;
    if (op.t === 'pin') {
      if (d.off) return;
      const c = await human(op, i, () => d.pin(op.text, ANCHORS[op.as]()), () => true);
      if (c) (add(c, i, d.attrs.page, false, op.d), byOp.set(i, c.id));
    } else if (op.t === 'reply' || op.t === 'retry') {
      if (d.off || page !== d.attrs.page) return;
      const c = await shown(d, root);
      if (!c) return void ctx.note('   (not on its screen: skipped)');
      const nonce = `n${ctx.seed}x${i}`.padEnd(10, '0');
      const exists = () => (M.get(root)?.gone ? false : true);
      const out = await human(op, i, () => d.reply(c, op.text, nonce), exists);
      if (!out) return;
      add(out, i, page, false, op.d);
      said(root, false);
      if (op.t === 'retry') {
        // The same words sent again with the same nonce (the page retries while the lab can't be reached): one comment.
        const again = await d.send({ name: d.name, text: op.text, parent: root, nonce }).catch((e) => ({ error: e.message }));
        if (again.comment?.id !== out.id) ctx.add('silent', 'retry-made-a-second-comment', `the same reply sent twice with one nonce came back as ${out.id} and ${again.comment?.id || again.error}`, {});
      }
    } else if (op.t === 'resolve') {
      if (d.off || page !== d.attrs.page) return;
      const c = await shown(d, root);
      if (!c) return;
      const was = c.resolved;
      const out = await human(op, i, () => d.toggleResolved(c), () => (M.get(root).gone ? false : mayChange(d, root)));
      if (out) Object.assign(T.get(root), { resolved: !was, progress: false }); // resolving and reopening both clear the status line (lib/comments-api.mjs: progress: undefined)
    } else if (op.t === 'move') {
      if (d.off || page !== d.attrs.page || T.get(root)?.chat) return;
      const c = await shown(d, root);
      if (!c) return;
      const out = await human(op, i, () => d.move(c, { ...ANCHORS.spot(), selector: '#t', x: 0.7, y: 0.3 }), () => (M.get(root).gone ? false : mayChange(d, root)));
      if (out) moved = true;
    } else if (op.t === 'delete') {
      if (d.off || page !== d.attrs.page) return;
      const c = await shown(d, root);
      if (!c) return;
      // The owner (this computer, or a device with a pass) may delete any pin; one without a pass only its own pin, fresh (15 s) and unanswered.
      const t = T.get(root);
      const own = owner(d) ? true : !d.edits.has(root) || t.said ? false : t.maybe || Date.now() - t.at > 12000 ? undefined : true;
      const out = await human(op, i, () => d.remove(c).then(() => true), () => (M.get(root).gone ? false : own));
      if (out) drop(root);
    } else if (op.t === 'areply') {
      const text = op.text.replace(/^\s+|\s+$/g, '');
      const intent = op.intent;
      if (op.cli) {
        // After a bare --: the words are words, whatever they start with.
        const r = await cli(s, ['reply', root, ...(intent ? [`--${intent === 'working' ? 'on-it' : intent}`] : []), ...(op.andResolve ? ['--resolve'] : []), '--', text]);
        if (r.code !== 0) return M.get(root).gone ? ctx.note(`   refused as it should be: ${r.out.trim()}`) : loud('agent-command-failed', `labit reply on ${root}: ${r.out.trim().slice(0, 300)}`, { step: 'reply', restart: restarts ? 1 : 0 });
        if (M.get(root).gone) return void ctx.add('silent', 'accepted-what-should-be-refused', `labit reply on the deleted thread ${root} said: ${r.out.trim()}`, { step: 'areply' });
        unsure.add(text); // the command printed no id: the reply is found by its words at the end
      } else {
        const r = await agentPost(s, { page, parent: root, name: signed(s), text, ...(intent ? { intent } : {}) });
        if (r.status !== 201) return M.get(root).gone ? null : loud('agent-answer-refused', `an answer on ${root}: ${r.status} ${r.text.slice(0, 200)}`, { status: r.status });
        add(r.json().comment, i, page, true, op.s);
        if (op.andResolve) await agentPost(s, { page, action: 'resolve', id: root });
      }
      said(root, true, intent);
      if (op.andResolve) Object.assign(T.get(root), { resolved: true, progress: false });
    } else if (op.t === 'killreply') {
      // The agent's command dies part-way: its answer landed whole or not at all, and nobody can say which.
      const text = op.text.trim();
      kills++;
      await runCli(ctx, lab, ['reply', root, '--name', s.name, '--', text], { env: cliEnv(s), killAfter: op.after });
      for (const h of handed) if (h.s === s.name && h.acked === false) h.acked = 'maybe'; // its request may have gone through before the kill
      unsure.add(text);
      const t = T.get(root);
      if (t) Object.assign(t, { progress: t.progress === false ? false : null, resolved: t.resolved });
      T.get(root).maybe = true; // its thread may hold one more message than the model knows: order and "waiting" are not judged
    } else if (op.t === 'progress') {
      const gone = M.get(root).gone;
      const r = op.cli ? await cli(s, ['reply', root, '--progress', op.text]) : await agentPost(s, { page, action: 'progress', id: root, text: op.text });
      const ok = op.cli ? r.code === 0 : r.status === 200;
      if (!ok && !gone) return loud('agent-command-failed', `progress on ${root}: ${(r.out || r.text).trim().slice(0, 300)}`, { step: 'progress', restart: restarts ? 1 : 0 });
      if (ok && !gone) T.get(root).progress = true;
    } else if (op.t === 'aresolve') {
      const gone = M.get(root).gone;
      const r = op.cli ? await cli(s, ['resolve', root]) : await agentPost(s, { page, action: 'resolve', id: root });
      const ok = op.cli ? r.code === 0 : r.status === 200;
      if (!ok && !gone) return loud('agent-command-failed', `resolve on ${root}: ${(r.out || r.text).trim().slice(0, 300)}`, { step: 'resolve', restart: restarts ? 1 : 0 });
      if (ok && !gone) Object.assign(T.get(root), { resolved: true, progress: false });
    } else if (op.t === 'apin') {
      const r = await cli(s, ['pin', '#t', op.text, '--page', op.page, '--no-check']);
      const id = /^Pinned ([0-9a-f]{12}) on /m.exec(r.out)?.[1];
      if (r.code !== 0 || !id) return loud('agent-command-failed', `labit pin: ${r.out.trim().slice(0, 300)}`, { step: 'pin', restart: restarts ? 1 : 0 });
      add({ id, parent: null, text: op.text, name: signed(s), anchor: { kind: 'element' } }, i, op.page, true, op.s);
      byOp.set(i, id);
    } else if (op.t === 'listen') {
      s.wanted = true;
      listen(s);
    } else if (op.t === 'unlisten') unlisten(s);
    else if (op.t === 'dropnext') s.dropNext = !s.cli;
    else if (op.t === 'wait') await sleep(op.ms);
    else if (op.t === 'restart') {
      labDown = true;
      lastSig = op.sig;
      await lab.stop(op.sig);
      restarts++;
      const again = await lab.start();
      labDown = false;
      upAt = Date.now();
      if (!again.ok) throw new Error(`the lab did not start again: ${lab.log.slice(-300)}`);
    } else if (op.t === 'offline') (d.off = true), d.goOffline();
    else if (op.t === 'online') (d.off = false), d.online();
    else if (op.t === 'reload') {
      if (!d.off) await d.open();
    }
  };
  const rounds = new Map();
  plan.ops.forEach((op, i) => op && rounds.set(op.r, [...(rounds.get(op.r) || []), [op, i]]));
  for (const [, ops] of [...rounds].sort((a, b) => a[0] - b[0])) await Promise.all(ops.map(([op, i]) => step(op, i)));

  // ---------- what must stay refused: a device on the wifi with no pass, whatever it sends (#397 changed who is the owner, not that) ----------
  // No cookie: none of resolve, reopen, move or delete takes, with no key, with a forged admin key, or with a made-up edit key.
  if (wifi) {
    const live = [...byOp.values()].find((id) => M.get(id) && !M.get(id).gone && T.get(id) && !T.get(id).chat);
    if (live) {
      const pg = M.get(live).page;
      let refused = 0;
      for (const [what, extra] of [['resolve', {}], ['reopen', {}], ['move', { anchor: { ...ANCHORS.spot(), selector: '#t' } }], ['delete', {}]]) {
        for (const [how, headers, edit] of [['no credentials', {}, undefined], ['a forged admin key', { 'x-lab-admin': 'f'.repeat(64) }, undefined], ['a forged edit key', {}, 'e'.repeat(32)]]) {
          const r = await rq(lab, { from: 'lan', method: 'POST', path: '/_lab/api/comments', headers, body: { page: pg, action: what, id: live, ...(edit ? { edit } : {}), ...extra } }).catch((e) => ({ status: 0, text: String(e.message) }));
          if (r.status >= 200 && r.status < 300) ctx.add('silent', 'accepted-what-should-be-refused', `a device with no pass was let ${what} ${live} (${how}): ${r.status}`, { step: what, device: 'no-pass' });
          else if (r.status === 403) refused++;
          else if (r.status !== 403) ctx.note(`unclear: ${what} with ${how} answered ${r.status} (not 2xx, not 403): ${String(r.text).slice(0, 120)}`);
        }
      }
      ctx.note(`no-pass probes: ${refused} of 12 refused with 403`);
    }
  }

  // ---------- the end: everyone back, every pin handed out, then what does each observer hold? ----------
  for (const d of devices) if (d.off) (d.off = false), d.online();
  // Every wait still open ends here (its command is killed, as an agent's session ending does), and is gone before the
  // last waits below ask: one still on its way would take their pins, or be told another session listens.
  ending = true;
  const closing = [...ctx.procs].filter((p) => p !== lab.proc);
  for (const s of S) {
    s.wanted = false;
    if (s.open) lastKill = Date.now();
    s.open?.stop();
    s.open = null;
  }
  await Promise.all(closing.map((p) => new Promise((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r)))));
  await sleep(60);
  const ask = async (page, from, cookie) => (await rq(lab, { from, cookie, path: `/_lab/api/comments?page=${encodeURIComponent(page)}` })).json().comments;
  // The last waits: every session asks until it is handed nothing more.
  const drain = async () => {
    for (let pass = 0, got = true; pass < 4 && got; pass++) {
      got = false;
      for (const s of S) {
        for (let n = 0; n < 6; n++) {
          const r = await agentRq(lab, sessOf(s), '/_lab/wait', { timeout: 0.25, ack: true }, { timeout: 15000 }).catch((e) => ({ status: 0, text: String(e) }));
          if (r.status !== 200) {
            if (r.status !== 204) loud('wait-failed', `the last wait of ${s.name} answered ${r.status}: ${r.text.slice(0, 200)}`, { status: r.status });
            break;
          }
          took(s, r.text, true);
          got = true;
          await agentRq(lab, sessOf(s), '/_lab/ack', { id: r.headers['x-lab-delivery'] }).catch(() => {});
        }
      }
    }
  };
  await drain();
  // A hand-off nobody confirmed (a wait killed with it on the way, a session that died holding it) is taken back after
  // 1.2 s and goes out again: when something a person wrote is still out, the last waits ask once more after that.
  const out = async () => {
    const got = new Set(handed.filter((h) => h.acked).flatMap((h) => [...h.ids]));
    for (const p of PAGES) for (const c of await ask(p, 'local')) if (!c.session && !got.has(c.id) && !M.get(c.id)?.gone) return true;
    return false;
  };
  if (lastKill && (await out())) {
    await sleep(Math.max(0, lastKill + ACK_MS + 500 - Date.now()));
    await drain();
  }

  // What the lab says now, to this computer and to a phone.
  const truth = {};
  for (const p of PAGES) truth[p] = await ask(p, 'local');
  const all = PAGES.flatMap((p) => truth[p].map((c) => ({ ...c, page: p })));
  // Answers the model could not be sure of (a command that printed no id, or died): found by their words.
  for (const c of all) if (!M.has(c.id) && c.session && unsure.has(c.text)) add(c, -1, c.page, true, -1);
  const tags = { ...(restarts ? { restart: lastSig } : {}) };

  // 1. The lab holds exactly what was said yes to.
  const live = [...M.values()].filter((m) => !m.gone);
  for (const m of live) {
    const c = all.find((x) => x.id === m.id);
    if (!c) ctx.add('silent', 'acknowledged-comment-missing', `${m.agent ? "an agent's" : "a person's"} ${m.parent ? 'reply' : 'pin'} ${m.id} (step ${m.op}) was answered 2xx and is not in the lab`, { who: m.agent ? 'agent' : 'person', ...tags });
    else if (!m.agent && c.text !== m.text) ctx.add('silent', 'comment-text-changed', `${m.id}: sent ${JSON.stringify(m.text.slice(0, 80))}, the lab has ${JSON.stringify(c.text.slice(0, 80))}`, {});
    else if ((c.parent || null) !== m.parent || c.page !== m.page) ctx.add('silent', 'comment-in-wrong-thread', `${m.id}: made in ${m.parent || 'its own thread'} on ${m.page}, the lab has it in ${c.parent || 'its own thread'} on ${c.page}`, tags);
  }
  for (const c of all) {
    const m = M.get(c.id);
    if (!m) ctx.add('silent', 'comment-nobody-made', `the lab holds ${c.id} "${c.text.slice(0, 60)}" by ${c.name}, which no step made`, tags);
    else if (m.gone) ctx.add('silent', 'deleted-comment-is-back', `${c.id} (step ${m.op}) was deleted (2xx) and the lab still holds it`, tags);
  }
  // 2. Each thread's state is what the steps left it in (where the rules say).
  for (const [id, t] of T) {
    const c = all.find((x) => x.id === id);
    if (!c || M.get(id).gone) continue;
    if (t.resolved !== null && !t.maybe && Boolean(c.resolved) !== t.resolved) ctx.add('silent', 'thread-state-wrong', `thread ${id}: the steps leave it ${t.resolved ? 'resolved' : 'open'}, the lab says ${c.resolved ? `resolved by ${c.resolvedBy}` : 'open'}`, { want: t.resolved ? 'resolved' : 'open', ...tags });
    if (t.progress !== null && !t.maybe && Boolean(c.progress) !== t.progress) ctx.add('silent', 'status-line-wrong', `thread ${id}: its status line should be ${t.progress ? 'there' : 'gone'}, the lab ${c.progress ? `shows "${c.progress.text}"` : 'shows none'}`, { want: t.progress ? 'shown' : 'gone', ...tags });
  }

  // 3. Every device holds what the lab would tell it now (its own list, kept up by the live stream alone).
  const tSettle = Date.now();
  const settled = await until(async () => {
    for (const d of devices) await d.idle(300);
    const now = (await rq(lab, { path: '/_lab/state' })).json();
    return devices.every((d) => !d.busy && d.commentsRev === now.comments && d.state?.mode === now.mode);
  }, BOUND, 40);
  const now = (await rq(lab, { path: '/_lab/state' })).json();
  for (const p of PAGES) truth[p] = await ask(p, 'local');
  for (const d of devices) {
    const where = { device: d.kind, ...(d.jitter ? { held: 'answers-held' } : {}), ...tags };
    const want = d.kind === 'phone' ? await ask(d.attrs.page, 'lan', d.cookie) : truth[d.attrs.page];
    const has = d.S.comments;
    const dup = has.map((c) => c.id).filter((id, k, list) => list.indexOf(id) !== k);
    if (dup.length) ctx.add('silent', 'device-shows-a-comment-twice', `${d.id} (${d.kind}) holds ${dup.join(', ')} twice`, where);
    const diff = diffComments(want, has);
    const who = (id) => (M.get(id)?.agent ? 'agent' : 'person');
    // What the lab answers now to the asks this device made (its last few "changes since N"), beside the device's own log.
    const again = [];
    for (const n of new Set([...(d.asked || []), ...(process.env.TORTURE_DUMP ? Array.from({ length: now.comments + 1 }, (_, k) => k) : [])])) {
      const r = (await rq(lab, { from: d.from, cookie: d.cookie, path: `/_lab/api/changes?${new URLSearchParams({ page: d.attrs.page, since: String(n) })}` })).json();
      again.push(`since ${n}: ${r.full ? 'load everything' : `to ${r.rev} +${r.set.map((c) => c.id.slice(0, 6)).join(',')} -${r.del.length}`}`);
    }
    const logOf = () => `\n      ${d.id} log: ${d.log.slice(-14).join(' | ')}\n      the lab now, asked the same: ${again.join(' | ') || '-'}`;
    // Made while this device's page was loading (between its request and its live stream's first message)?
    const loading = (id) => (d.loads.some(([from, to]) => M.get(id)?.at >= from - 30 && M.get(id)?.at <= to + 30) || (!d.heard && M.get(id)?.at >= d.loadFrom - 30) ? { cond: 'made-while-the-page-loaded' } : {});
    for (const id of diff.missing) ctx.add('silent', M.get(id)?.agent && M.get(id).parent ? 'agent-reply-missing-on-device' : 'comment-missing-on-device', `${d.id} (${d.kind} on ${d.attrs.page}) does not show ${id} (${who(id)}'s ${M.get(id)?.parent ? 'reply' : 'pin'}, step ${M.get(id)?.op})${logOf()}`, { who: who(id), ...loading(id), ...where });
    for (const id of diff.extra) ctx.add('silent', 'device-shows-a-comment-the-lab-lacks', `${d.id} (${d.kind}) still shows ${id} (step ${M.get(id)?.op}), which the lab no longer has${logOf()}`, where);
    for (const [id, field] of diff.changed) ctx.add('silent', 'device-shows-old-state', `${d.id} (${d.kind}) shows ${id}.${field} = ${JSON.stringify(has.find((c) => c.id === id)[field])?.slice(0, 80)}, the lab says ${JSON.stringify(want.find((c) => c.id === id)[field])?.slice(0, 80)}${logOf()}`, { field, ...where });
    // The order within a thread is the same everywhere.
    if (!diff.missing.length && !diff.extra.length && !dup.length) {
      for (const root of want.filter((c) => !c.parent)) {
        const [a, b] = [want, has].map((list) => list.filter((c) => c.parent === root.id).map((c) => c.id).join(' '));
        if (a !== b) ctx.add('silent', 'thread-order-differs', `${d.id} (${d.kind}) shows thread ${root.id} as ${b}, the lab as ${a}`, { ...where, tie: new Set(want.filter((c) => c.parent === root.id).map((c) => c.createdAt)).size < want.filter((c) => c.parent === root.id).length ? 'same-ms' : 'no' });
      }
    }
    if (d.state?.mode !== now.mode || JSON.stringify(d.state?.heard) !== JSON.stringify(now.heard)) ctx.add('silent', 'device-status-stale', `${d.id} (${d.kind}) was last told mode ${d.state?.mode} heard ${JSON.stringify(d.state?.heard)}, the lab says ${now.mode} ${JSON.stringify(now.heard)}`, where);
  }
  if (settled) ctx.time('agent-sync: after the last hand-off, until every device held what the lab holds', Date.now() - tSettle);

  // The real browser draws a numbered pin for every open thread on the page, and for no other.
  if (real) {
    const want = truth['/index'].filter((c) => !c.parent && !c.resolved && c.anchor?.kind !== 'page').map((c) => `${c.num} by ${c.name}`).sort();
    let got = null;
    const same = await until(async () => {
      const labels = await real.page.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
        return r ? [...r.querySelectorAll('.pin')].map((p) => p.getAttribute('aria-label') || '') : null;
      }).catch(() => null);
      got = labels && labels.map((l) => /^comment (\d+ by .*?)(?:,|$)/.exec(l)?.[1]).filter(Boolean).sort();
      return got && JSON.stringify(got) === JSON.stringify(want);
    }, 8000 * opts.slow, 200);
    if (!same) ctx.add('silent', 'browser-pins-differ', `${plan.browser} as a ${real.as} shows pins [${got ? got.join(' | ') : 'no widget'}], the open threads on /index are [${want.join(' | ')}]`, { browser: plan.browser, as: real.as, what: !got ? 'no-widget' : want.some((w) => !got.includes(w)) ? 'pin-missing' : 'pin-too-many', ...tags });
  }

  // 4. The files in .lab hold the same.
  let onDisk = {};
  await until(() => {
    onDisk = lab.store();
    return PAGES.every((p) => JSON.stringify(Object.values(onDisk[p] || {}).sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify([...truth[p]].sort((a, b) => a.id.localeCompare(b.id))));
  }, 2500 * opts.slow, 50);
  for (const p of PAGES) {
    const diff = diffComments(truth[p], Object.values(onDisk[p] || {}));
    if (diff.missing.length || diff.extra.length || diff.changed.length) ctx.add('silent', 'files-differ-from-the-lab', `.lab/comments for ${p}: missing ${diff.missing.join(' ') || '-'}, extra ${diff.extra.join(' ') || '-'}, changed ${diff.changed.map((x) => x.join('.')).join(' ') || '-'}`, { what: diff.missing.length ? 'missing' : diff.extra.length ? 'extra' : `field-${diff.changed[0][1]}`, ...tags });
  }

  // 5. The agent's text (what `labit` shows an agent, and .lab/comments.md) names every open thread and its messages.
  const md = fs.existsSync(path.join(lab.dir, '.lab/comments.md')) ? fs.readFileSync(path.join(lab.dir, '.lab/comments.md'), 'utf8') : '';
  for (const p of PAGES) {
    const text = (await rq(lab, { path: `/_lab/agent${p}` })).text;
    for (const root of truth[p].filter((c) => !c.parent)) {
      const ids = [root.id, ...truth[p].filter((c) => c.parent === root.id).map((c) => c.id)];
      for (const [what, t] of [['the agent text', text], ['.lab/comments.md', md]]) {
        const there = ids.filter((id) => t.includes(`id ${id}`));
        if (!root.resolved && there.length < ids.length) ctx.add('silent', 'agent-text-misses-a-comment', `${what} for ${p} lacks ${ids.filter((id) => !there.includes(id)).join(' ')} of the open thread ${root.id}`, { where: what === 'the agent text' ? 'agent-text' : 'comments.md', ...tags });
        if (root.resolved && idsIn(t).has(root.id)) ctx.add('silent', 'agent-text-lists-a-done-thread', `${what} for ${p} lists the resolved thread ${root.id} as open`, { where: what === 'the agent text' ? 'agent-text' : 'comments.md', ...tags });
      }
    }
  }

  // 6. What the waits were handed: every word a person wrote in a thread still open reached a wait; none that no step made.
  const reached = new Set(handed.flatMap((h) => [...h.ids]));
  const confirmed = new Set(handed.filter((h) => h.acked).flatMap((h) => [...h.ids])); // 'maybe' counts: it may well have been confirmed
  for (const m of live) {
    const t = T.get(m.parent || m.id);
    const c = all.find((x) => x.id === (m.parent || m.id));
    if (m.agent || !c || c.resolved || t?.maybe) continue; // a resolved thread's words are not handed out
    if (!reached.has(m.id)) ctx.add('silent', 'message-never-reached-a-wait', `${m.parent ? 'the reply' : 'the pin'} ${m.id} (step ${m.op}, on ${m.page}) by a person is in an open thread and no wait was handed it, also not the last ones of every session\n      sessions: ${S.map((s) => `${s.name}${s.pages ? ` --pages ${s.pages}` : ''} ended: ${s.ended.join(' / ') || '-'}`).join('; ')}`, { what: m.parent ? 'reply' : 'pin', sessions: S.length, ...tags });
  }
  // (An answer whose command printed no id, in a thread deleted since, is known only by its words.)
  const maybeMine = (line) => [...unsure].some((t) => line.includes(t.split(/\r\n?|[\n\u2028\u2029]/)[0].slice(0, 60)));
  for (const h of handed) for (const id of h.ids) if (!M.has(id) && !maybeMine(h.lines.get(id) || '')) ctx.add('silent', 'wait-handed-an-unknown-id', `a wait of ${h.s} named ${id}, which no step made: ${h.lines.get(id)?.slice(0, 120)}`, tags);
  // Each of them once: the count a hand-off states ("2 new, 1 reply"), summed, is the number of different messages
  // handed out. Not judged when a pin moved (a moved pin is new again) or a hand-off went unconfirmed (it goes out again).
  const people = new Set([...M.values()].filter((m) => !m.agent).map((m) => m.id));
  const distinct = new Set(handed.flatMap((h) => [...h.ids].filter((id) => people.has(id))));
  const stated = handed.reduce((n, h) => n + h.fresh, 0);
  if (!moved && !kills && handed.every((h) => h.acked === true) && ![...T.values()].some((t) => t.maybe) && stated !== distinct.size) {
    const twice = [...distinct].filter((id) => handed.filter((h) => h.ids.has(id)).length > 1);
    ctx.add(stated > distinct.size ? 'silent' : 'unclear', stated > distinct.size ? 'message-handed-out-twice' : 'hand-off-count-low', `the hand-offs state ${stated} new messages in all, and name ${distinct.size} different ones by people (in more than one hand-off: ${twice.join(' ') || 'none'})\n      ${handed.map((h) => `${h.s}: ${h.fresh} stated, ids ${[...h.ids].join(' ')}`).join('\n      ')}`, { ...tags });
  }
  // A thread the page shows as "the agent has it" (handedAt) was handed to a wait that confirmed it.
  for (const c of all.filter((x) => !x.parent && !x.resolved && x.handedAt)) if (!confirmed.has(c.id) && !T.get(c.id)?.maybe) ctx.add('silent', 'pin-says-handed-but-no-wait-has-it', `thread ${c.id} carries handedAt ${c.handedAt}, and no confirmed hand-off named it (unconfirmed ones: ${handed.filter((h) => !h.acked && h.ids.has(c.id)).length})`, tags);

  // 7. The "waiting" count the page list and `labit list` show: threads nobody answered, or whose newest word is a person's.
  const info = (await rq(lab, { path: '/_lab/pages' })).json();
  for (const p of PAGES) {
    const roots = truth[p].filter((c) => !c.parent && !c.resolved);
    const lastOf = (r) => truth[p].filter((c) => c.parent === r.id).pop();
    const want = roots.filter((r) => !lastOf(r) || !lastOf(r).session).length;
    const got = info.pages.find((x) => x.path === p)?.waiting;
    const named = roots.some((r) => lastOf(r) && !lastOf(r).session && AGENT_WORDS.test(lastOf(r).name));
    if (got !== want && !roots.some((r) => T.get(r.id)?.maybe)) ctx.add('silent', 'waiting-count-wrong', `${p}: ${want} open threads wait on an answer (no reply, or a person wrote last), the lab says ${got}`, { cause: named ? 'a-person-named-like-an-agent-wrote-last' : 'other' });
  }
}
