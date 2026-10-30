---
domain: grid-input
related: [grid-core, grid-render-pipeline, grid-plugin-selection, grid-plugins-catalog-ui, grid-features]
---

# Grid Input & Pointer — Mental Model

`libs/grid/src/lib/core/internal/`. Pointer modality detection, drag capture/promotion, and the coarse long-press arbitration policy. Touch-input epic **#302**.

- Keyboard nav / focus / a11y → grid-core.md § focus & a11y.
- Wheel + faux-scrollbar plumbing (`touch-scroll.ts#setupWheelScrollListeners`) → grid-render-pipeline.md § virtualization-manager.
- Consumer plugins: Selection, ContextMenu → grid-plugin-selection.md; reorder/DnD → grid-plugins-catalog-ui.md.

Read order for "my gesture doesn't fire on touch": long-press priority policy (is another handler claiming it?) → pointer-drag promotion FLOW → pointer-modality.

## outer mixed-axis wheel (`touch-scroll.ts`)

- DECIDED (local outer-wheel slice): when faux Y has no range, unmodified mixed wheel deltas can move inner X + nearest eligible outer Y once. WHY: Chromium's plain nested-overflow control consumes both axes in the inner scroller; returning without `preventDefault` alone loses outer Y. No public scroll-owner API or consumer forwarding.
- INVARIANT: user-scrollable overflow only; stop at hidden/clip, exhausted contain/none, open dialog/aria-modal; nested scrollable controls keep browser ownership. Only cancel with movable X and eligible Y; pixel/line/page units normalized, noncancelable/default-prevented/zoom modifiers untouched. Pure axes, Shift and faux internal scrolling keep existing paths. Tests: `wheel-scroll.spec.ts`; real-wheel native + plain overflow controls (programmatic offsets cannot prove gesture ownership).

## pointer-modality (`core/internal/pointer-modality.ts`)

- OWNS: `PointerModality` (`'fine' | 'coarse'`), `getPrimaryPointer()`, `onPointerModalityChange(cb)`. **NOT exported from `public.ts`** — internal. `@since 3.5.0`; infra for touch-input epic #302 (#307). Tests: `pointer-modality.spec.ts`.
- INVARIANT: one lazily-created shared `MediaQueryList` for `(pointer: coarse)` — a single OS listener regardless of subscriber count; unsubscribe idempotent (`removed` flag). SSR / happy-dom safe: guard `typeof globalThis.matchMedia !== 'function'` → `'fine'`, and fall back to legacy `addListener`.
- RULE: plugins and features MUST use this module, not `matchMedia` directly.

## row hover (`core/internal/row-hover.ts`)

- DECIDED (2026-10-16, user-approved): row presentation uses `[data-tbw-hovered]`, not browser `:hover`. WHY: Chrome 155 retains stale hover on transform-only fixed rows; ordinary overflow retargets correctly. Recycling is not required. `e2e/tests/row-hover.spec.ts` preserves both controls and the 54-row reduction.
- OWNS: last mouse coordinates, one pending RAF and one marked row per connected grid. READS: one `ownerDocument.elementFromPoint`, nearest grid/row ownership. WRITES: old/new marker; no row scans, geometry loops, focus, selection, capture or synthetic events.
- FLOW: host `Symbol.for('tbw.grid.row.hover')` shares row + change subscribers across core/plugin bundles. Notify after marker writes; clear publishes null, aborted subscribers unsubscribe. `CellExpansion` reads this authority instead of pointerover/out; existing menu > focus > geometric hover arbitration remains plugin-owned. No public event, observer or second hit test. Packaged `row-hover.spec.ts` browser regression covers stationary 1980→1988 action transfer and lease/focus countercases.
- FLOW: passive capture of pointer/scroll → coalesced hit test → marker; `refreshVirtualWindow` + `_schedulerAfterRender` also reconcile rebuilt/recycled DOM. A scroll may reconcile the immediate transform and the final row pass on successive frames; no polling when idle.
- INVARIANT: touch/pen, outside pointer, window exit/blur and disconnect clear state/cancel work. Nested-grid headers and outside overlays cannot mark the underlying outer row. Sticky clone capture strips copied markers; row DOM identity is not occurrence identity.
- INVARIANT: built-in core/group/pivot/card row styles consume the marker under `(hover: hover)`; print suppresses it. Consumer row/action selectors must replace only their row `:hover` predicate, without OR fallback; focus-within/menu-open and hover-none visibility stay independent. Button-local browser hover remains browser-owned.
- TENSION: hit testing is bounded browser geometry work, not free; retain paired browser costs and the existing scroll budget when changing scheduling. No render-epoch, utility-view, portal or scroll-offset ownership changes.

## pointer-drag (`core/internal/pointer-drag.ts`)

- OWNS: `startPointerDrag(startEvent, captureTarget, handlers, options?) => cancelFn`, `PointerDragHandlers` (`onMove`, `onEnd`, `onPromote?`, `onCancel?`), `PointerDragOptions` (`threshold?`, `longPressDuration?`, `longPressSlop?` default 8). **NOT in `public.ts`** — internal. `@since 3.5.0`; #303 created it (not #228), generic for #228 DnD reuse.
- INVARIANT: `setPointerCapture` ONLY — no `document`/`window` `pointermove`/`pointerup`; sole exception is a capture-phase `document` `keydown` for Escape-to-abort. Capture survives virtualization re-renders that would detach the drag source.
- INVARIANT: capture is claimed at **promotion**, never on `pointerdown` — a captured pointer retargets `mouseup`/`click`/`dblclick` to the capture element, killing every `closest()`-based click feature (broke dblclick-to-edit in #303). Capture failure at promotion → `cancel()`.
- INVARIANT: `captureTarget` must be a stable element (the resize _handle_, not the header cell); `ResizeController.start` takes a 4th param `captureTarget?: Element`. Re-entrancy guarded by a module-level `WeakMap<Element, Set<number>>` of active pointerIds. `touch-action: none` is set on the target only inside `onPromote` (never on `pointerdown`, else swipe-to-scroll is swallowed), restored in `onEnd`/`onCancel`.
- INVARIANT: `buildCellMouseEvent` falls back to `document.elementFromPoint` whenever the resolved target has no `[data-col]` ancestor — not merely when outside `renderRoot`, since capture retargets moves to `renderRoot` itself and every move then reports the anchor cell.
- FLOW (promotion): no threshold/long-press → synchronous; `threshold > 0` → first move past distance; `longPressDuration > 0` → timer, and an earlier move beyond `longPressSlop` **cancels the drag** (it was a scroll). `onPromote` fires at all three sites.
- DECIDED (#303, Jul 2026): fine-vs-coarse uses per-event `e.pointerType` (`touch`/`pen` → coarse, `mouse` → fine), not `getPrimaryPointer()`. WHY: hybrid devices (Surface) report `(pointer: coarse)` while a mouse is in use; `getPrimaryPointer()` is only the fallback for synthetic events lacking `pointerType`.
- Consumers: `resize.ts` (column resize), `plugins/shell/shell.ts` (tool-panel splitter), `event-delegation.ts` (cell-range paint, `LONG_PRESS_MS = 400` coarse, `DRAG_THRESHOLD_PX = 3` fine — the threshold keeps plain clicks from capturing). Tests: `pointer-drag.spec.ts` (24), `resize.spec.ts` (8); happy-dom does not route pointer capture, so specs MUST stub `setPointerCapture`/`hasPointerCapture`/`releasePointerCapture` on the capture target and dispatch pointer events **directly on it**.
- INVARIANT: `handlePointerDown` returns early for any non-primary **mouse** button (`e.button !== 0 && pointerType === 'mouse'`), so plugin `onCellMouseDown` NEVER sees a right-click in a browser — `button === 2` branches there are dead code that only unit tests reach (one shipped in Selection until #541). Context-menu behavior MUST hang off the `contextmenu` path (`ContextMenuPlugin`), which every invocation — mouse, long-press, Shift+F10, ContextMenu key — shares.

## long-press priority policy (#307 / touch-input epic #302)

- DECIDED (#307, Jul 2026; implemented #303/#304/#306): coarse long-press order — (1) **header → column header menu** (blocked on #270; falls through to context menu); (2) **row + `SelectionPlugin` `mode: 'row'` → selection mode** (#304); (3) **cell + `SelectionPlugin` `mode: 'cell'|'range'` → range paint** (#303); (4) **otherwise → `ContextMenuPlugin`** (#306). Every future long-press handler MUST honour it — see `apps/docs/src/content/docs/grid/guides/touch-input.mdx` and the `ContextMenuPlugin` JSDoc.
- DECIDED (#306): the fallback is **passive, not a polyfill** — browsers already synthesise `contextmenu` from long-press, so `ContextMenuPlugin` needs no touch code. `handlePointerDown`'s `onPromote` calls `suppressNextContextMenu(renderRoot)` **only when `dispatchDown()` returned true** (a plugin claimed the press), so the default is correct without per-plugin opt-in. `core/internal/event-delegation.ts`.
- INVARIANT: `suppressNextContextMenu` is one-shot and time-boxed (`CONTEXT_MENU_SUPPRESS_MS = 700` vs browser synthesis ~500 ms), registered on `document` **capture phase** so it precedes `ContextMenuPlugin`'s listener (on `.tbw-grid-root`), and removes itself on first event _or_ timeout. It MUST NOT latch — a later right-click must still open the menu. 5 tests in `event-delegation.spec.ts` → `describe('long-press → contextmenu priority (#306)')`; real-browser timing only in `e2e/tests/touch-input.spec.ts` (unrun; happy-dom never synthesises `contextmenu` from touch).
