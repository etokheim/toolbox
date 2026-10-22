/**
 * Hierarchy Plugin
 *
 * Owns the hierarchical row model shared by structure-contributing plugins.
 */

import type { PluginManifest } from '../../core/plugin/base-plugin';
import { BaseGridPlugin } from '../../core/plugin/base-plugin';
import { RowMetadata } from '../../core/plugin/row-metadata';
import type { RowElementInternal } from '../../core/types';
import { buildHierarchyModel, type HierarchyModel } from './hierarchy';
import type { HierarchyContributor, HierarchyRowMeta } from './types';

function isContributor(plugin: unknown): plugin is HierarchyContributor & BaseGridPlugin {
  return typeof (plugin as Partial<HierarchyContributor>).processSiblings === 'function';
}

function processRowsPriority(plugin: BaseGridPlugin): number {
  return (plugin.constructor as typeof BaseGridPlugin).manifest?.hookPriority?.processRows ?? 0;
}

/**
 * Hierarchy Plugin for tbw-grid
 *
 * Builds one hierarchical row model from every attached structure contributor
 * — {@link https://toolboxjs.com/grid/plugins/tree/ | TreePlugin} discovers
 * child rows, {@link https://toolboxjs.com/grid/plugins/grouping-rows/ | GroupingRowsPlugin}
 * groups sibling lists — and announces each row's position with the WAI-ARIA
 * treegrid pattern (`aria-level` / `aria-setsize` / `aria-posinset`).
 *
 * Contributors know nothing about each other, so they compose: a grid with
 * both Tree and GroupingRows groups the children of every tree level.
 *
 * You never need to add this plugin yourself — TreePlugin and
 * GroupingRowsPlugin declare it as a dependency and the grid attaches it
 * automatically. It has no configuration.
 *
 * @example Group the children of every tree node
 * ```ts
 * import { TreePlugin } from '@toolbox-web/grid/plugins/tree';
 * import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';
 *
 * grid.gridConfig = {
 *   plugins: [
 *     new TreePlugin({ childrenField: 'children' }),
 *     new GroupingRowsPlugin({
 *       // Leave the root level ungrouped, group every child level by kind
 *       groupOn: (row, { depth }) => (depth > 0 ? row.kind : null),
 *     }),
 *   ],
 * };
 * ```
 *
 * @since 3.9.0
 */
export class HierarchyPlugin extends BaseGridPlugin {
  /** @internal */
  static override readonly manifest: PluginManifest = {
    modifiesRowStructure: true,
  };

  /** @internal */
  readonly name = 'hierarchy';

  #model: HierarchyModel = { rows: [], positions: new WeakMap() };
  #metadata = new RowMetadata();
  #generation = 0;

  /** @internal */
  override detach(): void {
    this.#generation++;
    for (const element of this.#metadata.elements) this.#metadata.release(element);
    this.#model = { rows: [], positions: new WeakMap() };
    super.detach();
  }

  /**
   * Build the row model for a contributor's `processRows` hook.
   *
   * Every contributor forwards its hook here; only the one that runs last in
   * the `processRows` pipeline builds the model (for all contributors at
   * once) — the earlier ones pass their rows through untouched.
   *
   * @example
   * ```ts
   * override processRows(rows: readonly unknown[]): unknown[] {
   *   return this.grid.getPluginByName('hierarchy')?.process(rows, this) ?? [...rows];
   * }
   * ```
   *
   * @since 3.9.0
   */
  process(rows: readonly unknown[], caller: HierarchyContributor): unknown[] {
    const contributors = this.#contributors();
    const attached = contributors.includes(caller as HierarchyContributor & BaseGridPlugin);
    if (attached && contributors[contributors.length - 1] !== caller) return rows as unknown[];
    const generation = ++this.#generation;
    this.#model = { rows: [], positions: new WeakMap() };
    const model = buildHierarchyModel(rows, attached ? contributors : [caller]);
    if (generation !== this.#generation) throw new Error('Hierarchy generation changed during row processing');
    this.#model = model;
    return model.rows;
  }

  /**
   * Hierarchy position of a row in the current row model, or `undefined` when
   * the row is not rendered (e.g. collapsed under a parent).
   *
   * @example
   * ```ts
   * const meta = grid.getPluginByName('hierarchy')?.getRowMeta(grid.rows[0]);
   * console.log(meta?.level, meta?.posInSet, meta?.setSize);
   * ```
   *
   * @since 3.9.0
   */
  getRowMeta(row: unknown): HierarchyRowMeta | undefined {
    return typeof row === 'object' && row !== null ? this.#model.positions.get(row) : undefined;
  }

  /** @internal Complete source generation before downstream visibility projection. */
  getRowModel(): HierarchyModel {
    return this.#model;
  }

  /** @internal */
  override afterRender(): void {
    this.#applyAria();
  }

  /** @internal */
  override onScrollRender(): void {
    this.#applyAria();
  }

  /** Attached contributors, in `processRows` hook order. */
  #contributors(): Array<HierarchyContributor & BaseGridPlugin> {
    const plugins = (this.grid?._pluginManager?.getPlugins?.() ?? []) as readonly BaseGridPlugin[];
    return plugins.filter(isContributor).sort((a, b) => processRowsPriority(a) - processRowsPriority(b));
  }

  #applyAria(): void {
    const active = this.#contributors().length > 0;
    for (const element of this.#metadata.elements) {
      if (!active || !this.gridElement.contains(element)) this.#metadata.release(element);
    }
    if (!active) return;
    const body = this.gridElement?.querySelector('.rows');
    if (!body) return;

    let hierarchical = false;
    for (const rowEl of body.querySelectorAll<HTMLElement>('.data-grid-row')) {
      const meta = this.getRowMeta((rowEl as RowElementInternal).__rowDataRef);
      if (!meta) {
        // Pooled row elements may carry a position from a previous row model.
        this.#metadata.release(rowEl);
        continue;
      }
      hierarchical = true;
      this.#metadata.set(rowEl, 'aria-level', String(meta.level));
      this.#metadata.set(rowEl, 'aria-setsize', String(meta.setSize));
      this.#metadata.set(rowEl, 'aria-posinset', String(meta.posInSet));
    }

    // `treegrid` only while the model has hierarchy, so per-row level/setsize/posinset are valid in context.
    const rowsBody = this.gridElement?.querySelector<HTMLElement>('.rows-body');
    if (rowsBody) {
      if (hierarchical) this.#metadata.set(rowsBody, 'role', 'treegrid');
      else this.#metadata.release(rowsBody);
    }
  }
}
