---
domain: grid-scoped-footers
related: [grid-hierarchy, grid-render-pipeline, grid-plugins-catalog-data, adapters-react]
---

# Scoped Non-Data Footers

Optional PinnedRows flow geometry, scope admission and single interactive ownership.

- Tree/GroupingRows occurrence model → `grid-hierarchy.md`.
- Global slots/aggregation → `grid-plugins-catalog-data.md`.
- Position cache/scheduler → `grid-render-pipeline.md`; React portals → `adapters-react.md`.

Read order for misplaced/missing footer: admission → row-flow offsets → live owner → capacity.

## Admission

- OWNS: `PinnedRowsConfig<T>.scopedFooters(FooterScope<T>)` returns `{height,render}` or `null`; grid scope includes empty data. Expanded real rows and admitted expanded groups are eligible contexts, not automatic commands.
- INVARIANT: `scope.key` derives from rendered-occurrence keys (`getRowCacheKey`); parent object/domain ID/view index is not occurrence identity. Group context exposes real `parent` and normalized `path`; duplicate canonical parents require distinct occurrences. Resolver replacement retires live owners.
- OWNS: `FooterContext.depth` is owner presentation depth (Tree `meta.depth`, group `__groupDepth`, grid zero); group-only `collapsible` distinguishes disclosure/fixed headings. Generation rebuild + `ControlSlot.update` refresh retained owners even at stable keys/renderer identities. Consumer owns name-column/icon/text offsets; `path.length` is not visual depth. `GroupingRows.getGroups()` cannot resolve groupOn occurrences.
- FLOW: `GroupingRows.emptyGroups(GroupOnContext)` seeds structural paths before member grouping within the admitted sibling list. `groupOrder` still only sorts. Fixed child groups are expanded; collapsed/removed/filtered-out parents never contribute child declarations.
- INVARIANT: explicit `children: []` + Tree `hasChildren` admits eligible empty real parents. Expanded empty arrays traverse hierarchy contributors; `defaultExpanded`/`expandAll` include them. Arbitrary leaves remain leaves; no loader is required.
- DECIDED (stage6, receiver-agreed): retained parent with an excluded category must omit that declaration. WHY: native cannot infer consumer projection/filter eligibility. `empty-groups.spec.ts`.

## Geometry and lifecycle

- OWNS: plugin `ScopedFooters` computes scope ends with the existing ancestor index; core private `RowFlow` registers non-data extents. `RowPosition.height` remains data/editor surface; `after` adds gaps, including final total. Single/batched measured-height deltas preserve gaps. No footer enters `grid.rows`.
- INVARIANT: `RowFlow.scopeAt` resolves individual footer segments to owning processed rows (grid/outside = -1); ordinary `getRowIndexAtOffset` still advances across gaps. `scopeEnd` includes descendant/own segments but excludes co-terminal ancestor/grid segments. Ordered per-ending-row buckets contain topology, not cached pixel geometry; offsets/heights always come from current position cache. Ancestor push-off groups by equal pixel ends, not equal subtree-end row indices.
- FLOW: forced virtualization rebuild → prepare scopes → authoritative cache gaps → data-row margins + absolute footer position relative to existing row-window origin. Empty-grid extent uses body minimum height. No additional scroll listener/RAF/cache of scroll coordinates.
- INVARIANT: only innermost eligible intersecting scope may stick; others remain at natural ends. `ControlSlot` supplies one live renderer owner; scope exit/collapse/removal/disconnect retires it. Footer control boundary excludes data click/key/paste handling but preserves browser focus. React reuses `createControlBridge` and existing PortalManager for props/canonical features; source callback replacement changes eligibility/height without sibling plugin resets.
- INVARIANT: per-row configured CSS height is applied before plugin `renderRow`, including structural headers; otherwise painted heights diverge from position cache. Browser fixture must not override cell minimum height below the configured row height.
- INVARIANT: retained ancestor absolute positioning outranks Selection's row-focus positioning; otherwise focusing a live control adds its full height back into normal flow while cache/footer offsets stay unchanged. `sticky-rows.css`; real-wheel selected-owner browser regression.
- DECIDED (stage6, user-directed capacity): after releasing sticky ancestors, insufficient space for footer plus current data/editor surface leaves footer in normal flow and emits `CONFIG_RULE_WARN`; sticky bottom occlusion is zero until capacity returns. A footer gap reserves its adjacent preceding data surface, not the next unrelated subtree selected by data navigation; scope membership comes from the segment owner, never that surface. WHY: preserve reachable controls without hiding, shrinking targets or forcing container height. `scoped-footers.spec.ts`, `scope-boundaries.spec.ts`, `e2e/tests/scoped-footers.spec.ts`.
- DECIDED (stage6, containing blocks): use native offset placement, not CSS sticky. WHY: flattened sibling rows have no subtree block; `.rows-viewport` clips, `.faux-vscroll` is a sibling, external `.tbw-scroll-area` captures sticky.
- INVARIANT: global panels retain normal-flow reservation. Consumer removes only its redundant action slot; native owns no domain command/label/permission/insertion or Save/Undo policy.
- INVARIANT: without RowWindow, scoped RowFlow keyboard/editor reveal reads the authoritative cached offset and data-surface height, including preceding non-data gaps; omitted RowFlow retains legacy estimated-height keyboard behavior. PinnedRows reports bottom occlusion directly, independent of ancestors. Public reveal can succeed before editor entry overwrites its scroll position; browser coverage includes no-ancestor bounded grids with semantic row heights and global totals.

## Qualification boundaries

- READS FROM: neutral built/extracted core+React package browser fixture; both scroll owners, densities, feature surfaces, empty/flat scopes, bounds/focus/capacity and owner disposal.
- INVARIANT: isolated declaration checks explicitly map `@toolbox-web/grid/all` as well as core/plugin entries to the extracted package; unresolved imports under `skipLibCheck` can otherwise erase contextual types. React peer types come from the test workspace.
- TENSION: Nx 23.2 boundary-rule `getEntryPoint` loops when static imports into the dynamically imported grid resolve under `dist/libs/grid` but its ancestor walk expects `libs/grid/`. Scoped-footer/grouping browser fixtures use awaited runtime imports plus type-only static imports, matching the existing lazy fixture contract; canonical `nx lint e2e` remains unsuppressed.
- TENSION: native qualification does not imply consumer acceptance. Broader full-plan performance and portable downstream adoption remain separate gates. Vue/Angular keep core DOM contract; no new template facade in this slice.
