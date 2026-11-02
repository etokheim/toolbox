import type { CommitCellValueContext } from '../plugin/types';
import type { CellChangeDetail, GridHost } from '../types';
import { readCellField } from './value-accessor';

/** Resolve every veto before executing the built-in writer. Legacy participants remain synchronous. */
export function queryCellCommit(grid: GridHost, context: CommitCellValueContext): boolean | undefined {
  const pending: NonNullable<CommitCellValueContext['deferredWrite']> = (context.deferredWrite = {});
  const responses = grid.query?.<boolean>('commitCellValue', context) ?? [];
  if (responses.includes(false)) return false;
  if (pending.apply) return pending.apply();
  if (!responses.includes(true)) return undefined;
  context.newValue = readCellField(context.row, context.field);
  return true;
}

/** The write owner emits once; this event is not a cancelable proposal. */
export function emitCellChange(grid: GridHost, detail: CellChangeDetail): void {
  grid.dispatchEvent(new CustomEvent('cell-change', { detail, bubbles: true, composed: true }));
}
