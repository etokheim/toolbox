import type { GridHost } from '../types';

// Symbols cross the independently bundled core/plugin entry points.
const CLEANUP = Symbol.for('tbw.grid.control.cleanup');
const BOUNDARY = Symbol.for('tbw.grid.control.boundary');

type ControlElement = HTMLElement & {
  [CLEANUP]?: () => void;
  [BOUNDARY]?: HTMLElement;
};

export function registerControlCleanup(cell: HTMLElement, cleanup: () => void): void {
  (cell as ControlElement)[CLEANUP] = cleanup;
}

export function releaseControl(cell: HTMLElement): void {
  const element = cell as ControlElement;
  const cleanup = element[CLEANUP];
  delete element[CLEANUP];
  cleanup?.();
}

export function releaseCell(grid: GridHost, cell: HTMLElement): void {
  releaseControl(cell);
  grid.__frameworkAdapter?.releaseCell?.(cell);
}

export function markControlBoundary(host: HTMLElement, grid: HTMLElement): void {
  (host as ControlElement)[BOUNDARY] = grid;
}

/** Leave native and framework handlers inside plugin controls in charge. */
export function isControlEvent(event: Event, grid: HTMLElement): boolean {
  return event.composedPath().some((target) => (target as ControlElement)[BOUNDARY] === grid);
}
