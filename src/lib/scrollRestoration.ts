/**
 * Position-path of `el` within `root`: a dot-joined chain of child indices
 * (e.g. "0.1.2"). Returns '' when el === root, or null when el is not a
 * descendant of root. Re-resolvable with elementAtPath after a re-render,
 * because the same logical container keeps the same structural position.
 */
export function domPath(el: Element, root: Element): string | null {
  if (el === root) return '';
  const parts: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    parts.push(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  if (cur !== root) return null;
  return parts.reverse().join('.');
}

/** Inverse of domPath: walk child indices from root. Null if it doesn't resolve. */
export function elementAtPath(root: Element, path: string): Element | null {
  if (path === '') return root;
  let cur: Element | null = root;
  for (const part of path.split('.')) {
    cur = cur ? (cur.children[Number(part)] ?? null) : null;
    if (!cur) return null;
  }
  return cur;
}
