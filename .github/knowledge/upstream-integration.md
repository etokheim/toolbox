---
domain: upstream-integration
related: [grid-hierarchy, toolbox-roadmap, build-and-deploy, release-versioning]
---

# Upstream Compatibility Boundary

Local integration of upstream changes into the source-pinned fork.

- Hierarchy contracts → `grid-hierarchy.md`.
- Utility defaults and approval boundaries → `toolbox-roadmap.md`.
- Distribution safeguards → `release-versioning.md`.

Read order for reproducing this integration: identities → decisions → checks.

## 2026-10-30 reconciliation

- READS FROM: fork commit `4c0e5f9d974b69f985488b3e3fd19fe2d9e4387d`,
  tree `077606a10d125ce8a5b619e525175a78861a1f9f`; upstream main
  `3531022ac2a27ec94ad0cf8855978ed671ecc23a`, common ancestor `bac5cc3a`
  (42 incoming commits; patch IDs new, partial semantic backports still present).
- READS FROM: frozen clearing tree `c79b500866ff925b324f5548c1d4e7bf54bb5f9e`;
  patch SHA256 `70f027029b17365f903610256a86509037dedab4b80e345fdfbc56fb5eb5a9bb`.
  Upstream-only resolution tree `1a23fa1cf970b52a0145aaf2f05065793dee62dd`
  precedes feature reapplication; neither snapshot is a commit.
- DECIDED (history): retain upstream public rowId/explicit-ID recording,
  programmatic events, history-change and post-render focus; approved private
  owner identity overrides silent deletion and stale-index no-ID fallback.
  WHY: missing/ambiguous/resolver-changed owners warn and skip while stacks
  advance and valid compound members replay; no atomicity claim.
- FLOW: upstream template host keydown/setInputValue and moved-row editor drafts
  coexist with IME guards, control retirement and RowWindow ownership. Hierarchy
  substitutes nested edit owners before contributors; substitution disables the
  single-contributor shortcut, not generation-safe metadata publication.
- DECIDED (measurement): retain direct-cell canonical processed indexes plus
  row-reference/RowWindow validation rather than upstream aria-only measurement.
  WHY: fork already fixes synthetic rows and additionally rejects foreign grids
  and noncontiguous-window mismatches.
- INVARIANT: MasterDetail caches remain WeakMaps; weak cached-owner references
  permit eligibility invalidation after collapse/filter without retaining
  evicted source rows. Abort/retired request contexts reject late responses;
  derived expandAll covers future rows without strong expansion membership.
  Tree/detail expansion classes retain independent owners.
- OWNS: GroupRowView owns stateless header presentation; GroupingRows retains
  expansion/disclosure lifetimes. TreeProjection owns row-preserving sort/key
  helpers; Tree retains generations, key/position maps and async loads.
  Extraction satisfies existing max-lines policy without new exemptions.
- INVARIANT: owner-gated release mutation/npm/deploy and composite publish
  rejection protect forks; ordinary validation stays enabled. Source versions
  remain upstream's; no commit, publication, consumer adoption or perf campaign.
- READS FROM: integrated library checks: grid5382 (3 existing skips), React498,
  Vue433, Angular592; 349 files. Exact upstream-only lint JSON271→267 warnings,
  zero new. Builds/type-dependent targets and entry budgets pass; approved
  raw-only core cap adjustment and exact measurements → build-and-deploy.md.
- TENSION: Nx24 inferred Angular `typecheck` invokes `tsc --build
--emitDeclarationOnly` over test projects with NodeNext extension/internal
  export errors; production ng-packagr/ngc checks main plus every secondary
  entry separately. Standalone failure is recorded, not claimed green.
  `--skipSync` avoids unrelated root/docs/e2e project-reference rewrites.

## 2026-10-16 identities

- READS FROM: upstream `https://github.com/OysteinAmundsen/toolbox.git`,
  default branch `main`, resolved 2026-10-16 to
  `bac5cc3ac1ff0080f8c2430b18ca875793266741`.
- READS FROM: frozen fork base `0e9b35898b943287c182ad82364490a0404c581e`,
  tree `7dc2ea3ba704753639a722df2f124912b3726c5a`; common ancestor
  `e95efbec3e53c2dfc82f94ca29b4759c668fb1e6` (16 incoming commits).
- INVARIANT: the source-pinned preview at the fork base is immutable. Integration
  does not replace its tag/assets, publish npm packages or update a consumer.

## 2026-10-16 integration decisions

- DECIDED (compatibility): preserve the fork's Hierarchy/Tree/GroupingRows
  implementation of upstream `5c94b761`. WHY: it already uses that contributor
  model, with additional scoped keys, full MultiSort, metadata restoration,
  guarded generations, fixed child sections, logical reveal ownership and typed
  disclosure lifetimes. Do not add a second hierarchy engine.
- DECIDED (utility defaults): retain owner-aware utility insertion and the
  unpinned checkbox default rather than upstream `46e5bd07`'s left-pinned default
  and new insertion order/early hook priority. WHY: the approved utility-default contract remains
  unchanged; utility composition is paused. The compatibility test asserts this
  exception explicitly.
- FLOW: upstream selection range-span chords and public `selectAll` delegation
  reach Angular, React and Vue without replacing their renderer bridges.
  Clipboard resolves the active axis for array selection modes; modified Space
  remains with native editors; core adds Ctrl/Cmd row-edge and viewport paging.
- INVARIANT: Alt+Arrow row reorder and its retained Ctrl alias must both reach
  bound custom drag handles, while cancellation, editing guards, ownership and
  stale actions remain authoritative.
- FLOW: Tooltip forwards wheel deltas through its anchor to the existing grid
  routing; mixed-axis outer-wheel code is unchanged. ServerSide rechecks the
  post-render viewport once after arriving blocks, clearing pending work on
  purge/source replacement/detach.
- DECIDED (packaging): accept upstream plugin-barrel externalization and release
  metadata; preserve fork preview publication guards and entry budgets. WHY:
  normal ESM dependencies should not embed duplicate public plugin classes.
  Source package versions are not a claim that this fork output was published.
- DECIDED (bundle compatibility): plugin ESM builds import core defaults from
  their existing public export rather than inline the entire announcement
  catalog. WHY: incoming announcements pushed Editing/Selection over their
  fixed budgets. No new public exports or budget increases; UMD is unchanged.
- DECIDED (documentation): preserve the fork's generic hierarchy/detail demo and
  its interaction test; retain upstream plugin-kind metadata and independent
  docs fixes. Replace obsolete upstream key-prefix prose with opaque-key
  guidance; the upstream hierarchy knowledge path redirects to the fork model.
- DECIDED (tooling): accept upstream skill migration/splits while retaining fork
  benchmark variance guidance and the active saving-mode preference. WHY: an
  upstream sync must not silently change local execution policy.

## 2026-10-16 qualification

- READS FROM (2026-10-16): `NX_DAEMON=false NX_NO_CLOUD=true bun nx run-many
-t lint test build --projects=grid,grid-react,grid-vue,grid-angular,docs
--parallel=2 --output-style=static` passed. Core 4,633 tests (3 skipped),
  React 451, Vue 429, Angular 564, docs 91; emitted core/React type fixture passed.
- READS FROM: exact-base lint JSON comparison added zero warnings:
  core 198→198, React 33→29, Vue 18→14, Angular 27→23. Documentation link
  audit: 0 issues/733 files; API coverage: 0 undocumented exports.
- READS FROM: emitted-package smoke imported all 27 plugins, confirmed one
  public Hierarchy class, independent scoped groups, null/disposed checkbox
  controls with inert stale actions, and React/Selection imports.
- INVARIANT: all hard bundle limits pass without increases; core gzip remains
  above the 45 KiB soft warning and Selection has only 103 raw bytes headroom.
- INVARIANT: source-alias tests, emitted type checks, bundle checks and browser
  comparisons are distinct evidence. Local macOS results do not establish
  hosted Linux parity or a matched physical-input receiving comparison.
- INVARIANT: report exact commands/results and package identities at handoff.
  The receiving owner compares the frozen baseline and integrated pair with
  unchanged rows, projection, viewport, density, instrumentation and input.
  No later geometry/feature work is included in this integration stage.
