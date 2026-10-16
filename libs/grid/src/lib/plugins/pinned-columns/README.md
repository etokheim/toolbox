# Pinned Columns Plugin

Pin columns to left or right edges for horizontal scrolling.

## Installation

```typescript
import { PinnedColumnsPlugin } from '@toolbox-web/grid/plugins/pinned-columns';
```

## Usage

```typescript
import { PinnedColumnsPlugin } from '@toolbox-web/grid/plugins/pinned-columns';

grid.gridConfig = {
  plugins: [new PinnedColumnsPlugin()],
};

// Pin columns via column config
grid.columns = [
  { field: 'id', pinned: 'left' },
  { field: 'name' },
  { field: 'email' },
  { field: 'actions', pinned: 'right' },
];
```

## Column Options

| Option   | Type                                    | Description        |
| -------- | --------------------------------------- | ------------------ |
| `pinned` | `'left' \| 'right' \| 'start' \| 'end'` | Pin column to edge |

### Physical vs Logical Values

For RTL (Right-to-Left) language support, use logical values:

| Value     | LTR Result | RTL Result | Description                   |
| --------- | ---------- | ---------- | ----------------------------- |
| `'left'`  | Left edge  | Left edge  | Physical left edge            |
| `'right'` | Right edge | Right edge | Physical right edge           |
| `'start'` | Left edge  | Right edge | Logical start (adapts to dir) |
| `'end'`   | Right edge | Left edge  | Logical end (adapts to dir)   |

**Recommended:** Use `'start'` and `'end'` for applications that support both LTR and RTL:

```typescript
// Works correctly in both LTR and RTL layouts
grid.columns = [
  { field: 'id', pinned: 'start' }, // Left in LTR, Right in RTL
  { field: 'name' },
  { field: 'actions', pinned: 'end' }, // Right in LTR, Left in RTL
];
```

## API Methods

### Compact action cells (LTR only)

Set `expandedCellWidth` to a finite positive pixel width on a right-pinned
`utility: true` column. Its normal `width` reserves space for persistent controls;
only the active row's **actual cell** grows inward. The header, column track,
other rows, adjacent right-pinned columns and horizontal scroll extent do not grow.
No renderer nodes are moved or cloned.

```typescript
{ field: '__actions', utility: true, pinned: 'right', width: 88, expandedCellWidth: 240 }
```

Keep renderer children in one inline strip, with secondary actions before the
persistent controls. Do not use an absolute floating container or `overflow: visible`.
The cell keeps clipping at its expanded border. Expansion is limited by the visible
scroll area and pinned rails, but never shrinks below the normal cell width.
Only the innermost right-pinned column has free space to expand; a chooser column
to its right keeps its normal offset. In narrower views, use the persistent menu
to reach actions that do not fit.

Mouse hover activates a row; focus in a row takes precedence over hover. An open
menu lease takes precedence over both:

```typescript
const pinned = grid.getPluginByName('pinnedColumns');
// In the menu's onOpenChange(true), using the same unique occurrence ID as getRowId:
const release = pinned.retainCellExpansion(occurrenceId, '__actions');
// In onOpenChange(false) and component cleanup:
release();
```

The ID identifies a rendered occurrence, not a canonical entity shared by several
rows or a view index. Acquisition throws unless one eligible cell is mounted.
Release is idempotent. Stable updates to the same renderer preserve the lease;
renderer replacement, recycling, row removal, unpinning, disabling the option and
plugin detach revoke it. Old releases cannot close successor cells. External
menus may additionally use `registerExternalFocusContainer` for grid-wide focus.

Supported pins are `right` and `end` in **LTR** grids. Effective/inherited RTL
disables this opt-in behavior and emits a deduplicated diagnostic; it does not
repair the pre-existing RTL pinning geometry. After changing direction, call
`await grid.forceLayout()` to reconcile the rendered cells and retire old leases.
Left/non-pinned cells, per-row expanded widths and editor expansion are not supported.

## Accessibility

Expansion responds to keyboard focus as well as mouse hover, supporting
[SC 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html).
Render a **visible, operable persistent menu button** containing all secondary
actions: touch users must not depend on hover, and clamped cells may not show every
inline action. The plugin does not consume clicks or keyboard events, add controls,
change tab order, or provide menu semantics. Your renderer owns accessible names,
menu focus/return, `aria-expanded`, and target sizes. Keep the menu lease until
the menu closes even when focus moves into a portal.

## Pinning Methods

Access via `grid.getPluginByName('pinnedColumns')`:

```typescript
const pinned = grid.getPluginByName('pinnedColumns');

// Pin or unpin a column programmatically
pinned.setPinPosition('email', 'left');
pinned.setPinPosition('email', undefined); // unpin

// Get left pinned columns (after resolving logical positions)
const leftPinned = pinned.getLeftPinnedColumns();

// Get right pinned columns (after resolving logical positions)
const rightPinned = pinned.getRightPinnedColumns();

// Refresh sticky offsets (e.g., after column resize)
pinned.refreshStickyOffsets();

// Clear all sticky positioning
pinned.clearStickyPositions();
```

## Behavior with Other Plugins

### ReorderPlugin

Pinned columns **cannot be reordered**. When using both `PinnedColumnsPlugin` and `ReorderPlugin`, columns with any `pinned` value (`'left'`, `'right'`, `'start'`, or `'end'`) are automatically marked as non-draggable. This ensures the sticky positioning behavior remains consistent.

```typescript
grid.gridConfig = {
  plugins: [new PinnedColumnsPlugin(), new ReorderPlugin()],
  columns: [
    { field: 'id', pinned: 'left' }, // Not draggable
    { field: 'name' }, // Draggable
    { field: 'actions', pinned: 'right' }, // Not draggable
  ],
};
```
