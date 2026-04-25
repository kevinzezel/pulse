// Mosaic helpers — coexistem com dois formatos:
//   - react-mosaic-component (canônico): { direction, first, second, splitPercentage }
//   - legado/customizado: { type: 'split', direction, children, splitPercentages }
// Toda normalização produz o formato canônico. As funções de leitura
// (getChildren / withChildren) ainda aceitam ambos pra suportar layouts
// persistidos antes da normalização entrar.

function getChildren(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node.children)) return node.children;
  if ('first' in node && 'second' in node) return [node.first, node.second];
  return [];
}

function getDirection(node, fallback = 'row') {
  if (!node || typeof node !== 'object') return fallback;
  return node.direction || fallback;
}

function getSplit(node) {
  if (!node || typeof node !== 'object') return 50;
  if (typeof node.splitPercentage === 'number') return node.splitPercentage;
  if (Array.isArray(node.splitPercentages) && typeof node.splitPercentages[0] === 'number') {
    return node.splitPercentages[0];
  }
  return 50;
}

function makeSplit(direction, first, second, splitPercentage = 50) {
  return {
    direction,
    first,
    second,
    splitPercentage: clampSplit(splitPercentage),
  };
}

function clampSplit(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 50;
  if (n < 5) return 5;
  if (n > 95) return 95;
  return n;
}

function isSplit(node) {
  return node && typeof node === 'object' && (
    Array.isArray(node.children) ||
    ('first' in node && 'second' in node)
  );
}

export function normalizeMosaicTree(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node;
  if (!isSplit(node)) return null;

  const direction = getDirection(node, 'row');
  const [rawFirst, rawSecond] = getChildren(node);
  const first = normalizeMosaicTree(rawFirst);
  const second = normalizeMosaicTree(rawSecond);

  // Colapsa nós com filho ausente para evitar holes que o react-mosaic-component
  // renderiza como tile vazio (causa raiz do "terceiro terminal somem").
  if (first && !second) return first;
  if (second && !first) return second;
  if (!first && !second) return null;

  return makeSplit(direction, first, second, getSplit(node));
}

export function replaceInTree(node, targetId, replacement) {
  if (node === targetId) return replacement;
  if (typeof node === 'string') return node;
  if (!isSplit(node)) return node;

  const [first, second] = getChildren(node);
  const newFirst = replaceInTree(first, targetId, replacement);
  const newSecond = replaceInTree(second, targetId, replacement);
  if (newFirst === first && newSecond === second) return node;
  return makeSplit(getDirection(node), newFirst, newSecond, getSplit(node));
}

export function removeFromTree(node, targetId) {
  if (node === targetId) return null;
  if (typeof node === 'string') return node;
  if (!isSplit(node)) return null;

  const [first, second] = getChildren(node);
  const newFirst = removeFromTree(first, targetId);
  const newSecond = removeFromTree(second, targetId);
  if (newFirst && newSecond) {
    if (newFirst === first && newSecond === second) return node;
    return makeSplit(getDirection(node), newFirst, newSecond, getSplit(node));
  }
  return newFirst || newSecond || null;
}

export function getVisibleSessionIds(node) {
  const ids = new Set();
  function walk(n) {
    if (!n) return;
    if (typeof n === 'string') { ids.add(n); return; }
    if (n.type === 'tabs' && Array.isArray(n.tabs)) { n.tabs.forEach((t) => ids.add(t)); return; }
    const children = getChildren(n);
    children.forEach(walk);
  }
  walk(node);
  return ids;
}

export function validateTree(node, validIds) {
  if (!node) return null;
  if (typeof node === 'string') return validIds.has(node) ? node : null;
  if (!isSplit(node)) return null;

  const [first, second] = getChildren(node);
  const newFirst = validateTree(first, validIds);
  const newSecond = validateTree(second, validIds);
  if (newFirst && newSecond) {
    if (newFirst === first && newSecond === second && !Array.isArray(node.children)) {
      // já era canônico e não mudou
      return node;
    }
    return makeSplit(getDirection(node), newFirst, newSecond, getSplit(node));
  }
  return newFirst || newSecond || null;
}

export function countLeaves(node) {
  if (!node) return 0;
  if (typeof node === 'string') return 1;
  if (!isSplit(node)) return 0;
  const [first, second] = getChildren(node);
  return countLeaves(first) + countLeaves(second);
}

export function getMaxDepth(node) {
  if (!node) return 0;
  if (typeof node === 'string') return 1;
  if (!isSplit(node)) return 0;
  const [first, second] = getChildren(node);
  return 1 + Math.max(getMaxDepth(first), getMaxDepth(second));
}

// Conta divisões por direção pra decidir como inserir o próximo terminal.
// Layout predominantemente horizontal (mais splits row) → cresce em column.
function countDirections(node) {
  let row = 0, col = 0;
  function walk(n) {
    if (!n || typeof n === 'string' || !isSplit(n)) return;
    if (getDirection(n) === 'column') col += 1;
    else row += 1;
    const [first, second] = getChildren(n);
    walk(first);
    walk(second);
  }
  walk(node);
  return { row, col };
}

// Encontra o ramo mais "simples" (menor profundidade, menos folhas) pra
// anexar a nova sessão. Evita acumular tudo num único ramo do mosaico,
// que é o que produz a sensação de tiles minúsculos.
function pickInsertionTarget(node) {
  if (!node || typeof node === 'string' || !isSplit(node)) return null;
  const [first, second] = getChildren(node);
  const fLeaves = countLeaves(first);
  const sLeaves = countLeaves(second);
  return sLeaves <= fLeaves ? 'second' : 'first';
}

// Inserção inteligente: alterna direção pra evitar três terminais empilhados
// na mesma linha/coluna e mantém o ramo mais leve crescendo.
//
// Regras:
//   - árvore vazia: retorna o id direto
//   - folha: divide em row 50/50
//   - subárvore: insere no ramo mais leve, alternando a direção do split pai
//     pra garantir um layout mais quadriculado
export function insertSession(tree, newId) {
  if (!newId) return tree;
  const normalized = normalizeMosaicTree(tree);
  if (!normalized) return newId;
  if (typeof normalized === 'string') {
    return makeSplit('row', normalized, newId, 50);
  }
  if (!isSplit(normalized)) return newId;

  const target = pickInsertionTarget(normalized);
  const [first, second] = getChildren(normalized);
  const parentDirection = getDirection(normalized);
  const childDirection = parentDirection === 'row' ? 'column' : 'row';

  function attach(branch) {
    if (!branch) return newId;
    if (typeof branch === 'string') {
      return makeSplit(childDirection, branch, newId, 50);
    }
    // Recurse: continua descendo pelo ramo mais leve até achar uma folha ou
    // outro split a particionar. Cada nível alterna a direção pelo pai.
    return insertSession(branch, newId);
  }

  if (target === 'second') {
    return makeSplit(parentDirection, first, attach(second), getSplit(normalized));
  }
  return makeSplit(parentDirection, attach(first), second, getSplit(normalized));
}

// Atalho útil pra quem quer só normalizar antes de persistir/render sem
// alterar conteúdo. Idempotente: chamar duas vezes não muda nada.
export function ensureCanonicalLayout(tree) {
  return normalizeMosaicTree(tree);
}

// Heurística adicional exposta caso outras partes do app queiram inspecionar
// o layout (ex: "qual a direção predominante?").
export function getDominantDirection(node) {
  const { row, col } = countDirections(node);
  if (row === 0 && col === 0) return null;
  return row >= col ? 'row' : 'column';
}
