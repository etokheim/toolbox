import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHoveredRow, observeRowHover, setupRowHover } from './row-hover';

describe('row hover presentation', () => {
  let host: HTMLElement;
  let first: HTMLElement;
  let second: HTMLElement;
  let controller: AbortController;
  let hit: Element | null;
  let sync: () => void;
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  function frame(): void {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  }
  function move(target: Element, pointerType = 'mouse'): PointerEvent {
    const event = new PointerEvent('pointermove', { bubbles: true, clientX: 20, clientY: 30, pointerType });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    frames = new Map();
    nextId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    host = document.createElement('div');
    host.setAttribute('data-tbw-grid', '');
    first = document.createElement('div');
    second = document.createElement('div');
    first.className = second.className = 'data-grid-row';
    host.append(first, second);
    document.body.append(host);
    hit = first;
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => hit);
    controller = new AbortController();
    sync = setupRowHover(host, controller.signal);
  });

  afterEach(() => {
    controller.abort();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('rejects a document without a window', () => {
    vi.spyOn(document, 'defaultView', 'get').mockReturnValue(null);
    expect(() => setupRowHover(host, controller.signal)).toThrow('Row hover requires a document with a window.');
  });

  it('notifies internal subscribers only after marker ownership changes and removes aborted subscriptions', () => {
    const subscription = new AbortController();
    const seen: (HTMLElement | null)[] = [];
    observeRowHover(
      host,
      () => {
        const row = getHoveredRow(host);
        if (row) expect(row.hasAttribute('data-tbw-hovered')).toBe(true);
        seen.push(row);
      },
      subscription.signal,
    );
    move(first);
    frame();
    sync();
    frame();
    expect(seen).toEqual([first]);
    hit = second;
    sync();
    frame();
    controller.abort();
    expect(seen).toEqual([first, second, null]);
    subscription.abort();
    const listener = vi.fn();
    observeRowHover(host, listener, subscription.signal);
    const nextController = new AbortController();
    setupRowHover(host, nextController.signal);
    move(first);
    frame();
    expect(seen).toEqual([first, second, null]);
    expect(listener).not.toHaveBeenCalled();
    nextController.abort();
  });

  it('does no hit testing until a mouse is observed and coalesces invalidations', () => {
    sync();
    document.dispatchEvent(new Event('scroll'));
    frame();
    expect(document.elementFromPoint).not.toHaveBeenCalled();
    move(first);
    sync();
    sync();
    frame();
    expect(document.elementFromPoint).toHaveBeenCalledExactlyOnceWith(20, 30);
    expect(first.hasAttribute('data-tbw-hovered')).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('retargets after scrolling without relying on a new pointer event or row identity', () => {
    move(first);
    frame();
    hit = second;
    host.dispatchEvent(new Event('scroll'));
    frame();
    expect(first.hasAttribute('data-tbw-hovered')).toBe(false);
    expect(second.hasAttribute('data-tbw-hovered')).toBe(true);
  });

  it('restores the marker after same-element rebuild and clears detached owners', () => {
    move(first);
    frame();
    first.removeAttribute('data-tbw-hovered');
    sync();
    frame();
    expect(first.hasAttribute('data-tbw-hovered')).toBe(true);
    first.remove();
    hit = second;
    sync();
    frame();
    expect(first.hasAttribute('data-tbw-hovered')).toBe(false);
    expect(second.hasAttribute('data-tbw-hovered')).toBe(true);
  });

  it('ignores nested grids and overlays instead of assigning their hover to an ancestor row', () => {
    move(first);
    frame();
    const nested = document.createElement('div');
    nested.setAttribute('data-tbw-grid', '');
    const nestedRow = document.createElement('div');
    nestedRow.className = 'data-grid-row';
    nested.append(nestedRow);
    first.append(nested);
    hit = nestedRow;
    sync();
    frame();
    expect(host.querySelectorAll('[data-tbw-hovered]')).toHaveLength(0);
    const nestedHeader = document.createElement('div');
    nested.append(nestedHeader);
    hit = nestedHeader;
    sync();
    frame();
    expect(host.querySelectorAll('[data-tbw-hovered]')).toHaveLength(0);
    hit = document.body;
    sync();
    frame();
    expect(host.querySelectorAll('[data-tbw-hovered]')).toHaveLength(0);
  });

  it.each(['touch', 'pen'])('clears mouse hover for %s input', (pointerType) => {
    move(first);
    frame();
    move(second, pointerType);
    sync();
    frame();
    expect(host.querySelectorAll('[data-tbw-hovered]')).toHaveLength(0);
  });

  it('observes stopped control events without changing focus, cancellation or propagation', () => {
    const button = document.createElement('button');
    first.append(button);
    button.focus();
    button.addEventListener('pointermove', (event) => event.stopPropagation());
    hit = button;
    const event = move(button);
    frame();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(first.hasAttribute('data-tbw-hovered')).toBe(true);
  });

  it.each(['outside', 'blur', 'abort', 'cancel'])('cleans up on %s', (reason) => {
    move(first);
    frame();
    sync();
    if (reason === 'outside') move(document.body);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'abort') controller.abort();
    if (reason === 'cancel') first.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    frame();
    expect(first.hasAttribute('data-tbw-hovered')).toBe(false);
    expect(frames.size).toBe(0);
    if (reason === 'abort') {
      move(second);
      sync();
      expect(frames.size).toBe(0);
    }
  });
});
