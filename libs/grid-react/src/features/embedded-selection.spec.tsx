/** @vitest-environment happy-dom */
import { DataGridElement, type CellRenderContext } from '@toolbox-web/grid';
import type { SelectionRowCheckboxContext } from '@toolbox-web/grid/plugins/selection';
import { act, createContext, StrictMode, useContext, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../lib/data-grid';
import type { ColumnConfig } from '../lib/react-column-config';
import { SelectionCheckbox } from './selection';

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
];
const Local = createContext('missing');
const roots: Root[] = [];
const unmount = vi.fn();
const latest = new Map<string, SelectionRowCheckboxContext<Row>>();
const updates = new Map<string, { hide(): void; change(): void }>();

function Control({ context, version }: { context: SelectionRowCheckboxContext<Row>; version: string }) {
  const label = useContext(Local);
  latest.set(`${label}:${context.rowId}`, context);
  useEffect(() => () => unmount(), []);
  return (
    <input
      type="checkbox"
      data-local={label}
      data-version={version}
      aria-label={context.ariaLabel}
      checked={context.checked}
      disabled={context.disabled}
      onChange={() => undefined}
      onClick={(event) => context.setChecked(event.currentTarget.checked, event)}
    />
  );
}

function Name({ context, owner }: { context: CellRenderContext<Row>; owner: string }) {
  const [show, setShow] = useState(true);
  const [version, setVersion] = useState('initial');
  updates.set(`${owner}:${context.row.id}`, { hide: () => setShow(false), change: () => setVersion('latest') });
  return (
    <Local.Provider value={`${owner}-local`}>
      {show && (
        <StrictMode>
          <SelectionCheckbox context={context}>
            {(state) => <Control context={state} version={version} />}
          </SelectionCheckbox>
        </StrictMode>
      )}
      <a href="#name" onClick={(event) => event.preventDefault()}>
        {context.row.name}
      </a>
    </Local.Provider>
  );
}

async function mount(count = 1) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const grids = Array.from({ length: count }, (_, index) => {
    const columns: ColumnConfig<Row>[] = [
      { field: 'name', renderer: (context) => <Name context={context} owner={`grid${index}`} /> },
    ];
    return <DataGrid key={index} rows={rows} gridConfig={{ columns }} selection={{ mode: 'row', checkbox: false }} />;
  });
  await act(async () => root.render(grids));
  await vi.waitFor(async () => {
    await act(async () => undefined);
    expect(container.querySelectorAll('input')).toHaveLength(count * rows.length);
  });
  return { root, container, grids: [...container.querySelectorAll<DataGridElement<Row>>(DataGridElement.activeTag)] };
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
  latest.clear();
  updates.clear();
  unmount.mockClear();
  vi.restoreAllMocks();
});

describe('SelectionCheckbox inside an existing Name portal', () => {
  it('reconciles a retained controlled native checkbox after checked Shift activation', async () => {
    const {
      grids: [grid],
    } = await mount();
    const input = grid.querySelector<HTMLInputElement>('input')!;
    const change = vi.fn();
    grid.addEventListener('selection-change', change);
    await act(async () => input.click());
    expect(input.checked).toBe(true);
    const old = latest.get('grid0-local:a');
    await act(async () => {
      input.focus();
      input.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect(input.checked).toBe(true);
    expect(grid.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([0]);
    expect(latest.get('grid0-local:a')).not.toBe(old);
    expect(change).toHaveBeenCalledTimes(2);
    expect(grid.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('retains Name-local providers, stable focused controls, callbacks and per-grid isolation', async () => {
    const errors = vi.spyOn(console, 'error');
    const { grids } = await mount(2);
    unmount.mockClear();
    const [first, second] = grids;
    const input = first.querySelector<HTMLInputElement>('input')!;
    expect(input.dataset.local).toBe('grid0-local');
    expect(second.querySelector<HTMLInputElement>('input')?.dataset.local).toBe('grid1-local');
    expect(first.querySelector('[data-field="__tbw_checkbox"]')).toBeNull();
    const change = vi.fn();
    first.addEventListener('selection-change', change);
    await act(async () => {
      input.focus();
      input.click();
    });
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(latest.get('grid0-local:a')?.checked).toBe(true);
    });
    expect(change).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect(first.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([0]);
    expect(second.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([]);
    await act(async () => updates.get('grid0:a')?.change());
    expect(input.dataset.version).toBe('latest');
    expect(first.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(unmount).not.toHaveBeenCalled();
    expect(
      errors.mock.calls.some(([message]) => /different component|flushSync|unmounted component/.test(String(message))),
    ).toBe(false);
  });

  it('revokes actions on unmount without disturbing the Name link or sibling control', async () => {
    const {
      grids: [grid],
    } = await mount();
    const old = latest.get('grid0-local:a')!;
    const link = grid.querySelector<HTMLAnchorElement>('a')!;
    await act(async () => {
      link.focus();
      updates.get('grid0:a')?.hide();
    });
    old.setChecked(true);
    expect(grid.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([]);
    expect(grid.querySelectorAll('input')).toHaveLength(1);
    expect(document.activeElement).toBe(link);
    await act(async () => grid.querySelector<HTMLInputElement>('input')?.click());
    expect(grid.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([1]);
  });

  it('rebinds a retained component after identity retirement without accepting old actions', async () => {
    const {
      grids: [grid],
    } = await mount();
    const old = latest.get('grid0-local:a')!;
    await act(async () => {
      grid.rows = [{ id: 'new', name: 'New Name' }];
      await new Promise(requestAnimationFrame);
    });
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(latest.get('grid0-local:new')?.row.name).toBe('New Name');
    });
    old.setChecked(true);
    expect(grid.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([]);
    await act(async () => grid.querySelector<HTMLInputElement>('input')?.click());
    expect(grid.getPluginByName('selection')?.getSelectedRowIndices()).toEqual([0]);
  });
});
