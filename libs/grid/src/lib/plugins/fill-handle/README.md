# Fill Handle Plugin

Vertical automatic fill from one selected range. Editing owns writes and validation,
Selection owns the range, and UndoRedo (native or `externalHistory`) owns history:
every accepted write of one fill is a single undo step.

## Usage

```typescript
import '@toolbox-web/grid/features/editing';
import '@toolbox-web/grid/features/selection';
import '@toolbox-web/grid/features/undo-redo';
import '@toolbox-web/grid/features/fill-handle';

grid.gridConfig = {
  columns: [
    { field: 'qty', type: 'number', editable: true },
    { field: 'due', type: 'date', editable: true },
  ],
  features: { selection: 'range', editing: 'manual', undoRedo: true, fillHandle: true },
};
grid.addEventListener('fill-complete', ({ detail }) => console.log(detail.cells));
```

Or construct `FillHandlePlugin` from `@toolbox-web/grid/plugins/fill-handle` after
`SelectionPlugin({ mode: 'range' })`, `EditingPlugin` and `UndoRedoPlugin`.

## Input

- **Pointer:** drag the square at the range's bottom-right corner up or down.
- **Tap:** tap the handle (it shows as pressed), then tap a target cell.
- **Keyboard:** with a cell focused, `Alt+ArrowDown` / `Alt+ArrowUp` starts a fill
  preview and focuses the handle; arrows move the target, Enter applies, Escape
  cancels. On the focused handle, Enter/Space starts the same preview.
- **API:** `grid.getPluginByName('fillHandle').fill({ source, targetRow })`.

The handle stays usable while a cell is being edited: starting a fill commits the
pending edit first and fills from the committed value. The handle follows the
selection state, so use Selection's `clearOnOutsideClick` to remove it on outside
clicks rather than hiding selection with `:focus-within` CSS.

## Series inference (`mode: 'auto'`, per column)

| Seeds                                    | Result                                             |
| ---------------------------------------- | -------------------------------------------------- |
| One number                               | Repeats                                            |
| Numbers with a constant step             | Continues the step (keeps decimal precision)       |
| One `YYYY-MM-DD`, `Date` or ISO stamp    | +1 calendar day (−1 day upward)                    |
| Dates a whole number of months apart     | Calendar months/years, clamped from the first seed |
| All month-ends                           | Month-ends (`Jan 31 → Feb 29 → Mar 31`)            |
| Dates with a constant day/time step      | Continues the step                                 |
| Anything else (text, mixed, locale text) | Repeats the seed cycle                             |

`Date` objects use UTC fields; ISO timestamps keep their written offset. Locale
date strings are never parsed. `mode: 'copy'` always repeats.

## Rules and outcomes

Only existing displayed data rows are filled (group, loading and other structural
rows are skipped; rows are never appended). Each cell reports `filled`, `skipped`
(`readonly`, `unavailable`, `out-of-range`, `unchanged`) or `rejected` (`conflict`,
`rule`, `validation`). A target whose value changed after it entered the preview is
a conflict. `fillValue(ctx)` may return `{ value }` or `{ reject: message }`.
More than 10,000 target cells rejects the whole fill. `fill-start` is cancelable.
