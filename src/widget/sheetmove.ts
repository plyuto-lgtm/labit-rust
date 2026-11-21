// How a drawer moves under a finger and after it lets go, one set of rules for the comment drawers (sheets.ts) and the
// board drawer (src/board/overlay.ts; Leo, 21 Nov: "can it share component?"). Pure: the motion tokens' lengths come in
// as numbers (ms), so a part without the widget's styles uses it too.

// A sheet let go carries on at the speed it had (Apple's "Designing Fluid Interfaces": a thing you drag and let go
// continues at the finger's velocity, and nothing starts steeply for no reason). A cubic-bezier's first slope is its
// starting speed in whole distances per duration, so each curve below is built from the release speed and the way left.
const bez = (...n: number[]) => `cubic-bezier(${n.map((x) => +x.toFixed(3))})`;
const SETTLE = 'cubic-bezier(.32, .72, 0, 1)'; // iOS's settle (styles.css --_ease-settle)
// To a stop `dist` px away, going `speed` px/ms toward it now (0 when it is going away, or still): [ms, curve]. Ends like
// iOS's settle (.32, .72, 0, 1), starts at the speed; a quick throw shortens it (never past slow). At rest it starts softly.
// The curve speeds up a little in its first frame (its start is convex), so it starts 1.2 times slower than asked for.
export function glide(dist: number, speed: number, slow: number, quick: number, cap = 1e9, rest = SETTLE): [number, string] {
  let ms = Math.min(cap, slow);
  if (!ms || dist < 1) return [ms, rest];
  if ((speed * ms) / dist > 2.7) ms = Math.max(quick, (2.7 * dist) / speed); // settle's own first slope is 2.25 (2.7 / 1.2)
  const m = (speed * ms) / dist / 1.2; // the first slope, in whole distances per duration
  const y = Math.min(1, 0.32 * m);
  return [ms, bez(m ? y / m : 0.32, y, 0, 1)];
}
// Off the screen `dist` px away, going `speed` px/ms toward it now: [ms, curve]. Keeps that speed (a steady pace, or
// speeding up from it, as a sheet falls) and does not stop at the end; at most `cap` ms.
export function carry(dist: number, speed: number, cap: number, quick: number): [number, string] {
  const ms = Math.min(cap, Math.max(quick, speed > 0 ? dist / speed : cap));
  const m = Math.min(2, (speed * ms) / dist);
  return [ms, bez(1 / 3, m / 3, 2 / 3, (m + 1) / 3)];
}
/** How fast the finger was going over its last ~100 ms (px/ms, + down), from its moves ({ t, y }); 0 if it held still
 * before letting go (at `now`). */
export function speedOf(moves: { t: number; y: number }[], now: number) {
  const last = moves[moves.length - 1];
  const from = moves.find((q) => last.t - q.t <= 100) || last;
  const span = last.t - from.t;
  return now - last.t > 80 || span < 8 ? 0 : (last.y - from.y) / span;
}
/** Let go `dy` px down from where it sits, going `v` px/ms: it goes when it would come to rest past half its height `h`
 * (iOS's throw: the distance plus the speed carried on at the normal deceleration, 0.998 a ms, so v × 499). A short quick
 * flick closes; a slow long drag closes past halfway; a move back up never does. */
export const goes = (dy: number, v: number, h: number) => v > -0.1 && dy + Math.max(0, v) * 499 > h / 2;
