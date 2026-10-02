import { describe, expect, it, vi } from 'vitest';
import { getFeatureClaim } from '../../../src/lib/internal/feature-claims';

const state = vi.hoisted(() => ({
  element: undefined as HTMLElement | undefined,
  value: true as boolean | { singleClick: boolean },
}));
vi.mock('@angular/core', () => ({
  Directive: () => (target: unknown) => target,
  ElementRef: class {},
  inject: () => ({ nativeElement: state.element }),
  input: () => () => state.value,
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
    directive.ngOnDestroy();
    expect(getFeatureClaim(state.element, 'cellEntry')).toBeUndefined();
  });
});
