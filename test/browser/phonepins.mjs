// A board pin's place on a frame is the same on every device: fx, fy are px of the frame as stored (a phone draws every frame
// 390 wide, and used to save its own 390-wide px, which a computer then read as 1440-wide ones). Not part of `npm test`; CI runs it
// in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-phonepins-');
const PORT = claimPort(8470, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=ph`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/pricing', w: 1440, h: 900 }, { id: 'b', src: '/pricing', w: 820, h: 600 }] }) });
const open = async (browser, opts) => {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
  const p = await ctx.newPage();
  await p.goto(`${B}/_lab/board/ph`);
  await p.waitForFunction(() => window.__labBoard?.box?.('a'), null, { timeout: 8000 });
  await sleep(1200);
  return p;
};
// the anchor of the middle of frame a, and where a stored spot is drawn: both in screen px
const look = (p, spot) => p.evaluate((spot) => {
  const B = window.__labBoard;
  const r = B.box('a').getBoundingClientRect();
  const a = B.anchor(r.left + r.width / 2, r.top + r.height / 2);
  const at = B.spot(spot);
  return { a: { fx: a.fx, fy: a.fy, lay: a.lay, frame: a.frame }, box: { l: r.left + scrollX, t: r.top + scrollY, w: r.width, h: r.height }, at: { l: at.left, t: at.top } };
}, spot);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const desk = await open(browser, { viewport: { width: 1200, height: 800 } });
      const d = await look(desk, { frame: 'a', fx: 1080, fy: 675 });
      check(eng, 'on a computer the middle of the frame is half of it in stored px, and says nothing about a phone', Math.abs(d.a.fx - 720) <= 3 && Math.abs(d.a.fy - 450) <= 3 && d.a.lay === undefined, JSON.stringify(d.a));
      check(eng, 'a spot at 75% across is drawn there', Math.abs(d.at.l - (d.box.l + d.box.w * 0.75)) <= 3 && Math.abs(d.at.t - (d.box.t + d.box.h * 0.75)) <= 3, JSON.stringify(d));
      const phone = await open(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const f = await look(phone, { frame: 'a', fx: 1080, fy: 675 });
      check(eng, 'on a phone (drawn 390 wide) the middle of the frame is still half of the stored 1440 × 900', Math.abs(f.a.fx - 720) <= 8 && Math.abs(f.a.fy - 450) <= 8 && f.a.lay === 390, JSON.stringify(f.a));
      check(eng, 'a spot saved on a computer (75% across, 75% down) is at 75% of the frame on a phone too', Math.abs(f.at.l - (f.box.l + f.box.w * 0.75)) <= 4 && Math.abs(f.at.t - (f.box.t + f.box.h * 0.75)) <= 4, JSON.stringify(f));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
