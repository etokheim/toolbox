const REVEAL_CLASSES = ['tbw-tree-slide-in', 'tbw-tree-fade-in', 'tbw-group-slide-in', 'tbw-group-fade-in'];

/** Decorative snapshots are not newly revealed logical rows. */
export function stripRevealAnimation(element: HTMLElement): void {
  element.classList.remove(...REVEAL_CLASSES);
}

/** Owns transient reveal state by logical occurrence, never by pooled DOM slot. */
export class RevealAnimation {
  #active = new Map<HTMLElement, { key: unknown; className: string; finish: (event: Event) => void }>();

  reconcile(body: Element | null | undefined, keyOf: (element: HTMLElement) => unknown, enabled: boolean): void {
    for (const [element, state] of this.#active) {
      if (!enabled || element.parentElement !== body || keyOf(element) !== state.key) this.#release(element);
    }
  }

  apply(element: HTMLElement, key: unknown, className: string): void {
    if (this.#active.get(element)?.key === key) return;
    this.#release(element);
    const finish = (event: Event) => {
      if (event.target !== element) return;
      const name = (event as AnimationEvent).animationName;
      if (REVEAL_CLASSES.includes(name)) this.#release(element);
    };
    this.#active.set(element, { key, className, finish });
    element.classList.add(className);
    element.addEventListener('animationend', finish);
    element.addEventListener('animationcancel', finish);
  }

  clear(): void {
    for (const element of this.#active.keys()) this.#release(element);
  }

  #release(element: HTMLElement): void {
    const state = this.#active.get(element);
    if (!state) return;
    element.classList.remove(state.className);
    element.removeEventListener('animationend', state.finish);
    element.removeEventListener('animationcancel', state.finish);
    this.#active.delete(element);
  }
}
