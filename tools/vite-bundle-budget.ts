import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { measureBundles, type BundleSize } from './bundle-size.ts';

export interface BudgetEntry {
  /** Path pattern relative to outDir. Use `*` for single-level directory wildcard. */
  path: string;
  /** Maximum raw file size in bytes (hard fail) */
  maxSize?: number;
  /** Maximum gzip compressed size in bytes (hard fail) */
  maxGzip?: number;
  /** Soft raw size threshold — emits a warning but does not fail the build */
  warnSize?: number;
  /** Soft gzip size threshold — emits a warning but does not fail the build */
  warnGzip?: number;
}

/**
 * Assertion that a built file does NOT contain certain string tokens — used to
 * prove a tree-shaken module (e.g. an opt-in plugin) left no trace in core.
 * Prefer non-manglable signals (string literals such as CSS class names) over
 * class identifiers, which terser may rename.
 */
export interface ForbiddenSymbolsEntry {
  /** Path pattern relative to outDir. Same glob semantics as {@link BudgetEntry.path}. */
  path: string;
  /** String tokens that MUST NOT appear in the matched file(s). */
  symbols: string[];
  /** Optional human-readable reason, surfaced in the violation message. */
  reason?: string;
}

export interface BundleBudgetOptions {
  /** Absolute path to the build output directory */
  outDir: string;
  /** Budget definitions to enforce */
  budgets: BudgetEntry[];
  /** Symbol-absence assertions (e.g. ensure a tree-shaken plugin left no trace in core) */
  forbiddenSymbols?: ForbiddenSymbolsEntry[];
  /** 'error' (default) fails the build; 'warn' logs a warning */
  severity?: 'error' | 'warn';
}

export interface BudgetCheckResult {
  /** Hard-fail messages (maxSize/maxGzip exceeded) */
  violations: string[];
  /** Soft-warn messages (warnSize/warnGzip exceeded but under hard limit) */
  warnings: string[];
  /** Exact measurements and the authoritative compressor version. */
  measurements: ReturnType<typeof measureBundles>;
}

/** Compare exact bytes; equality is within budget. Display rounding never decides acceptance. */
export function checkSizeBudget(
  path: string,
  size: Pick<BundleSize, 'raw' | 'gzip'>,
  budget: BudgetEntry,
): Pick<BudgetCheckResult, 'violations' | 'warnings'> {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (budget.maxSize != null && size.raw > budget.maxSize) {
    violations.push(`${path}: ${fmt(size.raw)} exceeds budget of ${fmt(budget.maxSize)}`);
  } else if (budget.warnSize != null && size.raw > budget.warnSize) {
    warnings.push(`${path}: ${fmt(size.raw)} approaching budget (warn at ${fmt(budget.warnSize)})`);
  }
  if (budget.maxGzip != null && size.gzip > budget.maxGzip) {
    violations.push(`${path}: ${fmt(size.gzip)} gzipped exceeds budget of ${fmt(budget.maxGzip)}`);
  } else if (budget.warnGzip != null && size.gzip > budget.warnGzip) {
    warnings.push(`${path}: ${fmt(size.gzip)} gzipped approaching budget (warn at ${fmt(budget.warnGzip)})`);
  }
  return { violations, warnings };
}

/**
 * Check bundle sizes against configured budgets.
 * Returns hard violations and soft warnings separately.
 */
export function checkBudgets(options: BundleBudgetOptions): BudgetCheckResult {
  const { outDir, budgets } = options;
  const violations: string[] = [];
  const warnings: string[] = [];
  const matchedBudgets = budgets.map((budget) => ({ budget, files: resolveGlob(outDir, budget.path) }));
  const measurements = measureBundles([...new Set(matchedBudgets.flatMap(({ files }) => files))]);
  const sizes = new Map(measurements.files.map((file) => [file.path, file]));

  for (const { budget, files } of matchedBudgets) {
    if (files.length === 0) {
      violations.push(`No files matched pattern "${budget.path}"`);
      continue;
    }

    for (const filePath of files) {
      const rel = relative(outDir, filePath).replace(/\\/g, '/');
      const size = sizes.get(filePath);
      if (!size) throw new Error(`Missing bundle measurement for ${filePath}`);
      const result = checkSizeBudget(rel, size, budget);
      violations.push(...result.violations);
      warnings.push(...result.warnings);
    }
  }

  for (const rule of options.forbiddenSymbols ?? []) {
    const files = resolveGlob(outDir, rule.path);
    if (files.length === 0) {
      violations.push(`No files matched pattern "${rule.path}"`);
      continue;
    }

    for (const filePath of files) {
      const rel = relative(outDir, filePath).replace(/\\/g, '/');
      const content = readFileSync(filePath, 'utf8');
      for (const symbol of rule.symbols) {
        if (content.includes(symbol)) {
          violations.push(`${rel}: must not contain "${symbol}"${rule.reason ? ` — ${rule.reason}` : ''}`);
        }
      }
    }
  }

  return { violations, warnings, measurements };
}

/**
 * Vite plugin that validates bundle sizes against configured budgets.
 * Runs in closeBundle so all sub-builds (plugins, features, UMD) are complete.
 */
export function bundleBudget(options: BundleBudgetOptions): Plugin {
  return {
    name: 'bundle-budget',
    apply: 'build',
    closeBundle() {
      const { violations, warnings, measurements } = checkBudgets(options);
      const severity = options.severity ?? 'error';
      console.log(`Bundle budget authority: Bun ${measurements.bunVersion}, node:zlib gzipSync defaults`);
      for (const file of measurements.files) {
        console.log(`${relative(options.outDir, file.path)}: ${file.raw} B raw, ${file.gzip} B gzip`);
      }

      if (warnings.length > 0) {
        const msg = `\nBundle budget warnings:\n${warnings.map((w) => `  ⚠ ${w}`).join('\n')}\n`;
        console.warn(`\x1b[33m${msg}\x1b[0m`);
      }

      if (violations.length > 0) {
        const msg = `\nBundle budget exceeded:\n${violations.map((v) => `  ✗ ${v}`).join('\n')}\n`;
        if (severity === 'warn') {
          console.warn(`\x1b[33m${msg}\x1b[0m`);
        } else {
          throw new Error(msg);
        }
      } else if (warnings.length === 0) {
        console.log('\n\x1b[32m✓ All bundle budgets passed\x1b[0m');
      }
    },
  };
}

// #region Helpers

const KB = 1024;

/** Format bytes as a human-readable string */
function fmt(bytes: number): string {
  return bytes < KB ? `${bytes} B` : `${bytes} B (${(bytes / KB).toFixed(1)} KiB)`;
}

/**
 * Resolve a path pattern with `*` wildcards against the filesystem.
 * Only supports `*` as a single directory-level wildcard (not `**`).
 */
function resolveGlob(baseDir: string, pattern: string): string[] {
  return walk(baseDir, pattern.split('/'));
}

function walk(dir: string, parts: string[]): string[] {
  if (parts.length === 0) return [];

  const [current, ...rest] = parts;

  if (current === '*') {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      if (rest.length === 0) {
        return entries.filter((e) => e.isFile()).map((e) => resolve(dir, e.name));
      }
      return entries.filter((e) => e.isDirectory()).flatMap((e) => walk(resolve(dir, e.name), rest));
    } catch {
      return [];
    }
  }

  const target = resolve(dir, current);
  if (rest.length === 0) {
    try {
      statSync(target);
      return [target];
    } catch {
      return [];
    }
  }

  return walk(target, rest);
}

// #endregion
