---
domain: grid-plugin-fill-handle
related: [grid-plugins-editing, grid-plugin-undo-redo, grid-plugin-selection]
---

# FillHandle plugin

Vertical automatic fill from one range Selection. `libs/grid/src/lib/plugins/fill-handle/`.

- Writes/validation → `grid-plugins-editing.md`; history → `grid-plugin-undo-redo.md`; range → `grid-plugin-selection.md`.

## Ownership

- OWNS: handle/preview DOM (`.tbw-fill-handle`, `.tbw-fill-preview` in `.tbw-grid-root`), the fill session (drag/armed/keyboard + `FillBaseline`), series inference (`fill-series.ts`, not public).
- READS FROM: Selection `getSelectedRanges`/`setRanges`, `this.rows` (processed order incl. virtualized rows), `visibleColumns`.
- WRITES TO: Editing's strict bulk path with `source: 'fill'`; UndoRedo `beginTransaction`/`endTransaction` (native or `externalHistory`). Never a second history owner.
- DECIDED: fill shares Editing's strict bulk policy with Clear (`strictBulk = source === 'clear' || source === 'fill'`): `editable` rules, `cell-commit` vetoes and validation reject a cell; accepted cells still write. Fill is never disguised as clear.
- DECIDED: only existing displayed data rows; structural rows (`isStructuralRow`: non-objects, `__isGroupRow`, `__loading`, pivot total/group rows) are skipped silently, rows never appended. >`FILL_CELL_LIMIT` (10,000) target cells rejects the whole fill.
- INVARIANT: conflicts compare against `FillBaseline` — values captured when a target first entered the preview (`extendFillBaseline`, bounded 2× limit). `rebaseFillPlan` returns false if layout/rows/seeds changed, so a stale preview cannot write. API `fill()` baselines at call time.
- DECIDED: keyboard is grid-scoped `Alt+ArrowUp/Down` (Tab is trapped in the grid, so Excel's Ctrl+D-from-anywhere does not map); `hookPriority.onKeyDown: -30`, guarded by `isCellEntryTarget`. Ctrl+Arrow belongs to Selection.
- INVARIANT: handle x is clamped to `.rows-viewport` right − half hit area. WHY: `.faux-vscroll` stacks at `--tbw-z-layer-header` (30) above plugin overlays and covers a right-edge corner; e2e caught clicks landing on `.faux-vscroll-spacer`.
- DECIDED: fill `A11yMessages` keys stay public/customizable, but English defaults live in the plugin (`FILL_MESSAGES` + local `getA11yMessage`); core `DEFAULT_A11Y_MESSAGES` omits them. WHY: core gzip had 62 B headroom; zero core growth.
- DECIDED: dates — lone date +1 day (−1 upward); month/year steps clamp from the FIRST seed (no drift); all-month-end seeds stay month-ends; `Date` uses UTC fields; ISO offsets preserved; locale strings never parsed.
- DECIDED (Nov 2026, Roma): an open ROW edit no longer hides/blocks the handle. Every fill entry (handle pointerdown, handle Enter/Space, `Alt+Arrow`) goes through `#commitAndSource()` → `editing.commitActiveRowEdit()` BEFORE the baseline is captured, so fill reads the committed value; still-editing after commit → no fill. WHY explicit: the handle's `pointerdown.preventDefault()` suppresses the compat `mousedown`, so Editing's click-outside-row commit never fires. Grid-mode editing (`isEditing` always true) still hides the handle. Escape with no session stays Editing's.
- INVARIANT: handle visibility = Selection STATE (`#source()` on `selection-change`), never focus. A host hiding `.selected` via `:not(:focus-within)` CSS desyncs them — use Selection `clearOnOutsideClick` (grid-plugin-selection.md).
- Tests: `fill-series.spec.ts`, `fill-handle.spec.ts`, `e2e/tests/fill-handle.spec.ts` (self-built fixture against `dist/libs/grid`).
