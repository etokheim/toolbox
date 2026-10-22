import type { RowPosition } from './virtualization';

const ROW_FLOW = Symbol.for('tbw.grid.row.flow');

/** @internal A non-data segment's scope owner and adjacent data surface, never a fake row. */
export interface RowFlowPoint {
  /** Processed owning row, or -1 for the whole-grid scope/outside content. */
  owner: number;
  /** Preceding data surface reserved by capacity policy, or -1 when absent. */
  surface: number;
}

/** @internal Non-data extents share the authoritative row position cache. */
export interface RowFlow {
  prepare(): void;
  after(index: number): number;
  emptyHeight(): number;
  layout(): void;
  bottom(): number;
  exhausted?(): boolean;
  scopeAt?(offset: number): RowFlowPoint | undefined;
  scopeEnd?(index: number, end: number): number;
}

type RowFlowHost = { [ROW_FLOW]?: RowFlow };

/** @internal Shared by independently bundled core and optional plugins. */
export function getRowFlow(host: object): RowFlow | undefined {
  return (host as RowFlowHost)[ROW_FLOW];
}

/** @internal One plugin owns non-data flow extents for a grid. */
export function setRowFlow(host: object, flow: RowFlow | undefined): void {
  if (flow) (host as RowFlowHost)[ROW_FLOW] = flow;
  else delete (host as RowFlowHost)[ROW_FLOW];
}

/** @internal Add gaps without changing data/editor surface heights. */
export function applyRowFlow(cache: RowPosition[], flow: RowFlow): void {
  let offset = 0;
  for (let i = 0; i < cache.length; i++) {
    const entry = cache[i];
    entry.offset += offset;
    entry.after = flow.after(i);
    offset += entry.after;
  }
}
