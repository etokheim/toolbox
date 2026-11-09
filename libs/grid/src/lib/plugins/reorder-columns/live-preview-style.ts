/**
 * Live-preview transforms for the ReorderPlugin.
 *
 * A scoped stylesheet rather than inline styles, so body rows recycled by
 * vertical scrolling during the drag are shifted too.
 * @internal
 */

/** Grid attribute scoping the live-preview stylesheet to one grid. */
export const PREVIEW_ATTR = 'data-tbw-reorder-preview';
/** Class on the header cells a pointer drag has lifted; they position themselves. */
export const LIFTED = 'tbw-reorder-lifted';

let previewScopeSeq = 0;

/** @internal */
export class LivePreviewStyle {
  #style: HTMLStyleElement | null = null;
  #scope = '';
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: () => HTMLElement | undefined,
    /** Fields a group header cell spans. */
    private readonly groupFields: (cell: HTMLElement) => string[],
    /** Transition duration in ms, 0 when animation is off. */
    private readonly duration: () => number,
  ) {}

  /** Translate every listed field by its offset; unlisted fields rest. */
  write(deltas: Map<string, number>): void {
    const gridEl = this.host();
    if (!gridEl) return;
    clearTimeout(this.#timer);
    if (!this.#style) {
      this.#scope ||= String(++previewScopeSeq);
      const style = document.createElement('style');
      const root = gridEl.getRootNode();
      (root instanceof ShadowRoot ? root : document.head).appendChild(style);
      this.#style = style;
    }
    gridEl.setAttribute(PREVIEW_ATTR, this.#scope);

    const ms = this.duration();
    const scope = `[${PREVIEW_ATTR}="${this.#scope}"]`;
    // Skip cells of a nested grid (e.g. a master-detail row) that share field names.
    const own = `:not(${scope} tbw-grid *)`;
    const rules: string[] = [];
    if (ms) rules.push(`${scope} .cell[data-field]${own}{transition:transform ${ms}ms ease-out}`);
    deltas.forEach((dx, f) =>
      rules.push(`${scope} .cell[data-field="${CSS.escape(f)}"]${own}{transform:translateX(${dx}px)}`),
    );
    this.#style.textContent = rules.join('\n');

    // A group header slides with its columns only when they all move together.
    gridEl.querySelectorAll<HTMLElement>('.header-group-row > .cell[data-group]').forEach((cell) => {
      if (cell.classList.contains(LIFTED)) return;
      const fields = this.groupFields(cell);
      const dx = deltas.get(fields[0]) ?? 0;
      const together = fields.every((f) => (deltas.get(f) ?? 0) === dx);
      cell.style.transition = ms ? `transform ${ms}ms ease-out` : '';
      cell.style.transform = together && dx ? `translateX(${dx}px)` : '';
    });
  }

  /** Drop the preview; `animate` slides cells back to their slots first. */
  end(animate: boolean): void {
    const gridEl = this.host();
    if (!gridEl || !this.#style) return;
    const clear = () => {
      if (this.#style) this.#style.textContent = '';
      gridEl.removeAttribute(PREVIEW_ATTR);
      gridEl.querySelectorAll<HTMLElement>('.header-group-row > .cell[data-group]').forEach((cell) => {
        cell.style.transition = '';
        cell.style.transform = '';
      });
    };
    const ms = this.duration();
    if (animate && ms) {
      this.write(new Map());
      this.#timer = setTimeout(clear, ms + 50);
    } else {
      clearTimeout(this.#timer);
      clear();
    }
  }

  /** Remove the stylesheet (plugin detach). */
  dispose(): void {
    clearTimeout(this.#timer);
    this.#style?.remove();
    this.#style = null;
  }
}
