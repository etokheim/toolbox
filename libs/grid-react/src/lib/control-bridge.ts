import type { ControlRenderer, ControlView } from '@toolbox-web/grid';
import type { ReactNode } from 'react';
import { getPortalManager, removeFromContainer, renderToContainer } from './portal-bridge';

type Output<T> = ReactNode | HTMLElement | ControlView<T>;

/** A control always belongs to an explicit DataGrid, even before its host mounts. */
export function createControlBridge<T extends { grid: HTMLElement }>(
  renderer: (context: T) => Output<T>,
): ControlRenderer<T> {
  return (initial) => {
    const element = document.createElement('span');
    element.style.display = 'contents';
    let portalHost: HTMLElement | undefined;
    let key: string | undefined;
    let view: ControlView<T> | undefined;
    let disposed = false;
    const clearPortal = () => {
      if (key) removeFromContainer(key);
      key = undefined;
      portalHost = undefined;
    };
    const render = (context: T) => {
      const output = renderer(context);
      if (output === undefined) throw new TypeError('Checkbox renderer must return a control or null, not undefined.');
      if (output instanceof HTMLElement) {
        clearPortal();
        if (output.parentElement !== element) element.replaceChildren(output);
        return;
      }
      if (output && typeof output === 'object' && 'element' in output) {
        clearPortal();
        if (
          !(output.element instanceof HTMLElement) ||
          typeof output.update !== 'function' ||
          (output.dispose !== undefined && typeof output.dispose !== 'function')
        ) {
          throw new TypeError('Invalid checkbox ControlView.');
        }
        view = output;
        element.replaceChildren(output.element);
        return;
      }
      if (output === null) {
        clearPortal();
        element.replaceChildren();
        return;
      }
      if (!getPortalManager(context.grid)) throw new Error('Checkbox JSX requires an owning DataGrid PortalManager.');
      if (!portalHost) {
        portalHost = document.createElement('span');
        portalHost.style.display = 'contents';
      }
      if (portalHost.parentElement !== element) element.replaceChildren(portalHost);
      key = renderToContainer(portalHost, output, key, context.grid);
    };
    try {
      render(initial);
    } catch (error) {
      clearPortal();
      throw error;
    }
    return {
      element,
      update(context) {
        if (disposed) return;
        if (view) view.update(context);
        else render(context);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        clearPortal();
        view?.dispose?.();
      },
    };
  };
}
