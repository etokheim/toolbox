---
domain: grid-hierarchy
related: [grid-plugins, grid-plugins-catalog-data, grid-plugins-catalog-ui, grid-core, grid-data-pipeline]
---

# Hierarchical Row Models

Hierarchy composes real Tree descendants and parent-local GroupingRows without cloning domain rows.

- Plugin lifecycle/dependencies → `grid-plugins.md`.
- Other row transforms, sorting/filtering, aggregation → `grid-plugins-catalog-data.md`.
- Independent MasterDetail expansion, disclosure navigation → `grid-plugins-catalog-ui.md`.
- Framework control ownership → `adapters-react.md`.

Read order for composition/teardown: `hierarchy.ts` → `hierarchy-plugin.ts` → `core/plugin/row-metadata.ts` → contributor/disclosure code.

## Local fork trial disposition

- DECIDED (2026-10-12, actual human approval relayed by coordinator): "I approve and you can keep working on the local roma trail without asking for approval. Just document/remember what we defer/what needs more work". Applies to `1ecc5ce987e48f92e8491339aa35e4a5a67d04b4` and ongoing LOCAL sticky-section trial fixes/handoffs. WHY: continue consumer validation while recording residuals; no repeated routine waiver prompts, publication, asset replacement, PR/remote merge authority or answering human questions on their behalf.
- TENSION: source1ecc retains audit FAIL163 raw / FAIL62 covered (71 unused members, 7 clones). Bounded d30 comparison: forced-render task means +0.056–0.157ms; 25-row wall completion +0.593ms/+31.56%, with noisy paired variation; no timing gate pass. Broader grouping/cold/mutation/large-viewport/React performance and detail-null/predefined-empty coverage remain deferred. Opaque public sticky theme remains required; real Roma acceptance is consumer-owned.
- INVARIANT: published5b53 and failed d30 evidence remain frozen. Pair1ecc is local-only: core SHA256 `85b12da43e4742b49043563fa965408ebef61e312a6123432e34589888ba346a`, React `1c3113afc31892180b46cc11deb577c50e664f37a72bf9acef54a420314ba85a`. This approval record postdates the pinned source; it does not change packaged runtime or turn failed gates into passes.

## Hierarchy

- DECIDED (2026-10, selective port of upstream `5c94b761`): Tree + GroupingRows compose via `HierarchyContributor`; provided dependency goes through the per-grid instance gate. WHY: sequential whole-array transforms lose natural parent scopes. No new feature toggle or adapter template bridge.
- FLOW: contributors forward `processRows` → last participating hook builds once → structure stage discovers/sorts natural siblings → transform stage groups each list → preorder flatten. `shaped` children bypass transforms; real descendants still contribute natural sibling lists.
- OWNS: published `HierarchyModel.positions` lookup and compare-and-restore `RowMetadata` leases for role/level/setsize/posinset. Contributors retain independent controls/expanded/loading state. No-contributor, flat, recycled and detached paths release owned metadata.
- INVARIANT: real row references survive. Repeated canonical entities require distinct occurrence objects/IDs. Composed keys serialize `[parentOccurrence, normalizedGroupPath]` (root scope `null`); standalone grouping retains legacy keys. Accordion follows stored structural ancestry, not key prefixes across parent scopes.
- OWNS: `ActiveAncestors` indexes unique explicit `getRowId`/native synthetic keys per generation and snapshots each live row's key in a WeakMap. Immutable same-occurrence updates reuse that row before core utility-view retention; absent/ambiguous IDs use reference-only ownership, never entity-ID or view-index inference. Resolver changes revoke snapshots; removed rows follow normal teardown. Reconciliation remains bounded by W+A. Tests: `active-ancestors.spec.ts`, React `mixed-column-renderers.spec.tsx`.
- DECIDED (2026-10, user-approved projection boundary): native Filtering remains root-input filtering; ancestor retention/promotion and complete canonical totals remain consumer eager projections. WHY: grouping must not change data ownership or silently narrow totals. Aggregation sees direct sibling members; no selection aliasing, domain-buffer mutation, or nested predefined/lazy group contract.

## Metadata generations and standalone paths

- OWNS: `buildHierarchyModel` selects `FLAT_HIERARCHY` only for one active contributor. `hasDefaultHierarchyHooks` rejects overridden `processSiblings`/`endHierarchy`; composed/custom hooks use the generic pipeline. `beginHierarchy` still runs; returning false removes a contributor from that rebuild.
- DECIDED (2026-10, positional lookup reuse): sole default Tree lends a getter-only view of its completed `#rowMeta` generation. WHY: avoid duplicate real-row metadata writes without changing public maps, comparator behavior, or ARIA ownership.
- INVARIANT: Hierarchy clears its published lookup before a rebuild and publishes only the matching completed generation. Reentrant builds sharing a contributor throw; a `finally` removes the build guard. Generation changes during callbacks cannot publish partial/stale positions.
- OWNS: Tree's `#retirePositions` drops the borrowed map reference on next begin/detach. `#priorRowMeta` survives only for sibling edit-order reconstruction; Hierarchy cannot retain retired Tree state through the getter.
- INVARIANT: public `buildHierarchy(..., meta)` fully materializes the supplied WeakMap and retains its identity. Generic completion with no shaped contributor deletes emitted rows' entries; unrelated/non-emitted entries remain. Borrowing is private, not a new public map/config contract.
- INVARIANT: same-instance standalone → composed → standalone activity translates root group expansion through `RootGroupKeys`. Replacing plugin arrays follows existing detach/reinitialize policy, not same-instance state preservation.
- TESTS: `hierarchy.spec.ts`, `hierarchy-integration.spec.ts`, `borrowed-positions.spec.ts`, `correctness-followup.spec.ts` cover generation/reentrancy, explicit maps, custom IDs/hooks, row replacement, both plugin orders and contributor retirement. Defensive missing-contributor/container ARIA fixtures are not claims about normal config replacement leaving Hierarchy attached.

## Reveal ownership

- OWNS: Tree and GroupingRows keep visible logical-occurrence deltas; `hierarchy/reveal-animation.ts` owns transient classes/listeners per direct body element + occurrence. Recycle, removal, disable, detach and matching row-level animation end/cancel release that owner; nested/unrelated animation events do not.
- INVARIANT: GroupingRows compares scoped group keys and resolved data IDs (row-reference fallback), never view indexes or stale `data-group-key` on recycled real rows. Inactive grouping still remembers ungrouped roots before the first child-section expansion. `hierarchy-reveal.spec.ts`.
- DECIDED (native reveal correction): newly visible live headers, including fixed child sections, use GroupingRows reveal animation. Decorative StickyRows templates strip transient Tree/GroupingRows classes. WHY: live occurrence reveal is distinct from later scroll promotion; clones have no animation lifecycle owner.
- INVARIANT: scroll hooks only retire mismatched active owners; they never compute a reveal delta. No timer, new animation frame or forced layout is introduced. Grid `data-animation-mode` expresses policy, not active media preference; the CSS `--tbw-animation-enabled` signal gates default reduced-motion behaviour.

## Tree

OWNS: expanded keys, flattened rows, `rowKeyMap`, `#rowMeta` `WeakMap<row,FlattenedTreeRow>`, `#rowKeys` `WeakMap<row,string>`, animation state, `loadingKeys`/`loadedKeys`, `#childRequests: Map<key,AbortController>`.
HOOKS: processRows(10), processColumns, afterCellRender, afterRender, onCellClick, onHeaderClick, renderRow, getRowHeight, adjustVirtualStart.
QUERIES: `canMoveRow`, `datasource:viewport-mapping`, `sort:get-model`. EVENTS: `tree-expand`, `tree-load-start|end|error`. FIRES: `datasource:fetch-children`. LISTENS: `datasource:children|error` (filtered on `context.source === 'tree'`).

- DECIDED (v3.4.0, lazy loading): ServerSide wins; `requestLazyChildren` checks `datasource:is-active` **via `queryBoolean`** (#430 — raw `query()` returns truthy `[]`). Otherwise `TreeConfig.loadChildren` accepts Promise/Subscribable with per-request `AbortController`, aborted on detach. WHY: preserve one source owner. `TreePlugin.#loadChildrenLocally`; `tree-integration.spec.ts`.
- INVARIANT: Subscribable is take-one; `finish()` removes the controller detach would abort, and `settled` handles synchronous emission. Truthy non-array `childrenField` or `TreeConfig.hasChildren` signals lazy children; single-batch, no pagination. `loadedKeys`, not child-array length, prevents refetch per attach. Errors do not mark loaded; `datasource:error` clears `loadingKeys` for retry.
- INVARIANT (#430): `detectTreeStructure(rows, childrenField, hasChildren)` receives `config.hasChildren`; predicate-only lazy trees have no `children` field. File: [tree-detect.ts](libs/grid/src/lib/plugins/tree/tree-detect.ts).
- INVARIANT: loading uses core `createDefaultSpinner('small')` + `.tree-loading` sizing in `@layer tbw-plugins`. Tree leases row `aria-expanded`/`aria-busy` (including null absence); `afterRender` retires disconnected/non-Tree slots, detach retires all. Shared Hierarchy positions, successor leases and externally replaced attributes survive. Direct body rows only; `tree-row-metadata.spec.ts` covers Tree→fixed-group→Tree recycling and pending loads.
- INVARIANT (#264): Hierarchy owns final visual ARIA positions; Tree retains natural-parent metadata and derives indentation from final depth. Root-owner ordinals include group headers in the final list. Inactive Tree clears its row metadata.
- INVARIANT: keys prefer `effectiveConfig.getRowId`, then legacy id/reference/path. Expansion walks last natural root input, not flattened synthetic rows. MultiSort uses its whole model via `applySorts`. Row-mode edit freeze uses prior natural positions only when every row still has matching parent/cardinality; replacement, reparenting or size change forces sorting.
- FLOW (async rows): empty `flattenedRows` makes `processColumns` a no-op; ROWS does not rerun COLUMNS. Both `processRows` branches call `#syncTreeColumn()`, which microtask-checks `#treeColumnWrapped !== flattenedRows.length > 0` and calls `requestColumnsRender()` on mismatch. Covers `grid.rows` after `ready()` and ServerSide blocks.
- INVARIANT: `_schedulerMergeConfig` reseeds `#baseColumns` from `_columns`; plugin columns are not pristine. Tree tracks installed wrapper and both original renderer aliases (`renderer || viewRenderer`); restore both on unwrap, never nest wrappers during repeated merges.
- OWNS: `#cells` maps cells to row/key, persistent wrapper, independent content element and optional `ControlSlot<TreeDisclosureContext<T>>`. Same logical row preserves wrapper/content. Recycle calls `releaseCell` inside an adapter batch before invoking cached Name renderer, then detaches wrapper intact; `afterCellRender` registers post-install cleanup.
- INVARIANT: `disclosureRenderer` applies to eligible parents with visible icons; loading disables action. `setExpanded` rechecks slot, attachment, live row/key and loading before `toggle`. Callback setter requests STYLE only. Custom DOM controls own names/native activation; no default custom Tree label. Navigation boundary → `grid-plugins-catalog-ui.md`.
- INVARIANT (perf): `flattenTree` allocates one array; `appendFlattenedRows` recursively appends preorder rows. Returning/spreading child arrays risks JS argument limits on wide trees. Bench: `tree-data.bench.ts`.

## GroupingRows

OWNS: grouped model, expanded keys, animation state. HOOKS: processRows(10), onHeaderClick(-1), renderRow. QUERIES: `canMoveRow`, `grouping:get-grouped-fields`, `datasource:viewport-mapping`. EVENTS: `group-toggle|expand|collapse`.

- DECIDED (#335): `setGroupOn(fn, expanded?)` accepts `DefaultExpandedValue: boolean|number|string|string[]`, seeding the next fresh group set; immediate `expandAll`/`collapseAll` also defer. WHY: old keys cannot resolve new grouping. `groupConfigDirty`, `pendingExpansion`, `processRows`, `getGroupKeys(initialBuild)`.
- FLOW: rebuild snapshots/clears pending expansion, resolves against fresh keys, then broadcasts one `group-toggle`. Numeric root default `0` is a valid first-group index, not disabled; explicit collapse survives later rebuilds (`default-expansion.spec.ts`).
- DECIDED (2026-10-12, user-directed): numeric defaults resolve once per real parent's first nonempty top-level child-group list. WHY: independent initial disclosure per parent without reopening user collapses. `ChildGroupExpansion.#numericParents` keys by occurrence ID, survives source replacement/rebuild, clears on detach; empty lists wait, out-of-range nonempty lists consume the default. Explicit pending overrides still win. Boolean `#seenKeys` behaviour and root resolver remain separate.
- DECIDED (2026-10, user-directed): `childDefaultExpanded?: boolean|number` overrides only real-parent child groups; omission falls back to `defaultExpanded`. WHY: global groups can start open while Tree parents/child sections start closed, without post-render repair. Same numeric once-parent/pending-action precedence; standalone/predefined unaffected. `scoped-defaults.spec.ts`.
- DECIDED (2026-10, user-directed): `groupOrder(GroupOnContext)` ranks normalized category segments as a fixed prefix, independent of sort direction. WHY: semantic sections must not require modified labels/keys. Once per natural sibling model build, reused at nested group levels; first duplicate wins, missing categories omitted, unlisted values retain normal direction. `group-order.spec.ts`.
- INVARIANT: `setGroupOrder` is equality-guarded row invalidation only; it does not clear expansion, numeric initialization, group identity or selection. React live-config synchronization → `adapters-react.md`.
- DECIDED (2026-10, user-directed): `childGroupsCollapsible:false` fixes every group-path level under real Tree parents open; root/global/predefined remain collapsible. WHY: semantic sections need policy, not post-render reopening. Overrides defaults/pending/accordion/bulk; single-key actions no-op. Public model/render params expose optional `collapsible:false`, model stays `expanded:true`. `fixed-sections.spec.ts`.
- OWNS: `ChildGroupExpansion` retains seen/numeric initialization and visited fixed keys through rebuilds/hidden parents; detach clears all. Fixed rows release expansion leases/controls but retain structural metadata and normal cell navigation.
- INVARIANT: GroupingRows stamps direct owned `.cell` children with current processed `data-row`; nested grid header/body cells are excluded. Core handled `renderRow` skips normal reconciliation. StickyRows capture uses the matched cell's parent, so custom cells must be direct row children; no sticky engine/ancestor-expiry change. `fixed-sections.spec.ts` covers reorder/regroup/reuse; `mixed-height-sections.spec.ts` covers foreign headers and measured offsets.
- TENSION: StickyRows overlay/clone backgrounds use `--tbw-color-bg`, whose default is `transparent`; whole-header custom cells without an opaque background expose scrolling text beneath. Native group cells paint their own background. An opaque consumer color token resolves this inherited painting limitation; capture/index correctness alone does not prove visual opacity.
- INVARIANT: bulk events use `broadcast<GroupToggleDetail>`, not `emitPluginEvent`. `GroupToggleDetail.{key,expanded,value,depth}` are optional; bulk carries only `expandedKeys`.
- OWNS: disclosure `ControlSlot`s by row element + group key/depth; guarded lookup reads current flattened model. Same-key headers preserve host/cell/focus and replace generated siblings only. Recycle/regroup/removal/callback replacement/disconnect revoke actions and dispose; whole-header renderer takes precedence.
- DECIDED (grouping disclosure slice): plugin-local `disclosureLabel` shares native/custom localization without expanding unrelated entry defaults (Editing budget had 6 bytes spare). WHY: preserve optional-plugin budgets. Custom hosts are semantics-free, never `.group-toggle`; native pseudo-target remains. Loading permits native collapse, so custom `disabled` matches.
- OWNS: `core/plugin/row-metadata.ts` leases group-specific attributes/styles separately from Hierarchy role/positions. Disable/detach/recycle restore unchanged owned values; successor leases inherit original baseline, external replacements survive. Header→data/loading clears old cells even with equal child counts. Tests: `disclosure-controls.spec.ts`, `grouping-row-metadata.spec.ts`.
