import { CONFIG_RULE_ERROR, throwDiagnostic } from '../../core/internal/diagnostics';
import type { ExternalHistoryOwner, HistoryChangeDetail } from './types';

/** Attachment-local delegation only. No row data, proposals or history actions are retained. */
export class ExternalHistoryBridge {
  #active = false;
  #busy = false;
  #publishing = false;
  #pending = false;
  #depth = 0;
  #group?: object;
  #unsubscribe?: () => void;
  #state: HistoryChangeDetail = { canUndo: false, canRedo: false };

  constructor(
    private readonly owner: ExternalHistoryOwner,
    private readonly emit: (state: HistoryChangeDetail) => void,
  ) {}

  get pendingGroups(): number {
    return this.#depth;
  }

  get state(): HistoryChangeDetail {
    return this.#state;
  }

  #fail(message: string): never {
    throwDiagnostic(CONFIG_RULE_ERROR, message, undefined, 'undoRedo');
  }

  #assertReady(): void {
    if (!this.#active || this.#busy) this.#fail('External history requires an attached, non-reentrant call.');
  }

  #sync<T>(callback: () => T): T {
    const value = callback();
    if (value && typeof value === 'object' && 'then' in value && typeof value.then === 'function') {
      this.#fail('External history callbacks must be synchronous.');
    }
    return value;
  }

  #call<T>(callback: () => T): T {
    this.#assertReady();
    this.#busy = true;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      const value = this.#sync(callback);
      outcome = { ok: true, value };
    } catch (error) {
      outcome = { ok: false, error };
    } finally {
      this.#busy = false;
    }
    try {
      if (this.#pending && this.#active) this.#flush();
    } catch (error) {
      if (!outcome.ok)
        throw new AggregateError([outcome.error, error], 'External history callback and notification failed.');
      throw error;
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  #notify = (): void => {
    if (!this.#active) return;
    if (this.#publishing) this.#fail('Cannot publish external history recursively from an availability notification.');
    this.#pending = true;
    if (!this.#busy) this.#flush();
  };

  #flush(): void {
    this.#pending = false;
    this.#publishing = true;
    try {
      this.#call(() => {
        const state = this.owner.getState();
        if (!state || typeof state.canUndo !== 'boolean' || typeof state.canRedo !== 'boolean') {
          this.#fail('externalHistory.getState must return boolean canUndo and canRedo.');
        }
        if (!this.#active) return;
        this.#state = { canUndo: state.canUndo, canRedo: state.canRedo };
        this.emit({ ...this.#state });
      });
    } finally {
      this.#publishing = false;
    }
  }

  attach(): void {
    this.#active = true;
    try {
      if (!this.owner || typeof this.owner !== 'object') this.#fail('externalHistory must be an owner object.');
      for (const key of ['request', 'getState', 'subscribe', 'beginGroup', 'endGroup'] as const) {
        if (typeof this.owner[key] !== 'function') this.#fail(`externalHistory.${key} must be a function.`);
      }
      this.#call(() => {
        const unsubscribe = this.owner.subscribe(this.#notify);
        if (typeof unsubscribe !== 'function') this.#fail('externalHistory.subscribe must return cleanup.');
        if (this.#active) this.#unsubscribe = unsubscribe;
        else this.#sync(unsubscribe);
        this.#pending = true;
      });
    } catch (error) {
      try {
        this.detach();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'External history attachment and cleanup failed.');
      }
      throw error;
    }
  }

  request(direction: 'undo' | 'redo'): void {
    this.#assertReady();
    if (this.#depth) this.#fail('Cannot replay external history inside an open group.');
    this.#call(() => this.owner.request(direction));
  }

  begin(): void {
    this.#assertReady();
    if (this.#depth++ > 0) return;
    const token = Object.freeze({});
    this.#group = token;
    try {
      this.#call(() => this.owner.beginGroup(token));
    } catch (error) {
      this.#depth = 0;
      if (this.#group === token) {
        this.#group = undefined;
        try {
          this.#call(() => this.owner.endGroup(token, 'error'));
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'External history group and cleanup failed.');
        }
      }
      throw error;
    }
  }

  end(): void {
    if (!this.#active && this.#depth > 0) {
      this.#depth--;
      return;
    }
    this.#assertReady();
    if (!this.#depth || !this.#group) this.#fail('No external history group is in progress.');
    if (--this.#depth > 0) return;
    const token = this.#group;
    this.#group = undefined;
    this.#call(() => this.owner.endGroup(token, 'complete'));
  }

  detach(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#pending = false;
    this.#state = { canUndo: false, canRedo: false };
    const unsubscribe = this.#unsubscribe;
    const token = this.#group;
    this.#unsubscribe = undefined;
    this.#group = undefined;
    const errors: unknown[] = [];
    try {
      if (unsubscribe) this.#sync(unsubscribe);
    } catch (error) {
      errors.push(error);
    }
    try {
      if (token) this.#sync(() => this.owner.endGroup(token, 'detach'));
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'External history detach cleanup failed.');
  }
}
