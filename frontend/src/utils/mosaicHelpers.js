function getChildren(node) {
  if (node.type === 'split') return node.children;
  if ('first' in node) return [node.first, node.second];
  return [];
}

function withChildren(node, newChildren) {
  if (node.type === 'split') return { ...node, children: newChildren };
  return { ...node, first: newChildren[0], second: newChildren[1] };
}

export function replaceInTree(node, targetId, replacement) {
  if (node === targetId) return replacement;
  if (typeof node === 'string') return node;

  const children = getChildren(node);
  const newChildren = children.map(c => replaceInTree(c, targetId, replacement));
  return withChildren(node, newChildren);
}

export function removeFromTree(node, targetId) {
  if (node === targetId) return null;
  if (typeof node === 'string') return node;

  const children = getChildren(node);
  const filtered = children
    .map(c => removeFromTree(c, targetId))
    .filter(c => c !== null);

  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];

  return withChildren(node, filtered);
}

export function getVisibleSessionIds(node) {
  const ids = new Set();
  function walk(n) {
    if (!n) return;
    if (typeof n === 'string') { ids.add(n); return; }
    if (n.type === 'tabs') { n.tabs.forEach(t => ids.add(t)); return; }
    const children = getChildren(n);
    children.forEach(walk);
  }
  walk(node);
  return ids;
}

export function validateTree(node, validIds) {
  if (!node) return null;
  if (typeof node === 'string') return validIds.has(node) ? node : null;

  const children = getChildren(node);
  const filtered = children
    .map(c => validateTree(c, validIds))
    .filter(c => c !== null);

  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];

  return withChildren(node, filtered);
}
