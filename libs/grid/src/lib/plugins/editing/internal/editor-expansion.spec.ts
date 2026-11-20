import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGridElement } from '../../../core/grid';
import type { ColumnConfig } from '../../../core/types';
import { EditingPlugin } from '../editing-plugin';
import { EDITOR_EXPANDED_ATTR, EDITOR_EXPANDED_ROW_ATTR } from './editor-expansion';

type Row = { id: string; a: string; b: string; c: string; d: string };

const COL = 100;
const VIEWPORT = 400;
const CONTENT = 250;
const ROW = 24;
const CONTENT_HEIGHT = 80;
/** Top of the row in the 200px-tall rows viewport. */
let rowTop = 0;

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
      const height = this.style.height === 'max-content' ? CONTENT_HEIGHT : parseFloat(this.style.height) || ROW;
      return new DOMRect(
        base + (parseFloat(this.style.marginLeft) || 0),
        rowTop + (parseFloat(this.style.marginTop) || 0),
        width,
        height,
      );
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
  rowTop = 0;
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('support LTR grids only'));
  });

  it('grows down over the rows below and lifts its row', async () => {
    const { cell, focus } = await setup([{ editorHeight: 100 }, { editorWidth: 200, editorHeight: 'content' }]);
    await focus(0);
    const expanded = cell(0);
    expect(expanded.getAttribute(EDITOR_EXPANDED_ATTR)).toBe('down');
    expect(expanded.style.height).toBe('100px');
    expect(expanded.style.marginTop).toBe('0px');
    // Outer height = height + margins = the 24px row.
    expect(expanded.style.marginBottom).toBe('-76px');
    expect(expanded.style.width).toBe('');
    expect(expanded.parentElement!.hasAttribute(EDITOR_EXPANDED_ROW_ATTR)).toBe(true);
    await focus(1);
    expect(cell(0).style.height).toBe('');
    expect(cell(1).getAttribute(EDITOR_EXPANDED_ATTR)).toBe('right down');
    expect(cell(1).style.height).toBe(`${CONTENT_HEIGHT}px`);
    expect(cell(1).parentElement!.hasAttribute(EDITOR_EXPANDED_ROW_ATTR)).toBe(true);
    await focus(2);
    expect(cell(1).parentElement!.hasAttribute(EDITOR_EXPANDED_ROW_ATTR)).toBe(false);
  });

  it('grows up near the bottom of the rows viewport and clamps to it', async () => {
    rowTop = 160;
    const { cell, focus } = await setup([{ editorHeight: 100 }, { editorHeight: 1000 }]);
    await focus(0);
    expect(cell(0).getAttribute(EDITOR_EXPANDED_ATTR)).toBe('up');
    // Slides up only as far as needed to fit above the viewport bottom (200).
    expect(cell(0).style.marginTop).toBe('-60px');
    expect(cell(0).style.marginBottom).toBe('-16px');
    await focus(1);
    expect(cell(1).style.height).toBe('200px');
    expect(cell(1).style.marginTop).toBe('-160px');
  });

  it('animates the grow and keeps the cell expanded until the shrink finishes', async () => {
    const animations: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void }[] = [];
    HTMLElement.prototype.animate = function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const target = new EventTarget();
      const animation = Object.assign(target, { cancel: vi.fn() }) as unknown as Animation;
      animations.push({ keyframes, options, finish: () => target.dispatchEvent(new Event('finish')) });
      return animation;
    } as HTMLElement['animate'];
    const computed = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      const style = computed(el);
      if (!el.matches('.cell')) return style;
      return {
        getPropertyValue: (name: string) =>
          name === '--tbw-editor-expand-duration' ? '0.12s' : style.getPropertyValue(name),
      } as CSSStyleDeclaration;
    });
    try {
      const { cell, focus } = await setup([{ editorWidth: 250 }]);
      await focus(0);
      expect(animations).toHaveLength(1);
      expect(animations[0].keyframes[0].clipPath).toBe('inset(0px 150px 0px 0px)');
      expect(animations[0].options.duration).toBe(120);
      await focus(1);
      // Shrinking: still laid out wide until the animation ends.
      expect(animations).toHaveLength(2);
      expect(animations[1].keyframes[1].clipPath).toBe('inset(0px 150px 0px 0px)');
      expect(cell(0).style.width).toBe('250px');
      animations[1].finish();
      expect(cell(0).style.width).toBe('');
      expect(cell(0).hasAttribute(EDITOR_EXPANDED_ATTR)).toBe(false);
      expect(cell(0).parentElement!.hasAttribute(EDITOR_EXPANDED_ROW_ATTR)).toBe(false);
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });
});
