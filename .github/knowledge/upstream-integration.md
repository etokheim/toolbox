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

## Identities

- READS FROM: upstream `https://github.com/OysteinAmundsen/toolbox.git`,
  default branch `main`, resolved 2026-10-16 to
  `bac5cc3ac1ff0080f8c2430b18ca875793266741`.
- READS FROM: frozen fork base `0e9b35898b943287c182ad82364490a0404c581e`,
  tree `7dc2ea3ba704753639a722df2f124912b3726c5a`; common ancestor
  `e95efbec3e53c2dfc82f94ca29b4759c668fb1e6` (16 incoming commits).
- INVARIANT: the source-pinned preview at the fork base is immutable. Integration
  does not replace its tag/assets, publish npm packages or update a consumer.

## Integration decisions

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

## Qualification

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
