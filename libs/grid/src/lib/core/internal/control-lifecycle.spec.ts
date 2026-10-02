import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isControlEvent,
  markControlBoundary,
  ownControlBoundary,
  registerControlCleanup,
  releaseControl,
  unregisterControlCleanup,
} from './control-lifecycle';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('composite cell control cleanup', () => {
  it('classifies an in-flight click after release without claiming another grid or future clicks', () => {
    const grid = document.createElement('div');
    const other = document.createElement('div');
    const host = document.createElement('span');
    const input = document.createElement('input');
    host.append(input);
    grid.append(host);
    document.body.append(grid);
    const release = ownControlBoundary(host, grid);
    const classified: boolean[] = [];
    input.addEventListener('click', release, { once: true });
    grid.addEventListener('click', (event) => {
      classified.push(isControlEvent(event, grid));
      expect(isControlEvent(event, other)).toBe(false);
    });
    input.click();
    host.click();
    expect(classified).toEqual([true, false]);
  });

  it('removes an obsolete lease listener without clearing a successor boundary', () => {
    const grid = document.createElement('div');
    const host = document.createElement('span');
    grid.append(host);
    document.body.append(grid);
    const release = ownControlBoundary(host, grid);
    const successor = ownControlBoundary(host, grid);
    release();
    const classified: boolean[] = [];
    host.addEventListener('click', successor, { once: true });
    grid.addEventListener('click', (event) => classified.push(isControlEvent(event, grid)));
    host.click();
    host.click();
    expect(classified).toEqual([true, false]);
    const obsolete = ownControlBoundary(host, grid);
    markControlBoundary(host, grid);
    obsolete();
    host.click();
    expect(classified).toEqual([true, false, true]);
  });

  it('replaces only the same owner and releases all owners exactly once', () => {
    const cell = document.createElement('div');
    const first = {};
    const second = {};
    const replaced = vi.fn();
    const cleanupFirst = vi.fn(() => unregisterControlCleanup(cell, first));
    const cleanupSecond = vi.fn(() => unregisterControlCleanup(cell, second));
    registerControlCleanup(cell, replaced, first);
    registerControlCleanup(cell, cleanupFirst, first);
    registerControlCleanup(cell, cleanupSecond, second);
    releaseControl(cell);
    releaseControl(cell);
    expect(replaced).not.toHaveBeenCalled();
    expect(cleanupFirst).toHaveBeenCalledTimes(1);
    expect(cleanupSecond).toHaveBeenCalledTimes(1);
  });

  it('unregisters one owner without disposing or unregistering its sibling', () => {
    const cell = document.createElement('div');
    const owner = {};
    const cleanup = vi.fn();
    const sibling = vi.fn();
    registerControlCleanup(cell, cleanup, owner);
    registerControlCleanup(cell, sibling);
    unregisterControlCleanup(cell, owner);
    unregisterControlCleanup(cell, owner);
    expect(cleanup).not.toHaveBeenCalled();
    expect(sibling).not.toHaveBeenCalled();
    releaseControl(cell);
    expect(sibling).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
