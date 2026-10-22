# Pinned Rows Plugin

Status bar with row counts and aggregation rows for computed values.

## Installation

```typescript
import { PinnedRowsPlugin } from '@toolbox-web/grid/plugins/pinned-rows';
```

## Usage

```typescript
import { PinnedRowsPlugin, rowCountPanel } from '@toolbox-web/grid/plugins/pinned-rows';

grid.gridConfig = {
  plugins: [
    new PinnedRowsPlugin({
      slots: [
        {
          id: 'totals',
          position: 'bottom',
          aggregators: {
            quantity: 'sum',
            // Object syntax with formatter for currency
            price: {
              aggFunc: 'sum',
              formatter: (value) => `$${value.toFixed(2)}`,
            },
          },
          cells: { id: 'Totals:' },
        },
        { id: 'count', position: 'bottom', render: rowCountPanel() },
      ],
    }),
  ],
};
```

## Scoped Non-Data Footers

`scopedFooters(scope)` optionally returns `{ height, render }` or `null`.
`FooterScope<T>` distinguishes `grid`, expanded real `row`, and expanded
structural `group` scopes. Groups expose `parent` and normalized `path`;
`key` alone identifies the rendered occurrence, not the domain ID or parent
reference. The whole-grid callback runs even for empty data. Fixed groups,
including `emptyGroups` declarations, count as expanded.

`FooterContext.depth` is the zero-based presentation depth of the owning row or
group occurrence, matching its Tree/group renderer; grid scope uses zero.
`collapsible` is a boolean for group owners (false for fixed headings), otherwise
undefined. These values update on topology changes even when the scope key and
renderer stay unchanged. Use `scope.kind` to distinguish owners. Name-column,
disclosure/icon and button-text offsets remain application presentation rules;
neither `path.length` nor an inserted child's depth describes the owner's name.

Each footer reserves space at its scope's natural end. Only the innermost
eligible intersecting scope sticks; other footers stay in flow. Native uses the
existing row offset/window machinery because flattened virtual siblings have
no subtree CSS-sticky containing block. Height is explicit, including borders
(for example 40px/24px); global panels retain their space.
If header/panels/footer cannot leave a usable data/editor surface after releasing
sticky ancestors, the footer remains reachable in normal flow with the standard
insufficient-space diagnostic and zero sticky bottom occlusion. Capacity
restoration re-enables sticking without shrinking targets or forcing height.
Sticky ancestors remain scoped through their own and descendant footer extents,
but not through co-terminal parent or whole-grid footers. Adjacent footer segments
retain their own scope membership; ordinary data navigation still skips them.

Render an `HTMLElement` or persistent `ControlView<FooterContext<T>>`.
`setScopedFooters` replaces live eligibility/height without resetting siblings.
React's feature prop and canonical `gridConfig.features` also accept JSX through
the shared portal manager. Remove only your own redundant global action slot
when enabling a whole-grid action; native does not infer command semantics.
Omitting the callback leaves existing behaviour unchanged.

See the [scoped-footer guide](https://toolboxjs.com/grid/plugins/pinned-rows/#scoped-non-data-footers)
for typed examples, occurrence identity and empty-section admission.

## Accessibility

[SC 2.1.1: Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html):
footer controls retain normal browser focus and keyboard handling. They are not
data rows, selectable entities, editing/paste targets, or export/persistence
records. The application owns accessible labels, permissions and commands.

## Configuration

| Option      | Type              | Default | Description                                                    |
| ----------- | ----------------- | ------- | -------------------------------------------------------------- |
| `slots`     | `PinnedRowSlot[]` | `[]`    | Ordered list of pinned-row slots (see [Slots API](#slots-api)) |
| `fullWidth` | `boolean`         | `false` | Default fullWidth mode applied to every aggregation slot       |

> **Removed in v3** — the legacy `position`, `showRowCount`, `showSelectedCount`,
> `showFilteredCount`, `aggregationRows`, and `customPanels` fields, plus the
> imperative `addPanel`/`removePanel`/`addAggregationRow`/`removeAggregationRow`
> methods, have been removed. Use `slots` instead. The default config seeds a
> single bottom info-bar slot (row count, filtered count, selected count), so
> `new PinnedRowsPlugin()` still renders the familiar info bar.

## Slots API

The unified `slots[]` array replaces both `aggregationRows[]` and
`customPanels[]`. Each entry is either:

- An **aggregation slot** — same shape as `AggregationRowConfig` (no `render`).
- A **panel slot** — has a `render` field. `render` is either
  `(ctx) => HTMLElement | null` (left zone) or an array of
  `{ zone?: 'left' | 'center' | 'right', render }` entries.

A `null` return from a panel render skips that contribution; a slot whose
renderers all return `null` is dropped from the DOM. Built-in renderers
`rowCountPanel()`, `selectedCountPanel()`, and `filteredCountPanel()` use
this to self-hide when there is nothing to show.

```typescript
import {
  PinnedRowsPlugin,
  filteredCountPanel,
  rowCountPanel,
  selectedCountPanel,
} from '@toolbox-web/grid/plugins/pinned-rows';

new PinnedRowsPlugin({
  slots: [
    { position: 'top', aggregators: { price: 'sum' }, cells: { id: 'Totals:' } },
    { position: 'bottom', render: rowCountPanel() },
    { position: 'bottom', render: filteredCountPanel() },
    { position: 'bottom', render: selectedCountPanel() },
  ],
});
```

## Aggregation Rows

Configure computed footer/header rows:

```typescript
{
  id: 'totals',
  position: 'bottom',  // 'top' or 'bottom'
  fullWidth: false,    // Render as single spanning cell
  label: 'Totals',     // Label (overlay in per-column mode, inline in fullWidth mode)
  aggregators: {
    // Simple string aggregator
    quantity: 'sum',
    // Custom function
    name: (rows, field) => new Set(rows.map(r => r[field])).size,
    // Object syntax with formatter
    price: {
      aggFunc: 'sum',
      formatter: (value) => `$${value.toFixed(2)}`,
    },
  },
  cells: { id: 'Totals:' },  // Static cell values
}
```

### Full-Width Mode

When `fullWidth` is `true`, an aggregation row renders as a single spanning cell with the label and aggregated values displayed inline (similar to the row grouping plugin's full-width mode). When `false` (the default), each column gets its own cell aligned to the grid template.

You can set `fullWidth` globally on `PinnedRowsConfig` or per-slot on the aggregation slot. Per-slot settings override the global default.

```typescript
// Global fullWidth: all aggregation slots span full width
new PinnedRowsPlugin({
  fullWidth: true,
  slots: [
    {
      id: 'totals',
      label: 'Totals',
      aggregators: { quantity: 'sum', price: 'sum' },
    },
    {
      id: 'per-column',
      fullWidth: false, // Override: this row renders per-column
      aggregators: { quantity: 'avg', price: 'avg' },
      cells: { product: 'Averages:' },
    },
  ],
});
```

````

### Aggregator Syntax

| Syntax   | Example                                              | Description                |
| -------- | ---------------------------------------------------- | -------------------------- |
| String   | `'sum'`                                              | Built-in aggregator        |
| Function | `(rows, field, column) => value`                     | Custom aggregator function |
| Object   | `{ aggFunc: 'sum', formatter: (v) => v.toFixed(2) }` | Aggregator with formatter  |

### Built-in Aggregators

`sum`, `avg`, `count`, `min`, `max`, `first`, `last`

### Formatter

The `formatter` function formats the computed value for display:

```typescript
formatter: (value, field, column) => string;
````

- `value` - The computed aggregation value
- `field` - The column field name
- `column` - The full column configuration

## API Methods

Access via `grid.getPluginByName('pinnedRows')`:

```typescript
const pinned = grid.getPluginByName('pinnedRows');

// Refresh status bar and aggregations
pinned.refresh();

// Get current context
const context = pinned.getContext();

// Add a custom panel dynamically
pinned.addPanel({ id: 'my-panel', render: () => 'Custom content' });

// Remove a custom panel
pinned.removePanel('my-panel');

// Add an aggregation row dynamically
pinned.addAggregationRow({ id: 'avg', aggregators: { price: 'avg' } });

// Remove an aggregation row
pinned.removeAggregationRow('avg');
```

## CSS Variables

| Variable                   | Description                |
| -------------------------- | -------------------------- |
| `--tbw-pinned-rows-bg`     | Info bar background        |
| `--tbw-pinned-rows-border` | Info bar border            |
| `--tbw-pinned-rows-color`  | Info bar text color        |
| `--tbw-aggregation-bg`     | Aggregation row background |
| `--tbw-aggregation-border` | Aggregation row border     |
