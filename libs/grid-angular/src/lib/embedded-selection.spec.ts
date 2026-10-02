// @vitest-environment happy-dom
import '@angular/compiler';
import type { ApplicationRef, EnvironmentInjector, ViewContainerRef } from '@angular/core';
import { DataGridElement } from '@toolbox-web/grid';
import { SelectionPlugin, type SelectionRowCheckboxContext } from '@toolbox-web/grid/plugins/selection';
import { expect, it, vi } from 'vitest';
import { GridAdapter } from './angular-grid-adapter';

it('keeps native binding context through Angular config preprocessing and grid teardown', async () => {
  type Row = { id: string; name: string };
  const previous = Reflect.get(window, '__ANGULAR_GRID_ADAPTER__');
  const adapter = new GridAdapter(
    { get: () => null } as EnvironmentInjector,
    {} as ApplicationRef,
    {} as ViewContainerRef,
  );
  const selection = new SelectionPlugin<Row>({ mode: 'row', checkbox: false });
  const contexts: (SelectionRowCheckboxContext<Row> | null)[] = [];
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  try {
    grid.gridConfig = adapter.processGridConfig<Row>({
      plugins: [selection],
      columns: [
        {
          field: 'name',
          renderer(context) {
            const host = document.createElement('span');
            const button = document.createElement('button');
            button.disabled = true;
            host.append(button);
            let state: SelectionRowCheckboxContext<Row> | null = null;
            selection.bindRowCheckbox(context, host, (next) => {
              state = next;
              contexts.push(next);
              button.disabled = !next || next.disabled;
              button.textContent = next?.row.name ?? '';
            });
            button.onclick = (event) => state?.setChecked(!state.checked, event);
            return host;
          },
        },
      ],
    });
    grid.rows = [{ id: 'a', name: 'Alice' }];
    document.body.append(grid);
    await vi.waitFor(() => expect(grid.hasAttribute('data-upgraded')).toBe(true));
    await grid.ready();
    await vi.waitFor(() => expect(grid.querySelector('button')?.disabled).toBe(false));
    const old = contexts.at(-1)!;
    grid.querySelector('button')!.click();
    expect(selection.getSelectedRowIndices()).toEqual([0]);
    grid.remove();
    await Promise.resolve();
    expect(contexts.at(-1)).toBeNull();
    old.setChecked(true);
    expect(selection.getSelectedRowIndices()).toEqual([]);
  } finally {
    grid.remove();
    if (previous === undefined) Reflect.deleteProperty(window, '__ANGULAR_GRID_ADAPTER__');
    else Reflect.set(window, '__ANGULAR_GRID_ADAPTER__', previous);
  }
});
