import { describe, expect, it, vi } from 'vitest';
import { getFeatureClaim, isEventClaimed } from '../../../src/lib/internal/feature-claims';
import type { FillHandleConfig } from '@toolbox-web/grid/plugins/fill-handle';

const state = vi.hoisted(() => ({
  element: undefined as HTMLElement | undefined,
  value: true as boolean | FillHandleConfig,
}));
vi.mock('@angular/core', () => ({
  Directive: () => (target: unknown) => target,
  ElementRef: class {},
  inject: () => ({ nativeElement: state.element }),
  input: () => () => state.value,
  output: () => ({ emit: vi.fn() }),
}));
vi.mock('@toolbox-web/grid-angular', async () => import('../../../src/lib/internal/feature-claims'));
import { GridFillHandleDirective } from './grid-fill-handle.directive';

describe('GridFillHandleDirective', () => {
  it('claims the feature and fill events, forwards inputs and outputs, and releases ownership', () => {
    state.element = document.createElement('tbw-grid');
    const directive = new GridFillHandleDirective();
    expect(getFeatureClaim(state.element, 'fillHandle')?.()).toBe(true);
    state.value = { mode: 'copy' };
    expect(getFeatureClaim(state.element, 'fillHandle')?.()).toEqual({ mode: 'copy' });
    directive.ngOnInit();
    expect(isEventClaimed(state.element, 'fill-start')).toBe(true);
    expect(isEventClaimed(state.element, 'fill-complete')).toBe(true);
    const start = new CustomEvent('fill-start', { detail: { direction: 'down' }, cancelable: true });
    state.element.dispatchEvent(start);
    expect(directive.fillStart.emit).toHaveBeenCalledWith(start);
    const detail = { cells: [], limitExceeded: false, canceled: true };
    state.element.dispatchEvent(new CustomEvent('fill-complete', { detail }));
    expect(directive.fillComplete.emit).toHaveBeenCalledWith(detail);
    directive.ngOnDestroy();
    expect(getFeatureClaim(state.element, 'fillHandle')).toBeUndefined();
    expect(isEventClaimed(state.element, 'fill-start')).toBe(false);
    expect(isEventClaimed(state.element, 'fill-complete')).toBe(false);
    state.element.dispatchEvent(new CustomEvent('fill-complete', { detail }));
    expect(directive.fillComplete.emit).toHaveBeenCalledTimes(1);
  });
});
