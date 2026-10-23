/** @vitest-environment happy-dom */
import type { CellRenderContext } from '@toolbox-web/grid';
import { act, createRef, StrictMode, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { renderToContainer, resetBridge, setPortalManager } from './portal-bridge';
import { PortalManager, type PortalManagerHandle } from './portal-manager';
import { GridAdapter, registerColumnRenderer } from './react-grid-adapter';
import { DataGrid } from './data-grid';
import { GridElementContext } from './grid-element-context';

it('preserves a live native portal owner across StrictMode effect replay but retires on unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const target = document.createElement('div');
  document.body.append(container, target);
  const root = createRoot(container);
  let grid: HTMLElement | undefined;
  const mounts = vi.fn();
  const cleanup = vi.fn();
  function Action() {
    const [count, setCount] = useState(0);
    useEffect(() => cleanup, []);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  }
  function NativeOwner() {
    const owner = useContext(GridElementContext);
    useEffect(() => {
      if (!owner?.current) throw new Error('Missing grid owner');
      grid = owner.current;
      mounts();
      renderToContainer(target, <Action />, undefined, grid);
    }, [owner]);
    return null;
  }
  let unmounted = false;
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <DataGrid rows={[{ id: 'one' }]} gridConfig={{ columns: [{ field: 'id' }] }}>
            <NativeOwner />
          </DataGrid>
        </StrictMode>,
      ),
    );
    expect(mounts).toHaveBeenCalledTimes(2);
    const button = target.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(button?.textContent).toBe('1');
    await act(async () => renderToContainer(target, <Action />, undefined, grid));
    expect(target.querySelector('button')).toBe(button);
    expect(button?.textContent).toBe('1');
    expect(Object.keys(target).some((key) => key.startsWith('__reactContainer$'))).toBe(false);
    const beforeUnmount = cleanup.mock.calls.length;
    await act(async () => root.unmount());
    unmounted = true;
    renderToContainer(target, <Action />, undefined, grid);
    expect(target.querySelector('button')).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(beforeUnmount + 1);
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    resetBridge();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  }
});

it('keeps a cached detached renderer in its original portal until route teardown', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const grid = document.createElement('tbw-grid');
  const otherGrid = document.createElement('tbw-grid');
  const declaration = document.createElement('tbw-grid-column');
  declaration.setAttribute('field', '__actions');
  grid.append(declaration);
  document.body.append(host, grid, otherGrid);
  const root = createRoot(host);
  const manager = createRef<PortalManagerHandle>();
  const otherManager = createRef<PortalManagerHandle>();
  const cleanup = vi.fn();
  function Action() {
    const [count, setCount] = useState(0);
    useEffect(() => cleanup, []);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  }
  const adapter = new GridAdapter();
  let unmounted = false;
  try {
    await act(async () =>
      root.render(
        <>
          <PortalManager ref={manager} />
          <PortalManager ref={otherManager} />
        </>,
      ),
    );
    setPortalManager(grid, manager.current);
    setPortalManager(otherGrid, otherManager.current);
    registerColumnRenderer(declaration, () => <Action />);
    const renderer = adapter.createRenderer(declaration);
    if (!renderer) throw new Error('Expected registered renderer');
    const cell = document.createElement('div');
    const context: CellRenderContext = {
      row: { id: 'occurrence' },
      value: undefined,
      field: '__actions',
      column: { field: '__actions' },
      cellEl: cell,
    };
    await act(async () => {
      const container = renderer(context);
      if (!(container instanceof HTMLElement)) throw new Error('Expected React container');
      cell.append(container);
      grid.append(cell);
    });
    const original = cell.querySelector('button');
    if (!original) throw new Error('Expected action button');
    await act(async () => original.click());
    expect(original.textContent).toBe('1');
    await act(async () => {
      cell.remove();
      renderer(context);
      grid.append(cell);
    });
    expect(cell.querySelector('button')).toBe(original);
    expect(original.textContent).toBe('1');
    expect(Object.keys(cell.firstElementChild!).some((key) => key.startsWith('__reactContainer$'))).toBe(false);
    await act(async () => {
      setPortalManager(grid, null);
      renderer(context);
      root.unmount();
      unmounted = true;
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(original.parentNode).toBeNull();
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    adapter.destroy();
    resetBridge();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  }
});
