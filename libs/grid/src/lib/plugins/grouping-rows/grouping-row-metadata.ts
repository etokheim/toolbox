const METADATA = Symbol.for('tbw.grid.grouping-row-metadata');

interface Entry {
  owner: GroupingRowMetadata;
  previous: string | null;
  priority: string;
  value: string;
}

type TrackedElement = HTMLElement & { [METADATA]?: Map<string, Entry> };

/** Compare-and-restore leases for the attributes and styles written by GroupingRows. */
export class GroupingRowMetadata {
  readonly elements = new Set<HTMLElement>();

  set(element: HTMLElement, name: string, value: string): void {
    const tracked = element as TrackedElement;
    const entries = (tracked[METADATA] ??= new Map());
    const previous = entries.get(name);
    const current = this.read(element, name);
    const priority = name.startsWith('--') ? element.style.getPropertyPriority(name) : '';
    const unchanged = previous && current === previous.value && priority === '';
    if (unchanged && previous.owner === this) {
      previous.value = value;
    } else {
      entries.set(name, {
        owner: this,
        previous: unchanged ? previous.previous : current,
        priority: unchanged ? previous.priority : priority,
        value,
      });
      this.elements.add(element);
    }
    if (current !== value || priority !== '') this.write(element, name, value);
  }

  owns(element: HTMLElement, name: string): boolean {
    const entry = (element as TrackedElement)[METADATA]?.get(name);
    return entry?.owner === this && this.read(element, name) === entry.value;
  }

  release(element: HTMLElement): void {
    const tracked = element as TrackedElement;
    const entries = tracked[METADATA];
    if (entries) {
      for (const [name, entry] of entries) {
        if (entry.owner !== this) continue;
        const priority = name.startsWith('--') ? element.style.getPropertyPriority(name) : '';
        if (this.read(element, name) === entry.value && priority === '') {
          this.write(element, name, entry.previous, entry.priority);
        }
        entries.delete(name);
      }
      if (entries.size === 0) delete tracked[METADATA];
    }
    this.elements.delete(element);
  }

  private read(element: HTMLElement, name: string): string | null {
    return name.startsWith('--') ? element.style.getPropertyValue(name) || null : element.getAttribute(name);
  }

  private write(element: HTMLElement, name: string, value: string | null, priority = ''): void {
    if (name.startsWith('--')) element.style.setProperty(name, value ?? '', priority);
    else if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}
