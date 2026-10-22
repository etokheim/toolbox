/**
 * Pinned Rows Plugin Entry Point
 * Re-exports plugin class, types, and built-in panel renderers for tree-shakeable imports.
 *
 * @module Plugins/Pinned Rows
 */
export { filteredCountPanel, rowCountPanel, selectedCountPanel } from './pinned-rows';
export { PinnedRowsPlugin } from './pinned-rows-plugin';
export type {
  AggregationRowConfig,
  AggregationSlot,
  AggregatorConfig,
  AggregatorDefinition,
  AggregatorFormatter,
  FooterContext,
  FooterScope,
  PanelRender,
  PanelSlot,
  PanelZone,
  PinnedRowSlot,
  PinnedRowsConfig,
  PinnedRowsContext,
  PinnedRowsPosition,
  ScopedFooter,
  ZonedPanelRender,
} from './types';
