import { describe, expect, it } from 'vitest';
import { GroupingRowMetadata } from './grouping-row-metadata';

describe('GroupingRows metadata ownership', () => {
  it('restores pre-existing values and style priority without touching unowned row semantics', () => {
    const metadata = new GroupingRowMetadata();
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-level', '7');
    row.setAttribute('aria-selected', 'true');
    row.style.setProperty('--tbw-group-depth', '4', 'important');
    metadata.set(row, 'aria-level', '1');
    metadata.set(row, 'aria-level', '2');
    metadata.set(row, 'aria-level', '2');
    metadata.set(row, '--tbw-group-depth', '0');
    metadata.set(row, '--tbw-group-indent-width', '16px');
    expect(row.getAttribute('aria-level')).toBe('2');
    expect(row.style.getPropertyPriority('--tbw-group-depth')).toBe('');
    metadata.release(row);
    metadata.release(row);
    expect(row.getAttribute('role')).toBe('row');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.getAttribute('aria-level')).toBe('7');
    expect(row.style.getPropertyValue('--tbw-group-depth')).toBe('4');
    expect(row.style.getPropertyPriority('--tbw-group-depth')).toBe('important');
    expect(row.style.getPropertyValue('--tbw-group-indent-width')).toBe('');
    expect(metadata.elements.size).toBe(0);
  });

  it('cannot release a successor lease even when its value is identical', () => {
    const previous = new GroupingRowMetadata();
    const successor = new GroupingRowMetadata();
    const row = document.createElement('div');
    previous.set(row, 'aria-expanded', 'true');
    successor.set(row, 'aria-expanded', 'true');
    expect(previous.owns(row, 'aria-expanded')).toBe(false);
    expect(successor.owns(row, 'aria-expanded')).toBe(true);
    previous.release(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    successor.release(row);
    expect(row.hasAttribute('aria-expanded')).toBe(false);
  });

  it('leaves subsequently replaced attributes and style priorities intact', () => {
    const metadata = new GroupingRowMetadata();
    const row = document.createElement('div');
    metadata.set(row, 'aria-level', '1');
    metadata.set(row, 'aria-expanded', 'true');
    metadata.set(row, '--tbw-group-depth', '0');
    row.setAttribute('aria-level', '9');
    row.removeAttribute('aria-expanded');
    row.style.setProperty('--tbw-group-depth', '0', 'important');
    expect(metadata.owns(row, 'aria-level')).toBe(false);
    metadata.release(row);
    expect(row.getAttribute('aria-level')).toBe('9');
    expect(row.hasAttribute('aria-expanded')).toBe(false);
    expect(row.style.getPropertyValue('--tbw-group-depth')).toBe('0');
    expect(row.style.getPropertyPriority('--tbw-group-depth')).toBe('important');
  });

  it('restores the latest external value if grouping subsequently writes again', () => {
    const metadata = new GroupingRowMetadata();
    const row = document.createElement('div');
    metadata.set(row, 'aria-level', '1');
    row.setAttribute('aria-level', '8');
    metadata.set(row, 'aria-level', '2');
    metadata.release(row);
    expect(row.getAttribute('aria-level')).toBe('8');
  });
});
