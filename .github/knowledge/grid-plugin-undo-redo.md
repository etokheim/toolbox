---
domain: grid-plugin-undo-redo
related: [grid-plugins-editing, grid-data-pipeline, grid-plugins]
---

# UndoRedo ownership

Native scalar replay/snapshots and opt-in application-owned history.

- Editing acceptance, proposal correlation and clearing → `grid-plugins-editing.md`.
- Source-row writes and field paths → `grid-data-pipeline.md`.

Read order for incorrect replay: ownership mode → captured identity → accepted mutation vs availability events.

## Native mode

OWNS: stacks, action-keyed `EditTarget` WeakMap, private static snapshot-token WeakMap. DEPENDS: Editing. Tests: `undo-redo-{plugin,identity,snapshot}.spec.ts`, `integration/undo-redo-row-identity.spec.ts`.

- FLOW: `cell-edit-committed.row` (actual owner, including hidden index `-1`) → `captureEditTarget` → replay `resolveEditTarget` (`row-identity.ts`, shared with clearing). Historical `rowIndex` and public `rowId`/`recordEdit(..., rowId?)` remain compatible; private owner/resolver/ambiguity evidence governs replay.
- DECIDED (user-confirmed): missing/ambiguous owner or changed resolver → TBW041 + skip, normal stack movement, partial compounds. WHY: no stale-index writes or ID reinterpretation. Unique IDs follow settled immutable replacements; no-ID requires original live object.
- FLOW: ID replay → `updateRow(id, changes, 'history')` → Editing without re-recording; no-ID writes → core `_invalidateRowContent` → accessor/retained-cell invalidation. `#suppressRecording` resets in `finally`. Applied visible targets focus after `afterRender` re-sort/filter; skipped/filtered targets do not.
- DECIDED (Jul 2026, TBW111): nested `beginTransaction`/`endTransaction`, outermost end finalizes one compound. WHY: per-cell paste cascades must coalesce. End at depth 0 throws `NO_TRANSACTION`; detach/clear reset depth. Grouping cannot roll back callback side effects.
- DECIDED (#563): keyboard/public replay share `#performHistory`. WHY: identical events. `undo`/`redo` mean stack movement, NOT accepted writes; accepted ID mutations emit `cell-change(source:'history')`. `history-change`: after undo/redo, unbuffered record, non-empty outermost end/clear, every restore (even empty); not buffered edits, no-op undo/redo or detach.
- DECIDED (Nov 2026, remount continuity): capture before detach, restore after destination attachment; detach still empties history. WHY: stack arrays omit identity evidence. Opaque same-module tokens survive source cleanup; releasing tokens permits GC. Capture/restore copy action/compound/target containers, retain row/value/resolver references; never recapture, serialize or import arbitrary actions.
- INVARIANT: restore validates token + combined undo/redo capacity (compound = one), replaces both stacks atomically, clears pending focus, emits one history-change; no row/dirty/editor restore. TBW003 rejects detached/transaction/replay/notification snapshot calls and all history mutators during restore notification. Guards unwind in `finally`.

## External mode

OWNS: application retains domain commands; `ExternalHistoryBridge` retains attachment subscription, cached availability and group depth/token only. Tests: `external-history.spec.ts`.

- DECIDED (Nov 2026, externalHistory): opt-in owner callbacks, no native scalar recording/buffer or detached executor. WHY: domain commands must outlive grids without mirrored histories. `requestUndo/Redo` are void in both modes; native action/record/clear/snapshot APIs reject external mode. Application captures proposals before writes, promotes matched final notifications, suppresses replay feedback itself.
- INVARIANT: attach subscribes and emits initial availability; owner notifications update cached state/history-change, not mutation/action events. Callbacks synchronous; notifications coalesce inside callbacks; replay/group reentry rejects. Errors propagate after cleanup; partial effects remain.
- INVARIANT: outermost groups have unique tokens, including empty/rejected clears. Detach closes once (`detach`) and unsubscribes without clearing owner history; failed begin closes with `error`, ordinary end with `complete`. Outstanding ends drain before reattachment; clear's render/data cleanup survives end-callback errors.

## Keyboard ownership

INVARIANT: own-grid composed-path checks prevent duplicate nested shortcuts and recognize shadow-input targets. Both modes wait through the keydown default action before depleted-input fallback: Chromium can emit native `beforeinput(historyUndo/Redo)` AFTER the listener's microtask checkpoint. One task preserves native-first behavior; the captured attachment abort signal cancels stale fallback.
