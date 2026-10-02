/** Opt-in single-cell activation. Requires Editing in manual row mode and cell/range Selection.
 * @since 3.9.0
 */
export interface CellEntryConfig {
  /**
   * A plain primary click selects and edits one cell. Modified clicks, range
   * drags, long presses and interactive controls remain selection/native actions.
   * Keyboard Enter/F2 entry is available whenever CellEntry is enabled.
   * @default false
   * @since 3.9.0
   */
  singleClick?: boolean;
}
