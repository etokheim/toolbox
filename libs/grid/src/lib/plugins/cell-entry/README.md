# Cell Entry Plugin

Opt-in single-cell entry for client-side grids. Editing owns commits, cancellation,
validation and editor teardown; Selection owns the selected cell or range.

## Usage

The declarative feature API is recommended. Import all three features:

```typescript
import '@toolbox-web/grid/features/editing';
import '@toolbox-web/grid/features/selection';
import '@toolbox-web/grid/features/cell-entry';

grid.gridConfig = {
  columns: [{ field: 'name', editable: true }],
  features: {
    editing: { mode: 'row', editOn: 'manual', tabToEdit: true },
    selection: 'range',
    cellEntry: { singleClick: true },
  },
};
```

For manual plugin construction, use `CellEntryPlugin` from
`@toolbox-web/grid/plugins/cell-entry` alongside explicitly configured
`EditingPlugin` and `SelectionPlugin`. Do not enable the feature and construct the
same plugin separately.

| Configuration path                 | Use when                           |
| ---------------------------------- | ---------------------------------- |
| `features.cellEntry` (recommended) | Declaring grid configuration       |
| `new CellEntryPlugin(config)`      | Managing plugin instances directly |

## Behaviour

Enter/F2 opens one eligible cell. `singleClick` defaults to `false`; when enabled,
an ordinary click selects first and opens that cell. Modifier clicks, drags and
long-press gestures remain selection-only. Native links, controls and custom
interactive descendants retain their own activation.

Editing's `tabToEdit` defaults to `false`. Enable it to commit and continue with
Tab/Shift+Tab in displayed-row/visible-column order, skipping read-only cells and
rows. At either outer boundary, commit and leave the grid through native Tab
navigation; there is no wrap or trap. It also works with F2/programmatic single-cell
entry without CellEntry. Row-wide and grid-wide editing are unchanged.

`rowEditable`, column `editable`, and `editOn: false` remain authoritative. Utility
cells and loading placeholders cannot be entered. A canceled `cell-activate`
prevents entry. Existing commit vetoes still reject/revert values and close the
editor; they do not acquire stay-open semantics. `onBeforeEditClose` retains its
close veto. Custom editors must continue using the existing commit and
`before-edit-close` contracts.

CellEntry requires row-mode Editing with `editOn: 'manual'` (or `false` to disable
entry) and click-triggered cell/range Selection. Conflicting configuration and
missing dependencies produce grid diagnostics, not competing activation handlers.
Selection checkbox columns require row selection and therefore cannot share a
grid with CellEntry. Use row checkboxes with Editing without CellEntry; independent
batch-checkbox and cell/range selection are not provided. Custom Tree/MasterDetail
disclosures retain control activation and navigation without opening cell editors.

## Selected-cell clearing

Delete/Backspace clearing is separately opt-in: import `features/undo-redo`, enable
`features.undoRedo: true`, and set `features.cellEntry: { clearOnDelete: true }`.
Manual plugin users add `UndoRedoPlugin` before `CellEntryPlugin`. Existing entry
defaults are unchanged.

A plain Delete or Backspace clears the selected cell/range, not rows. Overlapping
ranges are deduplicated and the **10,000 unique selected-cell limit** is checked
before rules, validation or writes. An oversized action is rejected entirely.
Read-only/ineligible cells count toward the limit but are skipped.

Value policy, in precedence order:

1. `column.clearValue(context)` returns `{ value }` or `{ reject: 'reason' }`.
2. Explicit `nullable: true` clears to `null`.
3. Non-nullable string/text cells clear to `''`.
4. Other types are skipped without an explicit rule; no zero/today inference.

Accepted values run through Editing's synchronous `cell-commit` path with
`source: 'clear'`; `preventDefault()` **or `setInvalid()`** rejects that cell.
Use that normal programmatic-commit contract for validation; no native/custom
editor is mounted to run editor-only validation. Accepted edits (and normal
cascades) form one nested-safe Undo step. This is partial acceptance, **not an
atomic transaction** or rollback of arbitrary callback side effects.

`cell-clear` reports `{ cells, limitExceeded }`. Each cell has its original
`rowIndex`, field, row, `status` (`cleared`, `skipped`, `rejected`) and optional
reason/message. Reasons include readonly, unavailable, unsupported-type,
unchanged, rule and validation. Oversize rejection has an empty `cells` array.
`CellClearContext`, `CellClearValue`, `CellClearResult` and `CellClearDetail` are
exported from the plugin entry point.

Owners and fields are captured before writes, then checked around callbacks.
Unique IDs follow settled immutable replacements; ID-less rows require the
original live object. Missing/ambiguous targets warn and skip. A source/config
replacement queued during a callback makes remaining targets temporarily
unavailable; neither detached objects nor replacement cells at old indices are
written. Columns/owners changed while evaluating a rule or validating a cell are
skipped/rejected rather than silently retargeted.

Active editors, native controls, contenteditable, IME, prevented events, repeated
keys and modifier chords retain their existing behavior. Printable-key seeding
and fill handles are not provided.

## Accessibility

[SC 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html):
Enter/F2 provides the keyboard alternative to single-click entry; Escape cancels.
Existing Editing supplies editor names from column headers and edit announcements.
Opt-in clearing announces its accepted/not-cleared counts or whole-action limit
rejection. Localize `a11y.messages.cellsCleared` and `cellClearLimitExceeded`;
`a11y.announcements: false` disables announcements.

[SC 2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html):
with `tabToEdit`, Tab and Shift+Tab leave the grid at their respective boundaries.
Custom editor overlays can retain focus through the existing close-veto contract.

## Documentation

See [Cell Entry](https://toolboxjs.com/grid/plugins/cell-entry/) for the demo and
framework configuration.
