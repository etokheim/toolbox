import { CONFIG_RULE_ERROR, throwDiagnostic } from '../../core/internal/diagnostics';
import { announce, getA11yMessage } from '../../core/internal/aria';
import { readCellField } from '../../core/internal/value-accessor';
import {
  BaseGridPlugin,
  type CellClickEvent,
  type GridElement,
  type PluginManifest,
} from '../../core/plugin/base-plugin';
import type { CellEditRequest } from '../editing/internal/single-cell-entry';
import { findEntryCell, isCellEntryTarget } from '../editing/internal/single-cell-entry';
import type {} from '../editing/types';
import type {} from '../selection/types';
import type {} from '../undo-redo/types';
import { clearSelectedCells } from './clear-selection';
import type { CellEntryConfig } from './types';

/**
 * Single-cell keyboard entry with optional single-click activation.
 *
 * Configure Editing with `mode: 'row', editOn: 'manual'` and Selection with
 * `mode: 'cell'` or `'range'`. Editing's opt-in `tabToEdit` continues an edit with
 * Tab/Shift+Tab. Selected-cell clearing is separately opt-in; printable-key
 * entry is not installed.
 *
 * @since 3.9.0
 */
export class CellEntryPlugin extends BaseGridPlugin<CellEntryConfig> {
  /** @internal */
  readonly name = 'cellEntry';

  /** @internal */
  static override readonly dependencies = [
    { name: 'editing', required: true },
    { name: 'selection', required: true },
    { name: 'undoRedo', required: false },
  ];

  /** @internal */
  static override readonly manifest: PluginManifest<CellEntryConfig> = {
    hookPriority: { onCellClick: 20, onKeyDown: -20 },
    ownedProperties: [
      { property: 'clearValue', level: 'column', description: 'Explicit selected-cell clear value rule' },
    ],
    events: [{ type: 'cell-clear', description: 'Selected-cell clear outcomes or oversized-action rejection' }],
  };

  #selectionGesture = false;
  #clearing = false;

  /** @internal */
  override attach(grid: GridElement): void {
    super.attach(grid);
    const editing = grid.getPluginByName('editing')?.resolvedConfig;
    const selection = grid.getPluginByName('selection')?.resolvedConfig;
    if (
      !editing ||
      (editing.mode !== undefined && editing.mode !== 'row') ||
      (editing.editOn !== 'manual' && editing.editOn !== false) ||
      !selection ||
      (selection.mode !== 'cell' && selection.mode !== 'range') ||
      (selection.triggerOn !== undefined && selection.triggerOn !== 'click') ||
      (this.config.singleClick !== undefined && typeof this.config.singleClick !== 'boolean') ||
      (this.config.clearOnDelete !== undefined && typeof this.config.clearOnDelete !== 'boolean')
    ) {
      throwDiagnostic(
        CONFIG_RULE_ERROR,
        'CellEntry requires Editing { mode: "row", editOn: "manual" } and Selection { mode: "cell" | "range", triggerOn: "click" }.',
        grid.id,
        this.name,
      );
    }
    if (this.config.clearOnDelete && !grid.getPluginByName('undoRedo')) {
      throwDiagnostic(CONFIG_RULE_ERROR, 'CellEntry clearOnDelete requires UndoRedo.', grid.id, this.name);
    }
    const signal = this.disconnectSignal;
    grid.addEventListener('pointerdown', () => (this.#selectionGesture = false), { capture: true, signal });
    // Capture belongs to the existing drag/long-press recognizer, not a second threshold.
    grid.addEventListener(
      'gotpointercapture',
      (event) => {
        // Touch implicitly captures the pressed cell; only the render root's
        // explicit capture denotes a promoted grid gesture.
        if (event.target === grid) this.#selectionGesture = true;
      },
      { capture: true, signal },
    );
    grid.addEventListener(
      'click',
      (event) => {
        if (!this.#selectionGesture) return;
        this.#selectionGesture = false;
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true, signal },
    );
  }

  /** @internal */
  override onCellClick({ originalEvent: event, row, field }: CellClickEvent): boolean {
    if (
      !this.config.singleClick ||
      (event.type !== 'click' && event.type !== 'dblclick') ||
      event.button !== 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.defaultPrevented ||
      !isCellEntryTarget(event, this.gridElement)
    ) {
      return false;
    }
    if (event.type === 'dblclick') return this.grid.query<boolean>('isEditing').some(Boolean);
    const current = findEntryCell(this.grid, row, field);
    if (!current || !this.grid.getPluginByName('selection')?.isCellSelected(current.rowIndex, current.colIndex))
      return false;
    return this.#enter(current.rowIndex, current.colIndex, event);
  }

  /** @internal */
  override onKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Delete' || event.key === 'Backspace') return this.#clear(event);
    if (event.key !== 'Enter' && event.key !== 'F2') return false;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      this.grid.effectiveConfig.selectable === false ||
      this.grid.getPluginByName('selection')?.resolvedConfig.enabled === false ||
      !isCellEntryTarget(event, this.gridElement)
    ) {
      return true;
    }
    if (this.grid.query<boolean>('isEditing').some(Boolean)) return false;
    const { _focusRow: rowIndex, _focusCol: colIndex } = this.grid;
    const column = this.visibleColumns[colIndex];
    const row = this.rows[rowIndex];
    if (
      !column ||
      !row ||
      this.grid.getPluginByName('editing')?.resolvedConfig.editOn === false ||
      !findEntryCell(this.grid, row, column.field)
    )
      return true;
    const activate = new CustomEvent('cell-activate', {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: {
        rowIndex,
        colIndex,
        field: column.field,
        column,
        row,
        value: readCellField(row, column.field),
        cellEl: this.grid.findRenderedRowElement(rowIndex)?.querySelector(`[data-col="${colIndex}"]`),
        trigger: 'keyboard',
        originalEvent: event,
      },
    });
    this.gridElement.dispatchEvent(activate);
    const current = findEntryCell(this.grid, row, column.field);
    if (!activate.defaultPrevented && current) this.#enter(current.rowIndex, current.colIndex, event);
    event.preventDefault();
    return true;
  }

  #clear(event: KeyboardEvent): boolean {
    if (
      !this.config.clearOnDelete ||
      this.#clearing ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      this.grid.effectiveConfig.selectable === false ||
      this.grid.getPluginByName('selection')?.resolvedConfig.enabled === false ||
      this.grid.getPluginByName('editing')?.resolvedConfig.editOn === false ||
      this.grid.query<boolean>('isEditing').some(Boolean) ||
      !isCellEntryTarget(event, this.gridElement)
    )
      return false;
    const selection = this.grid.getPluginByName('selection')?.getSelection();
    const undo = this.grid.getPluginByName('undoRedo');
    if (!undo || !selection?.ranges.length || (selection.activeAxis !== 'cell' && selection.activeAxis !== 'range'))
      return false;
    event.preventDefault();
    this.#clearing = true;
    try {
      const result = clearSelectedCells(this.grid, selection.ranges, undo);
      const cleared = result.cells.filter((cell) => cell.status === 'cleared').length;
      announce(
        this.gridElement,
        result.limitExceeded
          ? getA11yMessage(this.gridElement, 'cellClearLimitExceeded')
          : getA11yMessage(this.gridElement, 'cellsCleared', cleared, result.cells.length - cleared),
      );
      this.emit('cell-clear', result);
    } finally {
      this.#clearing = false;
    }
    return true;
  }

  #enter(rowIndex: number, colIndex: number, event: MouseEvent | KeyboardEvent): boolean {
    if (!this.visibleColumns[colIndex]) return false;
    const request: CellEditRequest = { rowIndex, field: this.visibleColumns[colIndex].field, event };
    return this.grid.query<boolean>('beginCellEdit', request).some(Boolean);
  }
}

declare module '../../core/types' {
  interface PluginNameMap {
    cellEntry: CellEntryPlugin;
  }
}
