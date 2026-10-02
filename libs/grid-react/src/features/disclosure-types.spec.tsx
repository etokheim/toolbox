import type { MasterDetailConfig as DOMDetailConfig } from '@toolbox-web/grid/plugins/master-detail';
import type { TreeConfig as DOMTreeConfig } from '@toolbox-web/grid/plugins/tree';
import { expectTypeOf, it } from 'vitest';
import type { DataGridProps } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';
import type { MasterDetailConfig } from './master-detail';
import type { TreeConfig } from './tree';

type Row = { id: string; name: string };
it('types canonical disclosure configs on both React surfaces without widening core plugins', () => {
  const tree: TreeConfig<Row> = {
    disclosureRenderer: (ctx) => {
      expectTypeOf(ctx.row).toEqualTypeOf<Row>();
      ctx.setExpanded(true);
      // @ts-expect-error Expansion is a boolean, not a mixed model.
      ctx.setExpanded('tree');
      return <button aria-label={ctx.row.name} aria-expanded={ctx.expanded} />;
    },
  };
  const masterDetail: MasterDetailConfig<Row> = {
    detailRenderer: (row) => <section>{String(row['name'])}</section>,
    disclosureRenderer: (ctx) => {
      expectTypeOf(ctx.row).toEqualTypeOf<Row>();
      return <button aria-label={ctx.ariaLabel} />;
    },
  };
  const gridConfig: GridConfig<Row> = { features: { tree, masterDetail, editing: true } };
  const props: DataGridProps<Row> = { rows: [], tree, masterDetail, gridConfig };
  expectTypeOf(props).toExtend<DataGridProps<Row>>();
  const dom: DOMTreeConfig<Row> = {
    // @ts-expect-error Core plugins remain DOM-only.
    disclosureRenderer: () => <button />,
  };
  const detail: DOMDetailConfig<Row> = {
    // @ts-expect-error Empty slots must explicitly return null.
    disclosureRenderer: () => undefined,
  };
  expectTypeOf(dom).toExtend<DOMTreeConfig<Row>>();
  expectTypeOf(detail).toExtend<DOMDetailConfig<Row>>();
});
