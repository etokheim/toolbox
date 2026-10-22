import type { GridConfig, RowElementInternal, ScrollToRowOptions } from '../types';

const ROW_WINDOW = Symbol.for('tbw.grid.row.window');

/** @internal Opt-in noncontiguous rendering; ordinary virtualization remains contiguous. */
export interface RowWindow {
  indices: readonly number[];
  elements: Map<number, RowElementInternal>;
  select(start: number, end: number): boolean;
  reconcile(pool: RowElementInternal[], create: () => RowElementInternal): RowElementInternal[];
  layout(): void;
  viewport?(): { scrollTop: number; height: number; container: HTMLElement } | undefined;
  reveal?(index: number, options?: ScrollToRowOptions): void;
  pageHeight?(): number;
  captureHeightAnchor?(height: GridConfig['rowHeight']): ((scrollTop: number) => number | undefined) | undefined;
  cancelHeightAnchor?(): void;
}

type RowWindowHost = { [ROW_WINDOW]?: RowWindow };

/** @internal Shared across independently bundled core and plugin entries. */
export function getRowWindow(host: object): RowWindow | undefined {
  return (host as RowWindowHost)[ROW_WINDOW];
}

/** @internal The owner removes its registration before normal row recycling resumes. */
export function setRowWindow(host: object, window: RowWindow | undefined): void {
  if (window) (host as RowWindowHost)[ROW_WINDOW] = window;
  else delete (host as RowWindowHost)[ROW_WINDOW];
}
