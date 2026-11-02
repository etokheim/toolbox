# Undo/Redo Plugin

Edit history with undo and redo support.

## Installation

```typescript
import { UndoRedoPlugin } from '@toolbox-web/grid/plugins/undo-redo';
```

## Usage

```typescript
import { UndoRedoPlugin } from '@toolbox-web/grid/plugins/undo-redo';
import { EditingPlugin } from '@toolbox-web/grid/plugins/editing';

grid.gridConfig = {
  plugins: [
    new EditingPlugin(), // Required dependency
    new UndoRedoPlugin({
      maxHistorySize: 50,
    }),
  ],
};
```

> **Note:** `UndoRedoPlugin` requires `EditingPlugin` — it tracks cell edit history and will not function without it.

## Configuration

| Option            | Type                   | Default | Description                                            |
| ----------------- | ---------------------- | ------- | ------------------------------------------------------ |
| `maxHistorySize`  | `number`               | `100`   | Maximum actions in history                             |
| `externalHistory` | `ExternalHistoryOwner` | —       | Application owns history; native retention is disabled |

## Keyboard Shortcuts

| Shortcut                   | Action                  |
| -------------------------- | ----------------------- |
| `Ctrl+Z`                   | Undo last action        |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo last undone action |

## API Methods

Access via `grid.getPluginByName('undoRedo')`:

```typescript
const history = grid.getPluginByName('undoRedo');

// Undo/redo
history.undo();
history.redo();

// Check availability
const canUndo = history.canUndo();
const canRedo = history.canRedo();

// Clear history
history.clearHistory();

// Record an edit manually. rowIndex = current display index; the row's ID is captured from it
// unless you pass rowId (needed when the row may not be in view)
history.recordEdit(rowIndex, field, oldValue, newValue, rowId);

// Get stacks
const undoStack = history.getUndoStack();
const redoStack = history.getRedoStack();
```

### Application-owned history

Use `externalHistory` when the application already owns domain commands, including commands
that outlive a grid. The default remains native scalar history.

```typescript
import type { ExternalHistoryOwner } from '@toolbox-web/grid/plugins/undo-redo';

// Implemented by your application, not a grid-provided state engine.
const owner: ExternalHistoryOwner = {
  request: (direction) => appHistory.request(direction),
  getState: () => appHistory.availability,
  subscribe: (notify) => appHistory.subscribe(notify),
  beginGroup: (token) => appHistory.beginGroup(token),
  endGroup: (token, reason) => appHistory.endGroup(token, reason),
};
const history = new UndoRedoPlugin({ externalHistory: owner });
```

`requestUndo()` / `requestRedo()` return `void` in either mode. In external mode they and
all grid shortcuts delegate once to `owner.request`. Inputs retain native browser Undo
priority; the depleted-history fallback is canceled when its attachment ends. Requests
are attached-only. Invoke your application owner directly while no grid is mounted.

The application records **accepted domain changes**, not native action arrays.
Prepare a prospective command during `cell-commit`, keyed in a `WeakMap` by `operationId`;
promote it on the matching final `cell-change`, using its normalized `newValue`. Keep
original domain identity and dependent before-values in that proposal. Neither the token
nor the notification supplies replay authority. Do not record the proposal before acceptance,
reconstruct its inverse after the write, or record `sync`/`history` acknowledgments again.
The owner must suppress its own recorder during replay, including replay initiated directly
while grids are detached. Native does not hide accepted mutation notifications.

`beginTransaction()` / `endTransaction()` retain nesting, but notify the owner only on
outermost boundaries and retain no scalar buffer. Each group gets a distinct frozen token,
including across grids sharing an owner. Accepted clear notifications occur **inside** the
group; empty and all-rejected clears still get balanced boundaries. Independent application
commands and cross-grid batching remain application-owned.

The owner supplies `canUndo()` / `canRedo()` through `getState` and publishes changes through
the `subscribe` callback. The bridge emits initial availability on attach and `history-change`
for subsequent notifications, coalescing synchronous notifications inside an owner callback.
It does not synthesize `undo`/`redo` action events or a mutation acknowledgment for a request.
Availability reads during notifications use the cached state.

All owner callbacks are synchronous; Promise-returning callbacks are unsupported.
Reentry guards are per attached plugin; the owner guards direct and cross-grid calls.
Requests/group mutations during a callback or availability notification, and replay inside
an open group, raise `TBW003`. Callback exceptions propagate after guards reset; cleanup
failures may be combined in an `AggregateError`. Already accepted writes are **not rolled
back**, callbacks are not retried, and the owner must clean up its own partial effects.

Detach unsubscribes and closes an open group once with reason `detach`, never clearing the
application history. A failed begin is closed with reason `error`; ordinary ends use
`complete`. These reasons describe cleanup, not transaction rollback. Matching outstanding
`endTransaction()` calls can unwind after detach without notifying the owner again; finish
them before reusing that plugin instance. Detached plugin availability reads are false.

`undo()`, `redo()`, `recordEdit()`, `clearHistory()`, action-stack getters and snapshot APIs
raise `TBW003` in external mode rather than returning fabricated or empty native history.
Use the request methods and application-owned clearing/retention instead. `maxHistorySize`
only governs native mode. Choose the owner at attachment, not by mutating live configuration.

### Preserving history across remounts

The snapshot APIs below are for native history only.

```typescript
import type { UndoRedoSnapshot } from '@toolbox-web/grid/plugins/undo-redo';

// Capture before removing/reconfiguring the source grid.
const snapshot: UndoRedoSnapshot = history.captureHistory();

// Install the intended rows/config, including the SAME getRowId function,
// then wait for the destination grid to attach its plugins.
await replacementGrid.ready();
replacementGrid.getPluginByName('undoRedo').restoreHistory(snapshot);
```

`captureHistory()` preserves both stacks and their original private row-identity
evidence. `getUndoStack()` / `getRedoStack()` only copy arrays; they are inspection
APIs, not an export/import format. Never assign them into a plugin's private state.

Snapshots are opaque, reusable tokens valid only in the same loaded UndoRedo
module. JSON, structured clones, other package instances, workers and durable
storage are unsupported. Each capture/restore copies action containers, including
compound children, but retains original row, resolver and cell-value references.
Snapshots survive source detach or `clearHistory()`; release your reference when
no longer needed. They do not directly store a source grid/plugin reference,
but retained row, resolver or value references can indirectly retain them.

Restore replaces history, not rows, dirty baselines, editors or open transactions.
Use it only for the same logical dataset. It never recaptures identity: the
[row identity](#row-identity) safeguards below still apply, including original-object
safety for ID-less rows. Detach still clears live history; reconnect alone does
not restore it.

Both methods reject detached plugins, open transactions, replay and synchronous
`history-change` listener reentry with `TBW003`. Restore also rejects invalid
tokens and snapshots exceeding the receiving `maxHistorySize`, counting **undo
and redo entries together** (a compound counts as one). It validates before
replacing anything and never trims silently. During its notification, history
mutators are rejected too; defer follow-up work until the call returns.

A successful restore emits exactly one `history-change`, even for empty history,
and discards pending history focus. It does not emit `undo`, `redo` or `cell-change`,
write rows, or request focus. Action/history events describe stack movement,
including skipped edits; for ID-based replay, accepted mutations are reported by
`cell-change` with `source: 'history'`. Do not replay actions from history events
to persist skipped changes.

### Compound Actions (Transactions)

When a single user edit triggers cascaded changes to other fields, group them
into one undo step using `beginTransaction()` / `endTransaction()`:

```typescript
grid.addEventListener('cell-commit', (e) => {
  const { row, rowId, rowIndex } = e.detail;
  const undoRedo = grid.getPluginByName('undoRedo');
  undoRedo.beginTransaction();

  // Manually record cascaded side-effects (rowId keeps off-screen rows targeted correctly)
  const oldTotal = row.total;
  undoRedo.recordEdit(rowIndex, 'total', oldTotal, newTotal, rowId);
  grid.updateRow(rowId, { total: newTotal });

  // End after the auto-recorded original edit is captured
  queueMicrotask(() => undoRedo.endTransaction());
});
```

Undoing a compound action reverts available grouped edits in reverse order;
redoing replays them in forward order.

### Row identity

History captures the edited row's existing ID (`getRowId`, or conventional `id`/`_id`)
and field name when the edit is recorded. Sorting, filtering and column reordering
do not redirect the edit to the row or column now occupying its old position.
A unique ID follows immutable row replacements, including source rows filtered
out of the current view. A row without an ID can only be replayed while its
original object remains in the source or processed rows.

Unavailable or ambiguous targets produce a `TBW041` warning and are skipped.
Other edits in a compound action still apply, and the action moves between the
undo and redo stacks normally. Replacing the `getRowId` function also makes
previously recorded targets unavailable; old IDs are never reinterpreted with
the new resolver. Transactions group history, not atomic data changes.
Queued row replacements temporarily make targets unavailable until
the view is processed; replay never writes through the superseded view.

`recordEdit(rowIndex, ...)` takes the **current processed-view index** at recording
time. The returned action's `rowIndex` remains that original coordinate for
compatibility; replay and focus resolve the recorded owner, not that coordinate.
History only restores values, not removed rows.

## Events

`undo()` / `redo()` behave exactly like the keyboard shortcuts: both paths emit the same events.

### `undo`

Fired when an undo operation is performed (Ctrl+Z or `undo()`).

```typescript
grid.addEventListener('undo', (e) => {
  console.log('Action undone:', e.detail.action);
});
```

### `redo`

Fired when a redo operation is performed (Ctrl+Y or `redo()`).

```typescript
grid.addEventListener('redo', (e) => {
  console.log('Action redone:', e.detail.action);
});
```

### `history-change`

Fired whenever the history changes: an edit is recorded outside a transaction, a non-empty
transaction ends, an undo or redo runs, `restoreHistory()` succeeds, or `clearHistory()` empties a non-empty history. Use it
to enable/disable toolbar buttons.

```typescript
grid.addEventListener('history-change', (e) => {
  undoButton.disabled = !e.detail.canUndo;
  redoButton.disabled = !e.detail.canRedo;
});
```
