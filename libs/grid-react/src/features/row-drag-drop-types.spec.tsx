/* eslint @nx/enforce-module-boundaries: "off" -- Public-entrypoint fixture, including built declaration verification. */
import type { FeatureConfig, GridConfig as DOMGridConfig } from '@toolbox-web/grid';
import '@toolbox-web/grid/features/row-drag-drop';
import type { RowDragDropConfig as DOMConfig } from '@toolbox-web/grid/plugins/row-drag-drop';
// eslint-disable-next-line no-restricted-imports -- Intentional public self-import.
import type { DataGridProps, GridConfig, RowDragDropConfig } from '@toolbox-web/grid-react';
import { expectTypeOf, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- Resolve the public secondary entry for source and emitted checks.
import '@toolbox-web/grid-react/features/row-drag-drop';

interface Row {
  id: string;
  name: string;
}

it('preserves Row on both core and React feature surfaces without widening manual plugins', () => {
  const drag: RowDragDropConfig<Row> = {
    canDrag: (row) => {
      expectTypeOf(row).toEqualTypeOf<Row>();
      // @ts-expect-error Generic row cannot widen to any.
      void row.missing;
      return true;
    },
    dragHandleRenderer: (ctx) => {
      expectTypeOf(ctx.row).toEqualTypeOf<Row>();
      // @ts-expect-error Generic row cannot widen to any.
      void ctx.row.missing;
      return <button ref={ctx.bindHandle}>{ctx.row.name}</button>;
    },
  };
  const config: GridConfig<Row> = {
    features: {
      rowDragDrop: {
        dragHandleRenderer: (ctx) => {
          expectTypeOf(ctx.row).toEqualTypeOf<Row>();
          // @ts-expect-error Generic row cannot widen to any.
          void ctx.row.missing;
          return <button ref={ctx.bindHandle} />;
        },
      },
    },
  };
  const props: DataGridProps<Row> = { rows: [], rowDragDrop: drag, gridConfig: config };
  expectTypeOf(props).toExtend<DataGridProps<Row>>();
  const core: DOMGridConfig<Row> = {
    features: {
      rowDragDrop: {
        dragHandleRenderer: (ctx) => {
          expectTypeOf(ctx.row).toEqualTypeOf<Row>();
          // @ts-expect-error Generic row cannot widen to any.
          void ctx.row.missing;
          const element = document.createElement('button');
          ctx.bindHandle(element);
          return element;
        },
      },
    },
  };
  expectTypeOf(core.features).toEqualTypeOf<FeatureConfig<Row> | undefined>();
  const invalid: DOMConfig<Row> = {
    // @ts-expect-error Manual/core renderer must remain DOM-only.
    dragHandleRenderer: () => <button />,
  };
  expectTypeOf(invalid).toExtend<DOMConfig<Row>>();
});
