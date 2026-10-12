import { DataGridElement } from '@toolbox-web/grid';
import { GroupingRowsPlugin, type GroupingRowsDisclosureContext } from '@toolbox-web/grid/plugins/grouping-rows';
import { SelectionPlugin } from '@toolbox-web/grid/plugins/selection';
import { DataGrid } from '@toolbox-web/grid-react';
import '@toolbox-web/grid-react/features/grouping-rows';
import '@toolbox-web/grid-react/features/selection';
import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const Theme = createContext('missing');
const rows = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  name: `Item ${index}`,
  category: index < 6 ? 'A' : 'B',
}));
const counts = { mounted: 0, disposed: 0, updates: 0 };
function Disclosure({ context }: { context: GroupingRowsDisclosureContext }) {
  const theme = useContext(Theme);
  useLayoutEffect(() => {
    counts.mounted++;
    return () => {
      counts.disposed++;
    };
  }, []);
  useLayoutEffect(() => {
    counts.updates++;
  });
  return (
    <span className="design-system-disclosure">
      <button
        type="button"
        data-group={context.key}
        data-theme={theme}
        aria-label={context.ariaLabel}
        aria-expanded={context.expanded}
        disabled={context.disabled}
        onClick={() => context.setExpanded(!context.expanded)}
        style={{ minWidth: 24, minHeight: 24 }}
      >
        <svg width="12" height="12" aria-hidden="true">
          <path d="M2 2L10 6L2 10Z" />
        </svg>
      </button>
    </span>
  );
}
function RemovalApp({ custom, explicitConfig }: { custom: boolean; explicitConfig: boolean }) {
  const [enabled, setEnabled] = useState(true);
  return (
    <Theme.Provider value="grouping-proof">
      <select
        aria-label="Grouping mode"
        value={String(enabled)}
        onChange={(event) => setEnabled(event.target.value === 'true')}
      >
        <option value="true">Category</option>
        <option value="false">None</option>
      </select>
      <DataGrid
        rows={rows}
        columns={enabled ? [{ field: 'category' }, { field: 'name' }] : [{ field: 'name' }]}
        gridConfig={explicitConfig ? { emptyRenderer: null } : undefined}
        groupingRows={
          enabled
            ? {
                groupOn: (row) => row.category,
                defaultExpanded: true,
                animation: false,
                disclosureRenderer: custom ? (context) => <Disclosure context={context} /> : undefined,
              }
            : undefined
        }
      />
    </Theme.Provider>
  );
}
const container = document.getElementById('react');
if (!container) throw new Error('Missing React fixture container.');
const root = createRoot(container);
root.render(
  <Theme.Provider value="grouping-proof">
    <DataGrid
      rows={rows}
      selection="row"
      gridConfig={{ columns: [{ field: 'name' }] }}
      groupingRows={{
        groupOn: (row) => row.category,
        defaultExpanded: true,
        animation: false,
        disclosureRenderer: (context) => <Disclosure context={context} />,
      }}
    />
  </Theme.Provider>,
);

const native = document.createElement(DataGridElement.activeTag) as DataGridElement;
native.id = 'native';
native.gridConfig = {
  columns: [{ field: 'name' }],
  plugins: [
    new GroupingRowsPlugin({ groupOn: (row) => row.category, defaultExpanded: true, animation: false }),
    new SelectionPlugin({ mode: 'row' }),
  ],
};
native.rows = rows;
document.body.append(native);
Object.assign(window, {
  groupingProof: {
    counts,
    refresh: async (grid: DataGridElement) => {
      const plugin = grid.getPluginByName('groupingRows');
      if (!plugin) throw new Error('Missing grouping fixture plugin.');
      plugin.afterRender();
      await Promise.resolve();
    },
    unmount: () => root.unmount(),
    mountRemoval: (custom: boolean, explicitConfig: boolean) =>
      root.render(<RemovalApp custom={custom} explicitConfig={explicitConfig} />),
  },
});
