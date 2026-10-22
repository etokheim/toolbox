import type { BudgetEntry } from './vite-bundle-budget.ts';

/** Core budget shared by the production build and standalone report. */
export const CORE_BUNDLE_BUDGET: BudgetEntry = {
  path: 'index.js',
  maxSize: 170 * 1024,
  maxGzip: 52 * 1024,
  warnGzip: 45 * 1024,
};
