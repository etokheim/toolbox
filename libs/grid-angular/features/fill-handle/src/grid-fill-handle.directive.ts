import { Directive, ElementRef, inject, input, output, type OnDestroy, type OnInit } from '@angular/core';
import type { DataGridElement } from '@toolbox-web/grid';
import { claimEvent, unclaimEvent, registerFeatureClaim, unregisterFeatureClaim } from '@toolbox-web/grid-angular';
import type { FillCompleteDetail, FillHandleConfig, FillStartDetail } from '@toolbox-web/grid/plugins/fill-handle';

const EVENTS = ['fill-start', 'fill-complete'] as const;

/**
 * Owns `[fillHandle]`, `(fillStart)` and `(fillComplete)` on `<tbw-grid>`.
 * Requires range Selection, Editing and UndoRedo.
 * @category Directive
 * @since 2.7.0
 */
@Directive({
  selector: 'tbw-grid[fillHandle], tbw-grid[fillStart], tbw-grid[fillComplete]',
  standalone: true,
})
export class GridFillHandleDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<DataGridElement>);

  /** Enable vertical automatic fill. @since 2.7.0 */
  readonly fillHandle = input<boolean | FillHandleConfig>();

  /** Cancelable notification before a fill writes; call `preventDefault()` on the event to cancel. @since 2.7.0 */
  readonly fillStart = output<CustomEvent<FillStartDetail>>();

  /** Fill outcomes, cancellation or oversized-action rejection. @since 2.7.0 */
  readonly fillComplete = output<FillCompleteDetail>();

  private readonly onStart = (event: Event) => this.fillStart.emit(event as CustomEvent<FillStartDetail>);
  private readonly onComplete = (event: Event) =>
    this.fillComplete.emit((event as CustomEvent<FillCompleteDetail>).detail);

  constructor() {
    const element = this.elementRef.nativeElement;
    registerFeatureClaim(element, 'fillHandle', () => this.fillHandle());
    for (const type of EVENTS) claimEvent(element, type);
  }

  ngOnInit(): void {
    this.elementRef.nativeElement.addEventListener('fill-start', this.onStart);
    this.elementRef.nativeElement.addEventListener('fill-complete', this.onComplete);
  }

  ngOnDestroy(): void {
    const element = this.elementRef.nativeElement;
    unregisterFeatureClaim(element, 'fillHandle');
    element.removeEventListener('fill-start', this.onStart);
    element.removeEventListener('fill-complete', this.onComplete);
    for (const type of EVENTS) unclaimEvent(element, type);
  }
}
