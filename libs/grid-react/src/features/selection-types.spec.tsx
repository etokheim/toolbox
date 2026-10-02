import type { ControlRenderer, ControlView } from '@toolbox-web/grid';
import type {
  SelectionConfig as DOMSelectionConfig,
  SelectionRowCheckboxContext,
} from '@toolbox-web/grid/plugins/selection';
import { expectTypeOf, it } from 'vitest';
import type { SelectionConfig } from './selection';
import type { DataGridProps } from '../lib/data-grid';
import type { GridConfig } from '../lib/react-column-config';

interface Row {
  id: string;
  name: string;
}

it('types both React config surfaces while keeping manual plugins DOM-only', () => {
  const selection: SelectionConfig<Row> = {
    mode: 'row',
    checkbox: true,
    rowCheckboxRenderer(ctx) {
      expectTypeOf(ctx.row).toEqualTypeOf<Row>();
      expectTypeOf(ctx.rowId).toEqualTypeOf<string | undefined>();
      expectTypeOf(ctx.rowIndex).toEqualTypeOf<number>();
      ctx.setChecked(true, { shiftKey: true, metaKey: false, ctrlKey: false });
      // @ts-expect-error Modifiers are typed, not arbitrary event data.
      ctx.setChecked(true, { altKey: true });
      return <input aria-label={ctx.ariaLabel} />;
    },
    headerCheckboxRenderer: () => null,
  };
  const config: GridConfig<Row> = { features: { selection, editing: true } };
  const props: DataGridProps<Row> = { rows: [], selection, gridConfig: config };
  expectTypeOf(props).toExtend<DataGridProps<Row>>();
  const dom: DOMSelectionConfig<Row> = {
    mode: 'row',
    // @ts-expect-error Core plugins do not accept JSX.
    rowCheckboxRenderer: () => <input />,
    // @ts-expect-error Empty slots must explicitly return null.
    headerCheckboxRenderer: () => undefined,
  };
  expectTypeOf(dom).toExtend<DOMSelectionConfig<Row>>();
  const persistent: ControlRenderer<SelectionRowCheckboxContext<Row>> = () =>
    ({
      element: document.createElement('input'),
      update: () => undefined,
    }) satisfies ControlView<SelectionRowCheckboxContext<Row>>;
  const compatible: SelectionConfig<Row> = { mode: 'row', rowCheckboxRenderer: persistent };
  expectTypeOf(compatible).toExtend<SelectionConfig<Row>>();
});
