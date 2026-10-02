// @vitest-environment happy-dom
import type { DataGridElement, GridConfig } from '@toolbox-web/grid';
import { SelectionPlugin, type SelectionRowCheckboxContext } from '@toolbox-web/grid/plugins/selection';
import { createApp, h, nextTick } from 'vue';
import { expect, it, vi } from 'vitest';
import TbwGrid from '../lib/TbwGrid.vue';

it('preserves the native embedded binding through Vue config rendering and unmount', async () => {
  type Row = { id: string; name: string };
  const selection = new SelectionPlugin<Row>({ mode: 'row', checkbox: false });
  const contexts: (SelectionRowCheckboxContext<Row> | null)[] = [];
  const config: GridConfig<Row> = {
    plugins: [selection],
    columns: [
      {
        field: 'name',
        viewRenderer(context) {
          const host = document.createElement('span');
          const button = document.createElement('button');
          button.disabled = true;
          host.append(button);
          let state: SelectionRowCheckboxContext<Row> | null = null;
          selection.bindRowCheckbox(context, host, (next) => {
            contexts.push(next);
            state = next;
            button.disabled = !next || next.disabled;
            button.textContent = next?.row.name ?? '';
          });
          button.onclick = (event) => state?.setChecked(!state.checked, event);
          return host;
        },
      },
    ],
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render: () => h(TbwGrid, { rows: [{ id: 'a', name: 'Alice' }], gridConfig: config }) });
  try {
    app.mount(container);
    await nextTick();
    const grid = container.querySelector('tbw-grid') as DataGridElement<Row>;
    await grid.ready();
    await vi.waitFor(() => expect(container.querySelector('button')?.disabled).toBe(false));
    const old = contexts.at(-1)!;
    container.querySelector('button')!.click();
    expect(selection.getSelectedRowIndices()).toEqual([0]);
    app.unmount();
    await Promise.resolve();
    expect(contexts.at(-1)).toBeNull();
    old.setChecked(true);
    expect(selection.getSelectedRowIndices()).toEqual([]);
  } finally {
    if (container.firstChild) app.unmount();
    container.remove();
  }
});
