/* eslint @nx/enforce-module-boundaries: "off" -- Public-entrypoint self-imports recurse through dist aliases in Nx's graph rule. */
import type { FeatureConfig as DOMFeatures, GridConfig as DOMGridConfig } from '@toolbox-web/grid';
import '@toolbox-web/grid/features/cell-entry';
import '@toolbox-web/grid/features/editing';
import '@toolbox-web/grid/features/master-detail';
import '@toolbox-web/grid/features/selection';
import '@toolbox-web/grid/features/tree';
import type { CellEntryConfig } from '@toolbox-web/grid/plugins/cell-entry';
import type { EditingConfig } from '@toolbox-web/grid/plugins/editing';
import type { SelectionConfig as DOMSelectionConfig } from '@toolbox-web/grid/plugins/selection';
import { expectTypeOf, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- Self-import validates the published entrypoint, not a sibling adapter.
import type {
  DataGridProps,
  GridConfig,
  MasterDetailConfig,
  SelectionConfig,
  TreeConfig,
} from '@toolbox-web/grid-react';
// eslint-disable-next-line no-restricted-imports -- Self-import validates the published feature entrypoint.
import type { CellEntryConfig as ReactCellEntryConfig } from '@toolbox-web/grid-react/features/cell-entry';

interface Row {
  id: string;
  name: string;
}

it('retains canonical generic configs and combined feature props without widening DOM controls', () => {
  const cellEntry: ReactCellEntryConfig = { singleClick: true };
  expectTypeOf(cellEntry).toEqualTypeOf<CellEntryConfig>();
  const editing: EditingConfig = { editOn: 'manual', tabToEdit: true };
  const tree: TreeConfig<Row> = {
    disclosureRenderer: (context) => {
      expectTypeOf(context.row).toEqualTypeOf<Row>();
      // @ts-expect-error Row context must not widen to any.
      void context.row.missing;
      return <button aria-expanded={context.expanded}>{context.row.name}</button>;
    },
  };
  const masterDetail: MasterDetailConfig<Row> = {
    disclosureRenderer: (context) => {
      expectTypeOf(context.row).toEqualTypeOf<Row>();
      // @ts-expect-error Row context must not widen to any.
      void context.row.missing;
      return <button aria-label={context.ariaLabel}>{context.row.name}</button>;
    },
    detailRenderer: () => <section>Details</section>,
  };
  const gridConfig: GridConfig<Row> = {
    columns: [{ field: 'name', editable: true }],
    features: { selection: 'range', editing, cellEntry, tree, masterDetail },
  };
  const props: DataGridProps<Row> = {
    rows: [],
    selection: 'range',
    editing,
    cellEntry,
    tree,
    masterDetail,
    gridConfig,
  };
  expectTypeOf(props).toExtend<DataGridProps<Row>>();
  const selection: SelectionConfig<Row> = {
    mode: 'row',
    checkbox: true,
    rowCheckboxRenderer: (context) => {
      expectTypeOf(context.row).toEqualTypeOf<Row>();
      // @ts-expect-error Row context must not widen to any.
      void context.row.missing;
      return <input type="checkbox" aria-label={context.row.name} />;
    },
    headerCheckboxRenderer: (context) => <input type="checkbox" aria-label={context.ariaLabel} />,
  };
  const adjacent: GridConfig<Row> = { features: { selection, editing } };
  expectTypeOf(adjacent).toExtend<GridConfig<Row>>();
  const dom: DOMGridConfig<Row> = {
    features: {
      selection: 'range',
      editing,
      cellEntry,
      tree: {
        disclosureRenderer: (context) => {
          expectTypeOf(context.row).toEqualTypeOf<Row>();
          // @ts-expect-error Core feature context preserves Row, not unknown or any.
          void context.row.missing;
          const element = document.createElement('button');
          element.textContent = context.row.name;
          return element;
        },
      },
      masterDetail: {
        disclosureRenderer: (context) => {
          expectTypeOf(context.row).toEqualTypeOf<Row>();
          // @ts-expect-error Core feature context preserves Row, not unknown or any.
          void context.row.missing;
          const element = document.createElement('button');
          element.textContent = context.row.name;
          return element;
        },
      },
    },
  };
  expectTypeOf(dom.features).toEqualTypeOf<DOMFeatures<Row> | undefined>();
  const domAdjacent: DOMGridConfig<Row> = {
    features: {
      selection: {
        mode: 'row',
        checkbox: true,
        rowCheckboxRenderer: (context) => {
          expectTypeOf(context.row).toEqualTypeOf<Row>();
          // @ts-expect-error Core feature context preserves Row, not unknown or any.
          void context.row.missing;
          const element = document.createElement('input');
          element.setAttribute('aria-label', context.row.name);
          return element;
        },
      },
      editing,
    },
  };
  expectTypeOf(domAdjacent).toExtend<DOMGridConfig<Row>>();
  const domSelection: DOMSelectionConfig<Row> = {
    // @ts-expect-error React checkbox output must not widen the core DOM contract.
    rowCheckboxRenderer: () => <input />,
  };
  expectTypeOf(domSelection).toExtend<DOMSelectionConfig<Row>>();
  const domControls: DOMFeatures<Row> = {
    tree: {
      // @ts-expect-error React disclosure output must not widen the core DOM contract.
      disclosureRenderer: () => <button />,
    },
    masterDetail: {
      // @ts-expect-error React disclosure output must not widen the core DOM contract.
      disclosureRenderer: () => <button />,
    },
  };
  expectTypeOf(domControls).toExtend<DOMFeatures<Row>>();
});
