// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
//
// Framework detection: whether the page was drawn by React, Vue, Svelte or GPUI, so components.ts (loaded only then) can say
// which component a pin is on.
import { readComponents } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
// Which component drew what a pin is on (components.ts, React, Vue, Svelte, GPUI): its own file, loaded once the page shows
// it was drawn by one of them: at start, at load, or the first element the pointer goes over that says so. A pin
// reads it at once (anchorAt doesn't wait), so it is there before the first click.
// A GPUI app (Rust) is shown as a mirror page: <html data-gpui>, boxes carrying data-gpui-src (the file and line that drew them).
const drawnByGpui = (n: any) => n instanceof Element && (n.hasAttribute('data-gpui') || Boolean(n.closest('[data-gpui-src]')));
const drawnByFramework = (n: any) => Boolean(drawnByGpui(n) || n && (n.__vueParentComponent || n.__svelte_meta || Object.keys(n).some((k) => k.startsWith('__react'))));
const lookForFramework = (nodes: Iterable<Element | EventTarget | null>) => {
  if (W.S.components) return;
  for (const n of nodes) {
    if (!drawnByFramework(n)) continue;
    removeEventListener('pointerover', overFramework, true);
    if (document.documentElement.hasAttribute('data-gpui') || document.querySelector('[data-gpui-src]')) followGpui();
    W.S.components = W.part('components').then((m) => readComponents(m.componentAt), () => (W.S.components = null));
    return;
  }
};
export const overFramework = (e: PointerEvent) => lookForFramework([e.target]);
// The mirror's boxes are rebuilt whenever the app draws a new frame (same data-lab keys, maybe new places): the pins
// are placed again from where their boxes are now (W.reflow waits a frame, so a burst of rebuilds is one pass).
const followGpui = () => {
  const mirror = document.getElementById('gpui-mirror') || document.body;
  new MutationObserver((list) => list.some((m) => m.target instanceof Element && m.target.closest('#gpui-tree, [data-gpui-src]')) && W.reflow()).observe(mirror, { childList: true, subtree: true });
};
export const scanForFramework = () => lookForFramework([document.documentElement, document.body, ...document.querySelectorAll('body > *, body > * > *, body > * > * > *')]);
export function bindFramework(w: unknown) {
  W = w;
}
