# Row Grouping Plugin

Group rows by field values with aggregations and expand/collapse.

## Installation

```typescript
import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';
```

## Usage

```typescript
import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';

grid.gridConfig = {
  plugins: [
    new GroupingRowsPlugin({
      groupOn: (row) => row.category,
      aggregators: {
        total: 'sum',
        count: 'count',
      },
    }),
  ],
};
```

## Configuration

Reveal animation includes newly visible group headers and fixed child sections.
Stable occurrence IDs and scoped group keys prevent replay on rows shifted by
collapse, sorting or recycling. Supply `getRowId` when replacing row objects
without changing their logical occurrences.

| Option             | Type                                                        | Default   | Description                                          |
| ------------------ | ----------------------------------------------------------- | --------- | ---------------------------------------------------- |
| `groupOn`          | `(row, { parent, depth }) => any[] \| any \| null \| false` | -         | Function returning group key(s)                      |
| `groups`           | `GroupDefinition[]`                                         | -         | Pre-defined group structure                          |
| `aggregators`      | `Record<string, AggregatorRef>`                             | `{}`      | Aggregation functions per field                      |
| `fullWidth`        | `boolean`                                                   | `true`    | Group rows span full width                           |
| `defaultExpanded`  | `boolean \| number \| string \| string[]`                   | `false`   | Start groups expanded                                |
| `showRowCount`     | `boolean`                                                   | `true`    | Show row count in group headers                      |
| `indentWidth`      | `number`                                                    | `20`      | Indent width per depth level in pixels               |
| `animation`        | `false \| 'slide' \| 'fade'`                                | `'slide'` | Expand/collapse animation style                      |
| `accordion`        | `boolean \| (depth) => boolean`                             | `false`   | Only one group open at a time (optionally per depth) |
| `groupRowHeight`   | `number`                                                    | -         | Height of group header rows (px)                     |
| `groupRowRenderer` | `(params) => HTMLElement \| string \| void`                 | -         | Custom group row renderer                            |
| `formatLabel`      | `(value, depth, key) => string`                             | -         | Custom format function for group label               |

## Disclosure Controls

Use `disclosureRenderer` to customize only the expand/collapse control, preserving
generated labels, counts, aggregates and group-row navigation. `groupRowRenderer`
still takes precedence when it returns a whole header.

```typescript
new GroupingRowsPlugin({
  groupOn: (row) => row.category,
  disclosureRenderer(initial) {
    const element = document.createElement('button');
    element.type = 'button';
    let current = initial;
    element.onclick = () => current.setExpanded(!current.expanded);
    const update = (context: typeof initial) => {
      current = context;
      element.textContent = context.expanded ? '-' : '+';
      element.setAttribute('aria-label', context.ariaLabel);
      element.setAttribute('aria-expanded', String(context.expanded));
      element.disabled = context.disabled;
    };
    update(initial);
    return { element, update };
  },
});
```

`GroupingRowsDisclosureContext` supplies the owning `grid`, stable `host`, existing
group `key`, `value`, `depth`, read-only `rows`, `rowCount`, `expanded`, `disabled`,
`ariaLabel` and guarded `setExpanded(boolean)`. Keys are the existing composite
group keys (or explicit predefined keys), not data-row IDs or display indexes.

Return an `HTMLElement` to replace output, a `ControlView` for mount-once/update
behavior, or `null` for deliberately empty output. Strings, `undefined` and thrown
errors are reported through control diagnostics; they do not restore a default
button. Views dispose on replacement, recycling, removal or disconnect; obsolete
actions cannot change a new group. `setDisclosureRenderer` replaces or removes the
hook without resetting expansion.

Use `disclosureLabel: (expanded) => ...` for localized native and custom labels.
Custom controls own their accessible name, expanded/disabled semantics and native
click/Space/Enter behavior. Give buttons an adequate target size (at least 24px);
do not reuse private `.group-toggle` markup. Native controls retain their existing
minimum target and behavior when the hook is omitted.

The React feature entry accepts JSX elements on both `groupingRows` and
`gridConfig.features.groupingRows`, preserving surrounding React providers.
Manually constructed core plugins, Vue and Angular use the DOM/`ControlView`
contract; native Vue/Angular template disclosure facades are not provided.

## Accessibility

For [SC 1.3.1: Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html),
active grouping supplies treegrid hierarchy metadata. Disabling grouping or removing
the plugin restores grouping-owned row attributes, depth styles and the container role;
ordinary rows do not retain stale group expansion or hierarchy metadata.
For [SC 4.1.2: Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html),
native controls expose expansion state automatically; custom controls must apply
their own semantics from the disclosure context.
Fixed child sections (`childGroupsCollapsible: false`) keep hierarchy metadata but
omit plugin-owned expansion state and controls. Whole-header renderers receive
`collapsible: false` and must not add misleading expansion controls of their own.

## Multi-Level Grouping

Return an array from `groupOn` for nested groups:

```typescript
new GroupingRowsPlugin({
  groupOn: (row) => [row.region, row.country, row.city],
});
```

## Grouping Tree Children

Combined with `TreePlugin`, grouping applies to the root rows and to the children of every expanded tree node. The second `groupOn` argument tells which list is being grouped (`parent` is the tree row, or `null` for the root rows); return `null` to leave a level ungrouped:

```typescript
plugins: [
  new TreePlugin({ childrenField: 'children' }),
  new GroupingRowsPlugin({ groupOn: (row, { depth }) => (depth > 0 ? row.kind : null) }),
];
```

Composed groups use opaque keys encoding the parent occurrence identity and normalized group path. Read keys from group state, events or disclosure contexts rather than constructing them from labels. Equal labels under different parents have independent expansion; accordion closes only same-parent siblings and their descendants. Standalone grouping retains its existing keys and defaults.

Use `childDefaultExpanded` to override defaults beneath real Tree parents while `defaultExpanded` governs global groups. For example, `{ defaultExpanded: true, childDefaultExpanded: false }` opens global groups and leaves child sections collapsed. Set Tree's own `defaultExpanded: false` to also keep real parents collapsed. No post-render initialization is needed. Omitting the child override preserves the shared default behaviour; standalone and predefined groups ignore it.

For child groups, a numeric default (`childDefaultExpanded`, or `defaultExpanded` when omitted) applies once per parent when that parent's groups first appear: `0` opens its first group, `1` its second. A parent with no groups waits until its first nonempty group list. An out-of-range index opens nothing and is not retried when more groups appear. Later rebuilds and parent collapse/re-expand preserve explicit group collapses; removing and reattaching the plugin starts a new initialization. Explicit expansion actions take precedence; `setGroupOn(fn, true)` still expands all visited group scopes, not just global groups.

Real rows retain their original references. Supply distinct occurrence objects and IDs (using `getRowId` when needed) for an entity displayed under several parents; canonical selection deduplication remains consumer-owned. A `groupOn` array is a nested path, not multi-membership.

Grouping counts and aggregators use the direct sibling members in each group, not implicit recursive Tree membership. Keep complete-hierarchy totals and ancestor-retaining filtering in the consumer's eager projection. Native Filtering still filters the root input; this composition does not introduce descendant-filter semantics. Empty real parents remain rows; empty semantic groups are omitted unless explicitly declared with `emptyGroups`. Existing standalone predefined/server-count groups are unchanged.

Both plugins depend on `HierarchyPlugin`, which the grid attaches automatically.

### Fixed Child Sections and Sticky Headers

Set `childGroupsCollapsible: false` to keep all group-path levels beneath real Tree
parents open. This is a policy, unlike `childDefaultExpanded: true`: defaults,
pending expansion, accordion and bulk collapse cannot hide their members. Single-group
`expand`, `collapse` and `toggle` calls are no-ops for fixed sections. Their public
model reports `expanded: true`, `collapsible: false`; Tree parents can still hide
the whole subtree, and root/global groups remain independently collapsible.
Omitted/true preserves existing behaviour; standalone and predefined groups ignore it.

Use the existing StickyRows push mode with the public processed row model:

```typescript
const grouping = new GroupingRowsPlugin({
  groupOn: (row) => row.category,
  defaultExpanded: true,
  childGroupsCollapsible: false,
});
const sticky = new StickyRowsPlugin({
  mode: 'push',
  isSticky: (_row, index) => {
    const item = grouping.getFlattenedRows()[index];
    return item?.kind === 'group' && item.collapsible === false;
  },
});
// Include TreePlugin({ defaultExpanded: false }), grouping and sticky in plugins.
```

StickyRows predates native parent-local groups. Native group cell-index stamping
now makes generated and `.cell`-based whole-header output capturable at current
processed indexes, including recycled headers. No consumer `data-row` patch is needed.
Nested grids' header and body cells retain their own indexes. Content-measured
variable-height rows are measured on forced layout refreshes even in small datasets
that bypass virtualization, keeping sticky push offsets aligned with actual row
heights. Explicit configured/plugin heights remain authoritative; no private cache
repair is needed.
Whole-header custom cells should be direct children of the row; StickyRows' existing
clone lookup uses the matched cell's parent. Push mode follows the latest preceding
qualifying row, not the current ancestor path, and has no automatic parent-boundary
expiry. Rich headers never rendered into the viewport may not be synthesizable.

### Declared Empty Groups

`emptyGroups({ parent, depth })` returns explicit group paths for an admitted
natural sibling list, such as `parent ? [['Primary']] : []`. It adds structural
headers with normal selection/ARIA, never fake domain entities. `groupOrder`
still only sorts admitted groups. Fixed noncollapsible child groups are expanded,
including declared empties.

For eligible empty real parents, supply `children: []` and Tree `hasChildren`
returning true only for those parents. Expansion (including `defaultExpanded`
or `expandAll`) then visits the empty list without loading when no lazy loader
is configured. Arbitrary leaves do not become parents. Collapsed, removed and
filtered-out parents produce no child declarations.

For a retained parent whose category is excluded by consumer filtering, omit
that category from the declaration callback too. Native cannot infer whether
your projection removed members intentionally. `setEmptyGroups` replaces the
callback without resetting group expansion; omission preserves legacy behaviour.
See the [admission rules](https://toolboxjs.com/grid/plugins/grouping-rows/#declared-empty-groups)
and [scoped footers](https://toolboxjs.com/grid/plugins/pinned-rows/#scoped-non-data-footers).

### Category Order

`groupOrder: ({ parent }) => parent === null ? undefined : ['Primary', 'Secondary']`
keeps child sections in a semantic order without changing category values, labels or
keys. Listed normalized category segments form a fixed prefix, independent of column
sort direction. Unlisted categories follow normal sorting; missing categories create
no empty groups, and duplicate entries use the first position.

The callback runs once per natural sibling-list model build, with `groupOn`'s
parent/depth context. Its ranking is reused at nested group-path levels in that
list. Omitted, `undefined` and empty rankings retain normal ordering; predefined
groups retain their supplied order. To change an existing plugin without resetting
expansion, use `plugin.setGroupOrder(callback)` or clear with `undefined`. Passing
the same callback reference is a no-op.

## Aggregators

Built-in aggregators: `'sum'`, `'avg'`, `'count'`, `'min'`, `'max'`, `'first'`, `'last'`

Custom aggregator:

```typescript
new GroupingRowsPlugin({
  groupOn: (row) => row.category,
  aggregators: {
    customTotal: (values) => values.reduce((a, b) => a + b, 0) * 1.1,
  },
});
```

## Events

### `group-toggle`

Fired when a group is expanded or collapsed.

```typescript
grid.addEventListener('group-toggle', (e) => {
  console.log('Group key:', e.detail.key);
  console.log('Expanded:', e.detail.expanded);
  console.log('Value:', e.detail.value);
  console.log('Depth:', e.detail.depth);
});
```

### `group-expand` / `group-collapse`

Fired in pre-defined groups mode when a group is expanded or collapsed.

```typescript
grid.addEventListener('group-expand', (e) => {
  console.log('Group expanded:', e.detail.groupKey);
  console.log('Group path:', e.detail.groupPath);
});
```

### `group-load-error`

Fired when the ServerSide `getChildRows()` request for a pre-defined group's rows fails
(see [Server-Side Data](#server-side-data-unified-datasource)). The group leaves its
loading state; collapsing and re-expanding it retries the fetch.

```typescript
grid.addEventListener('group-load-error', (e) => {
  console.error('Group', e.detail.groupKey, 'failed:', e.detail.error);
});
```

## API Methods

Access via `grid.getPluginByName('groupingRows')`:

```typescript
const grouping = grid.getPluginByName('groupingRows');

// Expand a group by key
grouping.expand(key);

// Collapse a group by key
grouping.collapse(key);

// Toggle a group
grouping.toggle(key);

// Check if group is expanded
const isExpanded = grouping.isExpanded(key);

// Expand all groups
grouping.expandAll();

// Collapse all groups
grouping.collapseAll();

// Get expanded group keys
const expanded = grouping.getExpandedGroups();

// Get current group state
const state = grouping.getGroupState();

// Get visible row count
const count = grouping.getRowCount();

// Get flattened row model
const rows = grouping.getFlattenedRows();

// Check if grouping is active
const active = grouping.isGroupingActive();

// Set groupOn dynamically
grouping.setGroupOn((row) => row.category);

// Set groupOn and immediately expand all new groups (issue #335).
// The optional second argument resolves against the *new* group set
// once the next render rebuilds the grouping.
grouping.setGroupOn((row) => row.counterparty, true);
// Or expand specific keys:
grouping.setGroupOn((row) => row.region, ['EMEA', 'AMER']);

// expandAll()/collapseAll() called immediately after setGroupOn(fn)
// also defer automatically, so this works as expected:
grouping.setGroupOn((row) => row.region);
grouping.expandAll();

// Refresh grouped row model
grouping.refreshGroups();
```

## Server-Side Data (Unified DataSource)

When used together with `ServerSidePlugin`, grouped data is loaded through the
unified DataSource architecture. The GroupingRows plugin automatically claims
`datasource:data` events (interpreting rows as group definitions) and receives
row data for expanded groups via `datasource:children` events.

```typescript
import { ServerSidePlugin } from '@toolbox-web/grid/plugins/server-side';
import { GroupingRowsPlugin } from '@toolbox-web/grid/plugins/grouping-rows';

grid.gridConfig = {
  plugins: [
    new ServerSidePlugin({
      dataSource: {
        getRows: async (params) => {
          const res = await fetch(`/api/groups?start=${params.startNode}&end=${params.endNode}`);
          return res.json();
          // Expected: { rows: [{ key: 'Eng', value: 'Engineering', rowCount: 150 }, ...], totalNodeCount: 5 }
        },
        getChildRows: async (params) => {
          const { groupKey } = params.context;
          const res = await fetch(`/api/groups/${groupKey}/rows`);
          return { rows: await res.json() };
        },
      },
    }),
    new GroupingRowsPlugin(),
  ],
};
```

The `ServerSidePlugin` manages data fetching while GroupingRows handles group
rendering and expand/collapse. Whenever a group is expanded (by the user, `toggle()`,
`expand()`, `expandAll()`, or `defaultExpanded`), GroupingRows automatically
fires a `datasource:fetch-children` query — the ServerSide plugin calls
`getChildRows()` and delivers the results back via `datasource:children`.
Viewport mapping is handled automatically for correct pagination: top-level groups
load in blocks of `pageSize`, unloaded groups render as loading placeholders that
take up scroll space, and each block's definitions are merged at their `startNode`
(loaded rows and expansion survive later blocks; `defaultExpanded: true` opens groups
not shown before, and user-collapsed groups stay collapsed across refetches). A new
ServerSide cache generation — server sort/filter, `refresh()`, `purgeCache()` —
replaces the definitions.

If `getChildRows()` rejects, the group leaves its loading state and `group-load-error`
fires. An in-flight request is aborted (`params.signal`) when new group definitions
arrive (server sort/filter change, `refresh()`, or `setGroups()`), and when
`setGroupRows()` / `clearGroupRows()` replaces or clears that group's rows; collapsing
a group keeps its request. After a server refetch, still-expanded groups whose rows
were loaded (or loading) request them again. An expanded group without rows gets one
automatic attempt per set of group definitions (a failing group is not re-requested
on every render).

### Imperative API (Without ServerSide)

For full control without ServerSidePlugin, use the plugin instance directly:

```typescript
const grouping = grid.getPluginByName('groupingRows');

// Provide groups programmatically
grouping.setGroups([
  { key: 'engineering', value: 'Engineering', rowCount: 150 },
  { key: 'sales', value: 'Sales', rowCount: 89 },
]);

// Populate rows for an expanded group
grid.addEventListener('group-expand', async (e) => {
  const { groupKey } = e.detail;
  grouping.setGroupLoading(groupKey, true);
  const rows = await fetchGroupRows(groupKey);
  grouping.setGroupRows(groupKey, rows);
});
```

| Method                          | Description                               |
| ------------------------------- | ----------------------------------------- |
| `setGroups(groups)`             | Replace groups with an external structure |
| `getGroups()`                   | Get the current group definitions         |
| `setGroupRows(key, rows)`       | Populate rows for an expanded group       |
| `setGroupLoading(key, loading)` | Toggle loading indicator for a group      |
| `clearGroupRows(key?)`          | Clear cached rows (specific group or all) |

## Documentation

See the [docs site](https://toolboxjs.com/grid/plugins/grouping-rows/) for live examples.
