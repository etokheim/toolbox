import { expect, test, type Page } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Row = { id: string; actions: string[] };
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });

async function mount(page: Page, mode: number | 'content' = 'content') {
  const bundles = {
    'index.js': process.env['TBW_CONTENT_CORE'] ?? 'dist/libs/grid/index.js',
    'pinned.js': process.env['TBW_CONTENT_PINNED'] ?? 'dist/libs/grid/lib/plugins/pinned-columns/index.js',
  };
  for (const [name, path] of Object.entries(bundles)) {
    await page.route(`http://content.test/${name}`, async (route) =>
      route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(path), 'utf8') }),
    );
  }
  await page.route('http://content.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://content.test/');
  await page.addScriptTag({
    type: 'importmap',
    content: JSON.stringify({
      imports: {
        '@toolbox-web/grid': 'http://content.test/index.js',
        '@toolbox-web/grid/plugins/pinned-columns': 'http://content.test/pinned.js',
      },
    }),
  });
  await page.addScriptTag({ type: 'module', url: 'http://content.test/index.js' });
  await page.evaluate(async (mode) => {
    await customElements.whenDefined('tbw-grid');
    const { PinnedColumnsPlugin } = await import('@toolbox-web/grid/plugins/pinned-columns');
    const pinned = new PinnedColumnsPlugin();
    const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
    grid.id = 'subject';
    const style = document.createElement('style');
    style.textContent = `
      #subject { width:800px; height:400px; --tbw-pinned-cell-shadow:-6px 0 0 rgb(255,0,0) }
      #subject .cell[data-field="actions"] { padding:4px 8px; }
      .action-host, .action-wrapper, .action-strip { width:100%; min-width:0; box-sizing:border-box }
      .action-wrapper { padding-right:12px }
      .action-strip { display:flex; justify-content:flex-end; gap:2px; padding:0 4px; overflow:hidden }
      .action-strip button { flex:none; white-space:nowrap; font:14px monospace; padding:4px; border:1px solid; }
      .action-strip .secondary { visibility:hidden }
      [data-tbw-cell-expanded] .action-strip .secondary { visibility:visible }
      .action-strip .primary { width:28px }
      .action-strip .more { width:32px }
    `;
    document.head.append(style);
    grid.gridConfig = {
      getRowId: (row) => row.id,
      rowHeight: 49,
      plugins: [pinned],
      columns: [
        { field: 'id', pinned: 'left', width: 72 },
        { field: 'name', width: 1000, renderer: ({ row }) => row.id },
        {
          field: 'actions',
          utility: true,
          pinned: 'right',
          width: 120,
          expandedCellWidth: mode,
          renderer: ({ row }) => {
            const host = document.createElement('div');
            host.className = 'action-host';
            const wrapper = document.createElement('div');
            wrapper.className = 'action-wrapper';
            const strip = document.createElement('div');
            strip.className = 'action-strip';
            for (const label of [...row.actions, '+', '...']) {
              const button = document.createElement('button');
              button.textContent = label;
              button.className = label === '...' ? 'more' : label === '+' ? 'primary' : 'secondary';
              button.addEventListener('mousedown', (event) => event.stopPropagation());
              button.addEventListener('click', (event) => {
                event.stopPropagation();
                button.dataset['clicked'] = 'true';
                if (button.className !== 'more') return;
                const release = pinned.retainCellExpansion(row.id, 'actions');
                const menu = document.createElement('button');
                menu.id = 'menu';
                menu.textContent = `Close ${row.id}`;
                menu.style.cssText = 'position:fixed;left:900px;top:20px';
                menu.onclick = () => {
                  release();
                  menu.remove();
                };
                document.body.append(menu);
                menu.focus();
              });
              strip.append(button);
            }
            wrapper.append(strip);
            host.append(wrapper);
            return host;
          },
        },
        { field: 'chooser', utility: true, pinned: 'right', width: 36 },
      ],
    };
    grid.rows = Array.from({ length: 54 }, (_, index) => ({
      id: `occurrence-${index}`,
      actions:
        index === 0 ? [] : index === 1 ? ['x'] : index === 3 ? Array(20).fill('Long action') : ['Inspect', 'Change'],
    }));
    document.body.append(grid);
    await grid.ready();
  }, mode);
}

const cell = (page: Page, index: number) =>
  page.locator(`.rows > .data-grid-row > .cell[data-row="${index}"][data-field="actions"]`);

async function geometry(page: Page, index: number) {
  return cell(page, index).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.header-row > .cell[data-field="actions"]')!;
    const viewport = document.querySelector<HTMLElement>('.tbw-scroll-area')!;
    const strip = element.querySelector<HTMLElement>('.action-strip')!;
    const more = strip.querySelector<HTMLElement>('.more')!.getBoundingClientRect();
    const primary = strip.querySelector<HTMLElement>('.primary')!.getBoundingClientRect();
    const buttons = Array.from(strip.children);
    const padding = (node: Element) => {
      const css = getComputedStyle(node);
      return (
        parseFloat(css.paddingLeft) +
        parseFloat(css.paddingRight) +
        parseFloat(css.borderLeftWidth) +
        parseFloat(css.borderRightWidth)
      );
    };
    const natural =
      buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0) +
      (buttons.length - 1) * parseFloat(getComputedStyle(strip).columnGap) +
      padding(strip) +
      padding(element.querySelector('.action-wrapper')!) +
      padding(element.querySelector('.action-host')!) +
      padding(element);
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      natural,
      moreLeft: more.left,
      moreRight: more.right,
      primaryLeft: primary.left,
      header: header.getBoundingClientRect().width,
      available: viewport.clientWidth - 72 - 36,
      scrollWidth: viewport.scrollWidth,
      leftRail: document.querySelector('.header-row > .cell[data-field="id"]')!.getBoundingClientRect().right,
      shadow: getComputedStyle(element).boxShadow,
      expanded: element.hasAttribute('data-tbw-cell-expanded'),
    };
  });
}

test('content fits each occurrence, not a column maximum, and keeps persistent painted positions', async ({
  page,
}, info) => {
  await mount(page);
  for (const index of [0, 1, 2, 3]) {
    await page.mouse.move(1100, 750);
    await expect(cell(page, index)).not.toHaveAttribute('data-tbw-cell-expanded');
    const before = await geometry(page, index);
    await cell(page, index).hover();
    await expect(cell(page, index)).toHaveAttribute('data-tbw-cell-expanded', '');
    const after = await geometry(page, index);
    expect(after.width).toBeCloseTo(Math.max(120, Math.min(after.natural, after.available)), 1);
    expect(after.header).toBe(120);
    expect(after.right).toBeCloseTo(before.right, 1);
    expect(after.moreLeft).toBeCloseTo(before.moreLeft, 1);
    expect(after.primaryLeft).toBeCloseTo(before.primaryLeft, 1);
    expect(after.scrollWidth).toBe(before.scrollWidth);
    expect(after.left).toBeGreaterThanOrEqual(after.leftRail);
    expect(after.shadow).toContain('rgb(255, 0, 0) -6px 0px 0px');
    expect((await geometry(page, (index + 1) % 4)).width).toBe(120);
    if (index < 2) expect(after.width).toBe(120);
    await info.attach(`geometry-${index}`, {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
  }
  await info.attach('painted-moving-edge', { body: await page.screenshot(), contentType: 'image/png' });
});

test('mounted labels, fonts, permissions and viewport change intrinsic width without replacing controls', async ({
  page,
}) => {
  await mount(page);
  await cell(page, 2).locator('.more').click();
  await expect(page.locator('#menu')).toBeFocused();
  const before = await geometry(page, 2);
  await cell(page, 2)
    .locator('.secondary')
    .first()
    .evaluate((button) => {
      button.textContent = 'Inspect all permitted details';
    });
  await expect.poll(async () => (await geometry(page, 2)).width).toBeGreaterThan(before.width);
  const labelled = await geometry(page, 2);
  await cell(page, 2)
    .locator('.secondary')
    .evaluateAll((buttons) => buttons.forEach((button) => ((button as HTMLElement).style.fontSize = '20px')));
  await expect.poll(async () => (await geometry(page, 2)).width).toBeGreaterThan(labelled.width);
  await page.locator('#subject').evaluate((grid) => ((grid as HTMLElement).style.width = '350px'));
  await expect
    .poll(async () => {
      const state = await geometry(page, 2);
      return state.width - state.available;
    })
    .toBeCloseTo(0, 1);
  const clamped = await geometry(page, 2);
  expect(clamped.left).toBeCloseTo(clamped.leftRail, 1);
  expect(clamped.moreRight).toBeLessThan(clamped.right);
  await cell(page, 2)
    .locator('.secondary')
    .evaluateAll((buttons) => buttons.forEach((button) => button.remove()));
  await expect.poll(async () => (await geometry(page, 2)).width).toBe(120);
  await expect(cell(page, 2)).toHaveAttribute('data-tbw-cell-expanded', '');
  await expect(cell(page, 2).locator('.more')).toHaveAttribute('data-clicked', 'true');
  await expect(page.locator('#menu')).toBeFocused();
  await page.locator('#menu').click();
  await expect(cell(page, 2)).not.toHaveAttribute('data-tbw-cell-expanded');
});

test('numeric widths retain pixel semantics and content remains bounded during horizontal scrolling', async ({
  page,
}) => {
  await mount(page, 240);
  await cell(page, 0).hover();
  expect((await geometry(page, 0)).width).toBe(240);
  await page.evaluate(async () => {
    const grid = document.querySelector('tbw-grid') as DataGridElement<Row>;
    grid.columns = grid.gridConfig.columns!.map((column) =>
      column.field === 'actions' ? { ...column, expandedCellWidth: 'content' as const } : column,
    );
    await grid.forceLayout();
  });
  await cell(page, 3).hover();
  const before = await geometry(page, 3);
  await page.mouse.wheel(400, 0);
  await expect.poll(() => page.locator('.tbw-scroll-area').evaluate((area) => area.scrollLeft)).toBeGreaterThan(0);
  const after = await geometry(page, 3);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.right).toBeCloseTo(before.right, 1);
  expect(after.left).toBeGreaterThanOrEqual(after.leftRail);
  await page.mouse.wheel(10, 49);
  await expect.poll(() => page.locator('.faux-vscroll').evaluate((area) => area.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const hovered = document.querySelector('.data-grid-row[data-tbw-hovered]');
        return hovered?.querySelector('.cell[data-field="actions"]')?.hasAttribute('data-tbw-cell-expanded');
      }),
    )
    .toBe(true);
});

test('content leases retire on occurrence replacement and reconnect keeps one live owner', async ({ page }) => {
  await mount(page);
  await cell(page, 2).locator('.more').click();
  await page.mouse.move(1100, 750);
  await page.evaluate(async () => {
    const grid = document.querySelector('tbw-grid') as DataGridElement<Row>;
    grid.rows = grid.rows.map((row) => ({ ...row, id: `replacement-${row.id}` }));
    await grid.forceLayout();
  });
  await expect(page.locator('[data-tbw-cell-expanded]')).toHaveCount(0);
  await page.locator('#menu').click();
  await cell(page, 2).locator('.more').click();
  await expect(page.locator('[data-tbw-cell-expanded]')).toHaveCount(1);
  await page.mouse.move(1100, 750);
  await page.evaluate(() => {
    const grid = document.querySelector('tbw-grid')!;
    grid.remove();
    document.body.append(grid);
  });
  await expect(page.locator('[data-tbw-cell-expanded]')).toHaveCount(0);
  await page.locator('#menu').click();
  await cell(page, 0).locator('.more').click();
  await expect(page.locator('[data-tbw-cell-expanded]')).toHaveCount(1);
  expect((await geometry(page, 0)).width).toBe(120);
  await page.locator('#menu').click();
});

test('an inner right-pinned neighbour prevents content expansion over its occupied rail', async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const grid = document.querySelector('tbw-grid') as DataGridElement<Row>;
    grid.columns = grid.gridConfig.columns!.map((column) =>
      column.field === 'id' ? { ...column, pinned: 'right' as const } : column,
    );
    await grid.forceLayout();
  });
  await cell(page, 2).hover();
  await expect(cell(page, 2)).toHaveAttribute('data-tbw-cell-expanded', '');
  expect((await geometry(page, 2)).width).toBe(120);
});

test.describe('coarse first tap', () => {
  test.use({ hasTouch: true });
  test('persistent More opens once without a preceding expansion gesture', async ({ page }) => {
    await mount(page);
    const more = cell(page, 2).locator('.more');
    await expect(cell(page, 2)).not.toHaveAttribute('data-tbw-cell-expanded');
    await more.tap();
    await expect(page.locator('#menu')).toHaveCount(1);
    await expect(page.locator('#menu')).toBeFocused();
    await expect(more).toHaveAttribute('data-clicked', 'true');
    await page.locator('#menu').tap();
  });
});
