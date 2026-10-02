import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlSlot } from './control-view';

describe('ControlSlot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function setup() {
    const grid = document.createElement('div');
    grid.tabIndex = 0;
    const host = document.createElement('span');
    grid.append(host);
    document.body.append(grid);
    return { grid, host };
  }

  it('mounts persistent views once and updates without losing focus', () => {
    const { grid, host } = setup();
    const element = document.createElement('button');
    const update = vi.fn();
    const dispose = vi.fn();
    const renderer = vi.fn(() => ({ element, update, dispose }));
    const slot = new ControlSlot(host, renderer, grid);
    slot.update(1);
    element.focus();
    slot.update(2);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(2);
    expect(document.activeElement).toBe(element);
    slot.dispose();
    slot.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(grid);
    expect(slot.active).toBe(false);
  });

  it('replaces DOM outputs and respects empty null output', () => {
    const { grid, host } = setup();
    const first = document.createElement('button');
    const second = document.createElement('button');
    const renderer = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValue(null);
    const slot = new ControlSlot(host, renderer, grid);
    slot.update(1);
    slot.update(2);
    expect(host.firstElementChild).toBe(second);
    slot.update(3);
    expect(host.children).toHaveLength(0);
    expect(renderer).toHaveBeenCalledTimes(3);
  });

  it('reports update and disposal exceptions and invalidates the view', () => {
    const { grid, host } = setup();
    const warning = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const dispose = vi.fn(() => {
      throw new Error('dispose');
    });
    const slot = new ControlSlot(
      host,
      () => ({
        element: document.createElement('button'),
        update() {
          throw new Error('update');
        },
        dispose,
      }),
      grid,
    );
    slot.update(1);
    slot.update(2);
    slot.update(3);
    slot.dispose();
    expect(slot.active).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(host.children).toHaveLength(0);
  });
});
