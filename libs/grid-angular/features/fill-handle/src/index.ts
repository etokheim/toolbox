/**
 * Opt-in vertical automatic fill. Import GridFillHandleDirective alongside the
 * Selection, Editing and UndoRedo directives for attribute configuration.
 * @packageDocumentation
 */
import '@toolbox-web/grid/features/fill-handle';
export { GridFillHandleDirective } from './grid-fill-handle.directive';
export type { _Augmentation as _FillHandleAugmentation } from '@toolbox-web/grid/features/fill-handle';
export type { FillCompleteDetail, FillHandleConfig, FillStartDetail } from '@toolbox-web/grid/plugins/fill-handle';
