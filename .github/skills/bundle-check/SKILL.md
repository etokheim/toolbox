---
name: bundle-check
description: Check the grid bundle budget using authoritative Bun gzip (index.js ≤175 KiB raw, ≤52 KiB gzip hard limit, 45 KiB gzip soft warning). Run after code changes that could affect bundle size.
argument-hint: library-name (optional)
---

# Bundle Size Check

Verify that the grid library build stays within its budget constraints.

## Budget Limits

| Metric              | Threshold            | Action                                                                         |
| ------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `index.js` raw size | > 179200 B (175 KiB) | **Hard fail** — reduce size or document a justified budget increase.           |
| `index.js` gzipped  | > 53248 B (52 KiB)   | **Hard fail** — reduce size or document a justified budget increase.           |
| `index.js` gzipped  | > 46080 B, ≤ 53248 B | **Soft warning** — investigate; do not trade readability for marginal savings. |
| `index.js` gzipped  | ≤ 46080 B (45 KiB)   | **Pass**, provided raw size also passes.                                       |

## Steps

> **Steps 1–2 are deterministic — run the scripts, don't eyeball it.** The build hard-enforces the budget and the report script prints exact raw/gzip sizes. Reserve your judgment for step 3 (interpreting the warning band and investigating causes).

### 1. Build the Library (enforces the hard budget)

```bash
bun nx build grid
```

The Vite `bundleBudget` plugin enforces `tools/core-bundle-budget.ts` (175 KiB raw / 52 KiB gzip) and existing plugin rules. Both it and the report use `tools/bundle-size.ts`: Bun's default `node:zlib.gzipSync`, with one batched Bun subprocess for a Node-hosted caller. Missing Bun, failed measurement and malformed child output are errors, never grounds to substitute Node gzip. Record the printed Bun version with exact bytes and bundle hash.

Vite's inherited progress/sub-build size banners still use the hosting runtime and are informational. The explicitly labeled **Bundle budget authority** output and the report determine acceptance, not those rounded banners.

### 2. Print Exact Sizes

Run the shared size-report script — it measures raw **and** gzip for `index.js`, `all.js`, and every plugin in one deterministic pass (same script CI uses):

```bash
bun run tools/build-size-report.ts
```

Read the exact byte values in the **core (index.js)** row. The report now exits nonzero for missing/over-budget core, including `--ci`; other entries remain informational and their owning build/bundle-check targets enforce limits. `--dist <directory>` selects another built library root without changing limits. Historical reports before this enforcement were rounded display-only output: exit 0 did not prove acceptance.

Upstream is Bun-first, not Bun-only: inherited Nx/Vite uses a Node shebang and CI installs Node 24 alongside Bun. `node:` built-in imports are also supported under Bun; they do not identify the executing runtime. Keep the toolchain unchanged and record Bun versions rather than choosing whichever compressor passes.

### 3. Evaluate Results

Use this checklist in order. Stop at the first matching outcome.

#### 3a. Under budget (gzipped ≤ 45 KiB and raw ≤ 175 KiB)

- [ ] Report the raw and gzipped sizes.
- [ ] Confirm the build is good. No further investigation required.

#### 3b. Soft warning (gzip > 45 KiB and ≤ 52 KiB, raw ≤ 175 KiB)

- [ ] Report the sizes and flag the warning explicitly.
- [ ] Briefly investigate using the **Over-budget investigation checklist** below.
- [ ] Document any size increase in the commit message; merging is allowed.

#### 3c. Over budget (gzip > 52 KiB **or** raw > 175 KiB)

The build/report must fail. Evaluate the checklist, then either reduce size without harming code quality or use the user's standing permission for a justified increase. Record feature need, plugin-placement decision, readability/performance trade-offs, old/new limits and before/after authoritative bytes. Update the shared rule, active docs and threshold tests together. No per-increase approval is needed; this grants no commit or remote permission.

#### Over-budget investigation checklist

- [ ] Check for new dependencies or imports pulled into the core bundle.
- [ ] Verify plugins are separate entry points (not bundled into `index.js`).
- [ ] Look for dead code that should be tree-shaken.
- [ ] Consider if large functions could be moved to a plugin.
- [ ] Re-run `bun nx build grid` and review the Vite output summary.

### 4. Common Causes of Size Increase

- Accidentally importing a plugin in `src/index.ts` instead of `src/all.ts`
- Adding large utility functions to core modules
- New CSS that gets inlined into the core bundle
- Importing third-party libraries in core code
- Duplicated types or constants across modules

### 5. Size Reduction Strategies

- Move feature code to a plugin (separate entry point)
- Extract pure functions and ensure tree-shaking works
- Remove unused exports and dead code
- Minimize CSS by combining selectors
- Audit `import` statements for unnecessary pulls

## Plugin Bundle Sizes

Individual plugins are separate entry points. The report lists their raw/gzip bytes. Existing limits remain 55 KiB raw per plugin, except Editing at 56 KiB and Selection at 60 KiB. Any future increase must justify the affected entry, not silently loosen a shared wildcard or move always-loaded bytes into core. Disabled configuration does not remove an imported plugin's download/parse cost.

## Tooling regression checks

Run focused measurement, threshold, runtime and CLI failure tests through Nx:

```bash
bun nx exec --projects=grid --excludeTaskDependencies -- vitest run --root "$PWD" --config "$PWD/tools/vitest.config.mts"
```

Tests are Node-environment tooling tests (no DOM). They exercise the inherited Node caller and real Bun worker, exact below/equal/over boundaries, one batch, child failure, missing Bun, and report exit status.

## Bundle Composition (build-enforced + runtime smoke)

Where code lives is a global rule (`development-principles.instructions.md` → "Bundle Composition"). The build enforces the structural half via `tools/vite-core-imports.ts`, which runs in the per-plugin ESM and UMD builds:

| Build failure                                           | Meaning                                                                           | Fix                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `[core-imports] … inlines module state from X`          | A plugin inlined a core module that keeps module-level state, and core has it too | Export the plugin's entry point into that module from `public.ts` (`@internal` if needed) |
| `[core-imports] module state exists more than once`     | Two plugin bundles each carry the same stateful core module                       | Same fix: export it from `public.ts` so both share core's instance                        |
| `[core-imports] … which the built core does not export` | A plugin imports a public name that `index.js` doesn't export                     | Check `src/index.ts` re-exports                                                           |
| `[core-imports] … unexpected external import`           | Something other than `@toolbox-web/grid` (or a plugin dep, ESM) went external     | Find the import; plugin-shared code belongs in `plugins/shared/`                          |

A green build does not prove the bundles **run**. After touching `vite.config.ts`, `tools/vite-core-imports.ts`, `public.ts`, or a plugin's core imports, run the dist smoke test. It loads core and every plugin bundle (ESM and UMD) in happy-dom and drives a real grid:

```bash
bun nx build grid
bun .github/skills/bundle-check/smoke-dist.mjs   # exit 1 + ✗ lines on failure
```

It catches what the build cannot: a UMD plugin reading an undefined `TbwGrid.<name>`, a plugin carrying its own `BaseGridPlugin` copy, and module state that is not shared with core (`aggregatorRegistry`). To prove a fix, build once with the old config (`git show HEAD:libs/grid/vite.config.ts`) and confirm the script fails there.

## Dead Code Removal

Actively identify and remove dead code to minimize bundle size. Use the `fallow` skill for
deterministic detection instead of hand-grepping exports:

```bash
bunx fallow dead-code --format json > tmp/fallow-dead-code.json   # unused exports/files, circular deps
bun nx lint grid                                                 # unused imports/locals
```

Also remove commented-out code blocks and deprecated code with no remaining references.

### When removing code:

1. Verify no usages exist (use `list_code_usages` or grep)
2. Check for dynamic imports or string-based references
3. Consider if code is used by external consumers (public API)
4. Remove associated tests if the feature is fully removed
