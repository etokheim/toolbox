/**
 * Row Drag-Drop feature for @toolbox-web/grid
 *
 * Drag rows within a single grid and (with `dropZone`) between grids.
 *
 * @example
 * ```typescript
 * import '@toolbox-web/grid/features/row-drag-drop';
 *
 * grid.gridConfig = { features: { rowDragDrop: { dropZone: 'tasks' } } };
 * ```
 */

import { RowDragDropPlugin, type RowDragDropConfig } from '../plugins/row-drag-drop';
import { registerFeature } from './registry';

declare module '../core/types' {
  interface FeatureConfig<TRow = unknown> {
    /** Enable row drag-drop (intra-grid + optional cross-grid via `dropZone`). */
    rowDragDrop?: boolean | RowDragDropConfig<TRow>;
  }
}

const factory = (config: unknown) => {
  if (config === true) {
    return new RowDragDropPlugin();
  }
  return new RowDragDropPlugin((config as RowDragDropConfig) ?? undefined);
};

registerFeature('rowDragDrop', factory);

/** @internal Type anchor — forces bundlers to preserve this module's FeatureConfig augmentation when re-exported. */
export type _Augmentation = true;
