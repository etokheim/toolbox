import type { AncestorIndex } from './ancestor-index';
import type { RowFlowPoint } from '../../core/internal/row-flow';

/** @internal Natural row surface, not an expanded master/detail extent. */
export interface AncestorFrame {
  index: number;
  top: number;
  height: number;
}

/** @internal Uses generation-indexed eligible parents; mounts only capacity-selected ancestors. */
export function layoutAncestors(
  index: AncestorIndex,
  sticky: readonly boolean[],
  offsetAt: (index: number) => number,
  heightAt: (index: number) => number,
  rowAt: (offset: number) => number,
  scrollTop: number,
  viewportHeight: number,
  scopeAt?: (offset: number) => RowFlowPoint | undefined,
  scopeEnd?: (index: number) => number,
): AncestorFrame[] {
  if (!index.rows.length || viewportHeight <= 0) return [];
  let frames: AncestorFrame[] = [];
  let height = 0;
  const dataHeight = (stackHeight: number) => {
    const offset = scrollTop + stackHeight;
    const row = scopeAt?.(offset)?.surface ?? rowAt(offset);
    return row >= 0 ? heightAt(row) : 0;
  };
  const ancestorAt = (row: number) => (sticky[row] && index.subtreeEnds[row] > row + 1 ? row : index.parents[row]);
  const flowAncestor = (owner: number) => (owner < 0 ? -1 : ancestorAt(owner));
  const firstRow = rowAt(scrollTop);
  if (firstRow < 0) return [];
  const point = scopeAt?.(scrollTop);
  let ancestor = point
    ? flowAncestor(point.owner)
    : offsetAt(firstRow) < scrollTop
      ? ancestorAt(firstRow)
      : index.parents[firstRow];
  while (ancestor !== -1) {
    const rowHeight = heightAt(ancestor);
    const nextHeight = height + rowHeight;
    if (nextHeight + dataHeight(nextHeight) > viewportHeight) break;
    frames.push({ index: ancestor, top: 0, height: rowHeight });
    height = nextHeight;
    ancestor = index.parents[ancestor];
  }
  frames.reverse();

  const position = () => {
    const boundaryHeights: number[] = [];
    const ends = frames.map((frame) => scopeEnd?.(frame.index) ?? offsetAt(index.subtreeEnds[frame.index]));
    for (let i = frames.length - 1; i >= 0; i--) {
      boundaryHeights[i] = frames[i].height + (frames[i + 1] && ends[i] === ends[i + 1] ? boundaryHeights[i + 1] : 0);
    }
    let top = 0;
    let previousBottom = 0;
    let count = 0;
    for (const frame of frames) {
      const end = ends[count] - scrollTop;
      // Releasing an outer row must not pull an unscrolled descendant upward.
      if (offsetAt(frame.index) >= scrollTop + top || end <= Math.max(0, previousBottom)) break;
      frame.top = Math.min(top, end - boundaryHeights[count]);
      previousBottom = frame.top + frame.height;
      top += frame.height;
      count++;
    }
    frames = frames.slice(0, count).filter((frame) => frame.top + frame.height > 0);
    height = frames.length ? frames[frames.length - 1].top + frames[frames.length - 1].height : 0;
  };
  position();

  while (frames.length) {
    const offset = scrollTop + height;
    const point = scopeAt?.(offset);
    const row = point?.owner ?? rowAt(offset);
    if (row < 0) break;
    const parent = frames[frames.length - 1].index;
    if (row >= index.subtreeEnds[parent]) break;
    let node = point ? flowAncestor(row) : ancestorAt(row);
    let candidate = -1;
    while (node !== -1 && node !== parent) {
      candidate = node;
      node = index.parents[node];
    }
    if (node !== parent || candidate === -1 || offsetAt(candidate) >= scrollTop + height) break;
    const rowHeight = heightAt(candidate);
    frames.push({ index: candidate, top: height, height: rowHeight });
    height += rowHeight;
    let released = false;
    while (frames.length && height + dataHeight(height) > viewportHeight) {
      height -= frames[0].height;
      frames.shift();
      released = true;
    }
    position();
    if (released) break;
  }
  return frames;
}
