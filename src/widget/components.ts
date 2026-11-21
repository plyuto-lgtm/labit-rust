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
    if (d?.fileName) return `${repoPath(String(d.fileName))}:${d.lineNumber || 0}`;
    const st = f?._debugStack?.stack;
    if (typeof st !== 'string') return '';
    for (const line of st.split('\n').slice(1)) {
      const m = /((?:https?|webpack-internal|file):\/\/[^\s()]+?):(\d+):\d+\)?\s*$/.exec(line);
      if (m && !/node_modules|react-dom|react-jsx|jsx-dev-runtime|react-server|scheduler/.test(m[1])) return `${repoPath(m[1])} (line ${m[2]} as served, may differ from the source)`;
    }
    return '';
  };
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (key) {
    const host = el[key];
    const parts = [];
    let usedAt = '';
    // Up through the plain elements around it (a <span> in a <td> in a <tr>…) to the component that rendered it.
    for (let f = host?.return, i = 0; f && parts.length < 2 && i < 80; f = f.return, i++) {
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
  const vue = el.__vueParentComponent;
  if (vue?.type) {
    const n = vue.type.name || vue.type.__name || (vue.type.__file || '').replace(/^.*\//, '').replace(/\.vue$/, '');
    const parent = vue.parent?.type;
    const pn = parent && (parent.name || parent.__name);
    const v = variantOf(vue.props);
    return { component: `${n}${v ? ' ' + v : ''}${pn ? ` (in ${pn})` : ''}`, source: vue.type.__file ? repoPath(vue.type.__file) : undefined, usedAt: parent?.__file ? repoPath(parent.__file) : undefined };
  }
  const loc = el.__svelte_meta?.loc;
  if (loc?.file) return { component: loc.file.replace(/^.*\//, '').replace(/\.svelte$/, ''), source: `${repoPath(loc.file)}:${loc.line ?? 0}` };
  return {};
}
