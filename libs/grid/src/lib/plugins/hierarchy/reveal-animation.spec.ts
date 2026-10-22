import { afterEach, describe, expect, it } from 'vitest';
import { RevealAnimation, stripRevealAnimation } from './reveal-animation';

afterEach(() => document.body.replaceChildren());

describe('reveal animation ownership', () => {
  function fixture() {
    const body = document.createElement('div');
    const row = document.createElement('div');
    const child = document.createElement('span');
    row.append(child);
    body.append(row);
    document.body.append(body);
    const animation = new RevealAnimation();
    animation.apply(row, 'a/item', 'tbw-tree-slide-in');
    return { body, row, child, animation };
  }

  it('retains same-occurrence motion but cancels recycled, removed and disabled owners', () => {
    const { body, row, animation } = fixture();
    animation.reconcile(body, () => 'a/item', true);
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(true);
    animation.reconcile(body, () => 'b/item', true);
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(false);
    animation.apply(row, 'b/item', 'tbw-tree-fade-in');
    row.remove();
    animation.reconcile(body, () => 'b/item', true);
    expect(row.classList.contains('tbw-tree-fade-in')).toBe(false);
    body.append(row);
    animation.apply(row, 'b/item', 'tbw-tree-fade-in');
    animation.reconcile(body, () => 'b/item', false);
    expect(row.classList.contains('tbw-tree-fade-in')).toBe(false);
  });

  it.each(['animationend', 'animationcancel'])('handles own %s but ignores nested and unrelated events', (type) => {
    const { row, child, animation } = fixture();
    const event = (name: string) => Object.assign(new Event(type, { bubbles: true }), { animationName: name });
    child.dispatchEvent(event('tbw-tree-slide-in'));
    row.dispatchEvent(event('spinner'));
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(true);
    row.dispatchEvent(event('tbw-tree-slide-in'));
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(false);
    animation.apply(row, 'a/item', 'tbw-tree-slide-in');
    animation.clear();
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(false);
  });

  it('strips only hierarchy reveal classes from decorative copies', () => {
    const { row } = fixture();
    row.classList.add('tbw-group-slide-in', 'tbw-group-fade-in', 'tbw-tree-fade-in', 'consumer-highlight');
    const clone = row.cloneNode(true) as HTMLElement;
    stripRevealAnimation(clone);
    expect(clone.className).toBe('consumer-highlight');
    expect(row.classList.contains('tbw-tree-slide-in')).toBe(true);
  });
});
