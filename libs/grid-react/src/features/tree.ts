/**
 * Tree Data feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `tree` prop on DataGrid.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/tree';
 *
 * <DataGrid tree={{ childrenField: 'children' }} />
 * ```
 *
 * @packageDocumentation
 */

// Delegate to core feature registration
import '@toolbox-web/grid/features/tree';
// Named type re-export surfaces the core `FeatureConfig` augmentation to dist
// consumers — a bare side-effect import alone is stripped from the emitted
// `.d.ts`. See `.github/knowledge/adapters.md`.
export type { _Augmentation as _TreeAugmentation } from '@toolbox-web/grid/features/tree';

import type { TreeConfig as CoreTreeConfig } from '@toolbox-web/grid/plugins/tree';
import { createControlBridge } from '../lib/control-bridge';
import { registerFeatureRendererBridge } from '../lib/feature-renderers';
import type { TreeConfig } from '../lib/feature-props';
export type { TreeConfig } from '../lib/feature-props';
export type { TreeDisclosureContext } from '@toolbox-web/grid/plugins/tree';

const renderers = new WeakMap<
  NonNullable<TreeConfig['disclosureRenderer']>,
  NonNullable<CoreTreeConfig['disclosureRenderer']>
>();

function normalize(config: Record<string, unknown>): CoreTreeConfig {
  const { disclosureRenderer } = config as TreeConfig;
  if (disclosureRenderer && !renderers.has(disclosureRenderer))
    renderers.set(disclosureRenderer, createControlBridge(disclosureRenderer));
  return { ...config, disclosureRenderer: disclosureRenderer ? renderers.get(disclosureRenderer) : undefined };
}

registerFeatureRendererBridge('tree', {
  keys: ['disclosureRenderer'],
  normalize: (config) => ({ ...normalize(config) }),
  update(grid, config) {
    grid.getPluginByName('tree')?.setDisclosureRenderer(normalize(config).disclosureRenderer);
  },
});
