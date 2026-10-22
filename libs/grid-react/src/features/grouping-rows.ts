/**
 * Row Grouping feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `groupingRows` prop on DataGrid.
 * Automatically bridges React JSX `groupRowRenderer` to vanilla DOM.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/grouping-rows';
 *
 * <DataGrid groupingRows={{ groupBy: ['department'] }} />
 * ```
 *
 * @example Custom group row renderer
 * ```tsx
 * <DataGrid groupingRows={{
 *   groupBy: ['department'],
 *   groupRowRenderer: (params) => <strong>{params.key}: {params.value} ({params.rows.length})</strong>,
 * }} />
 * ```
 *
 * @packageDocumentation
 */

import '@toolbox-web/grid/features/grouping-rows';
import type { GroupingRowsConfig as CoreGroupingRowsConfig } from '@toolbox-web/grid/plugins/grouping-rows';
export type { _Augmentation as _GroupingRowsAugmentation } from '@toolbox-web/grid/features/grouping-rows';
export type { GroupingRowsDisclosureContext } from '@toolbox-web/grid/plugins/grouping-rows';
export type { GroupingRowsConfig } from '../lib/feature-props';
import type { GroupingRowsConfig } from '../lib/feature-props';
import { createControlBridge } from '../lib/control-bridge';
import { registerFeatureRendererBridge, trackFeaturePortal } from '../lib/feature-renderers';
import { getPortalManager, renderToContainer } from '../lib/portal-bridge';
import { isValidElement } from 'react';

const disclosures = new WeakMap<
  NonNullable<GroupingRowsConfig['disclosureRenderer']>,
  NonNullable<CoreGroupingRowsConfig['disclosureRenderer']>
>();

function normalizeDisclosure(config: GroupingRowsConfig): CoreGroupingRowsConfig['disclosureRenderer'] {
  const renderer = config.disclosureRenderer;
  if (renderer && !disclosures.has(renderer)) {
    disclosures.set(
      renderer,
      createControlBridge((context) => {
        const result = renderer(context);
        if (
          result !== null &&
          !(result instanceof HTMLElement) &&
          !isValidElement(result) &&
          !(typeof result === 'object' && 'element' in result)
        )
          throw new TypeError('Expected a disclosure control or null.');
        return result;
      }),
    );
  }
  return renderer ? disclosures.get(renderer) : undefined;
}

registerFeatureRendererBridge('groupingRows', {
  keys: ['disclosureRenderer'],
  liveConfigKeys: ['groupOrder', 'emptyGroups'],
  normalize(config, owner) {
    const options = config as GroupingRowsConfig;
    const renderer = options.groupRowRenderer;
    const groupRowRenderer: CoreGroupingRowsConfig['groupRowRenderer'] = renderer
      ? (params) => {
          const result = renderer(params);
          if (result instanceof HTMLElement || typeof result === 'string' || result === undefined) return result;
          const host = document.createElement('span');
          host.style.display = 'contents';
          if (result === null || result === false) return host;
          const grid = owner?.();
          if (!grid || !getPortalManager(grid)) throw new Error('Group JSX requires an owning DataGrid PortalManager.');
          trackFeaturePortal(host, renderToContainer(host, result, undefined, grid));
          return host;
        }
      : undefined;
    return { ...config, disclosureRenderer: normalizeDisclosure(options), groupRowRenderer };
  },
  update(grid, config) {
    const plugin = grid.getPluginByName('groupingRows');
    const options = config as GroupingRowsConfig;
    plugin?.setDisclosureRenderer(normalizeDisclosure(options));
    plugin?.setGroupOrder(options.groupOrder);
    plugin?.setEmptyGroups(options.emptyGroups);
  },
});
