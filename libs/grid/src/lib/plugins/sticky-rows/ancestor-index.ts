/** @internal Positional coordinates belong only to this row-generation snapshot. */
export interface AncestorIndex {
  readonly rows: readonly unknown[];
  readonly parents: readonly number[];
  readonly subtreeEnds: readonly number[];
}

/**
 * @internal Build from the complete authoritative hierarchy generation, then
 * project membership. Inferring parents from filtered levels can attach a
 * promoted descendant to an unrelated preceding root.
 */
export function buildAncestorIndex(
  hierarchyRows: readonly unknown[],
  positionOf: (row: unknown) => { level: number } | undefined,
  visibleRows: readonly unknown[] = hierarchyRows,
): AncestorIndex {
  const rows = visibleRows.slice();
  const positions = new Map<unknown, number>();
  for (let i = 0; i < rows.length; i++) {
    if (positions.has(rows[i])) throw new Error('StickyRows requires distinct row occurrences');
    positions.set(rows[i], i);
  }

  const parents = new Array<number>(rows.length).fill(-1);
  const stack: { level: number; visibleAncestor: number }[] = [];
  const seen = new Set<unknown>();
  for (let i = 0; i < hierarchyRows.length; i++) {
    const row = hierarchyRows[i];
    if (seen.has(row)) throw new Error('StickyRows requires distinct hierarchy occurrences');
    seen.add(row);
    const meta = positionOf(row);
    if (!meta) {
      stack.length = 0;
      continue;
    }
    const level = meta.level;
    if (!Number.isInteger(level) || level < 1) {
      throw new Error('StickyRows requires positive integer hierarchy levels');
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].visibleAncestor : -1;
    const visibleIndex = positions.get(row);
    if (visibleIndex !== undefined) parents[visibleIndex] = parent;
    stack.push({ level, visibleAncestor: visibleIndex ?? parent });
  }

  return { rows, parents, subtreeEnds: indexSubtreeEnds(parents) };
}

function indexSubtreeEnds(parents: readonly number[]): number[] {
  const ends = new Array<number>(parents.length).fill(parents.length);
  const stack: number[] = [];
  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];
    while (stack.length && stack[stack.length - 1] !== parent) {
      ends[stack[stack.length - 1]] = i;
      stack.pop();
    }
    if (parent !== -1 && !stack.length) {
      throw new Error('StickyRows visible rows must preserve hierarchy subtree order');
    }
    stack.push(i);
  }
  return ends;
}

/** @internal Walk only this occurrence's ancestors, in logical reading order. */
export function getAncestorChain(index: AncestorIndex, rowIndex: number): number[] {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= index.rows.length) {
    throw new RangeError('StickyRows row index is outside its hierarchy generation');
  }
  const ancestors: number[] = [];
  for (let parent = index.parents[rowIndex]; parent !== -1; parent = index.parents[parent]) {
    ancestors.push(parent);
  }
  return ancestors.reverse();
}

/** @internal Skip ineligible ancestry once per generation, never on scroll. */
export function indexEligibleAncestors(index: AncestorIndex, eligible: readonly boolean[]): AncestorIndex {
  const parents: number[] = [];
  for (let i = 0; i < index.rows.length; i++) {
    const parent = index.parents[i];
    parents.push(parent === -1 || eligible[parent] ? parent : parents[parent]);
  }
  return { ...index, parents };
}
