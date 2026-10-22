import type { ControlView } from '@toolbox-web/grid';
import type { GroupingRowsConfig as DOMConfig } from '@toolbox-web/grid/plugins/grouping-rows';
import type {
  DataGridProps,
  GridConfig,
  GroupingRowsConfig,
  GroupingRowsDisclosureContext,
} from '@toolbox-web/grid-react';
import type { GroupingRowsConfig as SecondaryConfig } from '@toolbox-web/grid-react/features/grouping-rows';
import '@toolbox-web/grid-react/features/editing';
import { expectTypeOf, it } from 'vitest';

type Row = { id: string; category: string };

it('types disclosure identity, controls and both React config surfaces without widening core', () => {
  const groupingRows: GroupingRowsConfig = {
    disclosureRenderer: (context) => {
      expectTypeOf(context.key).toEqualTypeOf<string>();
      expectTypeOf(context.rows).toEqualTypeOf<readonly unknown[]>();
      expectTypeOf(context.value).toEqualTypeOf<unknown>();
      expectTypeOf(context.host).toEqualTypeOf<HTMLElement>();
      // @ts-expect-error Groups are not row identities.
      expectTypeOf(context.row.id);
      // @ts-expect-error Expansion is boolean.
      context.setExpanded('expanded');
      return <button aria-label={context.ariaLabel} aria-expanded={context.expanded} />;
    },
  };
  const secondary: SecondaryConfig = groupingRows;
  const gridConfig: GridConfig<Row> = { features: { groupingRows: secondary, selection: 'row', editing: true } };
  const props: DataGridProps<Row> = { rows: [], groupingRows, gridConfig };
  expectTypeOf(props).toExtend<DataGridProps<Row>>();
  const persistent: DOMConfig = {
    disclosureRenderer: (_context): ControlView<GroupingRowsDisclosureContext> => ({
      element: document.createElement('button'),
      update: (next) => {
        expectTypeOf(next).toEqualTypeOf<typeof _context>();
      },
    }),
  };
  const empty: DOMConfig = { disclosureRenderer: () => null };
  const jsx: DOMConfig = {
    // @ts-expect-error Core remains DOM-only.
    disclosureRenderer: () => <button />,
  };
  const invalid: GroupingRowsConfig = {
    // @ts-expect-error Empty output must explicitly return null.
    disclosureRenderer: () => undefined,
  };
  const text: GroupingRowsConfig = {
    // @ts-expect-error A disclosure is a control, not text.
    disclosureRenderer: () => 'text',
  };
  expectTypeOf(persistent).toEqualTypeOf<DOMConfig>();
  expectTypeOf(empty).toEqualTypeOf<DOMConfig>();
  expectTypeOf(jsx).toEqualTypeOf<DOMConfig>();
  expectTypeOf(invalid).toEqualTypeOf<GroupingRowsConfig>();
  expectTypeOf(text).toEqualTypeOf<GroupingRowsConfig>();
});
