import { GridClasses } from '../../core/constants';
import { aggregatorRegistry } from '../../core/internal/aggregators';
import { isExpanderColumn } from '../../core/plugin/utility-column';
import type { ColumnConfig } from '../../core/types';
import type { GroupingDisclosures } from './grouping-disclosures';
import type { createGroupRow } from './grouping-rows';
import type { GroupingRowsConfig } from './types';

/** Stateless row presentation; the plugin retains expansion and disclosure lifetimes. */
export class GroupRowView {
  constructor(
    private readonly context: {
      config: () => GroupingRowsConfig;
      columns: () => readonly ColumnConfig[];
      gridElement: () => HTMLElement;
      disclosures: GroupingDisclosures;
      label: (expanded: boolean) => string;
      setIcon: (element: HTMLElement, icon: 'collapse' | 'expand') => void;
    },
  ) {}

  private get config() {
    return this.context.config();
  }
  private get columns() {
    return this.context.columns();
  }
  private get gridElement() {
    return this.context.gridElement();
  }
  get #disclosures() {
    return this.context.disclosures;
  }
  #disclosureLabel(expanded: boolean) {
    return this.context.label(expanded);
  }
  private setIcon(element: HTMLElement, icon: 'collapse' | 'expand') {
    this.context.setIcon(element, icon);
  }

  #appendDisclosure(
    row: { __groupKey: string; __groupDepth: number; __groupExpanded: boolean; __groupCollapsible?: boolean },
    rowEl: HTMLElement,
    cell: HTMLElement,
    handleToggle: () => void,
  ): void {
    if (row.__groupCollapsible === false) return;
    const renderer = this.config.disclosureRenderer;
    const disclosure = renderer
      ? this.#disclosures.create(row.__groupKey, row.__groupDepth, rowEl, cell, renderer)
      : this.createToggleButton(row.__groupExpanded, handleToggle);
    if (disclosure.parentElement !== cell) cell.appendChild(disclosure);
  }

  #groupCell(rowEl: HTMLElement, index: number): HTMLElement {
    const record = this.#disclosures.records.get(rowEl);
    const cell = record ? (rowEl.children[index] as HTMLElement | undefined) : undefined;
    if (!cell) return document.createElement('div');
    // Only generated content is replaced. The control and its focused descendants stay mounted.
    for (const child of Array.from(cell.childNodes)) if (child !== record?.slot.host) child.remove();
    return cell;
  }

  /**
   * Create a toggle button for expanding/collapsing a group.
   */
  createToggleButton(expanded: boolean, handleToggle: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${GridClasses.GROUP_TOGGLE}${expanded ? ` ${GridClasses.EXPANDED}` : ''}`;
    btn.setAttribute('aria-label', this.#disclosureLabel(expanded));
    this.setIcon(btn, expanded ? 'collapse' : 'expand');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleToggle();
    });
    return btn;
  }

  /**
   * Get the formatted label text for a group.
   */
  private getGroupLabelText(value: unknown, depth: number, key: string): string {
    const config = this.config;
    return config.formatLabel ? config.formatLabel(value, depth, key) : String(value);
  }

  renderFullWidthGroupRow(row: ReturnType<typeof createGroupRow>, rowEl: HTMLElement, handleToggle: () => void): void {
    const config = this.config;
    const aggregators = config.aggregators ?? {};
    const groupRows = row.__groupRows ?? [];

    // Full-width mode: single spanning cell with toggle + label + count + aggregates
    const cell = this.#groupCell(rowEl, 0);
    cell.className = 'cell group-full';
    cell.style.gridColumn = '1 / -1';
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('data-col', '0'); // Required for focus/click delegation

    // Toggle button
    this.#appendDisclosure(row, rowEl, cell, handleToggle);

    // Group label
    const label = document.createElement('span');
    label.className = GridClasses.GROUP_LABEL;
    label.textContent = this.getGroupLabelText(row.__groupValue, row.__groupDepth || 0, row.__groupKey);
    cell.appendChild(label);

    // Row count
    if (config.showRowCount !== false) {
      const count = document.createElement('span');
      count.className = GridClasses.GROUP_COUNT;
      count.textContent = `(${row.__groupRowCount ?? row.__groupRows?.length ?? 0})`;
      cell.appendChild(count);
    }

    // Render aggregates if configured
    const aggregatorEntries = Object.entries(aggregators);
    if (aggregatorEntries.length > 0) {
      const aggregatesContainer = document.createElement('span');
      aggregatesContainer.className = 'group-aggregates';

      for (const [field, aggRef] of aggregatorEntries) {
        const col = this.columns.find((c) => c.field === field);
        const result = aggregatorRegistry.run(aggRef, groupRows, field, col);
        if (result != null) {
          const aggSpan = document.createElement('span');
          aggSpan.className = 'group-aggregate';
          aggSpan.setAttribute('data-field', field);
          // Use column header as label if available
          const colHeader = col?.header ?? field;
          aggSpan.textContent = `${colHeader}: ${result}`;
          aggregatesContainer.appendChild(aggSpan);
        }
      }

      if (aggregatesContainer.children.length > 0) {
        cell.appendChild(aggregatesContainer);
      }
    }

    if (cell.parentElement !== rowEl) rowEl.appendChild(cell);
  }

  renderPerColumnGroupRow(row: ReturnType<typeof createGroupRow>, rowEl: HTMLElement, handleToggle: () => void): void {
    const config = this.config;
    const aggregators = config.aggregators ?? {};
    const columns = this.columns;
    const groupRows = row.__groupRows ?? [];

    // Get grid template from the grid element
    const bodyEl = this.gridElement?.querySelector('.body') as HTMLElement | null;
    const gridTemplate = bodyEl?.style.gridTemplateColumns || '';
    if (gridTemplate) {
      rowEl.style.display = 'grid';
      rowEl.style.gridTemplateColumns = gridTemplate;
    }

    // Track whether we've rendered the toggle button yet (should be in first non-expander column)
    let toggleRendered = false;

    columns.forEach((col, colIdx) => {
      const cell = this.#groupCell(rowEl, colIdx);
      cell.className = 'cell group-cell';
      cell.setAttribute('data-col', String(colIdx));
      cell.setAttribute('role', 'gridcell');

      // Skip expander columns (they're handled by other plugins like MasterDetail/Tree)
      // but still render an empty cell to maintain grid structure
      if (isExpanderColumn(col)) {
        cell.setAttribute('data-field', col.field);
        if (cell.parentElement !== rowEl) rowEl.appendChild(cell);
        return;
      }

      // First non-expander column gets the toggle button + label
      if (!toggleRendered) {
        toggleRendered = true;
        this.#appendDisclosure(row, rowEl, cell, handleToggle);

        const label = document.createElement('span');
        const firstColAgg = aggregators[col.field];
        if (firstColAgg) {
          const aggResult = aggregatorRegistry.run(firstColAgg, groupRows, col.field, col);
          label.textContent = aggResult != null ? String(aggResult) : String(row.__groupValue);
        } else {
          label.textContent = this.getGroupLabelText(row.__groupValue, row.__groupDepth || 0, row.__groupKey);
        }
        cell.appendChild(label);

        if (config.showRowCount !== false) {
          const count = document.createElement('span');
          count.className = GridClasses.GROUP_COUNT;
          count.textContent = ` (${groupRows.length})`;
          cell.appendChild(count);
        }
      } else {
        // Other columns: run aggregator if defined
        const aggRef = aggregators[col.field];
        if (aggRef) {
          const result = aggregatorRegistry.run(aggRef, groupRows, col.field, col);
          cell.textContent = result != null ? String(result) : '';
        } else {
          cell.textContent = '';
        }
      }

      if (cell.parentElement !== rowEl) rowEl.appendChild(cell);
    });
  }
}
