import { markControlBoundary, registerControlCleanup, releaseControl } from '../../core/internal/control-lifecycle';
import { ControlSlot } from '../../core/plugin/control-view';
import type { ControlRenderer } from '../../core/types';

interface CheckboxRecord<T> {
  identity: unknown;
  renderer: ControlRenderer<T> | undefined;
  element: HTMLElement;
  slot?: ControlSlot<T>;
}

/** One map per plugin/role. No DOM discovery or framework-specific ownership. */
export class CheckboxControls<T> {
  readonly records = new Map<HTMLElement, CheckboxRecord<T>>();

  render(
    grid: HTMLElement,
    cell: HTMLElement,
    identity: unknown,
    renderer: ControlRenderer<T> | undefined,
    context: (host: HTMLElement, active: () => boolean) => T,
    createDefault: () => HTMLElement,
  ): HTMLElement {
    let record = this.records.get(cell);
    if (
      record &&
      (record.identity !== identity || record.renderer !== renderer || record.element.parentElement !== cell)
    ) {
      this.release(cell);
      record = undefined;
    }
    if (!record) {
      const element = renderer ? document.createElement('span') : createDefault();
      if (renderer) {
        element.style.display = 'contents';
        markControlBoundary(element, grid);
      }
      record = {
        identity,
        renderer,
        element,
        slot: renderer ? new ControlSlot(element, renderer, grid) : undefined,
      };
      this.records.set(cell, record);
    }
    if (record.slot) {
      const current = record;
      const slot = record.slot;
      record.slot.update(
        context(record.element, () => slot.active && this.records.get(cell) === current && grid.contains(cell)),
      );
    }
    return record.element;
  }

  /** Body renderers commit ownership only after core has replaced old content. */
  commit(cell: HTMLElement): void {
    if (this.records.has(cell)) registerControlCleanup(cell, () => this.release(cell));
  }

  release(cell: HTMLElement): void {
    const record = this.records.get(cell);
    if (!record) return;
    this.records.delete(cell);
    // Delete the core's callback before consumer dispose can re-enter.
    releaseControl(cell);
    record.slot?.dispose();
  }

  clear(): void {
    for (const cell of this.records.keys()) this.release(cell);
  }
}
