import {
  DataGrid,
  type GridConfig,
  type MasterDetailDisclosureContext,
  type TreeDisclosureContext,
} from '@toolbox-web/grid-react';
import '@toolbox-web/grid-react/features/cell-entry';
import '@toolbox-web/grid-react/features/editing';
import '@toolbox-web/grid-react/features/master-detail';
import '@toolbox-web/grid-react/features/selection';
import '@toolbox-web/grid-react/features/tree';
import { createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';

interface Row {
  id: string;
  name: string;
  value: string;
  children?: Row[];
}

const Theme = createContext('missing');

function Disclosure({ context }: { context: TreeDisclosureContext<Row> | MasterDetailDisclosureContext<Row> }) {
  const theme = useContext(Theme);
  return (
    <button
      data-disclosure={'ariaLabel' in context ? 'detail' : 'tree'}
      data-theme={theme}
      aria-label={'ariaLabel' in context ? context.ariaLabel : `Children of ${context.row.name}`}
      aria-expanded={context.expanded}
      onClick={() => context.setExpanded(!context.expanded)}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M4 6L9 12L14 6" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>
  );
}

function Name({ row }: { row: Row }) {
  return (
    <span data-name={row.id} data-theme={useContext(Theme)}>
      {row.name}
    </span>
  );
}

const config: GridConfig<Row> = {
  columns: [
    { field: 'name', renderer: ({ row }) => <Name row={row} /> },
    { field: 'value', editable: true },
  ],
  features: {
    selection: 'range',
    editing: { editOn: 'manual', tabToEdit: true },
    cellEntry: { singleClick: true },
    tree: { treeColumn: 'name', animation: false, disclosureRenderer: (context) => <Disclosure context={context} /> },
    masterDetail: {
      animation: false,
      disclosureRenderer: (context) => <Disclosure context={context} />,
      detailRenderer: () => <section>Details</section>,
    },
  },
};

export function mount() {
  const container = document.createElement('div');
  container.id = 'integrated-react';
  document.body.append(container);
  createRoot(container).render(
    <Theme.Provider value="integrated">
      <DataGrid<Row>
        rows={[
          { id: 'parent-0', name: 'Parent 0', value: 'A', children: [{ id: 'child', name: 'Child', value: 'B' }] },
        ]}
        gridConfig={config}
      />
    </Theme.Provider>,
  );
}
