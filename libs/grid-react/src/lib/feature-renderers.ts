import type { DataGridElement } from '@toolbox-web/grid';

interface FeatureRendererBridge {
  keys: readonly string[];
  normalize(config: Record<string, unknown>): Record<string, unknown>;
  update(grid: DataGridElement, config: Record<string, unknown>): void;
}

const bridges = new Map<string, FeatureRendererBridge>();

/** Adapter-local bridges; never overrides the shared core feature registry. @internal */
export function registerFeatureRendererBridge(name: string, bridge: FeatureRendererBridge): void {
  bridges.set(name, bridge);
}

export function normalizeFeatureRenderers(features: Record<string, unknown>): Record<string, unknown> {
  const result = { ...features };
  for (const [name, bridge] of bridges) {
    const config = features[name];
    if (config && typeof config === 'object') result[name] = bridge.normalize(config as Record<string, unknown>);
  }
  return result;
}

export function updateFeatureRenderers(grid: DataGridElement, features: Record<string, unknown>): void {
  for (const [name, bridge] of bridges) {
    const config = features[name];
    if (config && typeof config === 'object') bridge.update(grid, config as Record<string, unknown>);
  }
}

function sameConfig(a: unknown, b: unknown, omitted: readonly string[] = []): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!omitted.includes(key) && left[key] !== right[key]) return false;
  return true;
}

/** Only renderer-only changes bypass the normal config rebuild. */
export function sameNonRendererConfig(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as { features?: Record<string, unknown> };
  const right = b as { features?: Record<string, unknown> };
  if (!sameConfig(a, b, ['features'])) return false;
  const names = new Set([...Object.keys(left.features ?? {}), ...Object.keys(right.features ?? {})]);
  for (const name of names) {
    if (!sameConfig(left.features?.[name], right.features?.[name], bridges.get(name)?.keys)) return false;
  }
  return true;
}
