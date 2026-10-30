import { Directive, ElementRef, inject, input, output, type OnDestroy, type OnInit } from '@angular/core';
import type { DataGridElement } from '@toolbox-web/grid';
import { claimEvent, unclaimEvent, registerFeatureClaim, unregisterFeatureClaim } from '@toolbox-web/grid-angular';
import type { CellClearDetail, CellEntryConfig } from '@toolbox-web/grid/plugins/cell-entry';

/**
 * Owns `[cellEntry]` on `<tbw-grid>`. Editing owns the editor lifecycle.
 * @category Directive
 * @since 2.7.0
 */
@Directive({
  selector: 'tbw-grid[cellEntry], tbw-grid[cellClear]',
  standalone: true,
})
export class GridCellEntryDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<DataGridElement>);

  /** Enable keyboard entry and optionally single-click entry. @since 2.7.0 */
  readonly cellEntry = input<boolean | CellEntryConfig>();

  /** Selected-cell clear outcomes. @since 2.7.0 */
  readonly cellClear = output<CellClearDetail>();

  private readonly onClear = (event: Event) => this.cellClear.emit((event as CustomEvent<CellClearDetail>).detail);

  constructor() {
    registerFeatureClaim(this.elementRef.nativeElement, 'cellEntry', () => this.cellEntry());
    claimEvent(this.elementRef.nativeElement, 'cell-clear');
  }

  ngOnInit(): void {
    this.elementRef.nativeElement.addEventListener('cell-clear', this.onClear);
  }

  ngOnDestroy(): void {
    unregisterFeatureClaim(this.elementRef.nativeElement, 'cellEntry');
    this.elementRef.nativeElement.removeEventListener('cell-clear', this.onClear);
    unclaimEvent(this.elementRef.nativeElement, 'cell-clear');
  }
}
