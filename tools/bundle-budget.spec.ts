import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureBundles } from './bundle-size.ts';
import { CORE_BUNDLE_BUDGET } from './core-bundle-budget.ts';
import { bundleBudget, checkBudgets, checkSizeBudget } from './vite-bundle-budget.ts';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'toolbox-budgets-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('exact byte boundaries', () => {
  it('keeps the requested core thresholds in one definition', () => {
    expect(CORE_BUNDLE_BUDGET).toEqual({ path: 'index.js', maxSize: 174080, maxGzip: 53248, warnGzip: 46080 });
  });

  it.each([-1, 0, 1])('checks gzip hard boundary at limit %+i bytes', (delta) => {
    const result = checkSizeBudget('index.js', { raw: 100000, gzip: 53248 + delta }, CORE_BUNDLE_BUDGET);
    expect(result.violations).toHaveLength(delta > 0 ? 1 : 0);
    if (delta > 0) expect(result.violations[0]).toContain('53249 B');
  });

  it.each([-1, 0, 1])('checks raw hard boundary at limit %+i bytes', (delta) => {
    const result = checkSizeBudget('index.js', { raw: 174080 + delta, gzip: 1000 }, CORE_BUNDLE_BUDGET);
    expect(result.violations).toHaveLength(delta > 0 ? 1 : 0);
  });

  it.each([-1, 0, 1])('checks gzip soft boundary at limit %+i bytes', (delta) => {
    const result = checkSizeBudget('index.js', { raw: 100000, gzip: 46080 + delta }, CORE_BUNDLE_BUDGET);
    expect(result.violations).toHaveLength(0);
    expect(result.warnings).toHaveLength(delta > 0 ? 1 : 0);
  });
});

describe('Bun measurement authority', () => {
  it('batches all files once and matches direct Bun default gzip exactly', () => {
    const files = [join(directory, 'one.js'), join(directory, 'two.js')];
    files.forEach((file, index) => writeFileSync(file, `const value = ${index};\n`.repeat(1000)));
    const result = measureBundles(files);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileSync).mock.calls[0][0]).toBe('bun');
    const direct = spawnSync('bun', [resolve(import.meta.dirname, 'bundle-size.ts'), '--worker'], {
      input: JSON.stringify(files),
      encoding: 'utf8',
    });
    expect(direct.status).toBe(0);
    expect(result).toEqual(JSON.parse(direct.stdout));
    expect(result.bunVersion).toBeTruthy();
    expect(result.files.map((file) => file.raw)).toEqual(files.map((file) => readFileSync(file).length));
  });

  it.each([
    'not json',
    '{}',
    '{"bunVersion":"1","files":[{"path":"wrong","raw":0,"gzip":1}]}',
    '{"bunVersion":"1","files":[{"path":"fixture.js","raw":-1,"gzip":1}]}',
    '{"bunVersion":"1","files":[{"path":"fixture.js","raw":1.5,"gzip":1}]}',
    '{"bunVersion":"1","files":[{"path":"fixture.js","raw":0,"gzip":0}]}',
  ])('rejects invalid child output: %s', (output) => {
    vi.mocked(execFileSync).mockReturnValueOnce(output);
    expect(() => measureBundles(['fixture.js'])).toThrow();
  });

  it('propagates child failure instead of using Node gzip', () => {
    const failure = new Error('Bun worker failed');
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => measureBundles(['fixture.js'])).toThrow(failure);
  });

  it('fails explicitly when Bun is unavailable to the Node CLI', () => {
    writeFileSync(join(directory, 'index.js'), 'fixture');
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'check-bundle-budget.ts'), directory, '[{"path":"index.js","maxGzip":999}]'],
      { encoding: 'utf8', env: { ...process.env, PATH: directory } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ENOENT');
  });

  it('rejects direct Node execution of the Bun-only worker', () => {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'bundle-size.ts'), '--worker'], {
      input: '[]',
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must run under Bun');
  });
});

describe('build and CLI enforcement', () => {
  it('preserves cumulative rules, missing-file errors and forbidden symbols', () => {
    writeFileSync(join(directory, 'index.js'), 'forbidden');
    const result = checkBudgets({
      outDir: directory,
      budgets: [{ path: 'index.js', maxSize: 1 }, { path: 'index.js', maxSize: 2 }, { path: 'missing.js' }],
      forbiddenSymbols: [{ path: 'index.js', symbols: ['forbidden'] }],
    });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(result.measurements.files).toHaveLength(1);
    expect(result.violations).toHaveLength(4);
  });

  it('throws from the Vite hook when a real measured file exceeds its budget', () => {
    writeFileSync(join(directory, 'index.js'), 'fixture');
    const plugin = bundleBudget({ outDir: directory, budgets: [{ path: 'index.js', maxGzip: 1 }] });
    const hook = plugin.closeBundle;
    if (typeof hook !== 'function') throw new Error('Expected callable closeBundle hook');
    expect(() => Reflect.apply(hook, {}, [])).toThrow('Bundle budget exceeded');
  });

  it.each(['bun', 'node'])('%s CLI returns true failure and exact bytes', (runtime) => {
    writeFileSync(join(directory, 'index.js'), 'fixture');
    const result = spawnSync(
      runtime === 'node' ? process.execPath : 'bun',
      [resolve(import.meta.dirname, 'check-bundle-budget.ts'), directory, '[{"path":"index.js","maxSize":6}]'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('7 B raw');
    expect(result.stderr).toContain('7 B exceeds budget of 6 B');
  });

  it.each([-1, 0, 1])('enforces a real CLI gzip boundary with limit offset %+i', (delta) => {
    const file = join(directory, 'index.js');
    writeFileSync(file, 'const fixture = 123;\n'.repeat(100));
    const gzip = measureBundles([file]).files[0].gzip;
    const result = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, 'check-bundle-budget.ts'),
        directory,
        JSON.stringify([{ path: 'index.js', maxGzip: gzip + delta }]),
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(delta < 0 ? 1 : 0);
    expect(result.stdout).toContain(`${gzip} B gzip`);
  });

  it.each(['bun', 'node'])('%s report enforces core and prints identical authority measurements', (runtime) => {
    mkdirSync(join(directory, 'grid'));
    writeFileSync(join(directory, 'grid/index.js'), 'a'.repeat(174081));
    const result = spawnSync(
      runtime === 'node' ? process.execPath : 'bun',
      [resolve(import.meta.dirname, 'build-size-report.ts'), '--dist', directory],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('174081 B');
    expect(result.stdout).toContain('Authority: Bun ');
    expect(result.stdout).toContain('Core budget: **FAIL**');
  });

  it('fails on missing core instead of printing a success-shaped report', () => {
    const result = spawnSync('bun', [resolve(import.meta.dirname, 'build-size-report.ts'), '--dist', directory], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Missing required grid/index.js');
  });

  it('returns success on a real core below both limits, including CI summary output', () => {
    mkdirSync(join(directory, 'grid'));
    writeFileSync(join(directory, 'grid/index.js'), 'fixture');
    const summary = join(directory, 'summary.md');
    const result = spawnSync(
      'bun',
      [resolve(import.meta.dirname, 'build-size-report.ts'), '--dist', directory, '--ci'],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(summary, 'utf8')).toContain('Core budget: **PASS**');
  });

  it('produces identical full reports from Node and Bun on the same files', () => {
    mkdirSync(join(directory, 'grid'));
    writeFileSync(join(directory, 'grid/index.js'), 'const fixture = 123;\n'.repeat(100));
    const args = [resolve(import.meta.dirname, 'build-size-report.ts'), '--dist', directory];
    const bun = spawnSync('bun', args, { encoding: 'utf8' });
    const node = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(bun.status).toBe(0);
    expect(node.status).toBe(0);
    expect(node.stdout).toBe(bun.stdout);
  });

  it('preserves nonzero report exit status when writing a failing CI summary', () => {
    mkdirSync(join(directory, 'grid'));
    writeFileSync(join(directory, 'grid/index.js'), 'a'.repeat(174081));
    const summary = join(directory, 'summary.md');
    const result = spawnSync(
      'bun',
      [resolve(import.meta.dirname, 'build-size-report.ts'), '--dist', directory, '--ci'],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      },
    );
    expect(result.status).toBe(1);
    expect(readFileSync(summary, 'utf8')).toContain('Core budget: **FAIL**');
  });
});
