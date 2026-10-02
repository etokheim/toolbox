import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerControlCleanup, releaseControl, unregisterControlCleanup } from './control-lifecycle';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('composite cell control cleanup', () => {
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
