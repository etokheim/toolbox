# `@toolbox-web/grid/plugins/sticky-rows`

Pin selected data rows below the grid header as the user scrolls past them.

## Recommended: feature shorthand

```ts
import '@toolbox-web/grid/features/sticky-rows';

grid.gridConfig = {
  features: {
    stickyRows: {
      isSticky: 'isSection', // field name OR (row, index) => boolean
      mode: 'stack', // decorative mode; use 'ancestors' for live hierarchy rows
      maxStacked: 3, // stack-mode cap (default Infinity)
    },
  },
};
```

## Direct plugin usage (advanced)

Use this only when you're composing plugins manually (e.g. building your own
plugin that needs to coordinate registration order).

```ts
import { StickyRowsPlugin } from '@toolbox-web/grid/plugins/sticky-rows';

grid.gridConfig = {
  plugins: [new StickyRowsPlugin({ isSticky: 'isSection' })],
};
```

## Modes

- **`'push'`** (default) — only one stuck row at a time. The next sticky row
  pushes the previous one up and out, iOS section-header style.
- **`'stack'`** — stuck rows accumulate below the header up to `maxStacked`.
- **`'ancestors'`** — retain live hierarchy ancestors, each bounded by its own
  subtree. Unlike the legacy modes, these are the original interactive rows.
  Short viewports release outermost ancestors first; `maxStacked` does not apply.
  Scoped-footer space belongs to its owning occurrence: subtree ends include
  descendant/own footers but exclude co-terminal parent/grid footers. Each
  segment preserves scope membership without changing data navigation. Normal
  push-off/clipping and capacity release still apply.

Use `'push'` or `'stack'` for decorative markers in flat lists. Use `'ancestors'`
with Tree or GroupingRows when hierarchy context must retain its normal controls:

```ts
import '@toolbox-web/grid/features/tree';
import '@toolbox-web/grid/features/sticky-rows';

grid.gridConfig = {
  features: {
    tree: { defaultExpanded: true },
    stickyRows: { mode: 'ancestors', isSticky: () => true },
  },
};
```

Ancestry follows the native occurrence model, including structural group rows,
not repeated entity identifiers or neighbouring visible row indices. Filtering,
collapse and removal retire excluded occurrences. Configure structural headings
as title-only through their normal row renderer and grouping options; StickyRows
does not create a second set of controls or assign application-specific roles.

For immutable row updates, configure a stable `getRowId` returning a unique ID
for each rendered occurrence, not a shared entity ID. Ancestor mode then keeps
the same live row so compatible cell views can retain their focus and menu
state. Missing or ambiguous IDs allow only reference-based reuse; removed
occurrences and a changed ID resolver retire their previous live owners.

### External vertical owner

For a content-height grid inside an `overflow:auto` element, pass that actual
element as `scrollContainer`. The application maintains the host's full natural
height, including its header, borders, footer and horizontal scrollbar; native
StickyRows owns the original header/ancestor positioning and vertical navigation.
Do not also translate those surfaces in application scroll handlers.

`topOffset` reserves fixed occlusion above the header in that external element;
omit it for internal scrolling. Owner replacement removes the old listeners and
observers. React accepts the element through either `stickyRows` or
`gridConfig.features.stickyRows`.

Replacing a configured `rowHeight` preserves the visible occurrence and its
intra-row offset once the natural extent settles. New user scrolling, public
navigation and data replacement take priority. Horizontal scroll is unchanged.
If the header/inset alone exhausts the external viewport, the plugin reports a
diagnostic instead of shrinking controls to create artificial space.

## API

```ts
interface StickyRowsConfig {
  isSticky: string | ((row, index) => unknown);
  mode?: 'push' | 'stack' | 'ancestors';
  scrollContainer?: HTMLElement;
  topOffset?: number;
  maxStacked?: number;
  className?: string;
}
```

In `'push'` and `'stack'`, stuck rows are rendered as **clones** of the real rows. The originals stay in
the row pool and remain interactive — clones are decorative and marked
`aria-hidden="true"` so screen readers traverse the underlying row in flow.

Snapshots refresh after grid rendering and the adapter's queued framework commit,
including `forceLayout()` while a row is already sticky. Tree disclosure controls
keep their rendered footprint; returning `null` removes that content from the next
settled snapshot. Clones do not own a second framework component or independent
expansion state. Custom asynchronously fetched content still needs a grid render
to refresh its snapshot.

Newly revealed live rows, including sticky-eligible section headers, retain
their Tree/GroupingRows reveal animation. Decorative snapshots omit that
transient state, so ordinary scroll promotion does not replay a reveal.

## Accessibility

In legacy modes, the decorative overlay reports its height to keyboard navigation
so other rows can be revealed below it. Clones are hidden from assistive
technology and do not receive focus; interaction remains with the original rows.

Ancestor mode keeps one live row/control owner and preserves logical row order
and row-index metadata. Its live row surfaces are limited to the visible window
plus the ancestors that fit the available viewport; released ancestors are not
mounted in a hidden holding area. A row leaving both sets follows normal renderer
teardown, even if it previously held focus or an open interaction.

This supports [WCAG 2.2 SC 2.4.11, Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html):
keyboard reveal accounts for the retained ancestor region. Natural row heights
are preserved; stickiness does not resize controls or shrink checkbox targets.
