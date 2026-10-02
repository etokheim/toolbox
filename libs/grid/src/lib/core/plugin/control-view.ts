import { CONTROL_RENDER_ERROR, warnDiagnostic } from '../internal/diagnostics';
import type { ControlRenderer, ControlView } from '../types';

/** Internal owner of one renderer output; selection owns identity and actions. */
export class ControlSlot<TContext> {
  #view?: ControlView<TContext>;
  #disposed = false;

  constructor(
    readonly host: HTMLElement,
    readonly renderer: ControlRenderer<TContext>,
    readonly grid: HTMLElement,
  ) {}

  get active(): boolean {
    return !this.#disposed;
  }

  update(context: TContext): void {
    if (this.#disposed) return;
    try {
      if (this.#view) {
        this.#view.update(context);
        return;
      }
      const output = this.renderer(context);
      if (output !== null && !(output instanceof HTMLElement) && !isControlView<TContext>(output)) {
        throw new TypeError('Expected HTMLElement, ControlView, or null.');
      }
      const element = isControlView<TContext>(output) ? output.element : output;
      if (isControlView<TContext>(output)) this.#view = output;
      if (element?.parentElement !== this.host) {
        this.#restoreFocus();
        this.host.replaceChildren(...(element ? [element] : []));
      }
    } catch (error) {
      warnDiagnostic(CONTROL_RENDER_ERROR, `Control renderer failed: ${String(error)}`, this.grid.id);
      this.dispose();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const view = this.#view;
    this.#view = undefined;
    this.#restoreFocus();
    try {
      view?.dispose?.();
    } catch (error) {
      warnDiagnostic(CONTROL_RENDER_ERROR, `Control disposal failed: ${String(error)}`, this.grid.id);
    } finally {
      // Detach the output, not its descendants: a framework may unmount later.
      this.host.replaceChildren();
    }
  }

  #restoreFocus(): void {
    if (this.host.contains(this.host.ownerDocument.activeElement)) this.grid.focus({ preventScroll: true });
  }
}

function isControlView<TContext>(value: unknown): value is ControlView<TContext> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'element' in value &&
    value.element instanceof HTMLElement &&
    'update' in value &&
    typeof value.update === 'function' &&
    (!('dispose' in value) || value.dispose === undefined || typeof value.dispose === 'function')
  );
}
