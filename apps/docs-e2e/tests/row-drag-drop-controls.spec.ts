import type { DataGridElement } from '@toolbox-web/grid';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openDemo } from './utils';

const fixture = `/@fs/${fileURLToPath(new URL('../fixtures/row-drag-drop-controls.tsx', import.meta.url))}`;

for (const surface of ['props', 'config'] as const) {
  test(`row drag controls — same-node factory ref removal and re-add (${surface})`, async ({ page }) => {
    await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
    await page.evaluate(async ({ url, surface }) => (await import(url)).mount(false, 'main', surface), {
      url: fixture,
      surface,
    });
    const grid = page.locator('#drag-react-fixture tbw-grid').first();
    const button = grid.locator('[data-drag="0"]');
    await expect(button).toHaveAttribute('draggable', 'true');
    await button.evaluate((element) => element.setAttribute('data-original-node', 'true'));
    await grid.evaluate((element) =>
      element.addEventListener('row-drag-start', () => element.setAttribute('data-native-start', 'true')),
    );
    await page.evaluate(async (url) => (await import(url)).setBinding(false), fixture);
    await expect(button).toHaveAttribute('data-bound', 'false');
    await expect(button).toHaveAttribute('data-original-node', 'true');
    await expect(button).not.toHaveAttribute('draggable');
    await button.click();
    await expect(button).toHaveAttribute('data-clicks', '1');
    await expect(grid.locator('.tbw-row-move-menu')).toBeHidden();
    await button.dragTo(grid.locator('.data-grid-row').nth(3));
    expect(await grid.getAttribute('data-native-start')).toBeNull();
    await page.evaluate(async (url) => (await import(url)).setBinding(true), fixture);
    await expect(button).toHaveAttribute('draggable', 'true');
    await expect(button).toHaveAttribute('data-original-node', 'true');
    await expect(button).toHaveAttribute('data-clicks', '1');
    await button.press('Enter');
    await expect(grid.locator('.tbw-row-move-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await button.dragTo(grid.locator('.data-grid-row').nth(3));
    await expect(grid).toHaveAttribute('data-native-start', 'true');
  });

  test(`row drag controls — same-callback output-generation leases (${surface})`, async ({ page }) => {
    await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
    await page.evaluate(async ({ url, surface }) => (await import(url)).mount(false, 'main', surface), {
      url: fixture,
      surface,
    });
    const grid = page.locator('#drag-react-fixture tbw-grid').first();
    await expect(grid.locator('[data-drag="0"]')).toHaveAttribute('draggable', 'true');
    await page.evaluate(async (url) => (await import(url)).setOutput('view'), fixture);
    await expect.poll(() => page.evaluate(async (url) => (await import(url)).liveCount(), fixture)).toBe(0);
    const dom = grid.locator('[data-drag="0"][data-output="view"]');
    await expect(dom).toHaveAttribute('draggable', 'true');
    await dom.click();
    await expect(grid.locator('.tbw-row-move-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await grid.evaluate((element) => {
      element.addEventListener('row-drag-start', () => element.setAttribute('data-native-start', 'true'));
      element.addEventListener('row-move', () => element.setAttribute('data-native-move', 'true'));
    });
    await dom.dragTo(grid.locator('.data-grid-row').nth(3));
    await expect(grid).toHaveAttribute('data-native-start', 'true');
    await expect(grid).toHaveAttribute('data-native-move', 'true');

    await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
    await page.evaluate(async ({ url, surface }) => (await import(url)).mount(false, 'main', surface, 'html'), {
      url: fixture,
      surface,
    });
    await expect(grid.locator('[data-drag="0"][data-output="html"]')).toHaveAttribute('draggable', 'true');
    await page.evaluate(async (url) => (await import(url)).setOutput('jsx'), fixture);
    const jsx = grid.locator('[data-drag="0"][data-clicks]');
    await expect(jsx).toHaveAttribute('draggable', 'true');
    await jsx.click();
    await expect(jsx).toHaveAttribute('data-clicks', '1');
    await page.keyboard.press('Escape');
    await jsx.evaluate((element) => element.setAttribute('data-original-node', 'true'));
    await page.evaluate(async (url) => (await import(url)).setOutput('jsx'), fixture);
    await expect(jsx).toHaveAttribute('data-clicks', '1');
    await expect(jsx).toHaveAttribute('data-original-node', 'true');
    await expect(jsx).toHaveAttribute('draggable', 'true');
  });
}

test('row drag controls — DOM demo pointer menu, keyboard and events', async ({ page }) => {
  await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
  const grid = page.locator('#row-drag-controls-demo tbw-grid');
  const first = grid.getByRole('button', { name: 'Drag to reorder, or activate for move options' }).first();
  await first.click();
  await grid.getByRole('button', { name: 'Move down', exact: true }).click();
  await expect(grid.locator('.data-grid-row').first()).toContainText('Review');
  await expect(page.locator('[data-event-log]')).toHaveText('Moved Draft');
  await grid
    .getByRole('button', { name: 'Drag to reorder, or activate for move options' })
    .first()
    .press('Control+ArrowDown');
  await expect(grid.locator('.data-grid-row').first()).toContainText('Draft');
});

test('row drag controls — native SVG drag, React cancellation, keyboard, owners and recycling', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
  await page.evaluate(async (url) => (await import(url)).mount(), fixture);
  const grids = page.locator('#drag-react-fixture tbw-grid');
  const grid = grids.first();
  await expect(grid.locator('[data-drag="0"]')).toHaveAttribute('data-theme', 'one');
  await expect(grids.nth(1).locator('[data-drag="0"]')).toHaveAttribute('data-theme', 'two');
  await browser.startTracing(page, { path: testInfo.outputPath('drag-trace.json'), categories: ['devtools.timeline'] });
  await grid.evaluate((element) => {
    for (const name of ['row-drag-start', 'row-move', 'row-transfer', 'cell-activate', 'selection-change']) {
      element.addEventListener(name, () => {
        element.setAttribute(`data-${name}`, String(Number(element.getAttribute(`data-${name}`) ?? 0) + 1));
      });
    }
  });
  const button = grid.locator('[data-drag="0"]');
  await page.evaluate(async (url) => (await import(url)).policy(true, true), fixture);
  await button.click();
  await expect(grid.locator('.tbw-row-move-menu')).toHaveCount(0);
  await button.press('Control+ArrowDown');
  expect(await grid.getAttribute('data-row-move')).toBeNull();
  await button.dragTo(grid.locator('.data-grid-row').nth(3));
  expect(await grid.getAttribute('data-row-drag-start')).toBeNull();
  await page.evaluate(async (url) => {
    const controls = await import(url);
    controls.policy(false);
    controls.render();
  }, fixture);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // Intentionally exercise an aria-disabled control rather than Playwright's enabled gate.
  await button.click({ force: true });
  await expect(grid.locator('.tbw-row-move-menu')).toHaveCount(0);
  await page.evaluate(async (url) => {
    const controls = await import(url);
    controls.policy(true);
    controls.render();
  }, fixture);
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await page.evaluate(async (url) => (await import(url)).policy(true, false), fixture);
  for (const key of ['Space', 'Enter']) {
    await button.press(key);
    await expect(grid.locator('.tbw-row-move-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(grid.locator('.tbw-row-move-menu')).toBeHidden();
  }
  await button.locator('path').click();
  await grid.getByRole('button', { name: 'Move down', exact: true }).click();
  await expect(grid).toHaveAttribute('data-row-move', '1');
  await expect(grid.locator('.data-grid-row').first()).toContainText('Task 1');
  await grid.locator('[data-drag="0"]').press('Control+ArrowUp');
  await expect(grid).toHaveAttribute('data-row-move', '2');
  await expect(grid.locator('.data-grid-row').first()).toContainText('Task 0');
  const source = await grid.locator('[data-drag="0"] svg').boundingBox();
  const target = await grid.locator('.data-grid-row').nth(3).boundingBox();
  if (!source || !target) throw new Error('Missing drag bounds');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 15, source.y + 10, { steps: 5 });
  await page.mouse.move(target.x + 100, target.y + target.height - 2, { steps: 12 });
  await page.mouse.up();
  await expect(grid).toHaveAttribute('data-row-drag-start', '1');
  await expect(grid).toHaveAttribute('data-row-move', '3');
  expect(await grid.getAttribute('data-cell-activate')).toBeNull();
  expect(await grid.getAttribute('data-selection-change')).toBeNull();
  await expect(grid.locator('.cell.editing')).toHaveCount(0);
  await page.evaluate(async (url) => (await import(url)).render('B'), fixture);
  await expect(grid.locator('button[data-drag]').first()).toHaveAttribute('data-version', 'B');
  await page.evaluate(async (url) => (await import(url)).render('B', true), fixture);
  await expect(grid.locator('button[data-drag]').first()).toHaveAttribute('data-version', 'B');
  await grid.evaluate((element) => (element as DataGridElement).scrollToRow(100));
  await expect(grid.locator('[data-drag="100"]')).toHaveAttribute('data-version', 'B');
  await expect.poll(() => page.evaluate(async (url) => (await import(url)).liveCount(), fixture)).toBeLessThan(80);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Memory.getDOMCounters');
  for (const index of [0, 120, 0, 120, 0, 100]) {
    await grid.evaluate((element, row) => (element as DataGridElement).scrollToRow(row), index);
    await expect(grid.locator(`[data-drag="${index}"]`)).toBeVisible();
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Memory.getDOMCounters');
  expect(after.jsEventListeners).toBeLessThanOrEqual(before.jsEventListeners + 40);
  expect(after.nodes).toBeLessThanOrEqual(before.nodes + 100);
  await page.evaluate(async (url) => (await import(url)).unmount(), fixture);
  await expect.poll(() => page.evaluate(async (url) => (await import(url)).liveCount(), fixture)).toBe(0);
  await browser.stopTracing();
  expect(errors).toEqual([]);
});

test('row drag controls — matching-zone pointer transfer preserves the plugin path', async ({ page }) => {
  await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
  await page.evaluate(async (url) => (await import(url)).mount(true), fixture);
  const grids = page.locator('#drag-react-fixture tbw-grid');
  const source = grids.first();
  const target = grids.nth(1);
  await expect(source.locator('[data-drag="0"]')).toBeVisible();
  await source.evaluate((element) => (element as DataGridElement).getPluginByName('selection')?.selectRows([0, 1]));
  await source.locator('[data-drag="0"]').dragTo(source.locator('.data-grid-row').nth(3));
  await expect(source.locator('.data-grid-row').first()).toContainText('Task 1');
  await expect(source.locator('.data-grid-row').nth(1)).toContainText('Task 2');
  await source.evaluate((element) => (element as DataGridElement).getPluginByName('selection')?.selectRows([0, 1]));
  for (const grid of [source, target]) {
    await grid.evaluate((element) =>
      element.addEventListener('row-transfer', () => {
        element.setAttribute('data-transferred', 'true');
      }),
    );
  }
  await source.locator('[data-drag="1"]').dragTo(target.locator('.data-grid-row').nth(2));
  await expect(source).toHaveAttribute('data-transferred', 'true');
  await expect(target).toHaveAttribute('data-transferred', 'true');
  expect(await source.evaluate((element) => (element as DataGridElement).rows.length)).toBe(198);
  expect(await target.evaluate((element) => (element as DataGridElement).rows.length)).toBe(202);
});

test('row drag controls — native pickup JSON delivered across windows retains selected transfer', async ({
  page,
  context,
}) => {
  await openDemo(page, 'row-drag-drop/RowDragDropControlsDemo');
  await page.evaluate(async (url) => (await import(url)).mount(true, 'source'), fixture);
  const source = page.locator('#source-one');
  await expect(source.locator('[data-drag="0"]')).toBeVisible();
  await source.evaluate((element) => {
    (element as DataGridElement).getPluginByName('selection')?.selectRows([0, 1]);
    element.addEventListener('dragstart', (event) => {
      const transfer = (event as DragEvent).dataTransfer;
      if (transfer)
        element.setAttribute(
          'data-transfer-json',
          JSON.stringify(Object.fromEntries(Array.from(transfer.types, (type) => [type, transfer.getData(type)]))),
        );
    });
  });
  const other = await context.newPage();
  await openDemo(other, 'row-drag-drop/RowDragDropControlsDemo');
  await other.evaluate(async (url) => (await import(url)).mount(true, 'target'), fixture);
  const target = other.locator('#target-one');
  await expect(target.locator('[data-drag="0"]')).toBeVisible();
  await source.locator('[data-drag="0"]').dragTo(page.locator('[data-event-log]'));
  const data = await source.getAttribute('data-transfer-json');
  if (!data) throw new Error('Native pickup did not produce transfer data');
  // Playwright cannot move the OS cursor between windows; deliver the captured native JSON.
  await target
    .locator('.data-grid-row')
    .nth(2)
    .evaluate((row, payload: Record<string, string>) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(payload)) transfer.setData(type, value);
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top }),
      );
      row.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top }),
      );
    }, JSON.parse(data));
  await expect.poll(() => source.evaluate((element) => (element as DataGridElement).rows.length)).toBe(198);
  await expect.poll(() => target.evaluate((element) => (element as DataGridElement).rows.length)).toBe(202);
  await other.close();
});
