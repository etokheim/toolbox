import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { Surface } from '../fixtures/active-ancestors-react';

let fixture: string;
test.beforeAll(async () => {
  const grid = resolve(process.env['TBW_ANCESTOR_PACKAGE'] ?? 'dist/libs/grid');
  const react = resolve(process.env['TBW_ANCESTOR_REACT_PACKAGE'] ?? 'dist/libs/grid-react');
  const result = await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: 'react', replacement: resolve('node_modules/react') },
        { find: 'react-dom', replacement: resolve('node_modules/react-dom') },
        { find: /^@toolbox-web\/grid-react$/, replacement: `${react}/index.js` },
        { find: '@toolbox-web/grid-react/features', replacement: `${react}/features` },
        { find: /^@toolbox-web\/grid$/, replacement: `${grid}/index.js` },
        { find: '@toolbox-web/grid/plugins', replacement: `${grid}/lib/plugins` },
        { find: '@toolbox-web/grid/features', replacement: `${grid}/lib/features` },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('e2e/fixtures/active-ancestors-react.tsx'), formats: ['es'], fileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected fixture build output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser fixture');
  fixture = chunk.code;
});

for (const surface of ['props', 'config', 'mixed'] as Surface[]) {
  for (const external of [true, false]) {
    test(`${surface}, ${external ? 'external' : 'internal'}: React density preserves anchor and live ownership`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('http://ancestor-react.test/fixture.js', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: fixture }),
      );
      await page.route('http://ancestor-react.test/', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
      );
      await page.goto('http://ancestor-react.test/');
      await page.evaluate(
        async ({ surface, external }) => {
          const url = 'http://ancestor-react.test/fixture.js';
          const { mount }: typeof import('../fixtures/active-ancestors-react') = await import(url);
          window.ancestorReact = await mount(surface, external);
          window.ancestorReact.scrollTo(3600);
        },
        { surface, external },
      );
      const row = page.locator('.data-grid-row').filter({ has: page.locator('[data-action="root-30"]') });
      await expect(row).toBeVisible();
      await row.locator('[data-field="__tbw_checkbox"]').click();
      await page.evaluate(() => window.ancestorReact.remember());
      const before = await page.evaluate(() => window.ancestorReact.measure());
      await info.attach('before', { body: JSON.stringify(before), contentType: 'application/json' });
      expect(before.selected).toContain('root-30');
      await page.locator('#density').click();
      await expect.poll(() => page.evaluate(() => window.ancestorReact.measure().rootHeight)).toBe(40);
      if (external) await expect.poll(() => page.evaluate(() => window.ancestorReact.measure().body)).toBe(5760);
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => window.ancestorReact.measure());
      await info.attach('after', { body: JSON.stringify(after), contentType: 'application/json' });
      expect(after.sameSource).toBe(true);
      expect(after.samePlugin).toBe(true);
      expect(after.sameSelection).toBe(true);
      expect(after.detaches).toBe(0);
      expect(after.attaches).toBe(0);
      expect(after.offset).not.toBeNull();
      expect(Math.abs(after.offset! - before.offset!)).toBeLessThanOrEqual(1);
      expect(after.selected).toContain('root-30');
      expect(after.pool).toBeLessThanOrEqual(after.window[1] - after.window[0] + after.retained);
      await page.locator('#density').click();
      await expect.poll(() => page.evaluate(() => window.ancestorReact.measure().rootHeight)).toBe(56);
      await expect.poll(() => page.evaluate(() => window.ancestorReact.measure().owner)).toBe(before.owner);
      const restored = await page.evaluate(() => window.ancestorReact.measure());
      expect(restored.offset).toBe(before.offset);
      expect(restored.detaches).toBe(0);
      // A config update normally rerenders cells. Subsequent sticking must keep
      // that live control, rather than replacing it with a snapshot or second root.
      await page.evaluate((top) => {
        window.ancestorReact.remember();
        window.ancestorReact.scrollTo(top + 60);
      }, restored.owner);
      await expect(row).toHaveClass(/tbw-ancestor-live/);
      expect(await page.evaluate(() => window.ancestorReact.measure().sameControl)).toBe(true);
      await expect(page.locator('[data-action="root-30"]')).toHaveCount(1);
      await page.locator('[data-action="root-30"]').click();
      expect(await page.evaluate(() => window.ancestorReact.measure().actions)).toBe(1);
      expect(errors).toEqual([]);
      await page.evaluate(() => window.ancestorReact.unmount());
    });
  }
}

for (const external of [true, false]) {
  test(`${external ? 'external' : 'internal'}: immutable descendant update keeps its live JSX menu owner`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://ancestor-react.test/fixture.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: fixture }),
    );
    await page.route('http://ancestor-react.test/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
    );
    await page.goto('http://ancestor-react.test/');
    await page.evaluate(async (external) => {
      const url = 'http://ancestor-react.test/fixture.js';
      const { mount }: typeof import('../fixtures/active-ancestors-react') = await import(url);
      window.ancestorReact = await mount('props', external, true);
      window.ancestorReact.scrollTo(3600);
    }, external);
    const control = page.locator('[data-action="child-30-3"]');
    await control.click();
    await expect(page.getByRole('menuitem')).toHaveText('Revision 0');
    await control.focus();
    await expect(control).toBeFocused();
    await page.evaluate(() => {
      window.ancestorReact.remember('child-30-3');
      window.ancestorReact.replaceRows();
    });
    await expect(page.getByRole('menuitem')).toHaveText('Revision 1');
    await expect(control).toBeFocused();
    await expect(control).toHaveCount(1);
    expect(await page.evaluate(() => window.ancestorReact.measure().sameControl)).toBe(true);
    expect(await page.evaluate(() => window.ancestorReact.measure().detaches)).toBe(0);
    await expect(page.locator('.cell[data-field="__actions"]').filter({ has: control })).toHaveAttribute(
      'data-tbw-cell-expanded',
      '',
    );
    await page.getByRole('menuitem').click();
    expect(await page.evaluate(() => window.ancestorReact.measure().actions)).toBe(1);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.ancestorReact.unmount());
  });
}
