/**
 * Pinned Rows feature for @toolbox-web/grid-react
 *
 * Import this module to enable the `pinnedRows` prop on DataGrid.
 * Automatically bridges React JSX `slots[]` panel
 * renderers to vanilla DOM via the portal bridge.
 *
 * @example
 * ```tsx
 * import '@toolbox-web/grid-react/features/pinned-rows';
 * import { rowCountPanel } from '@toolbox-web/grid/plugins/pinned-rows';
 *
 * <DataGrid pinnedRows={{
 *   slots: [
 *     { id: 'count', position: 'bottom', render: rowCountPanel() },
 *   ],
 * }} />
 * ```
 *
 * @example Slots API (issue #255) with React renderers
 * ```tsx
 * <DataGrid pinnedRows={{
 *   slots: [
 *     { position: 'top', render: (ctx) => <strong>{ctx.totalRows} rows</strong> },
 *     { position: 'top', aggregators: { price: 'sum' }, label: 'Total' },
 *     { position: 'bottom', render: [
 *       { zone: 'left',  render: (ctx) => <span>{ctx.filteredRows} shown</span> },
 *       { zone: 'right', render: (ctx) => ctx.selectedRows ? <em>{ctx.selectedRows} selected</em> : null },
 *     ]},
 *   ],
 * }} />
 * ```
 *
 * @packageDocumentation
 */

import type { BaseGridPlugin } from '@toolbox-web/grid';
import '@toolbox-web/grid/features/pinned-rows';
// Named type re-export surfaces the core `FeatureConfig` augmentation to dist
// consumers — a bare side-effect import alone is stripped from the emitted
// `.d.ts`. See `.github/knowledge/adapters.md`.
export type { _Augmentation as _PinnedRowsAugmentation } from '@toolbox-web/grid/features/pinned-rows';

import {
  PinnedRowsPlugin,
  type PinnedRowSlot as CorePinnedRowSlot,
  type PinnedRowsConfig as CorePinnedRowsConfig,
  type ZonedPanelRender as CoreZonedPanelRender,
  type PinnedRowsContext,
  type FooterContext,
} from '@toolbox-web/grid/plugins/pinned-rows';
import type { PanelRender, PinnedRowSlot, PinnedRowsConfig } from '../lib/feature-props';
import { registerFeature } from '../lib/feature-registry';
import { registerFeatureRendererBridge } from '../lib/feature-renderers';
import { removeFromContainer, renderToContainer } from '../lib/portal-bridge';
import { createControlBridge } from '../lib/control-bridge';

// Re-export React-typed config shapes from their single source of truth in
// `feature-props.ts`, so consumers can keep importing them from this module.
export type { PanelRender, PanelSlot, PinnedRowSlot, PinnedRowsConfig, ZonedPanelRender } from '../lib/feature-props';
export type { ScopedFooter } from '../lib/feature-props';
export type { FooterContext, FooterScope } from '@toolbox-web/grid/plugins/pinned-rows';

/**
 * Cache entry for a single React-typed renderer. Reused across grid re-renders
 * so the host element reference is stable — the pinned-rows plugin
 * (`renderPanelSlot`) reference-checks renderer outputs to skip DOM mutation
 * when nothing changed, and React updates the existing portal in place.
 */
interface SlotRenderer {
  update(renderer: PanelRender): void;
  render(ctx: PinnedRowsContext): HTMLElement | null;
  dispose(): void;
}

/** Callback replacement retains the portal; DOM/null output retires it. */
function createCachedReactRender(reactFn: PanelRender): SlotRenderer {
  let host: HTMLDivElement | undefined;
  let portalKey: string | undefined;
  const dispose = () => {
    if (portalKey) removeFromContainer(portalKey, { sync: false });
    host = undefined;
    portalKey = undefined;
  };
  return {
    update(renderer) {
      reactFn = renderer;
    },
    render(ctx) {
      const node = reactFn(ctx);
      if (node == null || node === false || node instanceof HTMLElement) {
        dispose();
        return node instanceof HTMLElement ? node : null;
      }
      if (!host) {
        host = document.createElement('div');
        host.style.display = 'contents';
      }
      portalKey = renderToContainer(host, node, portalKey, ctx.grid);
      return host;
    },
    dispose,
  };
}

/** Slot updates are presentation work, not a grid-wide plugin transaction. */
class PinnedRowsPluginWithCleanup extends PinnedRowsPlugin {
  #sourceSlots: PinnedRowSlot[] | undefined;
  #renderers = new Map<string, SlotRenderer>();
  #sourceFooters: PinnedRowsConfig['scopedFooters'];
  #footerRender = createControlBridge<FooterContext>(
    (context) => this.#sourceFooters?.(context.scope)?.render(context) ?? null,
  );

  constructor(config: PinnedRowsConfig = {}) {
    super({ ...config, slots: undefined, scopedFooters: undefined });
    this.#replaceSlots(config.slots);
    this.#replaceFooters(config.scopedFooters);
  }

  setFooterSource(callback: PinnedRowsConfig['scopedFooters']): void {
    if (callback === this.#sourceFooters) return;
    this.#replaceFooters(callback);
    this.setScopedFooters(this.userConfig.scopedFooters);
  }

  #replaceFooters(callback: PinnedRowsConfig['scopedFooters']): void {
    this.#sourceFooters = callback;
    this.userConfig.scopedFooters = callback
      ? (scope) => {
          const definition = this.#sourceFooters?.(scope);
          return definition ? { height: definition.height, render: this.#footerRender } : null;
        }
      : undefined;
  }

  setSlots(slots: PinnedRowSlot[] | undefined): void {
    if (slots === this.#sourceSlots) return;
    this.#replaceSlots(slots);
    this.requestAfterRender();
  }

  #replaceSlots(slots: PinnedRowSlot[] | undefined): void {
    this.#sourceSlots = slots;
    const next = new Map<string, SlotRenderer>();
    const normalized = slots?.map((slot, index): CorePinnedRowSlot => {
      if (!('render' in slot) || slot.render == null) return slot;
      const bridge = (render: PanelRender, part: number, zone?: string) => {
        const key = JSON.stringify([index, slot.id, slot.position ?? 'bottom', part, zone]);
        const renderer = this.#renderers.get(key) ?? createCachedReactRender(render);
        renderer.update(render);
        next.set(key, renderer);
        return renderer.render;
      };
      if (Array.isArray(slot.render)) {
        const render: CoreZonedPanelRender[] = slot.render.map((entry, part) => ({
          zone: entry.zone,
          render: bridge(entry.render, part, entry.zone),
        }));
        return { ...slot, render };
      }
      return { ...slot, render: bridge(slot.render, 0) };
    });
    for (const [key, renderer] of this.#renderers) if (!next.has(key)) renderer.dispose();
    this.#renderers = next;
    if (normalized) this.userConfig.slots = normalized;
    else delete this.userConfig.slots;
    if (this.config) this.config.slots = normalized ?? this.defaultConfig.slots;
  }

  override refreshUserConfigFrom(other: BaseGridPlugin<CorePinnedRowsConfig>): void {
    super.refreshUserConfigFrom(other);
    if (other instanceof PinnedRowsPluginWithCleanup) {
      this.#replaceSlots(other.#sourceSlots);
      this.#replaceFooters(other.#sourceFooters);
    }
  }

  override detach(): void {
    for (const renderer of this.#renderers.values()) renderer.dispose();
    super.detach();
  }
}

registerFeatureRendererBridge('pinnedRows', {
  keys: [],
  liveConfigKeys: ['slots', 'scopedFooters'],
  normalize: (config) => config,
  update(grid, config) {
    const plugin = grid.getPluginByName('pinnedRows');
    if (plugin instanceof PinnedRowsPluginWithCleanup) {
      plugin.setSlots((config as PinnedRowsConfig).slots);
      plugin.setFooterSource((config as PinnedRowsConfig).scopedFooters);
    }
  },
});

registerFeature(
  'pinnedRows',
  (config) =>
    new PinnedRowsPluginWithCleanup(config && typeof config === 'object' ? (config as PinnedRowsConfig) : undefined),
  { override: true },
);
