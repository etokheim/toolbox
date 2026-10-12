import {
  markDisclosureBoundary,
  ownControlBoundary,
  registerControlCleanup,
  unregisterControlCleanup,
} from '../../core/internal/control-lifecycle';
import { ControlSlot } from '../../core/plugin/control-view';
import type { PublicGrid } from '../../core/types';
import type { GroupingRowsConfig, GroupingRowsDisclosureContext as Context } from './types';

type State = Omit<Context, 'host' | 'setExpanded'>;
interface Owner {
  grid(): PublicGrid & HTMLElement;
  config(): GroupingRowsConfig;
  state(rowIndex: number): State | undefined;
  toggle(key: string): void;
  nativeButton(key: string): HTMLElement;
}
interface Record {
  key: string;
  depth: number;
  rowIndex: number;
  cell: HTMLElement;
  slot: ControlSlot<Context>;
  releaseBoundary(): void;
}

/** Owns control leases only; all group identity and expansion state comes from the plugin. */
export class GroupingDisclosures {
  readonly records = new Map<HTMLElement, Record>();

  constructor(private readonly owner: Owner) {}

  syncRow(
    row: { __isGroupRow?: boolean; __groupKey?: string; __groupDepth?: number } | undefined,
    rowEl: HTMLElement,
    rowIndex: number,
  ): void {
    const record = this.records.get(rowEl);
    if (!record) return;
    if (
      !row?.__isGroupRow ||
      record.key !== row.__groupKey ||
      record.depth !== row.__groupDepth ||
      !rowEl.contains(record.slot.host) ||
      !this.owner.config().disclosureRenderer ||
      this.owner.config().groupRowRenderer
    ) {
      this.release(rowEl);
    } else {
      record.rowIndex = rowIndex;
    }
  }

  refresh(): void {
    for (const [rowEl, record] of this.records) {
      if (!this.owner.grid().contains(rowEl) || !rowEl.contains(record.slot.host)) this.release(rowEl);
      else this.update(rowEl);
    }
  }

  release(rowEl: HTMLElement): void {
    const record = this.records.get(rowEl);
    if (!record) return;
    this.records.delete(rowEl);
    unregisterControlCleanup(record.cell, this);
    record.slot.dispose();
    record.releaseBoundary();
  }

  releaseAll(): void {
    for (const rowEl of this.records.keys()) this.release(rowEl);
  }

  update(rowEl: HTMLElement, rowIndex?: number): void {
    const record = this.records.get(rowEl);
    if (!record) return;
    if (rowIndex !== undefined) record.rowIndex = rowIndex;
    const state = this.owner.state(record.rowIndex);
    if (!state || state.key !== record.key || state.depth !== record.depth) {
      this.release(rowEl);
      return;
    }
    const renderer = this.owner.config().disclosureRenderer;
    if (record.slot.renderer !== renderer) {
      const host = record.slot.host;
      record.slot.dispose();
      if (!renderer) {
        host.replaceWith(this.owner.nativeButton(record.key));
        this.release(rowEl);
        return;
      }
      record.slot = new ControlSlot(host, renderer, state.grid);
    }
    const slot = record.slot;
    slot.update({
      ...state,
      host: slot.host,
      setExpanded: (next) => {
        const current = this.owner.state(record.rowIndex);
        if (
          !slot.active ||
          record.slot !== slot ||
          this.records.get(rowEl) !== record ||
          !state.grid.isConnected ||
          !state.grid.contains(rowEl) ||
          !record.cell.contains(slot.host) ||
          this.owner.config().disclosureRenderer !== slot.renderer ||
          !current ||
          current.key !== record.key ||
          current.depth !== record.depth ||
          current.expanded === next
        )
          return;
        this.owner.toggle(record.key);
      },
    });
  }

  create(
    key: string,
    depth: number,
    rowEl: HTMLElement,
    cell: HTMLElement,
    renderer: NonNullable<GroupingRowsConfig['disclosureRenderer']>,
  ): HTMLElement {
    let record = this.records.get(rowEl);
    if (!record) {
      const host = document.createElement('span');
      host.style.display = 'contents';
      const grid = this.owner.grid();
      markDisclosureBoundary(host, grid);
      const releaseBoundary = ownControlBoundary(host, grid);
      record = { key, depth, rowIndex: -1, cell, slot: new ControlSlot(host, renderer, grid), releaseBoundary };
      this.records.set(rowEl, record);
      registerControlCleanup(cell, () => this.release(rowEl), this);
    }
    return record.slot.host;
  }
}
