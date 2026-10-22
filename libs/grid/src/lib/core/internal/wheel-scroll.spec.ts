import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupWheelScrollListeners } from './touch-scroll';

describe('outer mixed-axis wheel ownership', () => {
  let outer: HTMLElement;
  let boundary: HTMLElement;
  let host: HTMLElement;
  let area: HTMLElement;
  let content: HTMLElement;
  let faux: HTMLElement;
  let abort: AbortController;

  function size(element: HTMLElement, values: Record<string, number>) {
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(element, key, { configurable: true, value });
  }

  function wheel(init: WheelEventInit = {}, target = content) {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      composed: true,
      cancelable: true,
      deltaX: 80,
      deltaY: 120,
      ...init,
    });
    // happy-dom's WheelEvent does not initialize modifier flags.
    for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      Object.defineProperty(event, key, { value: init[key] ?? false });
    }
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    outer = document.createElement('div');
    boundary = document.createElement('div');
    host = document.createElement('tbw-grid');
    area = document.createElement('div');
    content = document.createElement('div');
    faux = document.createElement('div');
    outer.style.overflowY = 'auto';
    area.style.overflowX = 'auto';
    content.style.lineHeight = '20px';
    outer.append(boundary);
    boundary.append(host);
    host.append(area, faux);
    area.append(content);
    document.body.append(outer);
    size(outer, { clientHeight: 400, scrollHeight: 1400 });
    size(area, { clientWidth: 600, scrollWidth: 1600 });
    size(faux, { clientHeight: 400, scrollHeight: 400 });
    abort = new AbortController();
    setupWheelScrollListeners(content, { fauxScrollbar: faux, scrollArea: area }, abort.signal);
  });

  afterEach(() => {
    abort.abort();
    outer.remove();
  });

  it.each([
    [300, 120],
    [80, 120],
    [-80, -120],
  ])('splits (%s, %s) once without dominant-axis loss', (x, y) => {
    area.scrollLeft = 200;
    outer.scrollTop = 200;
    expect(wheel({ deltaX: x, deltaY: y }).defaultPrevented).toBe(true);
    expect(area.scrollLeft).toBe(200 + x);
    expect(outer.scrollTop).toBe(200 + y);
    expect(faux.scrollTop).toBe(0);
  });

  it.each([1, 2])('normalizes deltaMode %s using line/page dimensions', (deltaMode) => {
    expect(wheel({ deltaX: 1, deltaY: 1, deltaMode }).defaultPrevented).toBe(true);
    expect(area.scrollLeft).toBe(deltaMode === 1 ? 20 : 600);
    expect(outer.scrollTop).toBe(deltaMode === 1 ? 20 : 400);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('leaves %s gestures to the browser', (key) => {
    expect(wheel({ [key]: true }).defaultPrevented).toBe(false);
    expect(area.scrollLeft).toBe(0);
    expect(outer.scrollTop).toBe(0);
  });

  it('preserves Shift horizontal scrolling and pure vertical native chaining', () => {
    expect(wheel({ shiftKey: true, deltaX: 0 }).defaultPrevented).toBe(true);
    expect(area.scrollLeft).toBe(120);
    expect(outer.scrollTop).toBe(0);
    expect(wheel({ deltaX: 0 }).defaultPrevented).toBe(false);
  });

  it('preserves internal dominant-axis handling when faux vertical scrolling exists', () => {
    size(faux, { scrollHeight: 1000 });
    expect(wheel().defaultPrevented).toBe(true);
    expect(faux.scrollTop).toBe(120);
    expect(area.scrollLeft).toBe(0);
    expect(outer.scrollTop).toBe(0);
  });

  it.each(['hidden', 'clip'])('does not forward through overflow:%s', (overflow) => {
    boundary.style.overflowY = overflow;
    expect(wheel().defaultPrevented).toBe(false);
    expect(outer.scrollTop).toBe(0);
  });

  it.each(['contain', 'none'])('honors an exhausted intermediate %s boundary', (overscroll) => {
    boundary.style.overflowY = 'auto';
    boundary.style.overscrollBehaviorY = overscroll;
    size(boundary, { clientHeight: 200, scrollHeight: 400 });
    boundary.scrollTop = 200;
    expect(wheel().defaultPrevented).toBe(false);
    expect(outer.scrollTop).toBe(0);
    boundary.scrollTop = 0;
    expect(wheel().defaultPrevented).toBe(true);
    expect(boundary.scrollTop).toBe(120);
    expect(outer.scrollTop).toBe(0);
  });

  it('does not route outside an aria-modal boundary', () => {
    boundary.setAttribute('aria-modal', 'true');
    expect(wheel().defaultPrevented).toBe(false);
    expect(outer.scrollTop).toBe(0);
  });

  it('does not steal from a nested scrollable editor, even at its limit', () => {
    const editor = document.createElement('textarea');
    editor.style.overflowY = 'auto';
    size(editor, { clientHeight: 40, scrollHeight: 200 });
    content.append(editor);
    for (const offset of [0, 160]) {
      editor.scrollTop = offset;
      expect(wheel({}, editor).defaultPrevented).toBe(false);
      expect(area.scrollLeft).toBe(0);
      expect(outer.scrollTop).toBe(0);
    }
  });

  it('leaves no-owner, exhausted-X and noncancelable cases to the browser', () => {
    outer.style.overflowY = 'visible';
    expect(wheel().defaultPrevented).toBe(false);
    outer.style.overflowY = 'auto';
    area.scrollLeft = 1000;
    expect(wheel().defaultPrevented).toBe(false);
    area.scrollLeft = 0;
    expect(wheel({ cancelable: false }).defaultPrevented).toBe(false);
    expect(area.scrollLeft).toBe(0);
    expect(outer.scrollTop).toBe(0);
  });

  it('cleans up when listeners are aborted', () => {
    abort.abort();
    expect(wheel().defaultPrevented).toBe(false);
    expect(area.scrollLeft).toBe(0);
  });

  it('honors containment on the horizontal scroller itself', () => {
    area.style.overscrollBehaviorY = 'contain';
    expect(wheel().defaultPrevented).toBe(false);
    expect(outer.scrollTop).toBe(0);
  });

  it('finds an owner across a consumer shadow root', () => {
    const shell = document.createElement('div');
    boundary.append(shell);
    shell.attachShadow({ mode: 'open' }).append(host);
    expect(wheel().defaultPrevented).toBe(true);
    expect(outer.scrollTop).toBe(120);
  });

  it('honors an open dialog boundary', () => {
    const dialog = document.createElement('dialog');
    dialog.open = true;
    boundary.append(dialog);
    dialog.append(host);
    expect(wheel().defaultPrevented).toBe(false);
    expect(outer.scrollTop).toBe(0);
  });

  it('recognizes version-suffixed grid hosts through the public marker', () => {
    const alternate = document.createElement('tbw-grid-v-next');
    alternate.setAttribute('data-tbw-grid', '');
    boundary.append(alternate);
    alternate.append(area, faux);
    host.remove();
    expect(wheel().defaultPrevented).toBe(true);
    expect(outer.scrollTop).toBe(120);
  });
});
