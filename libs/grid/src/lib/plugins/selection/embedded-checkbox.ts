import {
  ownControlBoundary,
  registerControlCleanup,
  unregisterControlCleanup,
} from '../../core/internal/control-lifecycle';
import { CONTROL_RENDER_ERROR, throwDiagnostic, warnDiagnostic } from '../../core/internal/diagnostics';
import type { GridElement } from '../../core/plugin/base-plugin';
import type { CellRenderContext } from '../../core/types';
import type { SelectionRowCheckboxBinding, SelectionRowCheckboxContext } from './types';

interface Binding<T> {
  cell: HTMLElement;
  host: HTMLElement;
  identity: unknown;
  listener: (context: SelectionRowCheckboxContext<T> | null) => void;
  phase: 'pending' | 'active' | 'retired';
  generation: number;
  notification: number;
  context?: SelectionRowCheckboxContext<T> | null;
  inert?: boolean;
  releaseBoundary?: () => void;
}

/** Selection owns the state reader; this registry owns only mounted-control lifetimes. */
export class EmbeddedCheckboxes<T> {
  readonly #records = new Set<Binding<T>>();
  readonly #cells = new WeakMap<HTMLElement, Set<Binding<T>>>();
  readonly #hosts = new WeakMap<HTMLElement, Binding<T>>();
  readonly #pending = new Set<Binding<T>>();
  readonly #notifications = new Map<Binding<T>, number>();
  #queued = false;

  constructor(
    private readonly grid: GridElement,
    private readonly identity: (row: T) => unknown,
    private readonly read: (
      cell: HTMLElement,
      identity: unknown,
      host: HTMLElement,
      active: () => boolean,
    ) => SelectionRowCheckboxContext<T> | null,
  ) {}

  bind(
    context: CellRenderContext<T>,
    host: HTMLElement,
    listener: (context: SelectionRowCheckboxContext<T> | null) => void,
  ): SelectionRowCheckboxBinding<T> {
    const cell = this.#cell(context, host);
    if (this.#hosts.has(host) || typeof listener !== 'function') {
      throwDiagnostic(CONTROL_RENDER_ERROR, 'Embedded checkbox requires an unbound host and a listener.', this.grid.id);
    }
    const record: Binding<T> = {
      cell,
      host,
      identity: this.identity(context.row),
      listener,
      phase: 'pending',
      generation: 0,
      notification: 0,
    };
    this.#records.add(record);
    this.#hosts.set(host, record);
    this.#addPending(record);
    return {
      update: (next) => {
        if (record.phase === 'retired') return false;
        const nextCell = this.#cell(next, host);
        this.#unlink(record);
        record.cell = nextCell;
        record.identity = this.identity(next.row);
        record.context = undefined;
        record.generation++;
        record.notification++;
        record.phase = 'pending';
        this.#addPending(record, false);
        return true;
      },
      dispose: () => this.#retire(record),
    };
  }

  #cell(context: CellRenderContext<T>, host: HTMLElement): HTMLElement {
    const cell = context.cellEl;
    if (
      context.grid !== this.grid ||
      !cell ||
      !(host instanceof HTMLElement) ||
      host === cell ||
      (cell.isConnected && cell.parentElement?.parentElement !== this.grid._bodyEl) ||
      (host.isConnected && (!cell.contains(host) || host.closest('[data-tbw-grid]') !== this.grid))
    ) {
      throwDiagnostic(
        CONTROL_RENDER_ERROR,
        'Embedded checkbox requires its owning body-cell renderer context and a dedicated host.',
        this.grid.id,
      );
    }
    return cell;
  }

  #addPending(record: Binding<T>, inert = true): void {
    let bucket = this.#cells.get(record.cell);
    if (!bucket) this.#cells.set(record.cell, (bucket = new Set()));
    bucket.add(record);
    if (inert) {
      record.inert = record.host.inert;
      record.host.inert = true;
    }
    this.#pending.add(record);
    this.#schedule();
  }

  /** Called after output installation, never while the old cell still owns cleanup. */
  commit(cell: HTMLElement): void {
    if (cell.parentElement?.parentElement !== this.grid._bodyEl || !this.grid.contains(cell)) return;
    this.#cells.get(cell)?.forEach((record) => {
      if (cell.contains(record.host)) this.#refresh(record);
    });
  }

  refresh(): void {
    this.#records.forEach((record) => {
      if (record.phase === 'active') this.#refresh(record);
    });
  }

  clear(): void {
    this.#records.forEach((record) => this.#retire(record));
  }

  #owns(cell: HTMLElement, host: HTMLElement): boolean {
    return (
      this.grid.isConnected &&
      cell.parentElement?.parentElement === this.grid._bodyEl &&
      this.grid.contains(cell) &&
      cell.contains(host) &&
      host.closest('[data-tbw-grid]') === this.grid
    );
  }

  #refresh(record: Binding<T>, reconcile = false): void {
    const { cell, host } = record;
    let generation = record.generation;
    const active = () => record.phase === 'active' && record.generation === generation && this.#owns(cell, host);
    if (!this.#owns(cell, host)) {
      this.#retire(record);
      return;
    }
    const next = this.read(cell, record.identity, host, active);
    if (!next) {
      this.#retire(record);
      return;
    }
    const previous = record.context;
    if (previous && previous.row !== next.row) generation = ++record.generation;
    if (record.phase === 'pending') {
      record.phase = 'active';
      this.#pending.delete(record);
      this.#restoreInert(record);
      record.releaseBoundary = ownControlBoundary(host, this.grid);
      registerControlCleanup(cell, () => this.#retire(record), record);
    }
    if (
      !reconcile &&
      previous &&
      previous.row === next.row &&
      previous.rowIndex === next.rowIndex &&
      previous.checked === next.checked &&
      previous.disabled === next.disabled &&
      previous.selectable === next.selectable &&
      previous.ariaLabel === next.ariaLabel
    )
      return;
    const action = next.setChecked;
    next.setChecked = (checked, modifiers) => {
      if (!active()) return;
      try {
        action(checked, modifiers);
      } finally {
        // Native activation can change input.checked even when selection stays
        // unchanged (Shift/eligibility). Reconcile only this still-current binding.
        if (active()) this.#refresh(record, true);
      }
    };
    record.context = next;
    this.#notify(record);
  }

  #restoreInert(record: Binding<T>): void {
    if (record.inert === undefined) return;
    if (record.host.inert) record.host.inert = record.inert;
    record.inert = undefined;
  }

  #unlink(record: Binding<T>): void {
    unregisterControlCleanup(record.cell, record);
    record.releaseBoundary?.();
    record.releaseBoundary = undefined;
    this.#cells.get(record.cell)?.delete(record);
    this.#pending.delete(record);
    this.#restoreInert(record);
  }

  #retire(record: Binding<T>, notify = true): void {
    if (record.phase === 'retired') return;
    record.phase = 'retired';
    record.generation++;
    this.#unlink(record);
    this.#records.delete(record);
    this.#hosts.delete(record.host);
    record.context = null;
    if (this.grid.isConnected && record.host.contains(record.host.ownerDocument.activeElement)) this.grid.focus();
    if (notify) this.#notify(record);
  }

  #notify(record: Binding<T>): void {
    this.#notifications.set(record, ++record.notification);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      // A renderer may throw, return null, or discard a detached host. No cell
      // cleanup owns those registrations, so settle them at this bounded checkpoint.
      this.#pending.forEach((record) => this.#refresh(record));
      const notifications = [...this.#notifications];
      this.#notifications.clear();
      this.#queued = false;
      for (const [record, version] of notifications) {
        if (record.notification !== version) continue;
        try {
          record.listener(record.context ?? null);
        } catch (error) {
          this.#retire(record, false);
          this.#notifications.delete(record);
          record.notification++;
          warnDiagnostic(CONTROL_RENDER_ERROR, `Embedded checkbox listener failed: ${String(error)}`, this.grid.id);
        }
      }
    });
  }
}
