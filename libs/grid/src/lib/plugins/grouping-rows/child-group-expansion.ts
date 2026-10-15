import { resolveDefaultExpanded } from './grouping-rows';
import type { DefaultExpandedValue, GroupingRowsConfig, RenderRow } from './types';

/** Parent-local initialization and fixed-section policy; lifetime follows the grouping plugin. */
export class ChildGroupExpansion {
  readonly fixedKeys = new Set<string>();
  #seenKeys = new Set<string>();
  #numericParents = new Set<string>();

  clear(): void {
    this.fixedKeys.clear();
    this.#seenKeys.clear();
    this.#numericParents.clear();
  }

  build(
    build: (expanded: Set<string>) => RenderRow[],
    config: GroupingRowsConfig,
    expanded: Set<string>,
    parentKey: string,
    pending: DefaultExpandedValue | undefined,
  ): RenderRow[] {
    const grouped = build(expanded);
    if (config.childGroupsCollapsible === false) {
      for (const item of grouped) {
        if (item.kind !== 'group') continue;
        this.fixedKeys.add(item.key);
        expanded.add(item.key);
      }
      return grouped;
    }
    const defaultExpanded = config.childDefaultExpanded ?? config.defaultExpanded;
    const numericDefault = typeof defaultExpanded === 'number';
    if (pending === undefined && defaultExpanded !== true && (!numericDefault || this.#numericParents.has(parentKey)))
      return grouped;
    const listKeys: string[] = [];
    for (const item of grouped) if (item.kind === 'group' && item.depth === 0) listKeys.push(item.key);
    const open =
      pending !== undefined
        ? resolveDefaultExpanded(pending, listKeys)
        : numericDefault
          ? resolveDefaultExpanded(defaultExpanded, listKeys)
          : new Set(listKeys.filter((key) => !this.#seenKeys.has(key)));
    if (numericDefault && listKeys.length > 0) this.#numericParents.add(parentKey);
    let added = false;
    for (const key of listKeys) {
      this.#seenKeys.add(key);
      if (open.has(key) && !expanded.has(key)) {
        expanded.add(key);
        added = true;
      }
    }
    return added ? build(expanded) : grouped;
  }
}
