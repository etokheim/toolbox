import { Directive, ElementRef, inject, input, type OnDestroy } from '@angular/core';
import type { DataGridElement } from '@toolbox-web/grid';
import { registerFeatureClaim, unregisterFeatureClaim } from '@toolbox-web/grid-angular';
import type { CellEntryConfig } from '@toolbox-web/grid/plugins/cell-entry';

/**
 * Owns `[cellEntry]` on `<tbw-grid>`. Editing owns the editor lifecycle.
 * @category Directive
 * @since 2.7.0
 */
@Directive({
  selector: 'tbw-grid[cellEntry]',
  standalone: true,
})
export class GridCellEntryDirective implements OnDestroy {
  private readonly elementRef = inject(ElementRef<DataGridElement>);

  /** Enable keyboard entry and optionally single-click entry. @since 2.7.0 */
  readonly cellEntry = input<boolean | CellEntryConfig>();

  constructor() {
    registerFeatureClaim(this.elementRef.nativeElement, 'cellEntry', () => this.cellEntry());
  }

  ngOnDestroy(): void {
    unregisterFeatureClaim(this.elementRef.nativeElement, 'cellEntry');
  }
}
