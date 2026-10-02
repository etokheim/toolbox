import { CellEntryPlugin, type CellEntryConfig } from '../plugins/cell-entry';
import { CONFIG_RULE_ERROR, throwDiagnostic } from '../core/internal/diagnostics';
import { registerFeature } from './registry';

declare module '../core/types' {
  interface FeatureConfig {
    /** Single-cell keyboard and optional click entry. @since 3.9.0 */
    cellEntry?: boolean | CellEntryConfig;
  }
}

registerFeature('cellEntry', (config) => {
  if (config !== true && (config === null || typeof config !== 'object' || Array.isArray(config))) {
    throwDiagnostic(CONFIG_RULE_ERROR, 'cellEntry must be true or a CellEntryConfig object.');
  }
  return new CellEntryPlugin(config === true ? undefined : config);
});

/** @internal */
export type _Augmentation = true;
