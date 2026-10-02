import { CONTROL_RENDER_ERROR, warnDiagnostic } from '../../core/internal/diagnostics';
import type { ControlSlot } from '../../core/plugin/control-view';
import type { RowDragHandleContext } from './types';

export const DRAG_HANDLE_LABEL = 'Drag to reorder, or activate for move options';

export interface HandleRecord<T> {
  identity: unknown;
  element: HTMLElement;
  slot?: ControlSlot<RowDragHandleContext<T>>;
  binding?: DragHandleBinding;
}

export function createDefaultDragHandle(openMenu: (element: HTMLElement) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dg-row-drag-handle';
  container.setAttribute('aria-label', DRAG_HANDLE_LABEL);
  container.setAttribute('role', 'button');
  container.setAttribute('tabindex', '-1');
  container.draggable = true;
  // A tap without dragstart opens the existing non-drag alternative.
  container.addEventListener('click', (event) => {
    event.stopPropagation();
    openMenu(container);
  });
  return container;
}

/** Snapshot the whole row, retaining the grid-scoped styles and original cursor offset. */
export function attachRowCloneDragImage(
  grid: HTMLElement,
  event: DragEvent,
  row: HTMLElement,
  handle: HTMLElement | null,
): void {
  if (!event.dataTransfer) return;
  const rect = row.getBoundingClientRect();
  const clone = row.cloneNode(true) as HTMLElement;
  clone.classList.add('tbw-row-drag-clone');
  clone.classList.remove('dragging', 'drop-target', 'drop-before', 'drop-after', 'flip-animating', 'row-focus');
  clone.removeAttribute('aria-selected');
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  // Core styles and --tbw-column-template are scoped to this grid, not document.body.
  grid.appendChild(clone);
  let offsetX = event.clientX - rect.left;
  let offsetY = event.clientY - rect.top;
  if (handle) {
    const handleRect = handle.getBoundingClientRect();
    offsetX = handleRect.left - rect.left + handleRect.width / 2;
    offsetY = handleRect.top - rect.top + handleRect.height / 2;
  }
  offsetX = Math.max(0, Math.min(rect.width, offsetX));
  offsetY = Math.max(0, Math.min(rect.height, offsetY));
  try {
    event.dataTransfer.setDragImage(clone, offsetX, offsetY);
  } catch {
    /* JSDOM/happy-dom: harmless */
  }
  setTimeout(() => clone.remove(), 0);
}

const bindings = new WeakMap<HTMLElement, DragHandleBinding>();
const INTERACTIVE = 'input,textarea,select,button,a,[contenteditable],.dg-cell-editor';

/** One revocable callback-ref lease. Native listeners run after portal handlers. */
export class DragHandleBinding {
  element: HTMLElement | null = null;
  #abort = new AbortController();
  #attributes = new Map<string, { before: string | null; value: string }>();
  #disposed = false;
  #space = false;

  constructor(
    readonly host: HTMLElement,
    readonly grid: HTMLElement,
    private readonly active: () => boolean,
    private readonly disabled: () => boolean,
    private readonly menu: (element: HTMLElement) => void,
    private readonly key: (event: KeyboardEvent) => void,
    private readonly closeMenu: (element: HTMLElement) => void,
    private readonly label: string,
  ) {
    const signal = this.#abort.signal;
    host.addEventListener(
      'click',
      (event) => {
        if (event.defaultPrevented || !this.owns(event)) return;
        event.stopPropagation();
        if (!this.valid) {
          event.preventDefault();
          return;
        }
        if (this.element) this.menu(this.element);
      },
      { signal },
    );
    host.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || !this.owns(event) || !this.valid) return;
        if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          this.key(event);
          return;
        }
        if (this.element instanceof HTMLButtonElement) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat) this.element?.click();
        } else if (event.key === ' ') {
          event.preventDefault();
          if (!event.repeat) this.#space = true;
        }
      },
      { signal },
    );
    host.addEventListener(
      'keyup',
      (event) => {
        const space = this.#space;
        this.#space = false;
        if (space && event.key === ' ' && !event.defaultPrevented && this.owns(event) && this.valid) {
          event.preventDefault();
          this.element?.click();
        }
      },
      { signal },
    );
    host.addEventListener(
      'focusout',
      () => {
        this.#space = false;
      },
      { signal },
    );
  }

  readonly bind = (element: HTMLElement | null): void => {
    if (this.#disposed || element === this.element) return;
    if (
      element !== null &&
      (!(element instanceof HTMLElement) ||
        (bindings.has(element) && bindings.get(element) !== this) ||
        (element.isConnected && !this.host.contains(element)))
    ) {
      warnDiagnostic(CONTROL_RENDER_ERROR, 'Drag handle must be an HTML element owned by its control.', this.grid.id);
      return;
    }
    this.unbind();
    if (!element) return;
    this.element = element;
    bindings.set(element, this);
    if (!element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) {
      this.#write('aria-label', this.label);
    }
    if (element instanceof HTMLButtonElement) {
      if (!element.hasAttribute('type')) this.#write('type', 'button');
    } else {
      if (!element.hasAttribute('role')) this.#write('role', 'button');
      if (!element.hasAttribute('tabindex')) this.#write('tabindex', '0');
    }
    this.refresh();
  };

  get valid(): boolean {
    return (
      !this.#disposed &&
      !!this.element &&
      this.active() &&
      this.host.contains(this.element) &&
      !this.element.matches(':disabled') &&
      this.element.getAttribute('aria-disabled') !== 'true' &&
      !this.disabled()
    );
  }

  owns(event: Event): boolean {
    for (const target of event.composedPath()) {
      if (target === this.element) return true;
      if (target instanceof Element && target.matches(INTERACTIVE)) return false;
    }
    return false;
  }

  refresh(): void {
    if (this.element) this.#write('draggable', String(!this.disabled()));
  }

  unbind(): void {
    const element = this.element;
    this.element = null;
    this.#space = false;
    if (!element) return;
    bindings.delete(element);
    this.closeMenu(element);
    for (const [name, { before, value }] of this.#attributes) {
      if (element.getAttribute(name) !== value) continue;
      if (before === null) element.removeAttribute(name);
      else element.setAttribute(name, before);
    }
    this.#attributes.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.#abort.abort();
    this.unbind();
  }

  #write(name: string, value: string): void {
    const element = this.element;
    if (!element) return;
    const previous = this.#attributes.get(name);
    const before = previous ? previous.before : element.getAttribute(name);
    this.#attributes.set(name, { before, value });
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
}

export function findDragHandle(event: Event, grid: HTMLElement): DragHandleBinding | undefined {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement) {
      const binding = bindings.get(target);
      if (binding?.grid === grid) return binding;
    }
  }
  return undefined;
}
