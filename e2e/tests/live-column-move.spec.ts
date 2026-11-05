import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * ReorderPlugin `livePreview` against the built bundles, in a real browser:
 * live rearrangement, Escape rollback, persistence only on drop, unchanged
 * pinned/locked/group restrictions — plus the classic drop's two visual
 * defects (group drop indicator, last-slot scrollbar flash).
 */
test.use({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });

type Options = {
  livePreview?: boolean;
  pinned?: boolean;
  locked?: boolean;
  groups?: boolean;
  lockGroupOrder?: boolean;
  animation?: false | 'flip';
};

const PLUGINS = {
  'reorder.js': ['reorder-columns', '@toolbox-web/grid/plugins/reorder-columns'],
  'pinned.js': ['pinned-columns', '@toolbox-web/grid/plugins/pinned-columns'],
  'grouping.js': ['grouping-columns', '@toolbox-web/grid/plugins/grouping-columns'],
} as const;

async function mount(page: Page, options: Options) {
  const core = process.env['TBW_LIVE_MOVE_CORE'] ?? 'dist/libs/grid/index.js';
  await page.route('http://move.test/index.js', async (route) =>
    route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(core), 'utf8') }),
  );
  for (const [name, [dir]] of Object.entries(PLUGINS)) {
    await page.route(`http://move.test/${name}`, async (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(resolve(`dist/libs/grid/lib/plugins/${dir}/index.js`), 'utf8'),
      }),
    );
  }
  await page.route('http://move.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>' }),
  );
  await page.goto('http://move.test/');
  const imports: Record<string, string> = { '@toolbox-web/grid': 'http://move.test/index.js' };
  for (const [name, [, specifier]] of Object.entries(PLUGINS)) imports[specifier] = `http://move.test/${name}`;
  await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports }) });
  await page.addScriptTag({ type: 'module', url: 'http://move.test/index.js' });

  await page.evaluate(async (o) => {
    await customElements.whenDefined('tbw-grid');
    const { ReorderPlugin } = await import('@toolbox-web/grid/plugins/reorder-columns' as string);
    const { PinnedColumnsPlugin } = await import('@toolbox-web/grid/plugins/pinned-columns' as string);
    const { GroupingColumnsPlugin } = await import('@toolbox-web/grid/plugins/grouping-columns' as string);
    // Classic scrollbars, so a transient horizontal overflow costs layout height.
    const style = document.createElement('style');
    style.textContent =
      '::-webkit-scrollbar{width:15px;height:15px;background:#ccc}::-webkit-scrollbar-thumb{background:#888}';
    document.head.append(style);

    const grid = document.createElement('tbw-grid') as HTMLElement & Record<string, any>;
    grid.id = 'subject';
    grid.style.cssText = 'display:block;width:900px;height:400px';
    document.body.append(grid);

    const log: string[] = [];
    (window as any).__log = log;
    grid.addEventListener('column-move', (e: Event) =>
      log.push('column-move:' + (e as CustomEvent).detail.columnOrder.join(',')),
    );
    grid.addEventListener('column-state-change', () => log.push('column-state-change'));

    const plugins: unknown[] = [];
    if (o.pinned) plugins.push(new PinnedColumnsPlugin());
    if (o.groups) plugins.push(new GroupingColumnsPlugin({ lockGroupOrder: o.lockGroupOrder }));
    plugins.push(
      new ReorderPlugin({ livePreview: o.livePreview, animation: o.animation ?? 'flip', animationDuration: 120 }),
    );

    grid.gridConfig = {
      fitMode: 'stretch',
      plugins,
      columnGroups: o.groups
        ? [
            { id: 'left', header: 'Left', children: ['a', 'b'] },
            { id: 'right', header: 'Right', children: ['c', 'd'] },
          ]
        : undefined,
      columns: [
        { field: 'id', width: 80, pinned: o.pinned ? 'left' : undefined },
        { field: 'a', width: 100 },
        { field: 'b', width: 200 },
        { field: 'c', width: 120, lockPosition: o.locked || undefined },
        { field: 'd' },
      ],
    };
    grid.rows = Array.from({ length: 30 }, (_, i) => ({ id: i, a: 'a' + i, b: 'b' + i, c: 'c' + i, d: 'd' + i }));
    await grid.ready?.();
  }, options);
  await page.waitForTimeout(200);
}

const order = (page: Page) => page.evaluate(() => (document.getElementById('subject') as any).getColumnOrder());
const log = (page: Page) => page.evaluate(() => [...(window as any).__log] as string[]);

/** Visual header order (by on-screen left), so transforms count. */
const visualOrder = (page: Page, row = '.header-row') =>
  page.evaluate((row) => {
    const cells = [...document.querySelectorAll<HTMLElement>(`#subject ${row} > .cell[data-field]`)];
    return cells
      .map((c) => ({ f: c.dataset['field']!, x: c.getBoundingClientRect().left }))
      .sort((p, q) => p.x - q.x)
      .map((c) => c.f);
  }, row);

const bodyVisualOrder = (page: Page) =>
  page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll<HTMLElement>('#subject .data-grid-row:first-child > .cell[data-field]'),
    ];
    return cells
      .map((c) => ({ f: c.dataset['field']!, x: c.getBoundingClientRect().left }))
      .sort((p, q) => p.x - q.x)
      .map((c) => c.f);
  });

async function point(page: Page, selector: string, fx: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height / 2 };
}

/** Press on `from`, hover `fx` across `over`, and leave the drag open. */
async function dragOver(page: Page, from: string, over: string, fx: number) {
  const start = await point(page, from, 0.5);
  const target = await point(page, over, fx);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y, { steps: 2 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.move(target.x + 1, target.y);
  await page.waitForTimeout(250);
}

const header = (f: string) => `#subject .header-row > .cell[data-field="${f}"]`;
const group = (id: string) => `#subject .header-group-row > .cell[data-group="${id}"]`;

test.describe('live column movement', () => {
  test('rearranges header and body live, and persists only on drop', async ({ page }) => {
    await mount(page, { livePreview: true });
    await dragOver(page, header('a'), header('d'), 0.75);

    expect(await visualOrder(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    expect(await bodyVisualOrder(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    await page.waitForTimeout(400); // longer than the state-change debounce
    expect(await log(page)).toEqual([]);

    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await order(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    expect(await visualOrder(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    expect(await bodyVisualOrder(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    expect(await log(page)).toEqual(['column-move:id,b,c,d,a', 'column-state-change']);
    // No transform left behind.
    expect(await page.locator('#subject[data-tbw-reorder-preview]').count()).toBe(0);
  });

  test('Escape restores the original order exactly', async ({ page }) => {
    await mount(page, { livePreview: true });
    const before = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#subject .cell[data-field]')].map(
        (c) => c.getBoundingClientRect().left,
      ),
    );
    await dragOver(page, header('b'), header('d'), 0.75);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'c', 'd', 'b']);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(400);

    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#subject .cell[data-field]')].map(
        (c) => c.getBoundingClientRect().left,
      ),
    );
    expect(after).toEqual(before);
    expect(await log(page)).toEqual([]);
  });

  test('releasing back on its own slot is a no-op', async ({ page }) => {
    await mount(page, { livePreview: true });
    const start = await point(page, header('b'), 0.5);
    const far = await point(page, header('d'), 0.75);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(far.x, far.y, { steps: 6 });
    await page.waitForTimeout(150);
    // b's original slot is now drawn by c/d, but targeting uses the original layout.
    await page.mouse.move(start.x, start.y, { steps: 6 });
    await page.waitForTimeout(250);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    expect(await log(page)).toEqual([]);
  });

  test('pinned and locked columns stay drop-refusing targets', async ({ page }) => {
    await mount(page, { livePreview: true, pinned: true, locked: true });
    expect(await page.locator(header('c')).getAttribute('draggable')).toBe('false');

    await dragOver(page, header('b'), header('id'), 0.25);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);

    await dragOver(page, header('b'), header('c'), 0.75);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);

    // Moving past the locked column (onto a movable neighbour) stays allowed, as without the preview.
    await dragOver(page, header('b'), header('d'), 0.75);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'c', 'd', 'b']);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'a', 'c', 'd', 'b']);
    expect(await log(page)).toEqual(['column-move:id,a,c,d,b', 'column-state-change']);
  });

  test('a group header drags its fragment as a block', async ({ page }) => {
    await mount(page, { livePreview: true, groups: true });
    await dragOver(page, group('left'), group('right'), 0.75);
    expect(await visualOrder(page)).toEqual(['id', 'c', 'd', 'a', 'b']);
    const groupLeft = () => page.$eval(group('left'), (el) => el.getBoundingClientRect().left);
    const rightGroupLeft = await page.$eval(group('right'), (el) => el.getBoundingClientRect().left);
    expect(await groupLeft()).toBeGreaterThan(rightGroupLeft);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'c', 'd', 'a', 'b']);
  });

  test('a lockGroupOrder veto slides the preview back', async ({ page }) => {
    await mount(page, { livePreview: true, groups: true, lockGroupOrder: true });
    await dragOver(page, header('a'), header('d'), 0.75);
    expect(await visualOrder(page)).toEqual(['id', 'b', 'c', 'd', 'a']);
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await order(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    expect(await visualOrder(page)).toEqual(['id', 'a', 'b', 'c', 'd']);
    // Within its own group the move is still allowed.
    await dragOver(page, header('a'), header('b'), 0.75);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order(page)).toEqual(['id', 'b', 'a', 'c', 'd']);
  });
});

test.describe('classic drop visuals', () => {
  test('a group drop target shows the indicator', async ({ page }) => {
    await mount(page, { groups: true });
    await dragOver(page, group('left'), group('right'), 0.75);
    const indicator = await page.evaluate(
      (sel) => getComputedStyle(document.querySelector(sel)!, '::after').width,
      group('right'),
    );
    expect(indicator).toBe('2px');
    await page.mouse.up();
  });

  test('moving out of the last slot never flashes a horizontal scrollbar', async ({ page }) => {
    await mount(page, { animation: 'flip' });
    const samples = await page.evaluate(async () => {
      const grid = document.getElementById('subject') as any;
      const area = grid.querySelector('.tbw-scroll-area') as HTMLElement;
      const out: number[] = [];
      grid.getPluginByName('reorderColumns').moveColumn('d', 1);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push(area.scrollWidth - area.clientWidth);
      }
      return out;
    });
    expect(samples.every((overflow) => overflow === 0)).toBe(true);
  });
});
