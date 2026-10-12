import { afterEach, describe, expect, it, vi } from 'vitest';
import { releaseControl } from '../../core/internal/control-lifecycle';
import type { PublicGrid } from '../../core/types';
import { GroupingDisclosures } from './grouping-disclosures';
import type { GroupingRowsConfig, GroupingRowsDisclosureContext as Context } from './types';

type State = Omit<Context, 'host' | 'setExpanded'>;

function setup() {
  const grid = document.createElement('div') as PublicGrid & HTMLElement;
  grid.tabIndex = -1;
  const row = document.createElement('div');
  const cell = document.createElement('div');
  row.append(cell);
  grid.append(row);
  document.body.append(grid);
  const initial: State = {
    grid,
    key: 'A',
    value: 'A',
    depth: 0,
    rows: [],
    rowCount: 0,
    ariaLabel: 'Expand group',
    expanded: false,
    disabled: false,
  };
  let state: State | undefined = initial;
  const contexts: Context[] = [];
  const dispose = vi.fn();
  const update = vi.fn((context: Context) => contexts.push(context));
  const renderer = vi.fn((context: Context) => {
    update(context);
    return { element: document.createElement('button'), update, dispose };
  });
  const config: GroupingRowsConfig = { disclosureRenderer: renderer };
  const toggle = vi.fn((_key: string) => {
    if (state) state = { ...state, expanded: !state.expanded };
  });
  const controls = new GroupingDisclosures({
    grid: () => grid,
    config: () => config,
    state: () => state,
    toggle,
    nativeButton: () => document.createElement('button'),
  });
  cell.append(controls.create(initial.key, initial.depth, row, cell, renderer));
  controls.update(row, 0);
  return {
    grid,
    row,
    cell,
    controls,
    initial,
    config,
    toggle,
    dispose,
    update,
    context: contexts[0],
    setState: (next: State | undefined) => (state = next),
    getState: () => state,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('GroupingDisclosures defensive owner-state guards (not user-route reproductions)', () => {
  it.each(['missing', 'key', 'depth'] as const)(
    'rejects an active action with %s projected state, then disposes the stale lease once',
    (kind) => {
      const fixture = setup();
      const { controls, row, cell, initial, context, setState, toggle, dispose, update } = fixture;
      const record = controls.records.get(row)!;
      const projected =
        kind === 'missing' ? undefined : { ...initial, ...(kind === 'key' ? { key: 'B' } : { depth: 1 }) };
      setState(projected);
      expect(record.slot.active).toBe(true);
      expect(record.slot.renderer).toBe(fixture.config.disclosureRenderer);
      expect(context.host.isConnected).toBe(true);
      context.setExpanded(true);
      expect(toggle).not.toHaveBeenCalled();
      expect(fixture.getState()).toBe(projected);
      expect(dispose).not.toHaveBeenCalled();
      controls.update(row);
      expect(update).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(record.slot.active).toBe(false);
      expect(controls.records.has(row)).toBe(false);
      controls.release(row);
      releaseControl(cell);
      controls.releaseAll();
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects an active lease when its owner grid is disconnected, before owner teardown', () => {
    const { grid, row, cell, controls, context, toggle, dispose, getState, initial } = setup();
    const record = controls.records.get(row)!;
    grid.remove();
    expect(record.slot.active).toBe(true);
    expect(grid.contains(row)).toBe(true);
    expect(cell.contains(context.host)).toBe(true);
    context.setExpanded(true);
    expect(toggle).not.toHaveBeenCalled();
    expect(getState()).toBe(initial);
    expect(dispose).not.toHaveBeenCalled();
    controls.releaseAll();
    releaseControl(cell);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
