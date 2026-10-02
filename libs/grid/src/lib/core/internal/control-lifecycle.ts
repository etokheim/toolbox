import type { GridHost } from '../types';

// Symbols cross the independently bundled core/plugin entry points.
const CLEANUP = Symbol.for('tbw.grid.control.cleanup');
const BOUNDARY = Symbol.for('tbw.grid.control.boundary');
const BOUNDARY_OWNER = Symbol.for('tbw.grid.control.boundary.owner');
const DISCLOSURE = Symbol.for('tbw.grid.control.disclosure');

type ControlElement = HTMLElement & {
  [CLEANUP]?: Map<object, () => void>;
  [BOUNDARY]?: HTMLElement;
  [BOUNDARY_OWNER]?: object;
  [DISCLOSURE]?: boolean;
};

type ControlEvent = Event & { [BOUNDARY]?: Set<HTMLElement> };

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
  delete (host as ControlElement)[BOUNDARY_OWNER];
  (host as ControlElement)[BOUNDARY] = grid;
}

/** Release only this lease, never a successor's boundary on the same host. */
export function ownControlBoundary(host: HTMLElement, grid: HTMLElement): () => void {
  const element = host as ControlElement;
  const owner = {};
  markControlBoundary(host, grid);
  element[BOUNDARY_OWNER] = owner;
  const capture = (event: Event) => {
    if (element[BOUNDARY_OWNER] === owner) ((event as ControlEvent)[BOUNDARY] ??= new Set()).add(grid);
  };
  // Keep only this dispatch classified if a native action synchronously releases
  // its host before reaching the grid's delegated bubble listener.
  host.addEventListener('click', capture, true);
  return () => {
    host.removeEventListener('click', capture, true);
    if (element[BOUNDARY_OWNER] !== owner) return;
    delete element[BOUNDARY_OWNER];
    if (element[BOUNDARY] === grid) delete element[BOUNDARY];
  };
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
  return (
    (event as ControlEvent)[BOUNDARY]?.has(grid) ||
    event.composedPath().some((target) => (target as ControlElement)[BOUNDARY] === grid)
  );
}
