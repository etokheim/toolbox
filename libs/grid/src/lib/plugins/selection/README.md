# Selection Plugin

Cell, row, and range selection for `<tbw-grid>`.

## Installation

```typescript
import { SelectionPlugin } from '@toolbox-web/grid/plugins/selection';
```

## Usage

```typescript
import { SelectionPlugin } from '@toolbox-web/grid/plugins/selection';

grid.gridConfig = {
  plugins: [
    new SelectionPlugin({
      mode: 'row', // 'cell' | 'row' | 'range'
    }),
  ],
};
```

## Configuration

| Option         | Type                                          | Default   | Description                                    |
| -------------- | --------------------------------------------- | --------- | ---------------------------------------------- |
| `mode`         | `'cell' \| 'row' \| 'range'`                  | `'cell'`  | Selection mode                                 |
| `multiSelect`  | `boolean`                                     | `true`    | Allow multiple items selected at once          |
| `triggerOn`    | `'click' \| 'dblclick'`                       | `'click'` | Mouse event type that triggers selection       |
| `enabled`      | `boolean`                                     | `true`    | Whether selection is enabled                   |
| `checkbox`     | `boolean`                                     | `false`   | Show checkbox column (row mode only)           |
| `isSelectable` | `(row, rowIndex, col?, colIndex?) => boolean` | -         | Callback to control per-row/cell selectability |

## Selection Modes

### Custom checkbox controls

In row checkbox mode, `rowCheckboxRenderer` and `headerCheckboxRenderer` accept
typed contexts and return an `HTMLElement`, `ControlView<Context>` or `null` (empty).
Omitting either hook keeps the native control. Persistent views initialise from
the first context, then receive `update(context)` without remounting; `dispose()`
runs on replacement/recycling/teardown. Plain elements use replacement semantics.
Use `context.setChecked(value, { shiftKey, ctrlKey, metaKey })`, not a separate
selection model. The row's processed index is not its optional stable `rowId`.

React feature props and `gridConfig.features.selection` additionally accept JSX
through the React adapter's shared portals. Manually instantiated plugins remain
DOM-only. See the [custom controls example and lifecycle guide](https://toolboxjs.com/grid/plugins/selection/#custom-checkbox-controls).

### Checkbox inside an existing column

Use `selection.bindRowCheckbox(rendererContext, dedicatedHost, onContext)` inside a
body-cell renderer with `mode: 'row'`; `checkbox: false` is supported. The returned
binding has `update(nextRendererContext)` and `dispose()`. Update returns false
after retirement; a reused host needs a new binding. Selection owns state,
eligibility, stable row identity, modifiers and mutations; the consumer owns DOM
and presentation. Keep Name links and other controls outside the dedicated host.

Pending hosts are inert. Notifications are microtask-batched after commit; retirement
publishes one `null`. Initialise controls disabled, apply each context's localised
label/checked/disabled state, and disable/remove them on null. Update/disposal revoke
old actions synchronously, including same-ID refresh. Throwing listeners report
`TBW065` and retire without another call. Cell teardown cleans up automatically.
Active actions republish canonical state even when unchanged (for example, Shift
on an already selected row). Apply checked/disabled on every notification; do not
deduplicate only by selection value. Disposal during `selection-change` revokes
actions immediately without reinterpreting that same click as a Name-cell click.
Later clicks on the released host are ordinary cell interactions.

React exposes `<SelectionCheckbox context={rendererContext}>` with a typed
render-prop child from `@toolbox-web/grid-react/features/selection`. It stays inside
the existing cell portal, preserving Name-local providers. Vue/Angular may use the
core DOM API (Vue: `viewRenderer`); template facades are not included. Row mode remains mandatory.
Use one native click handler, forward Shift/Ctrl/Meta, and retain accessible
focus/touch access when replacing icons on hover.

See the [embedded example and lifecycle contract](https://toolboxjs.com/grid/plugins/selection/#checkbox-inside-an-existing-column).

### Cell Mode (`'cell'`)

Single cell selection. Clicking a cell focuses and selects it.

### Row Mode (`'row'`)

Row selection. Clicking any cell selects the entire row.

- **Click**: Select single row
- **Ctrl+Click**: Toggle row in selection
- **Shift+Click**: Select range from last selected row
- **Shift+Arrow Up/Down**: Extend selection from anchor row
- **Shift+Page Up/Down**: Extend selection by page
- **Shift+Ctrl+Home/End**: Extend selection to first/last row

### Range Mode (`'range'`)

Rectangular range selection like Excel.

- **Click+Drag**: Select rectangular cell range
- **Shift+Click**: Extend selection to clicked cell
- **Ctrl+Click**: Start new range while keeping existing

## Accessibility

Custom checkbox controls must apply the context's localised label, checked/mixed
state and disabled state, provide keyboard activation and visible focus, and meet
[SC 2.5.8 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Use one activation handler; grid shortcuts do not run inside custom controls.

Range selection is a drag, so WCAG 2.2 [SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) requires a single-pointer alternative. Two are provided: click the first cell and pick **Extend selection to here** from the context menu on the opposite corner (right-click, long-press, or `Shift+F10`), or **tap** a range corner handle to arm it and tap the cell that corner should move to. Neither reserves extra chrome — both reuse affordances that already exist. When the `ContextMenuPlugin` is installed the action joins the normal menu; otherwise the plugin hosts a minimal `role="group"` menu of its own. Keyboard users can also extend a range with `Shift+Arrow`, but keyboard equivalence alone does not satisfy SC 2.5.7.

## Events

### `selection-change`

Fired when selection changes.

```typescript
grid.addEventListener('selection-change', (e) => {
  console.log('Selected ranges:', e.detail.ranges);
  console.log('Mode:', e.detail.mode);
});
```

## API Methods

Access via `grid.getPluginByName('selection')`:

```typescript
const selection = grid.getPluginByName('selection');

// Get current selection (all modes - returns { mode, ranges, anchor })
const result = selection.getSelection();

// Get selected row indices (row mode, sorted ascending)
const indices = selection.getSelectedRowIndices();

// Get actual row objects (preferred — works in all modes)
const rows = selection.getSelectedRows<Employee>();

// Select specific rows by index (row mode only)
selection.selectRows([0, 2, 4]);

// Select all (rows in row mode, all cells in range mode)
selection.selectAll();

// Clear selection
selection.clearSelection();

// Set ranges programmatically
selection.setRanges([{ from: { row: 0, col: 0 }, to: { row: 5, col: 3 } }]);

// Check if a specific cell is in range selection
const isSelected = selection.isCellSelected(row, col);

// Get all selected cells across all ranges
const cells = selection.getSelectedCells();
```

## CSS Variables

| Variable                   | Description                     |
| -------------------------- | ------------------------------- |
| `--tbw-focus-background`   | Row focus background (row mode) |
| `--tbw-range-selection-bg` | Range selection background      |
| `--tbw-range-border-color` | Range selection border color    |
