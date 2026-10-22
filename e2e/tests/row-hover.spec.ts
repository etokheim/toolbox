import { expect, test, type Page } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = resolve(process.env['TBW_HOVER_BUNDLE'] ?? 'dist/libs/grid/index.js');
const pointer = { x: 920, y: 446 };
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
type HoverMetrics = { hits: number; frames: { timestamp: number; duration: number; hits: number }[] };

async function mount(page: Page, mode: 'grid' | 'plain' | 'transform' = 'grid'): Promise<void> {
  await page.route('http://hover.test/index.js', async (route) =>
    route.fulfill({ contentType: 'text/javascript', body: await readFile(bundle, 'utf8') }),
  );
  await page.route('http://hover.test/pinned-columns.js', async (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(
        resolve(process.env['TBW_HOVER_PINNED_BUNDLE'] ?? 'dist/libs/grid/lib/plugins/pinned-columns/index.js'),
        'utf8',
      ),
    }),
  );
  await page.route('http://hover.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>' }),
  );
  await page.goto('http://hover.test/');
  await page.addScriptTag({
    type: 'importmap',
    content: JSON.stringify({
      imports: {
        '@toolbox-web/grid': 'http://hover.test/index.js',
        '@toolbox-web/grid/plugins/pinned-columns': 'http://hover.test/pinned-columns.js',
      },
    }),
  });
  await page.addScriptTag({ url: 'http://hover.test/index.js', type: 'module' });
  await page.evaluate(async (mode) => {
    // Platform font metrics must not change the final 8px wheel segment.
    const style = document.createElement('style');
    style.textContent = `
      #subject {position:absolute;left:324px;top:190px;width:1100px;height:693px}
      #subject .header-row {box-sizing:border-box;height:33px;min-height:33px}
      #header {height:34px}
      #viewport {height:658px;overflow:${mode === 'plain' ? 'auto' : 'hidden'}}
      #rows {will-change:transform}
      .plain-row {height:49px;box-sizing:border-box}
      .plain-row:hover {background:rgb(240,246,255)}
    `;
    document.head.append(style);
    if (mode === 'grid') {
      await customElements.whenDefined('tbw-grid');
      const grid = document.createElement('tbw-grid') as DataGridElement<{ id: string; name: string }>;
      grid.id = 'subject';
      grid.gridConfig = {
        columns: [{ field: 'name', header: 'Name', width: 1100 }],
        rowHeight: 49,
        getRowId: (row) => row.id,
      };
      grid.rows = Array.from({ length: 54 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` }));
      document.body.append(grid);
      await grid.ready();
    } else {
      const subject = document.createElement('div');
      subject.id = 'subject';
      subject.innerHTML = '<div id="header">Name</div><div id="viewport"><div id="rows"></div></div>';
      document.body.append(subject);
      const rows = document.querySelector<HTMLElement>('#rows')!;
      for (let index = 0; index < 54; index++) {
        const row = document.createElement('div');
        row.className = 'plain-row';
        row.textContent = `Row ${index}`;
        rows.append(row);
      }
      if (mode === 'transform') {
        let offset = 0;
        subject.addEventListener(
          'wheel',
          (event) => {
            event.preventDefault();
            offset = Math.max(0, Math.min(1988, offset + event.deltaY));
            rows.style.transform = `translateY(${-offset}px)`;
            subject.dataset['offset'] = String(offset);
          },
          { passive: false },
        );
      }
    }
  }, mode);
  if (mode === 'grid') {
    await expect(page.locator('#subject .header-row')).toHaveCSS('height', '33px');
    await expect
      .poll(() => page.locator('.faux-vscroll').evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBe(1988);
  }
}

async function sample(page: Page) {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)?.closest('.data-grid-row, .plain-row');
    return {
      hit: hit?.textContent,
      background: hit ? getComputedStyle(hit).backgroundColor : null,
      hover: [...document.querySelectorAll('.data-grid-row:hover, .plain-row:hover')].map((row) => row.textContent),
      marked: [...document.querySelectorAll('[data-tbw-hovered]')].map((row) => row.textContent),
      scrollTop: document.querySelector('.faux-vscroll')?.scrollTop ?? document.querySelector('#viewport')?.scrollTop,
    };
  }, pointer);
}

async function replay(page: Page, position = pointer): Promise<void> {
  await page.mouse.move(position.x, position.y);
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, 220);
    // Input pacing from the causal reduction, not a readiness wait.
    await new Promise((resolve) => setTimeout(resolve, 55));
  }

  await settle(page);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test('native row highlight follows a stationary pointer through the final 8px scroll', async ({ page }, info) => {
  await mount(page);
  expect(await page.locator('.data-grid-row').count()).toBeLessThan(54);
  await replay(page);
  const stationary = await sample(page);
  await info.attach('stationary', { body: JSON.stringify(stationary), contentType: 'application/json' });
  await info.attach('stationary-pixels', { body: await page.screenshot(), contentType: 'image/png' });
  expect(stationary.scrollTop).toBe(1988);
  expect(stationary.hit).toBe('Row 45');
  expect(stationary.background).toBe('rgb(240, 246, 255)');
  expect(stationary.marked).toEqual(['Row 45']);
  await page.mouse.move(pointer.x + 1, pointer.y);
  await expect.poll(async () => (await sample(page)).marked).toEqual(['Row 45']);
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-tbw-hovered]')).toHaveCount(0);
});

test('stationary hover survives row replacement, column rebuild and reconnect without owning focus', async ({
  page,
}) => {
  await mount(page);
  await replay(page);
  await page.evaluate(async () => {
    const grid = document.querySelector('tbw-grid') as DataGridElement<{ id: string; name: string }>;
    grid.rows = Array.from({ length: 54 }, (_, index) => ({ id: `new-${index}`, name: `Updated ${index}` }));
    await grid.forceLayout();
  });
  await settle(page);
  let state = await sample(page);
  expect(state.marked).toEqual([state.hit]);
  expect(state.hit).toBe('Updated 45');
  await page.evaluate(async () => {
    const grid = document.querySelector('tbw-grid') as DataGridElement;
    grid.columns = [
      {
        field: 'name',
        header: 'Changed',
        width: 1100,
        renderer: (_context) => {
          const button = document.createElement('button');
          button.textContent = 'Action';
          button.addEventListener('mousedown', (event) => event.stopPropagation());
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            button.setAttribute('data-clicked', '');
          });
          return button;
        },
      },
    ];
    await grid.forceLayout();
  });
  await settle(page);
  state = await sample(page);
  expect(state.marked).toEqual([state.hit]);
  const button = page.locator('[data-tbw-hovered] button');
  await button.click();
  await expect(button).toHaveAttribute('data-clicked', '');
  await expect(button).toBeFocused();
  await page.evaluate(() => {
    const grid = document.querySelector('tbw-grid')!;
    grid.remove();
    document.body.append(grid);
  });
  await settle(page);
  await page.mouse.move(10, 10);
  await page.mouse.move(pointer.x, pointer.y);
  await settle(page);
  state = await sample(page);
  expect(state.marked).toEqual([state.hit]);
});

test('overlay hit testing and touch input do not keep an underlying row highlighted', async ({ page }) => {
  await mount(page);
  await replay(page);
  await page.evaluate(async () => {
    const overlay = document.createElement('button');
    overlay.id = 'overlay';
    overlay.textContent = 'Outside control';
    overlay.style.cssText = 'position:fixed;left:900px;top:430px;width:100px;height:50px;z-index:1000';
    document.body.append(overlay);
    overlay.focus();
    await (document.querySelector('tbw-grid') as DataGridElement).forceLayout();
  });
  await settle(page);
  await expect(page.locator('[data-tbw-hovered]')).toHaveCount(0);
  await expect(page.locator('#overlay')).toBeFocused();
  await page.locator('#overlay').click();
  await expect(page.locator('#overlay')).toBeFocused();
  await page.locator('#overlay').evaluate((element) => element.remove());
  await page.mouse.move(pointer.x + 1, pointer.y);
  await settle(page);
  await expect(page.locator('[data-tbw-hovered]')).toHaveCount(1);
  await page.locator('tbw-grid').dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: pointer.x,
    clientY: pointer.y,
  });
  await settle(page);
  await expect(page.locator('[data-tbw-hovered]')).toHaveCount(0);
});

async function mountActions(page: Page, expandedWidth: number | 'content' = 240): Promise<void> {
  await mount(page);
  await page.evaluate(async (expandedWidth) => {
    const { PinnedColumnsPlugin } = await import('@toolbox-web/grid/plugins/pinned-columns');
    const grid = document.querySelector('tbw-grid') as DataGridElement<{ id: string; name: string }>;
    grid.gridConfig = {
      ...grid.gridConfig,
      plugins: [new PinnedColumnsPlugin()],
      columns: [
        { field: 'name', width: 900 },
        {
          field: 'id',
          width: 200,
          pinned: 'right',
          utility: true,
          expandedCellWidth: expandedWidth,
          renderer: ({ row }) => {
            const button = document.createElement('button');
            button.textContent = `Action ${row.id}`;
            button.style.width = '100%';
            button.addEventListener('mousedown', (event) => event.stopPropagation());
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              button.setAttribute('data-clicked', row.id);
            });
            return button;
          },
        },
      ],
    };
    const style = document.createElement('style');
    style.textContent = `
      .data-grid-row button {opacity:0;pointer-events:none}
      .data-grid-row .cell[data-tbw-cell-expanded] button {opacity:1;pointer-events:auto}
    `;
    document.head.append(style);
    await grid.forceLayout();
  }, expandedWidth);
}

test('pinned row actions follow stationary and moving pointers without changing activation ownership', async ({
  page,
}) => {
  await mountActions(page);
  await replay(page, { x: 1300, y: pointer.y });
  const row = page.locator('.data-grid-row[data-tbw-hovered]');
  await expect(row.locator('button')).toHaveText('Action row-45');
  await expect(row.locator('.cell[data-field="id"]')).toHaveCSS('position', 'sticky');
  await expect(row.locator('button')).toHaveCSS('opacity', '1');
  await page.mouse.move(1300, pointer.y + 49);
  await expect(row.locator('button')).toHaveText('Action row-46');
  const action = row.locator('button');
  await action.click();
  await expect(action).toHaveAttribute('data-clicked', 'row-46');
  await expect(action).toBeFocused();
});

for (const expandedWidth of [240, 'content'] as const) {
  test(`stationary 1980 to 1988 scroll transfers unleased action expansion while focus and leases take precedence (${expandedWidth})`, async ({
    page,
  }) => {
    await mountActions(page, expandedWidth);
    await page.mouse.move(pointer.x, pointer.y);
    for (let step = 0; step < 9; step++) {
      await page.mouse.wheel(0, 220);
      await new Promise((resolve) => setTimeout(resolve, 55));
    }
    await settle(page);
    expect((await sample(page)).scrollTop).toBe(1980);
    const oldAction = page.getByRole('button', { name: 'Action row-44', exact: true });
    const newAction = page.getByRole('button', { name: 'Action row-45', exact: true });
    const oldCell = oldAction.locator('..');
    const newCell = newAction.locator('..');
    await expect(oldCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await page.mouse.wheel(0, 220);
    await expect.poll(async () => (await sample(page)).scrollTop).toBe(1988);
    await settle(page);
    expect((await sample(page)).marked).toEqual(['Row 45Action row-45']);
    await expect(oldCell).not.toHaveAttribute('data-tbw-cell-expanded');
    await expect(newCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await expect(newAction).toHaveCSS('opacity', '1');

    await oldAction.focus();
    await expect(oldCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await expect(newCell).not.toHaveAttribute('data-tbw-cell-expanded');
    await page.evaluate(() => {
      const grid = document.querySelector('tbw-grid') as DataGridElement;
      const plugin = grid.getPluginByName('pinnedColumns');
      if (!plugin || !('retainCellExpansion' in plugin)) throw new Error('Missing pinned expansion');
      const release = (
        plugin as import('@toolbox-web/grid/plugins/pinned-columns').PinnedColumnsPlugin
      ).retainCellExpansion('row-44', 'id');
      Object.assign(window, { releaseExpansion: release });
      (document.activeElement as HTMLElement).blur();
    });
    await settle(page);
    await expect(oldCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await expect(newCell).not.toHaveAttribute('data-tbw-cell-expanded');
    await page.evaluate(() => {
      (window as typeof window & { releaseExpansion: () => void }).releaseExpansion();
    });
    await expect(oldCell).not.toHaveAttribute('data-tbw-cell-expanded');
    await expect(newCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await page.mouse.move(10, 10);
    await expect(page.locator('[data-tbw-cell-expanded]')).toHaveCount(0);
  });
}

test('ordinary nonvirtualized overflow scroll retargets browser hover', async ({ page }) => {
  await mount(page, 'plain');
  await replay(page);
  expect(await sample(page)).toMatchObject({ hit: 'Row 45', hover: ['Row 45'], scrollTop: 1988 });
});

test('transform-only control records browser hover independently of grid and recycling', async ({ page }, info) => {
  await mount(page, 'transform');
  await replay(page);
  const state = await sample(page);
  await info.attach('transform-control', { body: JSON.stringify(state), contentType: 'application/json' });
  expect(state.hit).toBe('Row 45');
  // Do not require a browser bug to persist in newer engines.
  await page.mouse.move(pointer.x + 1, pointer.y);
  await expect.poll(async () => (await sample(page)).hover).toEqual(['Row 45']);
});

test('hover work is bounded to one hit test per frame and stops when idle', async ({ page }, info) => {
  await page.addInitScript(() => {
    const metrics: HoverMetrics = { hits: 0, frames: [] };
    Object.assign(window, { hoverMetrics: metrics });
    const hitTest = document.elementFromPoint.bind(document);
    document.elementFromPoint = (x, y) => {
      metrics.hits++;
      return hitTest(x, y);
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((timestamp) => {
        const before = metrics.hits;
        const start = performance.now();
        callback(timestamp);
        if (metrics.hits > before)
          metrics.frames.push({
            timestamp,
            duration: performance.now() - start,
            hits: metrics.hits - before,
          });
      });
  });
  await mount(page);
  await replay(page);
  const readMetrics = () =>
    page.evaluate(() => (window as typeof window & { hoverMetrics: HoverMetrics }).hoverMetrics);
  const metrics = await readMetrics();
  expect(metrics.frames.length).toBeGreaterThan(0);
  const hitsByFrame = new Map<number, number>();
  for (const frame of metrics.frames)
    hitsByFrame.set(frame.timestamp, (hitsByFrame.get(frame.timestamp) ?? 0) + frame.hits);
  expect(Math.max(...hitsByFrame.values())).toBe(1);
  expect(metrics.frames.length).toBeLessThanOrEqual(25);
  await settle(page);
  await settle(page);
  expect((await readMetrics()).hits).toBe(metrics.hits);
  await info.attach('hover-frame-cost', { body: JSON.stringify(metrics), contentType: 'application/json' });
});
