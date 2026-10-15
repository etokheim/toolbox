---
domain: grid-plugins-catalog-ui
related:
  [
    grid-plugins,
    grid-hierarchy,
    grid-plugins-catalog-data,
    grid-plugin-responsive,
    grid-plugins-editing,
    grid-plugins-shell,
    grid-input,
    adapters,
  ]
---

# Plugin Catalog — Interaction & Display Plugins

Selection, independent row details, reordering and display-plugin ownership.

- Architecture → `grid-plugins.md`; Shell → `grid-plugins-shell.md`.
- Tree/GroupingRows composition and structural metadata → `grid-hierarchy.md`.
- Editing/UndoRedo → `grid-plugins-editing.md`; Responsive → `grid-plugin-responsive.md`.
- Other row/column models, sorting/filtering, pinned totals and export → `grid-plugins-catalog-data.md`.

Read order for incorrect pointer gestures: Selection dispatchers → drag-alternative decisions (#449) → ContextMenu order bands.

## Selection & Navigation

### Selection

OWNS: selected rows/cells/ranges/columns (`Set<field>`), `activeAxis`, normalized mode. HOOKS: onCellClick, onRowClick, onHeaderClick, onKeyDown, afterCellRender, processColumns (checkbox column), afterRender, onScrollRender. EVENTS: `selection-change`. MODES: `cell | row | range | column`, or an array of `'column'` + exactly one in-row axis.

- OWNS: `checkbox-controls.ts` keeps per-grid/per-role cell records; `ControlSlot` owns HTMLElement/null replacement or persistent `ControlView.update/dispose`. Identity = existing `tryResolveRowId` or row object, never processed index. Actions recheck current identity, eligibility and slot validity; plugin mutation/events remain authoritative.
- INVARIANT: `control-lifecycle.ts` registry symbols cross independently bundled entries. Cleanup is an owner-keyed Map per cell: same-owner registration replaces; owner release leaves siblings intact; whole-cell release unregisters all before disposal. Body registration follows `applyRendererOutput` in `afterCellRender`; headers release before rebuild. Outputs detach intact for deferred framework unmount; failed controls report TBW065 and invalidate actions.
- FLOW: selection STYLE/scroll update → tracked control contexts (no observers) → persistent updates. Boundary metadata bypasses native grid pointer/key dispatch before React's delegated handlers; custom controls own native semantics. Omitted hooks retain native markup/order; single-select header remains empty.
- DECIDED (2026-10, utility-control slice): only Selection DOM + React hooks ship here. WHY: reuse shared typed lifecycle without adding a universal renderer config, changing selection scope/cascades, or introducing Vue/Angular template bridges. React ownership → `adapters-react.md`.
- DECIDED (2026-10, human-confirmed embedded slice): `bindRowCheckbox(context, host, listener)` requires existing row mode; `checkbox:false` is supported. WHY: placement inside Name is independent of utility columns, not a new batch model or CellEntry mode. Full `CellRenderContext` supplies actual grid/cell ownership, including custom tags/nested grids.
- OWNS: lazy `embedded-checkbox.ts` registry holds lifetimes, not selection. Cell buckets make commit local; STYLE/scroll refresh mounted records only. `#rowCheckboxContext`/`#selectCheckboxRow` remain canonical for both placements. Identity is captured at binding/update; actions recheck current row and eligibility without searching all rows.
- FLOW: pending inert host → installed body-cell commit/microtask → active deferred context → retired terminal null. Abandoned/throwing/null outputs are swept at the same checkpoint. `update(context)` immediately revokes old actions and returns false for permanently retired handles; same-ID fresh objects revoke prior snapshots. Reentrant notifications use versions; throwing listeners retire with TBW065 and no repeat callback.
- INVARIANT: active checkbox actions force acting-binding reconciliation even after canonical no-ops; unrelated STYLE contexts remain deduplicated. Native checked→Shift and single-select clicks can toggle DOM without changing selection. Tests: `embedded-checkbox.spec.ts`, React/browser `embedded-selection.spec.*`.
- INVARIANT: post-install owner-keyed cleanup erases only its boundary token; HTMLElement marker/equality unchanged. Lease capture stamps the click with owning grids before native handlers; synchronous retirement removes host metadata but cannot reclassify that event as a Name click. New events use current boundaries. No propagation stop, Event API parameter or global scan. Focus recovery stays inside the retiring host.

- DECIDED (#269): mode normalized at `attach()` into `NormalizedModeConfig { primary, columnEnabled, bothAxes }`; throws on empty, 3+ items, 2-element without `'column'`, duplicates, unknown. RULED OUT: `['cell','row']`. Column selection keys on **field names**; `clearSelectionSilent()` preserves `selectedColumns`; row↔column mutual exclusion in `#buildEvent()`. Chords: header plain/Shift+Click = sort; **Ctrl/⌘+Click** toggles a column, **Ctrl/⌘+Shift+Click** extends; **Ctrl/⌘+Space** toggles the focused cell's column, **Ctrl/⌘+Shift+←/→** extends. Utility columns skip every column-axis path. `column-selection.ts` (+ spec).
- DECIDED (#308): `selection-change.detail.selectedColumns` + `getSelectedColumns()` emit in **visible-column order** via `buildSelectionEvent` → `selectableColumnFields(visibleColumns)`; the `selectColumns` query batches through `#setColumnSelection(fields)`. `#applySelectionClasses()` MUST reset stale `aria-selected` **scoped** to cells that previously carried `.selected`/`.column-selected` — clearing all wipes the active-cell focused marker (e2e `accessibility.spec.ts`).
- DECIDED (#284): clears selection when the host swaps source `rows` to a DIFFERENT size (`data-change` + changed `sourceRowCount`, cached `lastSourceRowCount = -1`); same-count edits preserve. RULED OUT: clearing on every `data-change`; deep equality. Also auto-selects the row entering edit in `mode:'row'` (listens `edit-open` via `broadcast()`); skips if mode isn't row, `isRowSelectable` false, or already selected; `multiSelect:false` replaces. NO `edit-close` listener. Tests: `selection-editing-integration.spec.ts`.
- DECIDED (Jul 2026): `onCellClick`/`onKeyDown` are thin dispatchers; semantics live in `#clickSelect{Cell,Row,Range}` and `#key{ColumnAxis,ClearSelection,NavCellMode,RowMode,RangeMode,SelectAll}`; `NAV_KEYS` is module-level. MUST NOT re-inline — mode PRECEDENCE belongs to the dispatcher, SEMANTICS to the branch.
- DECIDED (Jul 2026): range-mode right-click (`onCellMouseDown`, `button === 2`) inside an existing range preserves the selection (early return, no drag) so the context menu acts on the whole range (`isCellInAnyRange`); outside falls through to clear+select.
- DECIDED (#304, `@since 3.5.0`): **touch selection mode** — long-press a row → mode on + row selected; taps then toggle (as Ctrl); a second long-press range-extends from the anchor; `Done`/`Escape` exits. API: `touchSelectionActive`, `exitTouchSelection()`, `SelectionConfig.touchMode: 'sticky' | 'transient'` (default `'transient'` = exiting clears). UI in `plugins/selection/touch-selection.ts`: `SelectionToolbar` (role=toolbar, `data-action` buttons) + `RangeCornerHandles` (`startPointerDrag` dots, hidden when the anchor cell is virtualized away); "More…" proxies to `ContextMenuPlugin.showMenu()` via `getPluginByName('contextMenu')`. Header presses (`rowIndex < 0`) ignored — reserved for #270.
  - INVARIANT: entry gates on the **event's** `pointerType` (`#isCoarseEvent`), NOT `getPrimaryPointer()` — a hybrid device reports `(pointer: coarse)` with a mouse in use. `#renderTouchChrome` MUST NOT re-test the media query.
  - INVARIANT: mouse chords untouched — the only change is `|| this.#touchActive` in `#clickSelectRow`'s `ctrlKey`. Long-press detection is free: `event-delegation.ts` dispatches the coarse `mousedown` hook only after 400 ms (#303); no plugin-side timer.
  - DECIDED (Aug 2026): range corner handles are **touch-only** — `#rangeFromCoarsePointer` (set from `#isCoarseEvent(originalEvent)` in BOTH `onCellMouseDown` range branch and `#clickSelectRange`) gates `#renderTouchChrome`'s `rect`. WHY: on desktop only the most recent Ctrl-range carries handles, so they sit inside other ranges and obstruct drag-select.
  - TENSION: selection chunk +2.39 kB gz — `pointer-drag.ts` inlines (plugin entries are self-contained, `manualChunks: undefined`); ≤50 kB gz/plugin passes.
  - Tests: `touch-selection.spec.ts` → "does not render handles for a mouse-started range" / "renders handles for a tap-created range". Stubbing `matchMedia` per-test does NOT work for `getPrimaryPointer()` — `pointer-modality.ts` caches one shared MediaQueryList module-level; assert via `pointerType`.
- DECIDED (#449, SC 2.5.7): `getContextMenuItems` adds "Extend selection to here" at `EXTEND_ITEM_ORDER = 60`; `#extendAnchor` → `params.rowIndex/columnIndex` (`ContextMenuParams.columnIndex` = `data-col`/`colIndex`). WHY: click-only range extension without new chrome. `#setExtendAnchor` skips `button === 2`; separate `cellAnchor` may re-anchor on right-click.
- FLOW: `RangeCornerHandles` (`role="button"`, `aria-label`, `aria-pressed`) tracks `moved` in `#onPointerDown`/`onMove`; `onEnd`: tap → `callbacks.arm(corner)`, drag → `commit()` (`startPointerDrag` promotes immediately). Armed `onCellMouseDown` swallows without reset; `#clickSelectRange` places; Escape disarms before touch-mode/clear.
  - INVARIANT: the fallback `createDragAlternativeMenu('tbw-range-extend-menu', …)` is bound as ONE delegated `contextmenu` listener on the grid host (cells are recycled every render) and MUST bail when `#contextMenuPlugin()` is truthy — else two menus stack.

## Row Details

### MasterDetail

OWNS: expanded rows by reference, detail height, animation state, cell disclosure slots. HOOKS: processColumns (expander), afterCellRender, afterRender, onCellClick, afterRowRender, getRowHeight, adjustVirtualStart. EVENTS: `detail-expand`.

- DECIDED (2026-10, disclosure slice): `MasterDetailDisclosureContext<T>` is separate from Tree; both use `disclosureRenderer` + `ControlSlot`. WHY: controls render existing toggles, not a mixed expansion model. MD placement remains standalone; `ariaLabel` shares exact default "Expand details"/"Collapse details" source.
- INVARIANT: guarded MD `setExpanded` calls `toggleAndEmit`, not public `toggle(index)` (different event/datasource path). `setDisclosureRenderer` requests STYLE without recreating plugins. Detail removal, datasource replacement and detach call adapter `unmount` before DOM removal.
- DECIDED (2026-10, mixed expansion): `hasDetail(row)` gates controls, actions, loading and heights; omitted allows real rows, never group/loading markers. WHY: hiding a renderer does not revoke eligibility. Reconciliation retires expansion, cached data/measured heights, loading and controls even for collapsed/removed rows; late responses cannot reopen them. Tests: `master-detail/eligibility.spec.ts`, datasource integration.
- INVARIANT: click-microtask pruning and fixed/variable `adjustVirtualStart` recheck eligibility before reconciliation. Variable-height overlap uses position-cache offsets/heights; a formerly eligible row cannot retain a master or reuse its measured detail height after retirement.
- INVARIANT: Tree child state and detail state remain independent on the same real row. `tbw-detail-expanded` marks detail ownership; `tbw-row-expanded` is their visible union. Removing details preserves hierarchy expansion. No synthetic detail rows enter `grid.rows` or domain persistence.
- INVARIANT: MD disclosure ownership uses the nearest `.cell`, not direct parentage: Tree can wrap its expander in `.tree-content`. Both plugins register/release cleanup keyed by their instance. Tests: Tree `disclosure-controls.spec.ts` and browser matrix (both orders, omitted `treeColumn`, MD-only/both custom); removed MD must not dispose Tree.
- DECIDED (2026-10, browser repro): disclosure-only registry metadata delegates Arrow/Home/End/Page/Tab from the actual control cell to core navigation, skipping competing plugin key handlers. WHY: blanket Selection boundary return stranded focus on custom buttons. Click/Space/Enter remain native; Selection boundaries unchanged. Tests: `docs-e2e/tests/disclosure-controls.spec.ts`, Selection custom-checkbox browser regression.

- OWNS: shared `core/plugin/utility-column.ts` constructs/inserts selection/master-detail/row-drag utilities; retains `EXPANDER_COLUMN_FIELD`, width, predicates and legacy metadata. Removed `expander-column.ts`/`findExpanderColumn`/`ExpanderColumnRenderer` had no public barrel exports; do not restore obsolete DOM/CSS helpers.
- INVARIANT: placement remains order-dependent: selection follows existing expander or prepends; master-detail prepends; drag prepends/appends. Columns retain saved position/width; Tree wraps configured/first column, including utilities.
- OWNS: an enumerable registry-symbol property carries the producer instance across independent plugin bundles and column spreads/merges; JSON column state excludes it. `utility: true` alone never grants ownership.
- FLOW: `grid.ts #processColumns` prunes detached owners before splitting hidden columns; hooks upsert visible utilities; a hidden managed column survives only while its owner still produces it, replacing the newly generated visible copy. Consumer utility/reserved-field columns are not adopted or removed. Tests: `utility-column.spec.ts`, integration `utility-columns.spec.ts`.
- DECIDED (Jul 2026, `#syncDetailRows`): `#collectVisibleRowMap` (prefers the index-aligned `_rowPool`, `querySelectorAll` as fallback) → `#pruneDetachedDetails` (adapter `unmount` BEFORE `remove()`) → per-row `#insertDetailRow`. INVARIANT: the `.tbw-row-expanded` toggle MUST run on the collapsed branch too — recycling otherwise leaks the class onto another row.

## Reordering

### ReorderColumns

OWNS: column order, drag state, `BaseColumnConfig.lockPosition` augmentation. HOOKS: onCellMouseDown/Move/Up, afterRender. QUERIES: `canMoveColumn`.

- DECIDED: per-column lock is top-level `ColumnConfig.lockPosition` (augmented from `reorder-columns/types.ts`, NOT core). Legacy `meta.lockPosition`/`meta.suppressMovable` honored in `column-drag.ts#canMoveColumn` (top-level first).
- DECIDED: ReorderColumns owns the authoritative `canMoveColumn` query — other plugins (Visibility panel-drag) MUST `grid.query<boolean>('canMoveColumn', column)` and treat any `false` as a veto. Without the plugin it returns `[]` (= non-reorderable); an eager local check keeps test mocks (`query: () => []`) working.
- DECIDED: ALL column-level flags are top-level on `ColumnConfig` via module augmentation from the owning plugin's `types.ts` — never `meta.<flag>`, never directly in core. Flags: `lockVisible` (core), `lockPosition` (reorder-columns), `lockPinning`/`pinned` (pinned-columns), `utility` (public, core), `checkboxColumn` (`@internal`, selection), `group` (grouping-columns).
- INVARIANT: plugin-owned flags MUST NOT appear on the `grid.getAllColumns()` projection — only grid-universal fields (`field`, `header`, `visible`, `lockVisible`, `utility`). Plugins read raw config via `this.grid.columns.find(...)`.
- DECIDED (Apr 2026): `ColumnConfig.utility` is PUBLIC — "system column" flag (checkbox, expander, drag handle, action menu); prefix `__`. Honored by Visibility (chooser filter), Reorder (`canMoveColumn` false), Print (hidden unless `printHidden:false`), Clipboard/Export (`resolveColumns()` skips), Selection (clicks ignored), Filtering (no filter UI).

### ReorderRows

OWNS: row order, drag state. HOOKS: onCellMouseDown/Move/Up. QUERIES: `canMoveRow`.

### RowDragDrop (#225)

OWNS: row order/cross-grid sessions. HOOKS: processColumns, onKeyDown, onCellClick, delegated dragstart/over/leave/drop/dragend. QUERIES: `canMoveRow`. EVENTS: `row-move`, `row-drag-start`/`row-drop` (cancelable), `row-drag-end`, `row-transfer`. USES: `drag-drop-registry.ts` (cross-bundle WeakRefs), `drag-drop-protocol.ts` (MIME, codec, positioning, auto-scroll, current session).

- DECIDED (v3): removed `RowReorderPlugin`, `reorderRows` feature and `reorderRows`/`rowReorder` aliases. WHY: plugin deleted in v3. `RowDragDropPlugin.aliases === undefined` (`row-drag-drop.spec.ts > aliases`); docs redirect `reorder-rows` → `row-drag-drop`.
- INVARIANT (#225): other-plugin alias dedup uses constructor identity (`PluginManager#collapseAliasDuplicates`). `BaseGridPlugin.mergeConfigsFrom`: equal scalars/refs silent; dedupe TBW023 (dev); conflict TBW025.
- INVARIANT (#225): same-window `currentSession` enables synchronous `canDrop` during `dragover` (protected `getData()` is empty); cross-window uses `TBW_ROW_DRAG_MIME` JSON + `deserializeRow`. WeakRef registry restores live objects only on drop.
- FLOW: missing `findPeerOnGrid(sourceGridId)` → `tbw-row-drag-drop:transfer` broadcasts `{sourceGridId,toGridId,dropZone,rowIndices,toIndex,operation,serializedRows}`. Source filters ID/zone → removes rows/emits `row-transfer`/sets `dragAccepted`. Origin-scoped `BroadcastChannel('tbw-row-drag-drop')` is lazy/ref-counted/closed on last detach; without it source rows remain.
- DECIDED (Apr 2026): `dragFrom?: 'handle'|'row'|'both'` (default `'handle'`); `'row'` hides the handle column unless `showDragHandle` is explicit. `applyRowDraggable()` MUST run from BOTH `afterRender` AND `onScrollRender` (recycling loses `draggable="true"`).
- INVARIANT: row-origin interactive descendants (`button,input,select,textarea,a[href],[contenteditable]`) never start a drag — `INTERACTIVE_DRAG_SELECTORS` / `isInteractiveDragOrigin()`. Explicit `bindHandle` registration is the handle-only exception; nested independent controls still veto pickup.
- OWNS: `drag-handle-controls.ts` revocable `ControlSlot` lease; SVG → registered HTML root. Host listeners run after React portal cancellation. Revocation restores owned attributes/closes owned menu, not native payload.
- INVARIANT: native buttons keep Enter/Space clicks; other roots synthesize Enter-down/Space-up once. Local Ctrl-arrow precedes boundary bailout; custom move-menu boundary prevents Escape clearing Selection. `canDrag` refresh is custom-only/pure; default refresh skips control scanning.
- FLOW: `resolveDragOrigin` → `{rowEl, handle}`: native veto → binding ownership/identity/generation → handle/row. `onDragStart` keeps rows → `canDrag` → cancelable DOM event → state/payload/registry → refresh; no post-event revalidation. Cleanup: per-plugin (including omitted-treeColumn wrapping).
- DECIDED (drag-control slice): typed DOM + React-local hooks on both surfaces. WHY: retain per-grid providers/stable portals. Composition/pinning and Vue/Angular templates deferred.
- INVARIANT: `setDragImage` clone lives inside `this.gridElement`, not body (scoped `core/styles/*.css`, host `--tbw-column-template`). Fixed at -10000px; removed in `setTimeout(0)`. No opacity/shadow: browser translucency already fades it.

## Display

### Responsive

Moved to grid-plugin-responsive.md (breakpoints, card layout, view transitions, column fades, card height).

### Tooltip

OWNS: active tooltip + positioning, shared `#tbw-tooltip-popover`. HOOKS: afterCellRender, getVerticalScrollOffsets(no). CONFIG adds `focus` (default true), `hideDelay` (default 120ms).

- DECIDED (#449, WCAG 2.2 SC 1.4.13): `id=tbw-tooltip-popover`, `role="tooltip"`, anchor `aria-describedby`; `tooltip.css` uses `pointer-events: auto` + `user-select: text`. WHY: hoverable/selectable content.
- INVARIANT: `mouseout` delays hiding by `hideDelay` (120 ms); popover `mouseenter` cancels it. Only `hideDelay: 0` hides synchronously; immediate-teardown specs need zero or fake timers.
- DECIDED (#449): Escape listens on `document`, `capture: true`, without `preventDefault`/`stopPropagation`. WHY: tooltip may outlive grid focus; Escape must still cancel editing.
- FLOW (#449): `NAVIGATION_KEYS` keydown → `requestAnimationFrame` → `querySelector('.cell-focus')`. Host retains DOM focus; cell focus is virtual (no `aria-activedescendant`), so `:focus-visible` cannot drive it. Pointer users do not trigger this path.
- INVARIANT: nav keydown binds `this.gridElement`/`_hostElement`, not child `.tbw-grid-root`. `grid.ts` host `tabindex=0` means events bubble outward; `setupRootEventDelegation` uses the same host. Child-dispatched tests cannot detect this mis-binding.
- DECIDED (#449): JS `#prefersAbove` uses `height <= spaceAbove || spaceAbove >= spaceBelow`, `ARROW_GAP_PX = 11`. WHY: CSS `position-try-fallbacks` cannot synchronize `.tbw-tooltip-above`, especially across `hideDelay` re-hover.
- INVARIANT (#469): `#syncTooltipToFocusedCell()` checks `cell === #anchorCell` before `anchor-name`. `keyboard.ts` clamps navigation (`Math.max(0, _focusRow - 1)`), so boundary moves retain our `--tbw-tooltip-anchor`; foreign anchors (overlay editors) still hide.
- TENSION: no AT-detection API; only `prefers-reduced-motion`/`-contrast`/`forced-colors`. SC 1.4.13 focus triggering can use modality, hoverability cannot. No browser flag is needed.

### StickyRows (#279)

OWNS: `.tbw-sticky-rows` overlay container, clone cache by row index, displayed indices, push displacement. HOOKS: afterRender, onScrollRender, onScroll. READS: `grid.rows`, `grid._virtualization.{container,positionCache,rowHeight}`. CONFIG: `isSticky` (field name or `(row,index)=>unknown`), `mode:'push'|'stack'` (default push), `maxStacked`, `className`.

- INVARIANT: decorative clones: `aria-hidden="true"`, no `tabindex`/focus classes; live rows retain keyboard/AT access. Overlay: absolute/top0 inside `.rows-viewport`, not `.rows-body` flex child; `overflow:clip`.
- INVARIANT: `getCurrentScrollTop()` reads `_virtualization.container.scrollTop`, not `start * rowHeight`. Prime live rows; `findRenderedRow` is null outside window.
- INVARIANT: sticky threshold is strict `offsetOf(idx) < scrollTop`; stack adds `cumulativeHeightOfStuck`. At `maxStacked`, use `scrollTop + sumStuck - heightOf(oldest)` and translate `-distance`, capped by `heightOf(oldest)`. Push: `pushOffset = heightOfStuck - distance`. Never insert incoming clone during anticipation.
- INVARIANT: `displayedIndices` = appended set; missing clones retry. `detach`/changed sticky indices OR same-index row owners clear cache/template/display, not scroll; only live rows re-prime. Lookup uses current pool slot + direct body parent/cell index + `__rowDataRef`; nested/stale slots cannot donate snapshots.
- FLOW: `onScrollRender` primes/refreshes → `maybeScheduleSettlePass` → STYLE; `settlePassScheduled` coalesces, resets in `afterRender`. Requires in-window sticky row; portals commit after `data-row`.
- INVARIANT: `refreshClonesInWindow` reconciles displayed clones after settlement; `sameSet` otherwise strands stale DOM. Bypass scroll invokes `afterRender` without a public render event; avoid synchronous + settled double capture. `sticky-rows.spec.ts` no-flash regression.
- DECIDED (2026-10-15): `afterRender` coalesces capture-only settlement: leave hooks → adapter commits → recapture. WHY: `forceLayout()` captured empty React hosts. Token + attachment signal cancel stale work; no STYLE/RAF loop or empty-DOM readiness heuristic. Null/native replaces old content. `sticky-disclosures.spec.tsx`, `sticky-rows.spec.ts`.
- TENSION: arbitrary later async component state needs another grid render; settlement is not a DOM observer.
- DECIDED (#1370): missing capture → `synthesizeClone(index)` from detached real `templateClone`. WHY: downward scroll may never revisit uncaptured rows. Rewrite `.cell[data-field]` via `resolveCellValue`/`visibleColumns`; mark `data-synthetic-sticky-row`, replace on real capture.
- INVARIANT: synthesis omits templates with any `firstElementChild`; custom-renderer DOM cannot be retargeted. `sticky-rows.spec.ts`: `'synthesizes a stand-in…'`, `'omits rather than synthesizes…'`.
- DECIDED (#279): read `_virtualization` directly, zero core bytes. WHY: `core/internal/rows.ts#renderInlineRow` imports module-level `document.createElement('template')`, breaking happy-dom-less tests (#240).
- INVARIANT (#449, SC 2.4.11): `getVerticalScrollOffsets` returns container height; an already-displayed focused row gets `skipScroll:true`, otherwise keyboard navigation clears overlay. No clones → `undefined`.

### ContextMenu

OWNS: menu items, open state. HOOKS: afterRender, onKeyDown. QUERIES: `getContextMenuItems` (collects contributions from all plugins).
INVARIANT: contributions sort by `order` (default 100); `insertGroupSeparators` groups by the TENS digit. Bands: sort 10s, filter 20s, visibility 30s, pinning 40s, column move 50-53 (reorder-columns, #449), selection 60 (range extend, #449). A plugin that contributes AND self-hosts its own menu MUST bail when `grid.getPluginByName('contextMenu')` is truthy, else two menus stack.
