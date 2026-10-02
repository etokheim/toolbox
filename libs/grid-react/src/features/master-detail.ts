/**
 * Master-Detail feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `masterDetail` prop on DataGrid. Bridges
 * both:
 * - Light-DOM `<GridDetailPanel>` children → MasterDetailPlugin's detailRenderer
 *   (via the adapter's `createDetailRenderer` bridge).
 * - Config-level `masterDetail={{ detailRenderer: (row) => <JSX/> }}` → vanilla
 *   `HTMLElement` through adapter-local normalization.
 * - `disclosureRenderer` → a persistent control portal in the same grid.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/master-detail';
 *
 * // Light-DOM children form
 * <DataGrid masterDetail={{ showExpandColumn: true }}>
 *   <GridDetailPanel>{({ row }) => <DetailView row={row} />}</GridDetailPanel>
 * </DataGrid>
 *
 * // Config-level renderer form (now accepts ReactNode)
 * <DataGrid masterDetail={{ detailRenderer: (row) => <DetailView row={row} /> }} />
 * ```
 *
 * @packageDocumentation
 */

// Delegate to core feature registration
import '@toolbox-web/grid/features/master-detail';
// Named type re-export surfaces the core `FeatureConfig` augmentation to dist
// consumers — a bare side-effect import alone is stripped from the emitted
// `.d.ts`. See `.github/knowledge/adapters.md`.
export type { _Augmentation as _MasterDetailAugmentation } from '@toolbox-web/grid/features/master-detail';

import type { DataGridElement } from '@toolbox-web/grid/all';
import type { MasterDetailConfig } from '@toolbox-web/grid/plugins/master-detail';
import type { MasterDetailConfig as ReactMasterDetailConfig } from '../lib/feature-props';
import { createControlBridge } from '../lib/control-bridge';
import { registerFeatureRendererBridge, trackFeaturePortal, type GridOwner } from '../lib/feature-renderers';
import { getDetailRenderer, type DetailPanelContext } from '../lib/grid-detail-panel';
import { getPortalManager, renderToContainer } from '../lib/portal-bridge';
import { registerPostMountRefresh } from '../lib/post-mount-refresh-hooks';
import { registerDetailRendererBridge } from '../lib/react-grid-adapter';
export type { MasterDetailConfig } from '../lib/feature-props';
export type { MasterDetailDisclosureContext } from '@toolbox-web/grid/plugins/master-detail';

// Install the master-detail row-renderer bridge on the React adapter.
// This augments the adapter (mirroring how core plugins augment the grid
// via `registerPlugin`) so master-detail-specific bridging lives with the
// master-detail feature, not in the central adapter file.
registerDetailRendererBridge((gridElement, { trackPortal }) => {
  const renderFn = getDetailRenderer(gridElement);
  if (!renderFn) return undefined;

  return (row, rowIndex) => {
    const container = document.createElement('div');
    container.className = 'react-detail-panel';

    const ctx: DetailPanelContext<typeof row> = { row, rowIndex };
    const portalKey = renderToContainer(
      container,
      renderFn(ctx as DetailPanelContext<unknown>),
      undefined,
      gridElement,
    );
    trackPortal(portalKey, container, false);

    return container;
  };
});

// Refresh the MasterDetailPlugin's renderer once React has committed the
// `<GridDetailPanel>` child (the plugin is instantiated by feature-props
// before React's commit phase, so its initial renderer lookup misses).
// Replaces the hard-coded `refreshMasterDetailRenderer` that used to live
// in `data-grid.tsx`.
registerPostMountRefresh('masterDetail', ({ gridEl }) => {
  const grid = gridEl as DataGridElement;
  const plugin = grid.getPluginByName('masterDetail') as { refreshDetailRenderer?: () => void } | undefined;
  plugin?.refreshDetailRenderer?.();
});

const disclosures = new WeakMap<
  NonNullable<ReactMasterDetailConfig['disclosureRenderer']>,
  NonNullable<MasterDetailConfig['disclosureRenderer']>
>();

function normalizeDisclosure(config: ReactMasterDetailConfig): MasterDetailConfig['disclosureRenderer'] {
  const renderer = config.disclosureRenderer;
  if (renderer && !disclosures.has(renderer)) disclosures.set(renderer, createControlBridge(renderer));
  return renderer ? disclosures.get(renderer) : undefined;
}

function normalizeDetail(
  renderer: NonNullable<ReactMasterDetailConfig['detailRenderer']>,
  owner?: GridOwner,
): NonNullable<MasterDetailConfig['detailRenderer']> {
  return (row, rowIndex) => {
    const result = renderer(row, rowIndex);
    if (result == null || result === false) return document.createElement('div');
    if (typeof result === 'string' || result instanceof HTMLElement) return result;
    const grid = owner?.();
    if (!grid || !getPortalManager(grid)) throw new Error('Detail JSX requires an owning DataGrid PortalManager.');
    const host = document.createElement('div');
    host.className = 'react-detail-panel';
    const key = renderToContainer(host, result, undefined, grid);
    trackFeaturePortal(host, key);
    return host;
  };
}

registerFeatureRendererBridge('masterDetail', {
  keys: ['disclosureRenderer'],
  normalize(config, owner) {
    const options = config as ReactMasterDetailConfig;
    return {
      ...config,
      disclosureRenderer: normalizeDisclosure(options),
      detailRenderer: options.detailRenderer ? normalizeDetail(options.detailRenderer, owner) : undefined,
    };
  },
  update(grid, config) {
    grid.getPluginByName('masterDetail')?.setDisclosureRenderer(normalizeDisclosure(config as ReactMasterDetailConfig));
  },
});
