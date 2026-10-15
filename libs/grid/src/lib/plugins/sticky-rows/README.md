# `@toolbox-web/grid/plugins/sticky-rows`

Pin selected data rows below the grid header as the user scrolls past them.

## Recommended: feature shorthand

```ts
import '@toolbox-web/grid/features/sticky-rows';

grid.gridConfig = {
  features: {
    stickyRows: {
      isSticky: 'isSection', // field name OR (row, index) => boolean
      mode: 'stack', // 'push' (default) or 'stack'
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

## API

```ts
interface StickyRowsConfig {
  isSticky: string | ((row, index) => unknown);
  mode?: 'push' | 'stack';
  maxStacked?: number;
  className?: string;
}
```

Stuck rows are rendered as **clones** of the real rows. The originals stay in
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

Conforms to WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum): the clone overlay sits over the top
of the rows viewport, so the plugin reports its height to the grid and keyboard scrolling offsets
by that much — a focused row is never left hidden underneath the stuck clones. When the focused
row _is_ a stuck clone it is already in view, so scrolling is skipped entirely. Automatic; no
configuration.
