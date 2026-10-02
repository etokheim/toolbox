import type { GridHost } from '../types';

// Symbols cross the independently bundled core/plugin entry points.
const CLEANUP = Symbol.for('tbw.grid.control.cleanup');
const BOUNDARY = Symbol.for('tbw.grid.control.boundary');
const DISCLOSURE = Symbol.for('tbw.grid.control.disclosure');

type ControlElement = HTMLElement & {
  [CLEANUP]?: Map<object, () => void>;
  [BOUNDARY]?: HTMLElement;
  [DISCLOSURE]?: boolean;
};

export function registerControlCleanup(cell: HTMLElement, cleanup: () => void, owner: object = cell): void {
  const element = cell as ControlElement;
  (element[CLEANUP] ??= new Map()).set(owner, cleanup);
}

export function unregisterControlCleanup(cell: HTMLElement, owner: object): void {
  (cell as ControlElement)[CLEANUP]?.delete(owner);
}

export function releaseControl(cell: HTMLElement): void {
  const element = cell as ControlElement;
  const cleanups = element[CLEANUP];
  delete element[CLEANUP];
  cleanups?.forEach((cleanup) => cleanup());
}

export function releaseCell(grid: GridHost, cell: HTMLElement): void {
  releaseControl(cell);
  grid.__frameworkAdapter?.releaseCell?.(cell);
}

export function markControlBoundary(host: HTMLElement, grid: HTMLElement): void {
  (host as ControlElement)[BOUNDARY] = grid;
}

/** Disclosure buttons retain native activation but delegate cell navigation to the grid. */
export function markDisclosureBoundary(host: HTMLElement, grid: HTMLElement): void {
  markControlBoundary(host, grid);
  (host as ControlElement)[DISCLOSURE] = true;
}

export function disclosureNavigationCell(event: KeyboardEvent, grid: HTMLElement): HTMLElement | null {
  if (
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(event.key)
  ) {
    return null;
  }
  const host = event.composedPath().find((target) => {
    const element = target as ControlElement;
    return element[BOUNDARY] === grid && element[DISCLOSURE];
  }) as HTMLElement | undefined;
  return host?.closest<HTMLElement>('.cell[data-col]') ?? null;
}

/** Leave native and framework handlers inside plugin controls in charge. */
export function isControlEvent(event: Event, grid: HTMLElement): boolean {
  return event.composedPath().some((target) => (target as ControlElement)[BOUNDARY] === grid);
}
