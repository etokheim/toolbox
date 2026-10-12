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

| Option             | Type                                        | Default   | Description                            |
| ------------------ | ------------------------------------------- | --------- | -------------------------------------- |
| `groupOn`          | `(row) => any[] \| any \| null \| false`    | -         | Function returning group key(s)        |
| `groups`           | `GroupDefinition[]`                         | -         | Pre-defined group structure            |
| `aggregators`      | `Record<string, AggregatorRef>`             | `{}`      | Aggregation functions per field        |
| `fullWidth`        | `boolean`                                   | `true`    | Group rows span full width             |
| `defaultExpanded`  | `boolean \| number \| string \| string[]`   | `false`   | Start groups expanded                  |
| `showRowCount`     | `boolean`                                   | `true`    | Show row count in group headers        |
| `indentWidth`      | `number`                                    | `20`      | Indent width per depth level in pixels |
| `animation`        | `false \| 'slide' \| 'fade'`                | `'slide'` | Expand/collapse animation style        |
| `accordion`        | `boolean`                                   | `false`   | Only one group open at a time          |
| `groupRowHeight`   | `number`                                    | -         | Height of group header rows (px)       |
| `groupRowRenderer` | `(params) => HTMLElement \| string \| void` | -         | Custom group row renderer              |
| `formatLabel`      | `(value, depth, key) => string`             | -         | Custom format function for group label |

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

## Multi-Level Grouping

Return an array from `groupOn` for nested groups:

```typescript
new GroupingRowsPlugin({
  groupOn: (row) => [row.region, row.country, row.city],
});
```

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
rendering and expand/collapse. When a group is expanded, GroupingRows automatically
fires a `datasource:fetch-children` query — the ServerSide plugin calls
`getChildRows()` and delivers the results back via `datasource:children`.
Viewport mapping is handled automatically for correct pagination.

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
