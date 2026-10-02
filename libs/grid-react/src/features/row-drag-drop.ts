/**
 * Row Drag & Drop feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `rowDragDrop` prop on DataGrid and the
 * associated event handlers (`onRowDragStart`, `onRowDragEnd`, `onRowDrop`,
 * `onRowTransfer`). Supports both intra-grid reorder and cross-grid transfer.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/row-drag-drop';
 *
 * <DataGrid rowDragDrop={{ dropZone: 'employees' }} />
 * ```
 *
 * @packageDocumentation
 */

// Delegate to core feature registration
import '@toolbox-web/grid/features/row-drag-drop';
// Named type re-export surfaces the core `FeatureConfig` augmentation to dist
// consumers — a bare side-effect import alone is stripped from the emitted
// `.d.ts`. See `.github/knowledge/adapters.md`.
export type { _Augmentation as _RowDragDropAugmentation } from '@toolbox-web/grid/features/row-drag-drop';

import type {
  RowDragDropConfig as CoreRowDragDropConfig,
  RowDragHandleContext,
} from '@toolbox-web/grid/plugins/row-drag-drop';
import { createControlBridge } from '../lib/control-bridge';
import { registerFeatureRendererBridge } from '../lib/feature-renderers';
import type { RowDragDropConfig } from '../lib/feature-props';
export type { RowDragDropConfig } from '../lib/feature-props';
export type { RowDragHandleContext } from '@toolbox-web/grid/plugins/row-drag-drop';

const renderers = new WeakMap<
  NonNullable<RowDragDropConfig['dragHandleRenderer']>,
  NonNullable<CoreRowDragDropConfig['dragHandleRenderer']>
>();

function normalize(config: Record<string, unknown>): CoreRowDragDropConfig {
  const { dragHandleRenderer } = config as RowDragDropConfig;
  if (dragHandleRenderer && !renderers.has(dragHandleRenderer)) {
    const owners = new WeakMap<RowDragHandleContext['bindHandle'], RowDragHandleContext['bindHandle']>();
    renderers.set(
      dragHandleRenderer,
      createControlBridge(dragHandleRenderer, (initial, isActive) => {
        let bind = initial.bindHandle;
        let releasePending = false;
        const release = () => {
          releasePending = false;
          if (owners.get(bind) !== bindHandle) return;
          owners.delete(bind);
          bind(null);
        };
        const bindHandle = (element: HTMLElement | null) => {
          if (element !== null) {
            if (!isActive()) return;
            owners.set(bind, bindHandle);
            bind(element);
          } else if (owners.get(bind) === bindHandle) {
            if (isActive()) release();
            else if (!releasePending) {
              // Let the same commit's successor retain native attributes and menu state.
              releasePending = true;
              queueMicrotask(release);
            }
          }
        };
        return (context) => {
          bind = context.bindHandle;
          return { ...context, bindHandle };
        };
      }),
    );
  }
  return { ...config, dragHandleRenderer: dragHandleRenderer ? renderers.get(dragHandleRenderer) : undefined };
}

registerFeatureRendererBridge('rowDragDrop', {
  keys: ['dragHandleRenderer'],
  normalize: (config) => ({ ...normalize(config) }),
  update(grid, config) {
    grid.getPluginByName('rowDragDrop')?.setDragHandleRenderer(normalize(config).dragHandleRenderer);
  },
});
