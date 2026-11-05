import { FillHandlePlugin, type FillHandleConfig } from '../plugins/fill-handle';
import { CONFIG_RULE_ERROR, throwDiagnostic } from '../core/internal/diagnostics';
import { registerFeature } from './registry';

declare module '../core/types' {
  interface FeatureConfig {
    /** Vertical automatic fill from a single selected range. Requires `selection: 'range'`, `editing` and `undoRedo`. @since 3.11.0 */
    fillHandle?: boolean | FillHandleConfig;
  }
}

registerFeature('fillHandle', (config) => {
  if (config !== true && (config === null || typeof config !== 'object' || Array.isArray(config))) {
    throwDiagnostic(CONFIG_RULE_ERROR, 'fillHandle must be true or a FillHandleConfig object.');
  }
  return new FillHandlePlugin(config === true ? undefined : config);
});

/** @internal */
export type _Augmentation = true;
