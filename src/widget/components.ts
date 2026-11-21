// Part of the comment widget, built as its own file (public/_lab/components.js, scripts/build-widget.mjs) that
// src/comments.js loads only on a page a framework drew (React, Vue, Svelte) and hands to anchoring.ts.
// Which component drew an element and where, from a framework's dev build (React, Vue 3, Svelte); production
// builds keep none of it. A GPUI app's mirror page (labit_mirror) writes it into the boxes' attributes. A small cut of Census's reader (github.com/leonidstern/census).
const PLAIN_NAME = /^[A-Z][A-Za-z0-9]{2,}$/;
const PLUMBING = /(Provider|Context|Consumer|Boundary|Slot|Portal|Fragment|Presence|Scope|Trap|Root)$/;
const variantOf = (p) =>
  ['variant', 'size', 'tone', 'intent', 'kind']
    .flatMap((k) => ((typeof p?.[k] === 'string' || typeof p?.[k] === 'number') && /^[\w.-]{1,20}$/.test(String(p[k])) ? [`${k}=${p[k]}`] : []))
    .join(' ');
// Built files are never named as a source (a Next chunk, node_modules, dist): the page's own `file:` line is the right one there.
const BUILT = /(?:^|\/)(?:\.next|_next|chunks|node_modules|dist|build)\//;
// A served module's address as a repo path: Vite serves /src/x.tsx, webpack and Next say webpack-internal:///./src/x.tsx.
const repoPath = (url) => !/^[a-z-]+:\/\//i.test(url) ? url : decodeURIComponent(url.replace(/^[a-z-]+:\/\/\/?(\.\/)?/i, '/').replace(/^\/[^/]*:\d+/, '').split('?')[0]).replace(/^\/(@fs)?/, '').replace(/^\(app-pages-browser\)\/\.?\/?/, '');
// A box of a GPUI mirror: its component (the closest box that names one, with the element's own id), the file and line of
// the box, and where the component is used.
const gpuiAt = (el) => {
  const box = el.closest?.('[data-gpui-src]');
  if (!box) return null;
  const name = box.closest('[data-gpui-component]:not([data-gpui-component=""])')?.getAttribute('data-gpui-component') || '';
  const id = box.closest('[data-gpui-id]')?.getAttribute('data-gpui-id');
  return { component: name && (id ? `${name} #${id}` : name), source: box.getAttribute('data-gpui-src') || undefined, usedAt: box.closest('[data-gpui-used-at]')?.getAttribute('data-gpui-used-at') || undefined };
};
export function componentAt(el) {
  const gpui = gpuiAt(el);
  if (gpui) return gpui;
  const name = (t, d = 0) => (d > 3 ? '' : typeof t === 'function' ? t.displayName || t.name || '' : t && typeof t === 'object' ? t.displayName || name(t.render || t.type, d + 1) : '');
  const plain = (n) => PLAIN_NAME.test(n) && !PLUMBING.test(n);
  // React 18 writes the JSX's file and line; React 19 only the stack where the element was made.
  const srcOf = (f) => {
    const d = f?._debugSource;
    if (d?.fileName) return BUILT.test(String(d.fileName)) ? '' : `${repoPath(String(d.fileName))}:${d.lineNumber || 0}`;
    const st = f?._debugStack?.stack;
    if (typeof st !== 'string') return '';
    for (const line of st.split('\n').slice(1)) {
      const m = /((?:https?|webpack-internal|file):\/\/[^\s()]+?):(\d+):\d+\)?\s*$/.exec(line);
      if (m && !/node_modules|react-dom|react-jsx|jsx-dev-runtime|react-server|scheduler/.test(m[1])) return BUILT.test(m[1]) ? '' : `${repoPath(m[1])} (line ${m[2]} as served, may differ from the source)`;
    }
    return '';
  };
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (key) {
    // The fibers from the node up to the root, each the one on screen: after a hot update the fresh source is on the
    // alternate of the one the node was made with, so each level is whichever the level above lists as its child.
    const up = [];
    for (let f = el[key]; f && up.length < 3000; f = f.return) up.push(f);
    const top = up[up.length - 1];
    if (top?.tag === 3) {
      let c = top.stateNode.current;
      for (let i = up.length - 2; i >= 0 && c; i--) {
        for (c = c.child; c && c !== up[i] && c !== up[i].alternate; c = c.sibling);
        if (c) up[i] = c;
      }
    }
    const host = up[0];
    // A server component (React 19) has no fiber on the page: its elements name it as their owner, a plain record with a name.
    const own = host?._debugOwner;
    if (!own?.type && plain(String(own?.name))) return { component: own.name, source: srcOf(host) || undefined };
    const parts = [];
    let usedAt = '';
    // Up through the plain elements around it (a <span> in a <td> in a <tr>…) to the component that rendered it.
    for (let j = 1, f; (f = up[j]) && parts.length < 2 && j < 80; j++) {
      if (typeof f.type === 'string') continue;
      const n = name(f.type);
      if (!plain(n)) continue;
      if (!parts.length) usedAt = srcOf(f);
      const v = variantOf(f.memoizedProps);
      parts.push(v ? `${n} ${v}` : n);
    }
    if (!parts.length) return srcOf(host) ? { source: srcOf(host) } : {};
    return { component: parts.length > 1 ? `${parts[0]} (in ${parts[1]})` : parts[0], source: srcOf(host) || undefined, usedAt: usedAt || undefined };
  }
  // Vue 3 writes markup with nothing bound in it as one piece of HTML: its elements know no component, so the nearest
  // element above that does says whose it is, with no line (the file's own, or a component inside it).
  let owner = el;
  while (owner && !owner.__vueParentComponent) owner = owner.parentElement;
  const vue = owner?.__vueParentComponent;
  if (vue?.type) {
    const n = vue.type.name || vue.type.__name || (vue.type.__file || '').replace(/^.*\//, '').replace(/\.vue$/, '');
    const parent = vue.parent?.type;
    const pn = parent && (parent.name || parent.__name);
    const v = variantOf(vue.props);
    return { component: `${n}${v ? ' ' + v : ''}${pn ? ` (in ${pn})` : ''}`, source: vue.type.__file ? repoPath(vue.type.__file) + (owner === el ? '' : ' (line unknown: static markup)') : undefined, usedAt: parent?.__file ? repoPath(parent.__file) : undefined };
  }
  const loc = el.__svelte_meta?.loc;
  if (loc?.file) return { component: loc.file.replace(/^.*\//, '').replace(/\.svelte$/, ''), source: `${repoPath(loc.file)}:${loc.line ?? 0}` };
  return {};
}
