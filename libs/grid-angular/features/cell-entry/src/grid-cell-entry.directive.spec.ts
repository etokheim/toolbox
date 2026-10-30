import { describe, expect, it, vi } from 'vitest';
import { getFeatureClaim, isEventClaimed } from '../../../src/lib/internal/feature-claims';
import type { CellEntryConfig } from '@toolbox-web/grid/plugins/cell-entry';

const state = vi.hoisted(() => ({
  element: undefined as HTMLElement | undefined,
  value: true as boolean | CellEntryConfig,
}));
vi.mock('@angular/core', () => ({
  Directive: () => (target: unknown) => target,
  ElementRef: class {},
  inject: () => ({ nativeElement: state.element }),
  input: () => () => state.value,
  output: () => ({ emit: vi.fn() }),
}));
vi.mock('@toolbox-web/grid-angular', async () => import('../../../src/lib/internal/feature-claims'));
import { GridCellEntryDirective } from './grid-cell-entry.directive';

describe('GridCellEntryDirective', () => {
  it('claims the feature, forwards boolean/object inputs, and releases ownership', () => {
    state.element = document.createElement('tbw-grid');
    const directive = new GridCellEntryDirective();
    expect(getFeatureClaim(state.element, 'cellEntry')?.()).toBe(true);
    state.value = { singleClick: true };
    expect(getFeatureClaim(state.element, 'cellEntry')?.()).toEqual({ singleClick: true });
    state.value = { clearOnDelete: true };
    expect(getFeatureClaim(state.element, 'cellEntry')?.()).toEqual({ clearOnDelete: true });
    directive.ngOnInit();
    const detail = { cells: [], limitExceeded: true };
    expect(isEventClaimed(state.element, 'cell-clear')).toBe(true);
    state.element.dispatchEvent(new CustomEvent('cell-clear', { detail }));
    expect(directive.cellClear.emit).toHaveBeenCalledWith(detail);
    directive.ngOnDestroy();
    expect(getFeatureClaim(state.element, 'cellEntry')).toBeUndefined();
    expect(isEventClaimed(state.element, 'cell-clear')).toBe(false);
    state.element.dispatchEvent(new CustomEvent('cell-clear', { detail }));
    expect(directive.cellClear.emit).toHaveBeenCalledTimes(1);
  });
});
