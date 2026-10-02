/**
 * Synchronous plugin creation from feature props using the core feature registry.
 *
 * Delegates to `@toolbox-web/grid/features/registry` for plugin creation.
 * Keeps local utilities (`getUnregisteredFeatures`, `validateFeatureDependencies`)
 * for React-specific validation and debugging.
 *
 * @example
 * ```tsx
 * // Import features first (side effects)
 * import '@toolbox-web/grid-react/features/selection';
 * import '@toolbox-web/grid-react/features/filtering';
 *
 * // Then use the props
 * <DataGrid selection="range" filtering />
 * ```
 */

import { createPluginsFromFeatures as coreCreatePlugins } from '@toolbox-web/grid/features/registry';
import type { AllFeatureProps } from './feature-props';
import { isFeatureRegistered, type FeatureName } from './feature-registry';
import { normalizeFeatureRenderers, type GridOwner } from './feature-renderers';

/**
 * Plugin dependency declarations.
 * Some plugins require others to be loaded first.
 */
const PLUGIN_DEPENDENCIES: Partial<Record<FeatureName, FeatureName[]>> = {
  undoRedo: ['editing'],
  clipboard: ['selection'],
};

/**
 * Validates that all required dependencies are met for the requested features.
 * Logs a warning if a dependency is missing.
 */
export function validateFeatureDependencies(featureNames: FeatureName[]): void {
  const featureSet = new Set(featureNames);

  for (const feature of featureNames) {
    const deps = PLUGIN_DEPENDENCIES[feature];
    if (!deps) continue;

    for (const dep of deps) {
      if (!featureSet.has(dep)) {
        console.warn(
          `[DataGrid] Feature "${feature}" requires "${dep}" to be enabled. ` +
            `Add the "${dep}" prop to your DataGrid.`,
        );
      }
    }
  }
}

/**
 * Creates plugin instances synchronously from feature props.
 * Delegates to core registry's `createPluginsFromFeatures` for alias resolution,
 * dependency ordering, and plugin instantiation.
 *
 * @param featureProps - The feature props from DataGrid
 * @returns Array of plugin instances
 */
export function createPluginsFromFeatures<TRow = unknown>(
  featureProps: Partial<AllFeatureProps<TRow>>,
  owner?: GridOwner,
): unknown[] {
  // Validate dependencies before delegating
  const enabledFeatures: FeatureName[] = [];
  for (const [key, value] of Object.entries(featureProps)) {
    if (value === undefined || value === false) continue;
    enabledFeatures.push(key as FeatureName);
  }
  validateFeatureDependencies(enabledFeatures);

  // Delegate to core registry (handles alias resolution, ordering, instantiation)
  return coreCreatePlugins(normalizeFeatureRenderers(featureProps as Record<string, unknown>, owner));
}

/**
 * Get list of feature names that are enabled but not registered.
 * Useful for debugging.
 */
export function getUnregisteredFeatures(featureProps: Partial<AllFeatureProps>): FeatureName[] {
  const unregistered: FeatureName[] = [];

  for (const [key, value] of Object.entries(featureProps)) {
    if (value === undefined || value === false) continue;

    const featureName = key as FeatureName;
    if (!isFeatureRegistered(featureName)) {
      unregistered.push(featureName);
    }
  }

  return unregistered;
}
