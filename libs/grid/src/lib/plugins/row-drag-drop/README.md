# RowDragDropPlugin

Drag rows within a grid (reorder) **and** between grids that share a
`dropZone`. Replaces the pre-v3 `RowReorderPlugin`.

## Quick start

```ts
import { RowDragDropPlugin } from '@toolbox-web/grid/plugins/row-drag-drop';
// or, declarative feature key:
import '@toolbox-web/grid/features/row-drag-drop';

grid.gridConfig = {
  features: {
    rowDragDrop: {
      dropZone: 'employees',
      operation: 'move',
    },
  },
};
```

## Highlights

- **Drop zones** — only grids with a matching `dropZone` accept drops from
  one another. Without `dropZone` the plugin behaves as the legacy
  intra-grid reorder.
- **Move / copy** — `operation: 'move'` removes rows from the source on a
  successful cross-grid drop, `'copy'` keeps them.
- **Multi-row** — when the SelectionPlugin is loaded and the dragged row is
  part of a multi-row selection, all selected rows are dragged together.
  This is automatic — there is no `selection` config option.
- **Cross-window** — uses HTML5 `dataTransfer` so dragging into a different
  browser window works via JSON serialisation.
- **`canDrop` / `canDrag`** — synchronous hooks to veto drops or drags.
  `canDrop` is invoked during `dragover` (so it must be sync) and again at
  drop time; `canDrag` validates pickup and keyboard moves. Custom handle
  renderers also evaluate it during visual refresh (see below).
- **TSV / plain-text** — every drag also exposes a tab-separated text payload
  on the clipboard MIME so rows can be pasted into spreadsheets.

## Accessibility

Custom `dragHandleRenderer` controls receive `RowDragHandleContext<T>`. Return an
HTMLElement, persistent `ControlView`, or intentional `null`; omission retains
the default grip. Register one HTML root via `context.bindHandle(element)` (or a
React ref). A nested SVG is supported. The plugin owns draggable, click-menu and
Ctrl-arrow behaviour; do not duplicate native handlers or query private CSS.
Native buttons keep Enter/Space activation; other HTML roots receive missing button
semantics. Canceled events and disabled controls are respected.

`disabled` is pickup eligibility, not destination permission. For custom controls
only, `canDrag` also runs during visual refresh and must be pure. Live move/drop
validation, selection payloads and consumer sorted-policy hooks remain authoritative.
Intra-grid drops retain the first-payload-row move; this is not block reordering.
`setDragHandleRenderer` replaces visuals without rebuilding columns or plugin state.
The original default order/width/placement and saved state are unchanged.

React feature props and `gridConfig.features` accept JSX under the canonical
`RowDragDropConfig<T>` type from `@toolbox-web/grid-react`. Manual core plugins,
Vue and Angular use the DOM contract; Vue/Angular template bridges are deferred.

Supports [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html):
tapping the drag handle (press and release
without moving — no `dragstart` fires) opens a `role="group"` menu with **Move up**, **Move
down**, **Move to top**, **Move to bottom**, plus one **Send to _grid_** entry per peer sharing
the `dropZone` (**Copy to _grid_** under `operation: 'copy'`). The click path fires the same
`row-drag-start` / `row-drop` / `row-transfer` events and honours the same `canDrop` vetoes as a
real drag. The handle is `role="button"` named _"Drag to reorder, or activate for move options"_.

## Migration from `RowReorderPlugin`

```diff
- import { RowReorderPlugin } from '@toolbox-web/grid/plugins/reorder-rows';
+ import { RowDragDropPlugin } from '@toolbox-web/grid/plugins/row-drag-drop';

- new RowReorderPlugin(cfg);
+ new RowDragDropPlugin(cfg);
```

`RowReorderConfig.canMove` has no direct replacement: use `canDrag(row, index)`
for the dragstart-side veto and `canDrop(payload, targetIndex)` for the
drop-side veto.

See the [docs page](https://toolboxjs.com/grid/plugins/row-drag-drop/) for a
live two-grid demo and the full configuration reference.
