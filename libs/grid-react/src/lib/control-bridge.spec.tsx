/** @vitest-environment happy-dom */
import type { ControlView } from '@toolbox-web/grid';
import { act, createRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createControlBridge } from './control-bridge';
import { setPortalManager } from './portal-bridge';
import { PortalManager, type PortalManagerHandle } from './portal-manager';

afterEach(() => {
  document.body.innerHTML = '';
});

it('switches JSX, DOM and null without wiping React-owned descendants', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const rootHost = document.createElement('div');
  const grid = document.createElement('div');
  document.body.append(rootHost, grid);
  const root = createRoot(rootHost);
  const manager = createRef<PortalManagerHandle>();
  await act(async () => root.render(<PortalManager ref={manager} />));
  setPortalManager(grid, manager.current);
  type Context = { grid: HTMLElement; checked: boolean };
  let output: ReactNode | HTMLElement | ControlView<Context> = <button>React</button>;
  const renderer = vi.fn(() => output);
  const bridge = createControlBridge<Context>(renderer);
  const result = bridge({ grid, checked: false });
  if (!result || result instanceof HTMLElement) throw new Error('Expected persistent bridge.');
  try {
    await act(async () => {
      grid.append(result.element);
    });
    expect(grid.textContent).toBe('React');
    const portalNode = grid.querySelector('button')!;
    const dom = document.createElement('button');
    dom.textContent = 'DOM';
    output = dom;
    await act(async () => result.update({ grid, checked: true }));
    expect(grid.firstElementChild?.firstElementChild).toBe(dom);
    expect(portalNode.isConnected).toBe(false);
    output = null;
    await act(async () => result.update({ grid, checked: false }));
    expect(grid.textContent).toBe('');
    output = <button>Back</button>;
    await act(async () => result.update({ grid, checked: true }));
    expect(grid.textContent).toBe('Back');
    const dispose = vi.fn();
    const update = vi.fn();
    output = { element: dom, update, dispose };
    await act(async () => result.update({ grid, checked: false }));
    const calls = renderer.mock.calls.length;
    await act(async () => result.update({ grid, checked: true }));
    expect(renderer).toHaveBeenCalledTimes(calls);
    expect(update).toHaveBeenCalledWith({ grid, checked: true });
    await act(async () => {
      result.dispose?.();
      result.dispose?.();
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    result.dispose?.();
    setPortalManager(grid, null);
    await act(async () => root.unmount());
  }
});
