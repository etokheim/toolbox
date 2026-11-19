import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../../core/grid';
import type { ColumnConfig } from '../../../core/types';
import { EditingPlugin } from '../editing-plugin';
import { EDITOR_EXPANDED_ATTR } from './editor-expansion';

type Row = { id: string; a: string; b: string; c: string; d: string };

const COL = 100;
const VIEWPORT = 400;
const CONTENT = 250;

/** Lay out cells as 100px tracks in a 400px scroll area, honouring inline width/margins. */
function mockLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tbw-scroll-area') ? VIEWPORT : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.data-grid-row > .cell[data-col]')) {
      const base = Number(this.getAttribute('data-col')) * COL;
      // An expanded cell without inline width shrink-to-fits (`justify-self: start`).
      const shrunk = this.hasAttribute(EDITOR_EXPANDED_ATTR) && !this.style.width;
      const width = this.style.width === 'max-content' || shrunk ? CONTENT : parseFloat(this.style.width) || COL;
      return new DOMRect(base + (parseFloat(this.style.marginLeft) || 0), 0, width, 24);
    }
    return new DOMRect(0, 0, VIEWPORT, 200);
  });
}

async function setup(columns: Partial<ColumnConfig<Row>>[], dir?: 'rtl') {
  mockLayout();
  const editing = new EditingPlugin<Row>();
  const grid = document.createElement(DataGridElement.activeTag) as DataGridElement<Row>;
  if (dir) grid.setAttribute('dir', dir);
  grid.gridConfig = {
    getRowId: (row) => row.id,
    plugins: [editing],
    columns: (['a', 'b', 'c', 'd'] as const).map((field, i) => ({
      field,
      editable: true,
      width: COL,
      ...columns[i],
    })),
  };
  grid.rows = [{ id: '1', a: 'a', b: 'b', c: 'c', d: 'd' }];
  document.body.append(grid);
  await grid.ready();
  editing.beginBulkEdit(0);
  await settle();
  const cell = (col: number) => grid.querySelector<HTMLElement>(`.data-grid-row > .cell[data-col="${col}"]`)!;
  const focus = async (col: number) => {
    cell(col).querySelector<HTMLElement>('input')!.focus();
    await settle();
  };
  return { grid, editing, cell, focus };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('column.editorWidth', () => {
  it('overlays neighbours to the right without changing the column track', async () => {
    const { grid, cell, focus } = await setup([{ editorWidth: 250 }]);
    const template = grid.style.getPropertyValue('--tbw-column-template');
    await focus(0);
    const expanded = cell(0);
    expect(expanded.getAttribute(EDITOR_EXPANDED_ATTR)).toBe('right');
    expect(expanded.style.width).toBe('250px');
    expect(expanded.style.marginLeft).toBe('0px');
    // Outer size = width + margins = the 100px track.
    expect(expanded.style.marginRight).toBe('-150px');
    expect(grid.style.getPropertyValue('--tbw-column-template')).toBe(template);
  });

  it('stays expanded across re-syncs of a content-width editor', async () => {
    const { grid, cell, focus } = await setup([{ editorWidth: 'content' }]);
    await focus(0);
    expect(cell(0).style.width).toBe(`${CONTENT}px`);
    for (let i = 0; i < 3; i++) {
      grid.dispatchEvent(new FocusEvent('focusin'));
      await settle();
      expect(cell(0).getAttribute(EDITOR_EXPANDED_ATTR)).toBe('right');
      expect(cell(0).style.width).toBe(`${CONTENT}px`);
    }
  });

  it('grows to the left when the right side lacks room', async () => {
    const { cell, focus } = await setup([{}, {}, {}, { editorWidth: 250 }]);
    await focus(3);
    expect(cell(3).getAttribute(EDITOR_EXPANDED_ATTR)).toBe('left');
    expect(cell(3).style.marginLeft).toBe('-150px');
    expect(cell(3).style.marginRight).toBe('0px');
  });

  it('clamps to the scroll area and supports content width', async () => {
    const { cell, focus } = await setup([{ editorWidth: 1000 }, { editorWidth: 'content' }]);
    await focus(0);
    expect(cell(0).style.width).toBe(`${VIEWPORT}px`);
    await focus(1);
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
    expect(cell(0).style.width).toBe('');
    expect(cell(1).style.width).toBe(`${CONTENT}px`);
  });

  it('follows focus between editors and ignores columns without editorWidth', async () => {
    const { cell, focus } = await setup([{ editorWidth: 200 }, {}, { editorWidth: 200 }]);
    await focus(0);
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(true);
    await focus(1);
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
    expect(cell(1).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
    await focus(2);
    expect(cell(2).getAttribute(EDITOR_EXPANDED_ATTR)).toBe('right');
  });

  it('stays expanded while focus is in a registered overlay and collapses when the edit ends', async () => {
    const { grid, editing, cell, focus } = await setup([{ editorWidth: 200 }]);
    await focus(0);
    const overlay = document.createElement('input');
    document.body.append(overlay);
    grid.registerExternalFocusContainer(overlay);
    overlay.focus();
    await settle();
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(true);
    editing.cancelActiveRowEdit();
    await settle();
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
    expect(cell(0).style.width).toBe('');
    expect(cell(0).style.marginRight).toBe('');
  });

  it('collapses when focus leaves to an unrelated element', async () => {
    const { cell, focus } = await setup([{ editorWidth: 200 }]);
    await focus(0);
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    await settle();
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
  });

  it('is disabled in RTL grids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cell, focus } = await setup([{ editorWidth: 200 }], 'rtl');
    await focus(0);
    expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('editorWidth supports LTR grids only'));
  });
});
