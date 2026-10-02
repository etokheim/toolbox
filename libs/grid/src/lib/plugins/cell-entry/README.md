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

Printable-key seeding, Delete/Backspace clearing, fill handles and new history
behaviour are not provided.

## Accessibility

[SC 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html):
Enter/F2 provides the keyboard alternative to single-click entry; Escape cancels.
Existing Editing supplies editor names from column headers and edit announcements.

[SC 2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html):
with `tabToEdit`, Tab and Shift+Tab leave the grid at their respective boundaries.
Custom editor overlays can retain focus through the existing close-veto contract.

## Documentation

See [Cell Entry](https://toolboxjs.com/grid/plugins/cell-entry/) for the demo and
framework configuration.
