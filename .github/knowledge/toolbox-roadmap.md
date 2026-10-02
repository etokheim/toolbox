---
domain: toolbox-roadmap
related: [grid-plugins-catalog-ui, adapters-react, grid-plugins-editing, grid-render-pipeline, release-versioning]
---

# Toolbox Fork Delivery Roadmap

Scope: approved fork work, downstream adoption, and the wider grid wishlist; not an upstream commitment.

- Utility lifecycle implementation lives in `grid-plugins-catalog-ui.md`.
- React ownership and configuration live in `adapters-react.md`.
- Editing behavior lives in `grid-plugins-editing.md`; publishing rules live in `release-versioning.md`.
- Read order for the next task: delivery sequence → requirement ledger → acceptance gates → relevant implementation knowledge.

## Ownership and decisions

- DECIDED (2026-10-01, human): one roadmap owner coordinates focused implementation sessions and downstream adoption, owns routine engineering decisions and follows work through validation/review. WHY: the human should not need to supervise individual checks or resume each technical step.
- DECIDED (2026-10-01, human): proceed with the utility sequence AND the broader wishlist; investigate/plan ambiguous features and ask about product/UX/compatibility tradeoffs before choosing. Approval to investigate is not approval for an arbitrary breaking API.
- DECIDED (2026-10-01, human): consult the human before opening upstream PRs. Fork publication, merge, package release and upstream acceptance are distinct milestones; applicable per-request authorization still applies.
- INVARIANT: preserve upstream defaults; prefer additive, opt-in plugins and extension points. Business/domain policy and EDS-specific rendering stay downstream. Keep release manifests/package distribution wiring out of library feature slices.
- INVARIANT: a draft PR is a checkpoint, not completion. Green tests do not dismiss real review defects; static-analysis attribution errors do not justify unrelated rewrites or blanket suppressions.

## Delivery sequence

Status snapshot: 2026-10-02. Refresh GitHub before acting on status; this file is not a live CI feed.

| Stage                                     | Status                                                                    | Gate / deliverable                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Utility foundation                        | Merged, fork [#3](https://github.com/etokheim/toolbox/pull/3)             | Shared owner-aware column construction/cleanup; unchanged defaults.                                     |
| Selection core + React                    | Merged, fork [#4](https://github.com/etokheim/toolbox/pull/4), `b687ca9b` | Typed utility renderers and callback restoration; unchanged defaults.                                   |
| Disclosure core + React                   | Merged, fork [#5](https://github.com/etokheim/toolbox/pull/5), `a73ec4cc` | Separate tree/content slots; preserved MasterDetail placement.                                          |
| Cell-entry editing, Slice A               | Merged, fork [#6](https://github.com/etokheim/toolbox/pull/6), `fee40535` | Opt-in entry + Tab continuation; history identity and destructive clearing remain separate slices.      |
| Drag controls core + React                | Merged, fork [#7](https://github.com/etokheim/toolbox/pull/7), `e1c38f1f` | Custom handles, native cancellation, origin safety and owned lifecycle cleanup.                         |
| Embedded Selection core + React           | Implemented in fork [#8](https://github.com/etokheim/toolbox/pull/8)      | Row-only checkbox inside existing body-cell/Name renderer; approved runtime plus separate safety tests. |
| Opt-in utility composition                | Explicitly paused; no implementation or publication in this sequence      | Revisit order/pinning semantics only with separate approval.                                            |
| Downstream utility migration              | Not delivered by these fork PRs                                           | Separate immutable distribution and consumer browser proof; not blanket deletion of observers.          |
| Performance and small independent defects | Reproduce/measure before implementation                                   | Establish bounded workload; separate library defects from consumer geometry/theme policy.               |
| Heterogeneous expansion / nested groups   | Design required                                                           | Define row-model composition before coding; not a disclosure-renderer extension.                        |
| Outer-scroll sticky layout                | Repro/design required                                                     | Define scroll ownership, virtualization and offsets; no copied DOM-translation workaround.              |
| Fill handles / live column movement       | Experimental design required                                              | Agree semantics and performance/cancellation gates; do not assume upstream interest.                    |

FLOW: reviewed prerequisite API → independently scoped implementation → validation → review → authorized integration → downstream adoption proof. Planning may overlap prerequisites; dependent implementation must use the reviewed contract. Avoid a large stack of speculative feature branches.

- TENSION: Selection's measured Fallow audit remains non-passing (five core complexity attributions). React bridge dispatch now clears its findings; nine attributed unused public members and `onCellMouseMove` are baseline-identical. Private-method coverage attribution still misses executed methods. Independent review's callback-restoration defect has a red/green passive-effect regression; no global suppression or claim that Fallow passed.
- INVARIANT: dependent work using an unpublished prerequisite must identify that exact delta and reconcile it before publication; do not count the prerequisite twice or imply fork integration already happened.
- INVARIANT: fork merges #3–#7 establish fork integration only, not upstream acceptance, npm publication, a package release or downstream adoption. The embedded slice preserves all three drag-publication followups; its safety tests and this roadmap editorial are separate from the exact reviewed runtime commit.

## Utility acceptance and boundaries

- INVARIANT: core DOM + React are approved for this utility series; Vue/Angular native template bridges remain deferred. Preserve existing adapters and canonical React types/config surfaces.
- DECIDED (2026-10-02, human): embedded Selection is row-mode only inside an existing body-cell/Name renderer, using the existing React portal/provider tree. No pinned/synthetic placement qualification, headers, cascades, independent cell/range selection model or composition implementation. WHY: qualify the focused binding and React child without claiming broader consumer compatibility.
- INVARIANT: typed per-plugin state/actions, explicit grid/host/logical identity, persistent view update/disposal and deliberate null output. Plugin owns mutation, cancellation, broadcasts and state; control owns native accessibility/activation.
- INVARIANT: exactly-once click/Space/Enter including SVG targets; native grid listeners precede React delegation. Preserve entity-link behavior outside control boundaries and restore focus appropriately on removal.
- INVARIANT: no roots per control, global JSX overrides, DOM repair observers, full column rebuilds for state-only updates or plugin-state recreation on callback replacement.
- DECIDED (approved utility plan): default utility order unchanged; downstream opts into drag → checkbox → inline tree disclosure in pinned Name. WHY: placement/order/pinning are separate concerns; changing all users' defaults is unnecessary.
- INVARIANT: tree disclosure and content renderers need separate lifecycle slots inside one cell. MasterDetail's standalone default stays; inline MasterDetail placement is a separate proposal.
- INVARIANT: renderer support does not add grouped/tree selection cascade, domain-ID selection semantics, mixed expansion, hierarchical reparenting, live block drag, responsive cards or row-action overlays.
- READS FROM: downstream migration guards `cargo-crud.spec.ts`, `grid-auto-height.spec.ts`, `lifting-selection-header.spec.ts`; verify their current location/behavior in the downstream checkout before changing it.
- TENSION: portalled checkbox/drag/disclosure repair and the CSS contiguous selected-row frame are different mechanisms. Shared viewport geometry also drives sticky shadows. Remove only repair made unnecessary by demonstrated APIs; the frame/geometry need their own workstream.
- TENSION: row-mode checkbox hooks alone do not establish compatibility with an independent batch-selection model alongside cell ranges, descendant select-all or duplicate entity rows. Prove identity, eligibility and scope parity before migrating; do not broaden this renderer slice into selection-model changes.
- FLOW: adoption comparison → existing packages/adapter → matched reviewed packages with unchanged adapter → migrated hooks. Use one exact core/React revision and an immutable distributable before merging consumer dependency changes; local tarballs are isolated trial artifacts, not a production distribution.

## Wider requirement ledger

These are authorized roadmap items, not finalized APIs. Recheck current code/upstream before implementing historical suggestions.

| Requirement                                            | Initial route                                     | Decision / evidence needed                                                               |
| ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Single-cell editing; single-click entry                | Slice A merged in fork #6                         | Preserve opt-in defaults; later editing slices require separate review.                  |
| Delete/Backspace clears selected values                | Editing transaction integration                   | Read-only/validation handling, empty values, cancellation, one undo transaction.         |
| Fill down/up via corner drag                           | Experimental plugin candidate                     | Copy vs series, formulas if any, edit compatibility, pointer/keyboard alternatives.      |
| Mixed tree/detail/group expansion per row              | Row-model design                                  | Ownership of expansion, identities, child loading and composition semantics.             |
| Groups nested under a tree row                         | Same row-model design                             | Sorting/filtering/aggregation/selection behavior across structural row types.            |
| Disable manual reorder while sorted                    | Consumer policy through existing hooks first      | Confirm sort-state and `canDrag`/`canDrop` suffice; no unnecessary core switch.          |
| EDS editors / mixed JSX and DOM renderers              | Adapter compatibility + downstream simplification | Existing bridge capability and actual measured cost; no EDS dependency in core.          |
| Pinned hover backgrounds                               | Theme/CSS bug repro                               | Verify light/dark, selection and pinned/unpinned parity.                                 |
| Sticky boundary shadows                                | State/CSS extension or theme                      | Shared edge state rather than per-consumer geometry reads.                               |
| Auto height/width with outer-page sticky header/footer | Scroll-layout design                              | Which element owns scrolling; header/group/footer offsets, resizing and virtualization.  |
| Live column movement / transient scrollbar             | Separate repro + opt-in experiment                | Reproduce release-time width glitch; measure preview costs and cancellation.             |
| Numeric right alignment                                | Theme/default policy                              | Preserve explicit alignment; assess compatibility before changing defaults.              |
| Hover-expanding sticky action column                   | Consumer overlay first                            | Identify reusable clipping/stacking hook without moving business actions into core.      |
| Rendered-row identity/hooks                            | Public extension-point gap assessment             | Reuse existing identity contract; avoid index-as-ID or parallel metadata systems.        |
| Controlled external sorting                            | API reconciliation                                | Display state without neutralized comparators; inspect current support first.            |
| Stable plugin lifetime                                 | Regression tests / targeted fixes                 | Preserve canonical selection, expansion and Undo state on renderer/config updates.       |
| Flexible-column resizing                               | Repro then layout fix                             | Confirm which resize operation freezes flex sizing and define intended behavior.         |
| List navigation / entity-link focus                    | Opt-in interaction design                         | Native links/controls plus accessible keyboard navigation; no blanket focus suppression. |
| Range-selection ARIA / small variable-height grids     | Reproduce existing reports                        | Check current upstream fixes before duplicating changes.                                 |
| Scroll performance                                     | Shared measurement/scheduling investigation       | Separate forced-layout sources and compare the same workload before/after.               |

## Editing delivery split

- DECIDED (2026-10-01, coordinator review): implement only Slice A now: opt-in `CellEntry`, default-off Editing `tabToEdit`, existing single-cell editor lifecycle and all adapter feature bindings. WHY: useful cell entry must not depend on destructive clear policies or a history rewrite. No third edit mode, initial-text API or default behavior change.
- DECIDED (Slice A): ordinary click selects then opens on release; modifier clicks, drag and long-press remain selection-only. Tab skips non-editable targets and leaves at the dataset boundary. WHY: preserve selection gestures and avoid a keyboard focus trap. Validate actual native/framework editor transitions and external focus targets.
- FLOW: A entry/Tab → independently reviewed B stable-ID history correction → approved type-aware/bounded preflight policy → C range clear. Printable entry needs a separate custom-editor initial-text contract. Clear-value semantics, work limit and partial-veto UX remain proposals, not approved implementation.
- READS FROM: [OysteinAmundsen/toolbox#494](https://github.com/OysteinAmundsen/toolbox/issues/494) is open; [OysteinAmundsen/toolbox#487](https://github.com/OysteinAmundsen/toolbox/pull/487) closed unmerged. Do not resurrect its third-mode/default-on destructive-key proposal.
- TENSION: upstream main already merged modified-Space guards ([OysteinAmundsen/toolbox#498](https://github.com/OysteinAmundsen/toolbox/pull/498)), range spans ([OysteinAmundsen/toolbox#502](https://github.com/OysteinAmundsen/toolbox/pull/502)) and clipboard activeAxis ([OysteinAmundsen/toolbox#500](https://github.com/OysteinAmundsen/toolbox/pull/500)). Reconcile separately; upstream merge does not establish fork incorporation or npm availability.

## Validation and release gates

- OWNS: each slice supplies tests for its contract, type fixtures, appropriate docs/demo, focused browser/accessibility coverage and relevant build/lint/bundle/performance results. The roadmap owner verifies actual outcomes, not command launch.
- INVARIANT: measure hot behavior: select-all/clear-all with custom controls, virtualization/recycling, tree expansion with React content, repeated mount/unmount, bounded portal counts and geometry reads.
- INVARIANT: compare fixed datasets/viewports and stable baseline revisions; historical downstream timing is a hypothesis, not a Toolbox-only benchmark.
- TENSION: partial-suite coverage can fail a project-wide threshold despite passing assertions. Fallow private-method matching can miss executed anonymous V8 function records; classify with actual coverage/diff evidence. Do not lower thresholds or relabel failures as passes.
- TENSION: embedded audit against the actual drag-publication base remains non-passing. Fresh Istanbul after the bounded test-only followup covers the registry's 130/130 statements and 82/82 branches, plus the React wrong-owner guard. Private-method function attribution still misses executed statement/branch counters; two attributed functions are baseline-identical and the axe dependency is already root-declared. Shared lifecycle's sole unhit marker-mismatch arm requires bypassing owner/marker APIs; real foreign-marker and successor cleanup are tested without symbol forgery.
- DECIDED (2026-10-02, human, #8): accept this specific embedded audit residual and publish/merge after exact-head checks pass. WHY: eight new safety tests cover reachable guards without runtime changes, and all 83 executable hashes remain unchanged; no blanket waiver or gate reduction.
- INVARIANT: embedded qualification includes exact source-overlay proof, all 83 emitted grid entries and import graphs, source/emitted positive and negative types, native browser/axe tests and matched performance. Only Selection's raw cap increases to 60 KiB by explicit approval; other caps stay unchanged. Core's gzip soft warning, the known Angular inferred-typecheck limitation, unrelated Editing demo exception, macOS promo Control shortcut and manual-AT/OS-native-drag limitations are not erased by green focused gates.
- DECIDED (delivery): library integration and downstream package adoption stay separate. WHY: a merged fork PR does not make packages available to the consumer or constitute an upstream merge.
- INVARIANT: raise a human decision with a recommendation, concrete alternatives and consequences only when it changes product behavior, compatibility, scope, priority or external publication. CI waits and ordinary implementation choices are not product decisions.
