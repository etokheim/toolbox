import { expect, test, type Page } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import type { MasterDetailPlugin } from '@toolbox-web/grid/plugins/master-detail';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Row = { id: string; height: number };
type Subject = DataGridElement<Row>;

async function mount(page: Page, count: number, mode: 'callback' | 'numeric' | 'default', animated = false) {
  const root = process.env['TBW_DETAIL_PACKAGE'] ?? 'dist/libs/grid';
  for (const [name, path] of Object.entries({
    'core.js': 'index.js',
    'detail.js': 'lib/plugins/master-detail/index.js',
  })) {
    await page.route(`http://detail.test/${name}`, async (route) =>
      route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(root, path), 'utf8') }),
    );
  }
  await page.route('http://detail.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://detail.test/');
  await page.addScriptTag({
    type: 'importmap',
    content: JSON.stringify({
      imports: {
        '@toolbox-web/grid': 'http://detail.test/core.js',
        '@toolbox-web/grid/plugins/master-detail': 'http://detail.test/detail.js',
      },
    }),
  });
  await page.addScriptTag({ type: 'module', url: 'http://detail.test/core.js' });
  await page.evaluate(
    async ({ count, mode, animated }) => {
      await customElements.whenDefined('tbw-grid');
      const { MasterDetailPlugin } = await import('@toolbox-web/grid/plugins/master-detail');
      const grid = document.createElement('tbw-grid') as Subject;
      grid.id = 'subject';
      const style = document.createElement('style');
      style.textContent = `
        body { font:14px system-ui }
        #subject { display:block; width:600px; height:120px; --tbw-row-height:40px }
        #subject .data-grid-row { border-bottom:0 }
      `;
      document.head.append(style);
      const plugin = new MasterDetailPlugin({
        animation: animated ? 'slide' : false,
        detailHeight: 'auto',
        detailRenderer: () => {
          const content = document.createElement('div');
          content.className = 'detail-content';
          content.style.height = '80px';
          content.textContent = 'Generic detail content';
          return content;
        },
      });
      grid.gridConfig = {
        columns: [{ field: 'id' }],
        getRowId: (row) => row.id,
        rowHeight: mode === 'callback' ? (row) => row.height : mode === 'numeric' ? 56 : undefined,
        animation: { mode: 'on' },
        plugins: [plugin],
      };
      grid.rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, height: index === 0 ? 56 : 40 }));
      document.body.append(grid);
      await grid.ready();
    },
    { count, mode, animated },
  );
  await expect(page.locator('.rows > .data-grid-row').first()).toBeVisible();
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    const plugin = grid.getPluginByName('masterDetail') as MasterDetailPlugin;
    const row = grid.querySelector<HTMLElement>('.rows > .data-grid-row:has(> .cell[data-row="0"])')!;
    const detail = grid.querySelector<HTMLElement>('.master-detail-row');
    const next = grid.querySelector<HTMLElement>('.rows > .data-grid-row:has(> .cell[data-row="1"])')!;
    const viewport = grid.querySelector<HTMLElement>('.rows-viewport')!;
    const base = row.getBoundingClientRect().height;
    const panel = detail?.getBoundingClientRect().height ?? 0;
    return {
      base,
      panel,
      reported: plugin.getRowHeight(grid.rows[0], 0),
      actual: base + panel,
      nextOffset: next.getBoundingClientRect().top - row.getBoundingClientRect().top,
      nextViewportOffset: next.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      cacheHeight: grid._virtualization.positionCache?.[0].height,
      cacheNextOffset: grid._virtualization.positionCache?.[1].offset,
      total: grid._virtualization.scrollMapping.rawContentHeight,
      scrollTop: grid.querySelector('.faux-vscroll')!.scrollTop,
      animating: !!detail?.matches('.tbw-expanding, .tbw-collapsing'),
    };
  });
}

async function expand(page: Page) {
  await page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    (grid.getPluginByName('masterDetail') as MasterDetailPlugin).expand(0);
  });
  await expect(page.locator('.master-detail-row')).toBeVisible();
  await expect.poll(async () => (await metrics(page)).animating).toBe(false);
}

for (const count of [4, 80]) {
  for (const mode of ['callback', 'numeric', 'default'] as const) {
    test(`${count} rows: ${mode} base plus measured detail controls real offsets and scroll`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await mount(page, count, mode);
      await expand(page);
      const base = mode === 'default' ? 40 : 56;
      await expect.poll(() => metrics(page)).toMatchObject({ cacheHeight: base + 109, actual: base + 109 });
      const expanded = await metrics(page);
      expect(expanded).toMatchObject({
        base,
        panel: 109,
        reported: base + 109,
        actual: base + 109,
        nextOffset: base + 109,
        cacheNextOffset: base + 109,
        total: base + 109 + (count - 1) * (mode === 'numeric' ? 56 : 40),
      });
      await page.evaluate(() =>
        document.querySelector<Subject>('#subject')!.scrollToRowById('row-1', { align: 'start', behavior: 'instant' }),
      );
      await expect.poll(async () => (await metrics(page)).nextViewportOffset).toBe(0);
      expect((await metrics(page)).scrollTop).toBe(base + 109);
      await test
        .info()
        .attach('expanded-geometry', { body: JSON.stringify(expanded), contentType: 'application/json' });
      expect(errors).toEqual([]);
    });
  }
}

test('open density changes, async detail growth, animated collapse/re-expand and recycling', async ({ page }) => {
  await mount(page, 80, 'callback', true);
  await expand(page);
  await expect.poll(async () => (await metrics(page)).cacheHeight).toBe(165);
  await page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    grid.gridConfig = { ...grid.gridConfig, rowHeight: (_row: Row, index: number) => (index === 0 ? 64 : 44) };
  });
  await expect.poll(async () => (await metrics(page)).cacheNextOffset).toBe(173);
  expect((await metrics(page)).actual).toBe(173);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    grid.querySelector<HTMLElement>('.detail-content')!.style.height = '140px';
    grid.invalidateRowHeight(0);
  });
  await expect.poll(async () => (await metrics(page)).cacheNextOffset).toBe(233);
  expect((await metrics(page)).actual).toBe(233);
  await page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    (grid.getPluginByName('masterDetail') as MasterDetailPlugin).collapse(0);
  });
  await expect(page.locator('.master-detail-row')).toHaveCount(0);
  await expect.poll(async () => (await metrics(page)).cacheNextOffset).toBe(64);
  expect((await metrics(page)).nextOffset).toBe(64);
  await expand(page);
  await expect.poll(async () => (await metrics(page)).cacheNextOffset).toBe(173);
  await page.evaluate(() => document.querySelector<Subject>('#subject')!.scrollToRowById('row-60'));
  await expect(page.locator('.rows > .data-grid-row:has(> .cell[data-row="0"])')).toHaveCount(0);
  await page.evaluate(() => document.querySelector<Subject>('#subject')!.scrollToRowById('row-0'));
  await expect(page.locator('.rows > .data-grid-row:has(> .cell[data-row="0"])')).toBeVisible();
  await expect.poll(async () => (await metrics(page)).cacheNextOffset).toBe(173);
  expect((await metrics(page)).actual).toBe(173);
  await page.evaluate(() => document.querySelector('#subject')!.remove());
  await expect(page.locator('.master-detail-row')).toHaveCount(0);
});
