import { GridClasses } from '../constants';

// Share state across independently bundled core/plugin entries.
const HOVER = Symbol.for('tbw.grid.row.hover');
type HoverState = { row: HTMLElement | null; listeners: Set<() => void> };
type HoverHost = HTMLElement & { [HOVER]?: HoverState };

function stateFor(host: HoverHost): HoverState {
  return (host[HOVER] ??= { row: null, listeners: new Set() });
}

export function getHoveredRow(host: HTMLElement): HTMLElement | null {
  return (host as HoverHost)[HOVER]?.row ?? null;
}

export function observeRowHover(host: HTMLElement, listener: () => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const state = stateFor(host);
  state.listeners.add(listener);
  signal.addEventListener('abort', () => state.listeners.delete(listener), { once: true });
}

/** Reconcile row presentation without synthesizing browser pointer events. */
export function setupRowHover(host: HTMLElement, signal: AbortSignal): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('Row hover requires a document with a window.');
  let x = 0;
  let y = 0;
  let active = false;
  let pending = 0;
  const state = stateFor(host);

  const update = (row: HTMLElement | null): void => {
    const changed = row !== state.row;
    if (changed) state.row?.removeAttribute('data-tbw-hovered');
    state.row = row;
    // A recycled/rebuilt row can have lost the marker without changing identity.
    if (row && !row.hasAttribute('data-tbw-hovered')) row.setAttribute('data-tbw-hovered', '');
    if (changed) state.listeners.forEach((listener) => listener());
  };

  const clear = (): void => {
    active = false;
    if (pending) win.cancelAnimationFrame(pending);
    pending = 0;
    update(null);
  };
  const reconcile = (): void => {
    pending = 0;
    // One hit test, before either attribute write; never scan the row pool.
    const hit = doc.elementFromPoint(x, y);
    const row = hit?.closest<HTMLElement>(`.${GridClasses.DATA_ROW}`) ?? null;
    const next = hit?.closest('tbw-grid, [data-tbw-grid]') === host ? row : null;
    update(next);
  };
  const schedule = (): void => {
    if (active && !pending && !signal.aborted) pending = win.requestAnimationFrame(reconcile);
  };
  const pointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !host.contains(event.target as Node | null)) {
      clear();
      return;
    }
    x = event.clientX;
    y = event.clientY;
    active = true;
    schedule();
  };

  // Capture observes controls that stop propagation, without taking their input.
  doc.addEventListener('pointermove', pointer, { capture: true, passive: true, signal });
  doc.addEventListener('pointerover', pointer, { capture: true, passive: true, signal });
  doc.addEventListener('pointerdown', pointer, { capture: true, passive: true, signal });
  doc.addEventListener('pointercancel', clear, { capture: true, passive: true, signal });
  doc.addEventListener(
    'pointerout',
    (event) => {
      if (!event.relatedTarget) clear();
    },
    { capture: true, passive: true, signal },
  );
  // Includes outer-page and horizontal scrolling; the host may move under the pointer.
  doc.addEventListener('scroll', schedule, { capture: true, passive: true, signal });
  win.addEventListener('blur', clear, { signal });
  signal.addEventListener('abort', clear, { once: true });
  return schedule;
}
