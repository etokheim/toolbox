import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { build } from 'vite';
import type { Options } from '../fixtures/scoped-footers';

let fixture: string;
async function mount(page: Page, options: Options) {
  await page.route('http://scoped-footers.test/fixture.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: fixture }),
  );
  await page.route('http://scoped-footers.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://scoped-footers.test/');
  await page.evaluate(async (options: Options) => {
    const url = 'http://scoped-footers.test/fixture.js';
    const { mount }: typeof import('../fixtures/scoped-footers') = await import(url);
    window.scopedFixture = await mount(options);
  }, options);
}
test.beforeAll(async () => {
  const grid = resolve(process.env['TBW_FOOTER_PACKAGE'] ?? 'dist/libs/grid');
  const react = resolve(process.env['TBW_FOOTER_REACT_PACKAGE'] ?? 'dist/libs/grid-react');
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
      lib: { entry: resolve('e2e/fixtures/scoped-footers.tsx'), formats: ['es'], fileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected fixture build output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser fixture');
  fixture = chunk.code;
});

for (const external of [false, true]) {
  for (const compact of [false, true]) {
    test(`continuous scoped boundaries external=${external} compact=${compact}`, async ({ page }, info) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'warning') warnings.push(message.text());
      });
      await mount(page, { external, compact, canonical: true, boundary: true, customEditor: true });
      await page.evaluate(() => window.scopedFixture.resize(420));
      const surface = compact ? 24 : 40;
      const rootHeight = compact ? 32 : 56;
      const groupHeight = compact ? 24 : 32;
      const leafEnd = rootHeight + groupHeight + 15 * surface;
      const scopeEnd = leafEnd + 3 * surface + groupHeight;
      const read = () =>
        page.evaluate(() => {
          const grid = document.querySelector('tbw-grid')!;
          const geometry = window.scopedFixture.measure();
          const headerBottom = grid.querySelector('.header-row')!.getBoundingClientRect().bottom;
          const root = grid.querySelector('[data-row-control="root-0"]')?.closest('.data-grid-row');
          return {
            scroll: geometry.owner.scrollTop,
            headerBottom,
            root: root?.classList.contains('tbw-ancestor-live')
              ? { top: root.getBoundingClientRect().top, bottom: root.getBoundingClientRect().bottom }
              : null,
            flowErrors: geometry.flowErrors,
            frames: Array.from(grid.querySelectorAll('.tbw-ancestor-live')).map((row) => ({
              id: row.querySelector<HTMLElement>('[data-row-control]')?.dataset.rowControl,
              classes: row.className,
              position: getComputedStyle(row).position,
              text: row.textContent,
              top: row.getBoundingClientRect().top,
              bottom: row.getBoundingClientRect().bottom,
              paintedAtTop:
                document
                  .elementFromPoint(
                    row.getBoundingClientRect().left + 500,
                    Math.max(headerBottom, row.getBoundingClientRect().top) + 1,
                  )
                  ?.closest('.data-grid-row') === row,
            })),
            footers: geometry.footer,
          };
        });
      await page.evaluate((top) => window.scopedFixture.scroll(top), leafEnd - 24);
      await expect.poll(async () => (await read()).scroll).toBe(leafEnd - 24);
      await page.locator('[data-row-control="root-0"]').click();
      const note = page.locator('[data-row-note="root-0"]');
      await note.fill('same live owner');
      const noteOwner = await note.elementHandle();
      const owner = await page.locator('#owner').boundingBox();
      if (!owner) throw new Error('Missing scroll owner');
      await page.mouse.move(owner.x + owner.width - 60, owner.y + 180);
      const samples: Awaited<ReturnType<typeof read>>[] = [];
      try {
        for (const direction of [1, -1]) {
          const steps = (scopeEnd - leafEnd + 48) / 8;
          for (let i = 0; i < steps; i++) {
            const before = (await read()).scroll;
            await page.mouse.wheel(0, direction * 8);
            await expect.poll(async () => (await read()).scroll).toBe(before + direction * 8);
            const snapshot = await read();
            samples.push(snapshot);
            expect(snapshot.flowErrors, JSON.stringify(snapshot)).toEqual([]);
            expect(snapshot.frames.some((frame) => frame.text?.includes('Final'))).toBe(false);
            for (const frame of snapshot.frames) {
              if (snapshot.scroll >= scopeEnd) {
                expect(frame.id?.endsWith('-0') ?? false).toBe(false);
                continue;
              }
              const end =
                frame.id === 'movement-0'
                  ? leafEnd
                  : frame.id === 'branch-0'
                    ? leafEnd + surface
                    : frame.text?.includes('Contents')
                      ? leafEnd + 2 * surface
                      : scopeEnd;
              expect(frame.bottom, JSON.stringify({ frame, snapshot, leafEnd, scopeEnd })).toBeLessThanOrEqual(
                snapshot.headerBottom + end - snapshot.scroll + 1,
              );
              expect(end).toBeGreaterThan(snapshot.scroll);
              if (frame.id !== 'root-0' && snapshot.root && frame.top < snapshot.root.bottom - 1) {
                expect(frame.paintedAtTop, JSON.stringify(snapshot)).toBe(false);
              }
            }
            if (snapshot.scroll < scopeEnd) {
              expect(snapshot.root, JSON.stringify(snapshot)).not.toBeNull();
              const expectedTop = snapshot.headerBottom + Math.min(0, scopeEnd - snapshot.scroll - rootHeight);
              expect(snapshot.root!.top).toBeCloseTo(expectedTop, 0);
              expect(snapshot.root!.bottom).toBeGreaterThan(snapshot.headerBottom);
              if (direction === 1) {
                expect(await noteOwner!.evaluate((element) => element.isConnected)).toBe(true);
                await expect(note).toHaveValue('same live owner');
              }
            } else {
              expect(snapshot.root, JSON.stringify(snapshot)).toBeNull();
            }
          }
        }
        const finalFooter = page.locator('[data-footer="root-0/Final"]');
        await page.evaluate((top) => window.scopedFixture.scroll(top), scopeEnd - surface - 8);
        await expect(finalFooter).toHaveAttribute('data-owner-depth', '1');
        await expect(finalFooter).toHaveAttribute('data-owner-collapsible', 'false');
        const footerOwner = await finalFooter.elementHandle();
        await page.mouse.wheel(80, 0);
        await expect
          .poll(() => page.locator('.tbw-scroll-area').evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        expect(await footerOwner!.evaluate((element) => element.isConnected)).toBe(true);
        await expect(finalFooter).toHaveAttribute('data-owner-depth', '1');
        await page.evaluate(() => window.scopedFixture.wrapRoots(true));
        await expect(finalFooter).toHaveAttribute('data-owner-depth', '2');
        expect(await footerOwner!.evaluate((element) => element.isConnected)).toBe(true);
        await page.evaluate(() => window.scopedFixture.wrapRoots(false));
        await expect(finalFooter).toHaveAttribute('data-owner-depth', '1');
        expect(await footerOwner!.evaluate((element) => element.isConnected)).toBe(true);
        expect(errors).toEqual([]);
        expect(
          warnings.filter((warning) => warning.includes('Insufficient') || warning.includes('usable ancestor')),
        ).toEqual([]);
      } finally {
        const path = info.outputPath('continuous-scope-geometry.json');
        writeFileSync(path, JSON.stringify({ external, compact, leafEnd, scopeEnd, samples, errors, warnings }));
        await info.attach('continuous-scope-geometry', {
          path,
          contentType: 'application/json',
        });
      }
    });
  }
}

for (const external of [false, true]) {
  for (const compact of [false, true]) {
    test(`row generation Add focus editor external=${external} compact=${compact}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const rowCount = external ? 8 : 30;
      const lastIndex = rowCount + 4;
      await mount(page, { external, compact, canonical: true, flat: true, customEditor: true, rowCount });
      await page.evaluate(() => window.scopedFixture.addAndEdit());
      const cell = page.locator(`.cell[data-row="${lastIndex}"][data-field="value"]`);
      const editor = cell.locator('[data-custom-editor]');
      try {
        await expect(editor).toBeFocused();
      } finally {
        expect(errors).toEqual([]);
      }
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const input = document.querySelector('[data-custom-editor]');
            const footer = document.querySelector('.tbw-scoped-footer');
            if (!input || !footer) throw new Error('Missing editor/footer');
            return input.getBoundingClientRect().bottom - footer.getBoundingClientRect().top;
          }),
        )
        .toBeLessThanOrEqual(1);
      await editor.fill('987');
      await editor.press('Enter');
      await expect(cell.locator('[data-value-display]')).toHaveText('987');
      await page.locator('[data-row-control="added-4"]').click();
      const note = page.locator('[data-row-note="added-4"]');
      await note.fill('retained note');
      const noteOwner = await note.elementHandle();
      const action = await page.evaluate(() => window.scopedFixture.undo());
      expect(action).toMatchObject({ oldValue: 4, newValue: 987 });
      await expect(cell.locator('[data-value-display]')).toHaveText('4');
      await page.evaluate(() => window.scopedFixture.redo());
      await expect(cell.locator('[data-value-display]')).toHaveText('987');
      await page.evaluate(() => window.scopedFixture.updateLast());
      await expect(cell.locator('[data-value-display]')).toHaveText('15');
      await expect(page.locator(`.data-grid-row:has(.cell[data-row="${lastIndex}"]) [data-derived]`)).toHaveText('30');
      await expect(page.locator(`.data-grid-row:has(.cell[data-row="${lastIndex}"]) [data-dependent]`)).toHaveText(
        '16',
      );
      expect(await noteOwner?.evaluate((element) => element.isConnected)).toBe(true);
      await expect(note).toHaveValue('retained note');
      await page.evaluate(() => window.scopedFixture.shrinkAndFocus());
      await expect.poll(() => page.evaluate(() => window.scopedFixture.measure().rows)).toBe(rowCount);
      const remaining = page.locator(`.cell[data-row="${rowCount - 1}"][data-field="value"]`);
      await expect(remaining).toHaveAttribute('tabindex', '0');
      const shrinkGeometry = JSON.stringify({
        cell: await remaining.boundingBox(),
        ...(await page.evaluate(() => window.scopedFixture.measure())),
      });
      await info.attach('shrink-geometry', {
        body: shrinkGeometry,
        contentType: 'application/json',
      });
      await expect
        .poll(
          async () => {
            const cell = await remaining.boundingBox();
            const geometry = await page.evaluate(() => window.scopedFixture.measure());
            return cell ? cell.y + cell.height - geometry.footer[0].top : Number.POSITIVE_INFINITY;
          },
          { message: shrinkGeometry },
        )
        .toBeLessThanOrEqual(1);
      expect((await page.evaluate(() => window.scopedFixture.measure())).samePlugins).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

for (const compact of [false, true]) {
  test(`bounded reveal without ancestors compact=${compact}`, async ({ page }, info) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await mount(page, {
      external: false,
      compact,
      canonical: true,
      flat: true,
      customEditor: true,
      boundedReveal: true,
    });
    await page.evaluate(() => window.scopedFixture.append());
    await expect(page.locator('[data-row-control="added-4"]')).toBeAttached();
    await page.evaluate(() => window.scopedFixture.revealLast());
    const cell = page.locator('.cell[data-row="9"][data-field="value"]');
    const geometry = () =>
      page.evaluate(() => {
        const cell = document.querySelector('.cell[data-row="9"][data-field="value"]')!;
        return { cell: cell.getBoundingClientRect().toJSON(), ...window.scopedFixture.measure() };
      });
    const overlap = async () => {
      const measured = await geometry();
      return measured.cell.bottom - measured.footer[0].top;
    };
    await expect.poll(overlap).toBeLessThanOrEqual(1);
    await info.attach('before-editor', { body: JSON.stringify(await geometry()), contentType: 'application/json' });
    await cell.dblclick();
    await expect(cell.locator('[data-custom-editor]')).toBeFocused();
    await info.attach('after-editor', { body: JSON.stringify(await geometry()), contentType: 'application/json' });
    await expect.poll(overlap).toBeLessThanOrEqual(1);
    const edited = await geometry();
    expect(edited.cell.top).toBeGreaterThanOrEqual(edited.viewport.top - 1);
    expect(edited.cell.height).toBe(compact ? 24 : 48);
    const totals = await page.locator('[data-status]').boundingBox();
    expect(totals!.height).toBe(48);
    expect(edited.footer[0].bottom).toBeLessThanOrEqual(totals!.y + 1);
    await cell.locator('[data-custom-editor]').press('Escape');
    await page.evaluate(() => {
      window.scopedFixture.scroll(0);
      window.scopedFixture.focusLast();
    });
    await expect.poll(overlap).toBeLessThanOrEqual(1);
    await expect(cell).toHaveAttribute('tabindex', '0');

    const viewportHeight = edited.viewport.bottom - edited.viewport.top;
    await page.evaluate((height) => window.scopedFixture.resize(height), 300 - viewportHeight + (compact ? 30 : 60));
    await page.evaluate(() => window.scopedFixture.scroll(0));
    await expect.poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).bottomOcclusion).toBe(0);
    await expect.poll(() => warnings.some((message) => message.includes('Insufficient space'))).toBe(true);
    await page.evaluate(() => window.scopedFixture.scroll(100000));
    await expect(page.locator('[data-footer="grid"]')).toBeVisible();
    const exhausted = await page.evaluate(() => window.scopedFixture.measure());
    expect(exhausted.footer[0].stuck).toBe('false');
    expect(exhausted.footer[0].bottom).toBeLessThanOrEqual(exhausted.viewport.bottom + 1);
    expect(exhausted.owner.scrollTop).toBe(exhausted.owner.max);
    await page.evaluate(() => window.scopedFixture.resize(300));
    await page.evaluate(() => window.scopedFixture.scroll(0));
    await expect
      .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).bottomOcclusion)
      .toBe(compact ? 24 : 40);
    await page.evaluate(() => window.scopedFixture.revealLast());
    await expect.poll(overlap).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scopedFixture.dispose());
  });
}

for (const external of [false, true]) {
  for (const canonical of [false, true]) {
    test(`same-ID child filtering without callback invalidation external=${external} canonical=${canonical}`, async ({
      page,
    }) => {
      await mount(page, { external, compact: false, canonical, nested: true, stableGrouping: true });
      const first = page.locator('[data-footer="parent-0/A/Inner"]');
      await first.click();
      await page.evaluate(() => window.scopedFixture.immutable());
      await expect(page.locator('[data-menu="parent-0/A/Inner"]')).toBeVisible();
      await page.evaluate(() => window.scopedFixture.filterA());
      await expect(first).toHaveCount(0);
      await expect(page.locator('[data-footer="parent-0/B/Inner"]')).toHaveText('provider:parent-0/B/Inner:0');
      expect((await page.evaluate(() => window.scopedFixture.measure())).samePlugins).toBe(true);
      await page.evaluate(() => window.scopedFixture.reparent());
      await expect(page.locator('[data-footer="parent-0/B/Inner"]')).toHaveCount(0);
      await expect(page.locator('[data-footer="parent-1/B/Inner"]')).toHaveText('provider:parent-1/B/Inner:0');
      expect((await page.evaluate(() => window.scopedFixture.measure())).samePlugins).toBe(true);
      await page.evaluate(() => window.scopedFixture.dispose());
    });
  }
  for (const compact of [false, true]) {
    for (const exit of ['Escape', 'Enter']) {
      test(`custom editor exit ${exit} external=${external} compact=${compact}`, async ({ page }) => {
        await mount(page, { external, compact, canonical: true, flat: true, customEditor: true });
        await page.locator('[data-footer="grid"]').click();
        const control = page.locator('[data-row-control="item-0"]');
        await control.evaluate((element) => element.setAttribute('data-retained', 'yes'));
        const cell = page.locator('.cell[data-row="0"][data-field="value"]');
        await cell.dblclick();
        const input = cell.locator('[data-custom-editor]');
        await expect(input).toBeFocused();
        await input.fill('42');
        await input.evaluate((element) => element.setAttribute('data-retained', 'yes'));
        await page.evaluate(() => window.scopedFixture.update(1));
        await expect(input).toHaveAttribute('data-retained', 'yes');
        await expect(input).toBeFocused();
        await input.press(exit);
        await expect(cell).not.toHaveClass(/\bediting\b/);
        await expect(cell.locator('[data-value-display]')).toHaveText(exit === 'Escape' ? '0' : '42');
        await expect(cell.locator('input, .tbw-editor-host, .react-cell-editor')).toHaveCount(0);
        await expect(cell).not.toHaveAttribute('data-editor-managed');
        await expect(control).toHaveAttribute('data-retained', 'yes');
        await expect(page.locator('[data-menu="grid"]')).toBeVisible();
        await expect(cell).toBeFocused();
        await page.evaluate(() => window.scopedFixture.dispose());
      });
    }
  }
  test(`repeated canonical parents external=${external}`, async ({ page }) => {
    await mount(page, { external, compact: false, canonical: true, repeated: true });
    const first = page.locator('[data-footer="parent-0/A"]');
    await expect(first).toBeVisible();
    const firstKey = await first.getAttribute('data-scope-key');
    await first.click();
    await page.evaluate(() => window.scopedFixture.immutable());
    await expect(page.locator('[data-menu="parent-0/A"]')).toBeVisible();
    expect(await first.getAttribute('data-scope-key')).toBe(firstKey);
    await page.evaluate(() => window.scopedFixture.collapse('parent-0'));
    await expect(first).toHaveCount(0);
    const second = page.locator('[data-footer="parent-1/A"]');
    await expect(second).toBeVisible();
    const secondKey = await second.getAttribute('data-scope-key');
    expect(secondKey).not.toBe(firstKey);
    await page.evaluate(() => window.scopedFixture.remove());
    await expect(second).toBeVisible();
    expect(await second.getAttribute('data-scope-key')).toBe(secondKey);
    await page.evaluate(() => window.scopedFixture.dispose());
  });
  test(`nested arbitration and mutation external=${external}`, async ({ page }) => {
    await mount(page, { external, compact: false, canonical: true, nested: true });
    const inner = page.locator('[data-footer="parent-0/A/Inner"]');
    await expect(inner).toBeVisible();
    expect(await page.locator('.tbw-scoped-footer[data-stuck="true"] [data-footer]').getAttribute('data-footer')).toBe(
      'parent-0/A/Inner',
    );
    const key = await inner.getAttribute('data-scope-key');
    await inner.click();
    await page.evaluate(() => window.scopedFixture.immutable());
    await expect(page.locator('[data-menu="parent-0/A/Inner"]')).toBeVisible();
    expect(await inner.getAttribute('data-scope-key')).toBe(key);
    await page.evaluate(() => window.scopedFixture.filterA());
    await expect(inner).toHaveCount(0);
    await expect(page.locator('[data-footer="parent-0/B/Inner"]')).toBeVisible();
    const previousParentKey = await page.locator('[data-footer="parent-0/B/Inner"]').getAttribute('data-scope-key');
    await page.evaluate(() => window.scopedFixture.reparent());
    await expect(page.locator('[data-footer="parent-0/B/Inner"]')).toHaveCount(0);
    await expect(page.locator('[data-footer="parent-1/B/Inner"]')).toBeVisible();
    expect(await page.locator('[data-footer="parent-1/B/Inner"]').getAttribute('data-scope-key')).not.toBe(
      previousParentKey,
    );
    await page.evaluate(() => window.scopedFixture.sort());
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.scopedFixture.measure())).footer.some((entry) =>
          entry.text?.includes('parent-9'),
        ),
      )
      .toBe(true);
    const measured = await page.evaluate(() => window.scopedFixture.measure());
    expect(measured.footer.filter((entry) => entry.stuck === 'true')).toHaveLength(1);
    expect(measured.flowErrors).toEqual([]);
    expect(measured.samePlugins).toBe(true);
    await page.evaluate(() => window.scopedFixture.dispose());
  });
  for (const compact of [false, true]) {
    for (const canonical of [false, true]) {
      test(`scope owners external=${external} compact=${compact} canonical=${canonical}`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await mount(page, { external, compact, canonical });
        await expect(page.locator('[data-footer="parent-0/A"]')).toBeVisible();
        const initial = await page.evaluate(() => window.scopedFixture.measure());
        await info.attach('initial', { body: JSON.stringify(initial), contentType: 'application/json' });
        expect(initial.footer.filter((entry) => entry.stuck === 'true')).toHaveLength(1);
        expect(initial.footer[0].height).toBe(compact ? 24 : 40);
        expect(
          Math.abs(initial.footer[0].bottom - Math.min(initial.viewport.bottom, initial.owner.bottom)),
        ).toBeLessThanOrEqual(1);
        expect(initial.flowErrors).toEqual([]);
        await page.locator('[data-footer="parent-0/A"]').click();
        await expect(page.locator('[data-menu="parent-0/A"]')).toBeVisible();
        await page.evaluate(() => window.scopedFixture.update(1));
        await expect(page.locator('[data-footer="parent-0/A"]')).toHaveText('provider:parent-0/A:1');
        await expect(page.locator('[data-menu="parent-0/A"]')).toBeVisible();
        await expect(page.locator('[data-footer="parent-0/A"]')).toBeFocused();
        expect((await page.evaluate(() => window.scopedFixture.measure())).samePlugins).toBe(true);
        await page.evaluate(() => window.scopedFixture.density());
        await expect
          .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).footer[0]?.height)
          .toBe(compact ? 40 : 24);
        await expect(page.locator('[data-menu="parent-0/A"]')).toBeVisible();
        await expect(page.locator('[data-footer="parent-0/A"]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-menu="parent-0/A"] [role="menuitem"]')).toBeFocused();
        expect(await page.evaluate(() => window.scopedFixture.pasteIntoFooter())).toEqual({
          prevented: false,
          unchanged: true,
        });
        await page.evaluate(() => window.scopedFixture.collapse('parent-0'));
        await expect(page.locator('[data-footer="parent-0/A"]')).toHaveCount(0);
        await page.evaluate(() => window.scopedFixture.expand('parent-1'));
        await expect(page.locator('[data-footer="parent-1/A"]')).toBeVisible();
        await page.evaluate(() => window.scopedFixture.scroll(10000));
        await expect
          .poll(async () =>
            (await page.evaluate(() => window.scopedFixture.measure())).footer.some((entry) =>
              entry.text?.includes('parent-11/B'),
            ),
          )
          .toBe(true);
        const last = await page.evaluate(() => window.scopedFixture.measure());
        await info.attach('last', { body: JSON.stringify(last), contentType: 'application/json' });
        expect(last.footer.filter((entry) => entry.stuck === 'true').length).toBeLessThanOrEqual(1);
        expect(last.flowErrors).toEqual([]);
        expect(last.footer.at(-1)!.bottom).toBeLessThanOrEqual(Math.min(last.viewport.bottom, last.owner.bottom) + 1);
        expect(last.pool).toBeLessThan(45);
        expect(last.mounts - last.unmounts).toBe(last.footer.length);
        expect(last.footer.length).toBeLessThan(8);
        await page.evaluate(() => window.scopedFixture.focusLast());
        await expect
          .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).focused)
          .not.toBeNull();
        const focused = await page.evaluate(() => window.scopedFixture.measure());
        expect(focused.focused!.bottom).toBeLessThanOrEqual(
          Math.min(focused.owner.bottom, focused.viewport.bottom) - focused.bottomOcclusion + 1,
        );
        await page.evaluate(() => window.scopedFixture.dispose());
        const owners = await page.evaluate(() => window.scopedFixture.owners());
        expect(owners.clicks).toBe(1);
        expect(owners.mounts).toBe(owners.unmounts);
        expect(errors).toEqual([]);
      });
    }
    for (const empty of [false, true]) {
      test(`whole grid empty=${empty} external=${external} compact=${compact}`, async ({ page }) => {
        await mount(page, { external, compact, canonical: true, flat: true, empty });
        const footer = page.locator('[data-footer="grid"]');
        await expect(footer).toBeVisible();
        const measured = await page.evaluate(() => window.scopedFixture.measure());
        expect(measured.rows).toBe(empty ? 0 : 80);
        expect(measured.footer).toHaveLength(1);
        expect(measured.footer[0].height).toBe(compact ? 24 : 40);
        expect(measured.footer[0].bottom).toBeLessThanOrEqual(measured.owner.bottom + 1);
        expect(measured.flowErrors).toEqual([]);
        await expect(page.locator('[data-status]')).toHaveCount(1);
        await page.evaluate(() => window.scopedFixture.update(-1));
        await expect(footer).toHaveCount(0);
        await page.evaluate(() => window.scopedFixture.update(2));
        await expect(footer).toHaveText('provider:grid:2');
        expect((await page.evaluate(() => window.scopedFixture.measure())).samePlugins).toBe(true);
        await page.evaluate(() => window.scopedFixture.dispose());
      });
    }
    test(`capacity loss and restoration external=${external} compact=${compact}`, async ({ page }) => {
      const warnings: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warning') warnings.push(message.text());
      });
      await mount(page, { external, compact, canonical: true });
      await page.evaluate(() => window.scopedFixture.scroll(20));
      await expect
        .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).bottomOcclusion)
        .toBe(compact ? 24 : 40);
      await page.evaluate(() => window.scopedFixture.resize(80));
      await page.evaluate(() => window.scopedFixture.scroll(90));
      await expect
        .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).bottomOcclusion)
        .toBe(0);
      expect((await page.evaluate(() => window.scopedFixture.measure())).ancestors).toBe(0);
      await expect.poll(() => warnings.some((message) => message.includes('Insufficient space'))).toBe(true);
      await page.evaluate(() => window.scopedFixture.scroll(100000));
      await expect
        .poll(async () =>
          (await page.evaluate(() => window.scopedFixture.measure())).footer.some((entry) =>
            entry.text?.includes('parent-11/B'),
          ),
        )
        .toBe(true);
      expect(
        (await page.evaluate(() => window.scopedFixture.measure())).footer.every((entry) => entry.stuck === 'false'),
      ).toBe(true);
      await page.evaluate(() => window.scopedFixture.resize(320));
      await page.evaluate(() => window.scopedFixture.scroll(20));
      await expect
        .poll(async () => (await page.evaluate(() => window.scopedFixture.measure())).bottomOcclusion)
        .toBe(compact ? 24 : 40);
      await page.evaluate(() => window.scopedFixture.dispose());
    });
  }
}
