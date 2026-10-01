import { bench, describe } from 'vitest';
import type { ControlRenderer } from '../../core/types';
import { CheckboxControls } from './checkbox-controls';

interface Context {
  checked: boolean;
}

describe('checkbox controls: 50 visible rows', () => {
  for (const persistent of [false, true]) {
    const grid = document.createElement('div');
    const controls = new CheckboxControls<Context>();
    const cells = Array.from({ length: 50 }, () => document.createElement('div'));
    grid.append(...cells);
    let checked = false;
    const renderer: ControlRenderer<Context> = (ctx) => {
      const element = document.createElement('input');
      element.type = 'checkbox';
      element.checked = ctx.checked;
      return persistent
        ? {
            element,
            update: (next) => {
              element.checked = next.checked;
            },
          }
        : element;
    };
    const render = (cell: HTMLElement, index: number) => {
      const element = controls.render(
        grid,
        cell,
        index,
        renderer,
        () => ({ checked }),
        () => document.createElement('input'),
      );
      if (element.parentElement !== cell) cell.replaceChildren(element);
      controls.commit(cell);
    };
    cells.forEach(render);
    bench(persistent ? 'persistent view state update' : 'DOM replacement state update', () => {
      checked = !checked;
      cells.forEach(render);
    });
  }
});
