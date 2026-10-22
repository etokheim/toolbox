/**
 * Tests for portal-bridge — the module-level registry that connects
 * non-React code to per-grid PortalManagers for context-preserving rendering.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllContainers,
  clearContainersForGrid,
  createNodeBridge,
  getPortalManager,
  removeFromContainer,
  renderToContainer,
  resetBridge,
  setPortalManager,
} from './portal-bridge';
import type { PortalManagerHandle } from './portal-manager';

/** Create a mock grid element for testing. */
function createMockGrid(): HTMLElement {
  const el = document.createElement('tbw-grid');
  document.body.appendChild(el);
  return el;
}

/** Create a mock PortalManager handle. */
function createMockManager(): PortalManagerHandle {
  return {
    renderPortal: vi.fn(),
    removePortal: vi.fn(),
    beginBatch: vi.fn(),
    endBatch: vi.fn(),
    clear: vi.fn(),
  };
}

describe('portal-bridge', () => {
  beforeEach(() => {
    resetBridge();
  });

  afterEach(() => {
    resetBridge();
    document.body.innerHTML = '';
  });

  // #region setPortalManager / getPortalManager

  describe('setPortalManager / getPortalManager', () => {
    it('should return null when no manager is set', () => {
      expect(getPortalManager()).toBeNull();
    });

    it('should store and retrieve a manager by grid element', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);
      expect(getPortalManager(gridEl)).toBe(mockManager);
    });

    it('should return the single manager when no gridEl is provided', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);
      expect(getPortalManager()).toBe(mockManager);
    });

    it('should return null for unregistered grid', () => {
      const gridEl = createMockGrid();
      const otherEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);
      expect(getPortalManager(otherEl)).toBeNull();
    });

    it('should clear the manager when set to null', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);
      setPortalManager(gridEl, null);
      expect(getPortalManager(gridEl)).toBeNull();
    });
  });

  // #endregion

  // #region renderToContainer — with PortalManager

  describe('renderToContainer (with PortalManager)', () => {
    it('should delegate to portalManager.renderPortal', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      const container = document.createElement('div');
      gridEl.appendChild(container);
      const element = 'hello';
      const key = renderToContainer(container, element);

      expect(mockManager.renderPortal).toHaveBeenCalledWith(key, container, element);
      expect(key).toMatch(/^p-\d+$/);
    });

    it('should resolve grid via explicit gridEl parameter', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      // Container is NOT inside the grid (detached), but gridEl is explicit
      const container = document.createElement('div');
      const key = renderToContainer(container, 'hello', undefined, gridEl);

      expect(mockManager.renderPortal).toHaveBeenCalledWith(key, container, 'hello');
    });

    it('should reuse existing key when provided', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      const container = document.createElement('div');
      gridEl.appendChild(container);
      const key = renderToContainer(container, 'hello', 'existing-key');

      expect(key).toBe('existing-key');
      expect(mockManager.renderPortal).toHaveBeenCalledWith('existing-key', container, 'hello');
    });

    it('keeps a detached existing portal with its original owner when multiple grids are mounted', () => {
      const owner = createMockGrid();
      const other = createMockGrid();
      const manager = createMockManager();
      const otherManager = createMockManager();
      setPortalManager(owner, manager);
      setPortalManager(other, otherManager);
      const container = document.createElement('div');
      owner.append(container);
      const key = renderToContainer(container, 'original');
      const child = document.createElement('button');
      container.append(child);
      container.remove();

      renderToContainer(container, 'updated', key);

      expect(manager.renderPortal).toHaveBeenLastCalledWith(key, container, 'updated');
      expect(otherManager.renderPortal).not.toHaveBeenCalled();
      expect(container.firstChild).toBe(child);
      removeFromContainer(key, { sync: true });
    });

    it.each(['release', 'clear-grid', 'clear-all', 'unregister'] as const)(
      'does not reacquire a portal host after %s, even when its grid is registered again',
      (retirement) => {
        const grid = createMockGrid();
        const manager = createMockManager();
        setPortalManager(grid, manager);
        const container = document.createElement('div');
        grid.append(container);
        const key = renderToContainer(container, 'original');
        const child = document.createElement('button');
        container.append(child);
        if (retirement === 'release') removeFromContainer(key, { sync: true });
        if (retirement === 'clear-grid') clearContainersForGrid(grid);
        if (retirement === 'clear-all') clearAllContainers();
        if (retirement === 'unregister') setPortalManager(grid, null);
        const successor = createMockManager();
        setPortalManager(grid, successor);
        renderToContainer(container, 'late', key, grid);
        renderToContainer(container, 'late without key', undefined, grid);
        removeFromContainer(key);
        expect(manager.renderPortal).toHaveBeenCalledTimes(1);
        expect(successor.renderPortal).not.toHaveBeenCalled();
        expect(successor.removePortal).not.toHaveBeenCalled();
        expect(container.firstChild).toBe(child);
        expect(Object.keys(container).some((key) => key.startsWith('__reactContainer$'))).toBe(false);
        const fresh = document.createElement('div');
        renderToContainer(fresh, 'successor', undefined, grid);
        expect(successor.renderPortal).toHaveBeenCalledOnce();
      },
    );

    it('does not create a fallback for new hosts during explicit grid teardown', () => {
      const grid = createMockGrid();
      setPortalManager(grid, createMockManager());
      setPortalManager(grid, null);
      const container = document.createElement('div');
      renderToContainer(container, 'late', undefined, grid);
      expect(container.childNodes).toHaveLength(0);
      expect(Object.keys(container).some((key) => key.startsWith('__reactContainer$'))).toBe(false);
      const standalone = document.createElement('div');
      const key = renderToContainer(standalone, 'standalone');
      expect(standalone.textContent).toBe('standalone');
      removeFromContainer(key);
    });

    it('keeps original manager ownership when the host moves under a different grid', () => {
      const grid = createMockGrid();
      const other = createMockGrid();
      const manager = createMockManager();
      const otherManager = createMockManager();
      setPortalManager(grid, manager);
      setPortalManager(other, otherManager);
      const container = document.createElement('div');
      grid.append(container);
      const key = renderToContainer(container, 'original');
      other.append(container);
      renderToContainer(container, 'update', key, other);
      removeFromContainer(key, { sync: true });
      expect(manager.renderPortal).toHaveBeenLastCalledWith(key, container, 'update');
      expect(manager.removePortal).toHaveBeenCalledWith(key, true);
      expect(otherManager.renderPortal).not.toHaveBeenCalled();
      expect(otherManager.removePortal).not.toHaveBeenCalled();
    });

    it('should generate unique keys', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      const key1 = renderToContainer(document.createElement('div'), 'a', undefined, gridEl);
      const key2 = renderToContainer(document.createElement('div'), 'b', undefined, gridEl);

      expect(key1).not.toBe(key2);
    });
  });

  // #endregion

  // #region renderToContainer — fallback (no PortalManager)

  describe('renderToContainer (fallback, no PortalManager)', () => {
    it('should render content into container using createRoot fallback', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const key = renderToContainer(container, 'fallback content');

      expect(key).toMatch(/^p-\d+$/);
      expect(container.textContent).toBe('fallback content');
    });

    it('should reuse the fallback root on update', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const key = renderToContainer(container, 'first');
      expect(container.textContent).toBe('first');

      renderToContainer(container, 'second', key);
      expect(container.textContent).toBe('second');
    });
  });

  // #endregion

  // #region renderToContainer — fallback-to-portal transition

  describe('renderToContainer (fallback-to-portal transition)', () => {
    it('should clean up fallback root when PortalManager becomes available', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      // First render: no PM available, uses fallback
      const key = renderToContainer(container, 'fallback content');
      expect(container.textContent).toBe('fallback content');

      // Now register a PM
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      // Re-render with same key + explicit gridEl: should switch to PM
      renderToContainer(container, 'portal content', key, gridEl);
      expect(mockManager.renderPortal).toHaveBeenCalledWith(key, container, 'portal content');
    });
  });

  // #endregion

  // #region removeFromContainer

  describe('removeFromContainer', () => {
    it('should call the correct grid portalManager.removePortal', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      const container = document.createElement('div');
      const key = renderToContainer(container, 'content', undefined, gridEl);

      removeFromContainer(key);
      expect(mockManager.removePortal).toHaveBeenCalledWith(key, undefined);
    });

    it('should unmount fallback root when no manager', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const key = renderToContainer(container, 'to remove');
      expect(container.textContent).toBe('to remove');

      // Should not throw
      expect(() => removeFromContainer(key)).not.toThrow();
    });

    it('should handle removing non-existent key gracefully', () => {
      expect(() => removeFromContainer('non-existent')).not.toThrow();
    });

    it('should pass sync option to portalManager.removePortal', () => {
      const gridEl = createMockGrid();
      const mockManager = createMockManager();
      setPortalManager(gridEl, mockManager);

      const container = document.createElement('div');
      const key = renderToContainer(container, 'content', undefined, gridEl);

      removeFromContainer(key, { sync: true });
      expect(mockManager.removePortal).toHaveBeenCalledWith(key, true);
    });
  });

  // #endregion

  // #region Multi-grid isolation

  describe('multi-grid isolation', () => {
    it('should route portals to the correct grid PortalManager', () => {
      const grid1 = createMockGrid();
      const grid2 = createMockGrid();
      const pm1 = createMockManager();
      const pm2 = createMockManager();
      setPortalManager(grid1, pm1);
      setPortalManager(grid2, pm2);

      const container1 = document.createElement('div');
      grid1.appendChild(container1);
      const container2 = document.createElement('div');
      grid2.appendChild(container2);

      renderToContainer(container1, 'grid1-content');
      renderToContainer(container2, 'grid2-content');

      expect(pm1.renderPortal).toHaveBeenCalledTimes(1);
      expect(pm2.renderPortal).toHaveBeenCalledTimes(1);
    });

    it('should not affect other grids when removing portals', () => {
      const grid1 = createMockGrid();
      const grid2 = createMockGrid();
      const pm1 = createMockManager();
      const pm2 = createMockManager();
      setPortalManager(grid1, pm1);
      setPortalManager(grid2, pm2);

      const key1 = renderToContainer(document.createElement('div'), 'a', undefined, grid1);
      renderToContainer(document.createElement('div'), 'b', undefined, grid2);

      removeFromContainer(key1);
      expect(pm1.removePortal).toHaveBeenCalledWith(key1, undefined);
      expect(pm2.removePortal).not.toHaveBeenCalled();
    });

    it('should not affect other grids when clearing containers', () => {
      const grid1 = createMockGrid();
      const grid2 = createMockGrid();
      const pm1 = createMockManager();
      const pm2 = createMockManager();
      setPortalManager(grid1, pm1);
      setPortalManager(grid2, pm2);

      renderToContainer(document.createElement('div'), 'a', undefined, grid1);
      renderToContainer(document.createElement('div'), 'b', undefined, grid2);

      clearContainersForGrid(grid1);
      expect(pm1.clear).toHaveBeenCalled();
      expect(pm2.clear).not.toHaveBeenCalled();
    });
  });

  // #endregion

  // #region clearAllContainers / clearContainersForGrid

  describe('clearAllContainers', () => {
    it('should call clear on all PortalManagers', () => {
      const grid1 = createMockGrid();
      const grid2 = createMockGrid();
      const pm1 = createMockManager();
      const pm2 = createMockManager();
      setPortalManager(grid1, pm1);
      setPortalManager(grid2, pm2);

      clearAllContainers();
      expect(pm1.clear).toHaveBeenCalled();
      expect(pm2.clear).toHaveBeenCalled();
    });

    it('should clear fallback roots', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      renderToContainer(container, 'content');
      expect(() => clearAllContainers()).not.toThrow();
    });
  });

  // #endregion

  // #region createNodeBridge

  describe('createNodeBridge', () => {
    it('should return null when react fn returns null', () => {
      const bridge = createNodeBridge<{ value: number }>(() => null);
      expect(bridge({ value: 1 })).toBeNull();
    });

    it('should return null when react fn returns undefined', () => {
      const bridge = createNodeBridge<{ value: number }>(() => undefined);
      expect(bridge({ value: 1 })).toBeNull();
    });

    it('should return null when react fn returns false', () => {
      const bridge = createNodeBridge<{ value: number }>(() => false);
      expect(bridge({ value: 1 })).toBeNull();
    });

    it('should return a display:contents wrapper element when react fn returns a node', () => {
      const bridge = createNodeBridge<{ label: string }>((ctx) => ctx.label);
      const el = bridge({ label: 'hello' });
      expect(el).not.toBeNull();
      expect(el?.tagName).toBe('DIV');
      expect(el?.style.display).toBe('contents');
    });
  });

  // #endregion
});
