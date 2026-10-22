import { expect, test, type Page } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Row = { id: string; kind: number };
type Subject = DataGridElement<Row>;

async function mount(page: Page, count = 240, numeric = false) {
  const root = process.env['TBW_ANCHOR_PACKAGE'] ?? 'dist/libs/grid';
  await page.route('http://anchor.test/core.js', async (route) =>
    route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(root, 'index.js'), 'utf8') }),
  );
  await page.route('http://anchor.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://anchor.test/');
  await page.addScriptTag({ type: 'module', url: 'http://anchor.test/core.js' });
  await page.evaluate(
    async ({ count, numeric }) => {
      await customElements.whenDefined('tbw-grid');
      const grid = document.createElement('tbw-grid') as Subject;
      grid.id = 'subject';
      const style = document.createElement('style');
      style.textContent = `
        body { font:14px system-ui }
        #subject { display:block; width:400px; height:160px; --tbw-row-height:40px }
        #subject .data-grid-row { border-bottom:0 }
        #subject .cell { padding-block:0; font:10px/1 system-ui }
      `;
      document.head.append(style);
      grid.gridConfig = {
        columns: [{ field: 'id', width: 800 }],
        fitMode: 'fixed',
        getRowId: (row) => row.id,
        rowHeight: numeric ? 56 : (row) => [56, 24, 40][row.kind],
      };
      grid.rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, kind: index % 3 }));
      document.body.append(grid);
      await grid.ready();
    },
    { count, numeric },
  );
  await expect(page.locator('.rows > .data-grid-row').first()).toBeVisible();
}

async function scroll(page: Page, index: number, inside = 0) {
  await page.evaluate(
    ({ index, inside }) => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.scrollToRowById(`row-${index}`, { align: 'start', behavior: 'instant' });
      grid.querySelector('.faux-vscroll')!.scrollTop += inside;
    },
    { index, inside },
  );
  await expect.poll(async () => (await geometry(page, index)).top).toBe(0 - inside);
}

async function geometry(page: Page, index: number) {
  return page.evaluate((index) => {
    const grid = document.querySelector<Subject>('#subject')!;
    const row = grid.querySelector<HTMLElement>(`.rows > .data-grid-row:has(> .cell[data-row="${index}"])`);
    const viewport = grid.querySelector<HTMLElement>('.rows-viewport')!;
    const vertical = grid.querySelector<HTMLElement>('.faux-vscroll')!;
    return {
      top: row ? row.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null,
      height: row?.getBoundingClientRect().height,
      scrollTop: vertical.scrollTop,
      maxScroll: vertical.scrollHeight - vertical.clientHeight,
      cacheOffset: grid._virtualization.positionCache?.[index]?.offset,
      extent: grid._virtualization.scrollMapping.rawContentHeight,
    };
  }, index);
}

async function replace(page: Page, compact: boolean, numeric = false) {
  await page.evaluate(
    async ({ compact, numeric }) => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.gridConfig = {
        ...grid.gridConfig,
        rowHeight: numeric ? (compact ? 32 : 56) : (row: Row) => (compact ? [32, 16, 24] : [56, 24, 40])[row.kind],
      };
      await grid.forceLayout();
    },
    { compact, numeric },
  );
}

for (const count of [12, 240]) {
  for (const numeric of [false, true]) {
    test(`${count} rows: ${numeric ? 'numeric' : 'callback'} replacements preserve occurrence and intra-row position`, async ({
      page,
    }) => {
      await mount(page, count, numeric);
      const index = count === 12 ? 3 : 90;
      await scroll(page, index, 7);
      await replace(page, true, numeric);
      await expect.poll(async () => (await geometry(page, index)).top).toBe(-7);
      expect(await geometry(page, index)).toMatchObject({
        height: 32,
        scrollTop: (numeric ? index * 32 : (index / 3) * 72) + 7,
        extent: numeric ? count * 32 : (count / 3) * 72,
      });
      await replace(page, false, numeric);
      await expect.poll(async () => (await geometry(page, index)).top).toBe(-7);
      expect((await geometry(page, index)).height).toBe(56);
    });
  }
}

test('callback replacement preserves the formerly red root at offset zero', async ({ page }) => {
  await mount(page);
  await scroll(page, 90);
  expect((await geometry(page, 90)).scrollTop).toBe(3600);
  await replace(page, true);
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
  const result = await geometry(page, 90);
  expect(result).toMatchObject({ scrollTop: 2160, cacheOffset: 2160, extent: 5760 });
  await test
    .info()
    .attach('callback-replacement-anchor', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('callback to numeric and back preserves horizontal and vertical offsets', async ({ page }) => {
  await mount(page);
  await scroll(page, 90, 9);
  const horizontal = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#subject .tbw-scroll-area')!;
    scroller.scrollLeft = 100;
    return scroller.scrollLeft;
  });
  expect(horizontal).toBe(100);
  await replace(page, true, true);
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(-9);
  expect((await geometry(page, 90)).scrollTop).toBe(2889);
  await replace(page, false);
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(-9);
  expect(await page.locator('#subject .tbw-scroll-area').evaluate((el) => el.scrollLeft)).toBe(horizontal);
});

test('shrinking clamps inside the same row, then clamps at the new scroll range', async ({ page }) => {
  await mount(page);
  await scroll(page, 90, 55);
  await replace(page, true);
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(-31);
  await replace(page, false);
  await page.evaluate(() => {
    const vertical = document.querySelector('.faux-vscroll')!;
    vertical.scrollTop = vertical.scrollHeight;
  });
  await expect.poll(async () => (await geometry(page, 239)).top).not.toBeNull();
  await replace(page, true);
  await expect
    .poll(async () => {
      const value = await geometry(page, 239);
      return value.scrollTop - value.maxScroll;
    })
    .toBe(0);
  expect(
    Math.abs(
      await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.rows > .data-grid-row:has(> .cell[data-row="239"])')!;
        return (
          row.getBoundingClientRect().bottom - document.querySelector('.rows-viewport')!.getBoundingClientRect().bottom
        );
      }),
    ),
  ).toBeLessThan(1);
});

test('coalesced replacements retain the first anchor, including across the config microtask', async ({ page }) => {
  await mount(page);
  await scroll(page, 90, 11);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    grid.gridConfig = { ...grid.gridConfig, rowHeight: 36 };
    await Promise.resolve();
    grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => [32, 16, 24][row.kind] };
    await grid.forceLayout();
  });
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(-11);
  expect((await geometry(page, 90)).scrollTop).toBe(2171);
});

for (const intent of ['same-id', 'index', 'pixel', 'wheel', 'rows-first', 'rows-last', 'identity'] as const) {
  test(`newer ${intent} intent cancels pending anchoring`, async ({ page }) => {
    await mount(page);
    await scroll(page, 90);
    const requested = await page.evaluate(async (intent) => {
      const grid = document.querySelector<Subject>('#subject')!;
      if (intent === 'rows-first') grid.rows = [...grid.sourceRows];
      grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => [32, 16, 24][row.kind] };
      if (intent === 'same-id') grid.scrollToRowById('row-90', { align: 'start' });
      if (intent === 'index') grid.scrollToRow(60, { align: 'start' });
      if (intent === 'pixel') grid.querySelector('.faux-vscroll')!.scrollTop = 3000;
      if (intent === 'wheel')
        grid
          .querySelector('.rows-viewport')!
          .dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
      if (intent === 'rows-last') grid.rows = [...grid.sourceRows];
      if (intent === 'identity') grid.gridConfig = { ...grid.gridConfig, getRowId: (row: Row) => `new-${row.id}` };
      const requested = grid.querySelector('.faux-vscroll')!.scrollTop;
      await grid.forceLayout();
      return requested;
    }, intent);
    if (intent === 'wheel') expect(requested).toBeGreaterThan(3600);
    await expect.poll(async () => (await geometry(page, 90)).scrollTop).toBe(requested);
  });
}

test('equal resulting heights, unchanged callbacks and reverted batches do not shift the viewport', async ({
  page,
}) => {
  await mount(page);
  await scroll(page, 90, 7);
  await replace(page, false);
  expect((await geometry(page, 90)).scrollTop).toBe(3607);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    const original = grid.gridConfig;
    grid.gridConfig = { ...original, rowHeight: 32 };
    grid.gridConfig = original;
    await grid.forceLayout();
    grid.gridConfig = { ...grid.gridConfig };
    await grid.forceLayout();
  });
  expect(await geometry(page, 90)).toMatchObject({ top: -7, scrollTop: 3607 });
});

test('ordinary forceLayout retains pixel behavior for an unchanged callback', async ({ page }) => {
  await mount(page);
  await scroll(page, 90);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    grid.rows[0].kind = 1;
    await grid.forceLayout();
  });
  expect((await geometry(page, 90)).scrollTop).toBe(3600);
});
