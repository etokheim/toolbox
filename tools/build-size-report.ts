/**
 * Build Size Report — exact Bun measurements and core budget enforcement.
 *
 * Usage:
 *   bun run tools/build-size-report.ts [--ci] [--dist <directory>]
 *
 * Without --ci: prints a table to stdout.
 * With --ci:    appends a Markdown table to $GITHUB_STEP_SUMMARY.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measureBundles, type BundleSize } from './bundle-size.ts';
import { CORE_BUNDLE_BUDGET } from './core-bundle-budget.ts';
import { checkSizeBudget } from './vite-bundle-budget.ts';

const distArg = process.argv.indexOf('--dist');
if (distArg !== -1 && (!process.argv[distArg + 1] || process.argv[distArg + 1].startsWith('--'))) {
  throw new Error('--dist requires a directory');
}
const DIST = distArg === -1 ? resolve(import.meta.dirname, '..', 'dist', 'libs') : resolve(process.argv[distArg + 1]);
const CI = process.argv.includes('--ci');

// ─── Helpers ──────────────────────────────────────────────────────────

function existingPath(filePath: string): string | null {
  return existsSync(filePath) ? filePath : null;
}

function fmt(bytes: number): string {
  return `${bytes} B`;
}

function fmtCell(path: string | null, sizes: Map<string, BundleSize>): string {
  const info = path ? sizes.get(path) : undefined;
  if (!info) return '—';
  return `${fmt(info.raw)} (${fmt(info.gzip)})`;
}

// ─── Collect sizes ────────────────────────────────────────────────────

interface LibRow {
  label: string;
  grid: string | null;
  angular: string | null;
  react: string | null;
  vue: string | null;
}

const rows: LibRow[] = [];

// Core entry (index.js)
rows.push({
  label: '**core** (index.js)',
  grid: existingPath(resolve(DIST, 'grid/index.js')),
  angular: existingPath(resolve(DIST, 'grid-angular/fesm2022/toolbox-web-grid-angular.mjs')),
  react: existingPath(resolve(DIST, 'grid-react/index.js')),
  vue: existingPath(resolve(DIST, 'grid-vue/index.js')),
});

// All-in-one (grid only)
rows.push({
  label: '**all** (all.js)',
  grid: existingPath(resolve(DIST, 'grid/all.js')),
  angular: null,
  react: null,
  vue: null,
});

// Individual plugins / features
// Discover from grid plugins (canonical source of truth)
const gridPluginsDir = resolve(DIST, 'grid/lib/plugins');
const pluginNames = existsSync(gridPluginsDir)
  ? readdirSync(gridPluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'shared')
      .map((d) => d.name)
      .sort()
  : [];

for (const name of pluginNames) {
  // Angular features use a slightly different naming: toolbox-web-grid-angular-features-<name>.mjs
  const angularFile = resolve(DIST, 'grid-angular/fesm2022', `toolbox-web-grid-angular-features-${name}.mjs`);

  rows.push({
    label: name,
    grid: existingPath(resolve(DIST, `grid/lib/plugins/${name}/index.js`)),
    angular: existingPath(angularFile),
    react: existingPath(resolve(DIST, `grid-react/features/${name}.js`)),
    vue: existingPath(resolve(DIST, `grid-vue/features/${name}.js`)),
  });
}

// ─── Render Markdown ──────────────────────────────────────────────────

const paths = rows.flatMap(({ grid, angular, react, vue }) =>
  [grid, angular, react, vue].filter((path) => path !== null),
);
const measurements = measureBundles([...new Set(paths)]);
const sizes = new Map(measurements.files.map((file) => [file.path, file]));
const core = sizes.get(resolve(DIST, 'grid/index.js'));
const result = core
  ? checkSizeBudget('grid/index.js', core, CORE_BUNDLE_BUDGET)
  : { violations: ['Missing required grid/index.js'], warnings: [] };
const lines: string[] = [];
lines.push('## 📦 Build Size Report');
lines.push('');
lines.push(`> Exact bytes: raw (gzip). Authority: Bun ${measurements.bunVersion}, node:zlib gzipSync defaults.`);
lines.push(
  `> Core limits: ${CORE_BUNDLE_BUDGET.maxSize} B raw / ${CORE_BUNDLE_BUDGET.maxGzip} B gzip; soft gzip ${CORE_BUNDLE_BUDGET.warnGzip} B.`,
);
lines.push('');
lines.push('| Entry | grid | angular | react | vue |');
lines.push('| :--- | ---: | ---: | ---: | ---: |');

for (const row of rows) {
  lines.push(
    `| ${row.label} | ${fmtCell(row.grid, sizes)} | ${fmtCell(row.angular, sizes)} | ${fmtCell(row.react, sizes)} | ${fmtCell(row.vue, sizes)} |`,
  );
}

lines.push('');
lines.push(`Core budget: **${result.violations.length ? 'FAIL' : 'PASS'}**.`);
for (const warning of result.warnings) lines.push(`- Warning: ${warning}`);
for (const violation of result.violations) lines.push(`- Failure: ${violation}`);
lines.push('Other entries are informational here; their owning build/bundle-check targets enforce their budgets.');

const md = lines.join('\n');

// ─── Output ───────────────────────────────────────────────────────────

if (CI) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    writeFileSync(summaryPath, md, { flag: 'a' });
    console.log('Build size report appended to $GITHUB_STEP_SUMMARY');
  } else {
    console.warn('$GITHUB_STEP_SUMMARY not set — printing to stdout instead');
    console.log(md);
  }
} else {
  console.log(md);
}
if (result.violations.length) process.exitCode = 1;
