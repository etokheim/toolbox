import { expect, test, type Page } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Row = { id: string; kind: number; actions?: string; section?: string; children?: Row[] };
type Subject = DataGridElement<Row>;

async function mount(page: Page, external: boolean, actions = false) {
  const root = process.env['TBW_ANCESTOR_PACKAGE'] ?? 'dist/libs/grid';
  const imports: Record<string, string> = {};
  for (const entry of ['', 'tree', 'hierarchy', 'grouping-rows', 'sticky-rows', 'selection', 'pinned-columns']) {
    const url = `http://ancestors.test/${entry || 'core'}.js`;
    imports[`@toolbox-web/grid${entry ? `/plugins/${entry}` : ''}`] = url;
    await page.route(url, async (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(resolve(root, entry ? `lib/plugins/${entry}/index.js` : 'index.js'), 'utf8'),
      }),
    );
  }
  await page.route('http://ancestors.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }),
  );
  await page.goto('http://ancestors.test/');
  await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports }) });
  await page.addScriptTag({ type: 'module', url: imports['@toolbox-web/grid'] });
  await page.evaluate(
    async ({ external, actions }) => {
      const [
        { TreePlugin },
        { GroupingRowsPlugin },
        { StickyRowsPlugin },
        { SelectionPlugin },
        { PinnedColumnsPlugin },
      ] = await Promise.all([
        import('@toolbox-web/grid/plugins/tree'),
        import('@toolbox-web/grid/plugins/grouping-rows'),
        import('@toolbox-web/grid/plugins/sticky-rows'),
        import('@toolbox-web/grid/plugins/selection'),
        import('@toolbox-web/grid/plugins/pinned-columns'),
      ]);
      await customElements.whenDefined('tbw-grid');
      const style = document.createElement('style');
      style.textContent = `
      body { font:14px system-ui; margin:0 }
      #owner { height:320px; overflow:auto; width:600px }
      #subject { display:block; width:600px; height:320px }
      #subject .data-grid-row { border-bottom:0 }
      #subject .cell { padding-block:0; font:12px/1 system-ui }
      #subject .group-row { padding-block:0; min-height:0; height:24px }
      #subject .group-row > .cell { min-height:0 }
      #subject[data-compact] .group-row { height:16px }
      #subject button { font:12px/1 system-ui }
      #before, #after { height:100px }
      #subject { --tbw-pinned-cell-shadow:-6px 0 0 rgb(255,0,0) }
      .actions { display:flex; width:100%; min-width:0; justify-content:flex-end; gap:4px; overflow:hidden }
      .actions button { flex:none; height:28px; white-space:nowrap }
      .actions .secondary { visibility:hidden }
      [data-tbw-cell-expanded] .actions .secondary { visibility:visible }
    `;
      document.head.append(style);
      const owner = document.createElement('div');
      owner.id = 'owner';
      const before = document.createElement('div');
      before.id = 'before';
      const after = document.createElement('div');
      after.id = 'after';
      after.textContent = 'Following content';
      document.body.append(owner);
      const grid = document.createElement('tbw-grid') as Subject;
      grid.id = 'subject';
      const pinned = new PinnedColumnsPlugin();
      grid.gridConfig = {
        columns: [
          {
            field: 'id',
            renderer: ({ row }) => {
              const button = document.createElement('button');
              button.textContent = row.id;
              button.id = `action-${row.id}`;
              button.onclick = () => (grid.dataset['lastAction'] = row.id);
              return button;
            },
          },
          ...(actions
            ? [
                {
                  field: 'actions' as const,
                  utility: true,
                  pinned: 'right' as const,
                  width: 72,
                  expandedCellWidth: 'content' as const,
                  renderer: ({ row }: { row: Row }) => {
                    const strip = document.createElement('div');
                    strip.className = 'actions';
                    for (const label of ['Inspect', 'Change', 'More']) {
                      const button = document.createElement('button');
                      button.textContent = label;
                      button.className = label === 'More' ? 'more' : 'secondary';
                      button.onmousedown = (event) => event.stopPropagation();
                      button.onclick = (event) => {
                        event.stopPropagation();
                        grid.dataset['command'] = `${row.id}:${label}`;
                        if (label !== 'More') return;
                        const release = pinned.retainCellExpansion(row.id, 'actions');
                        const menu = document.createElement('button');
                        menu.textContent = 'Close menu';
                        menu.id = 'menu';
                        menu.style.cssText = 'position:fixed;left:650px;top:20px';
                        menu.onclick = () => {
                          release();
                          menu.remove();
                        };
                        document.body.append(menu);
                        menu.focus();
                      };
                      strip.append(button);
                    }
                    return strip;
                  },
                },
              ]
            : []),
        ],
        getRowId: (row) => row.id,
        rowHeight: (row) => [56, 24, 40][row.kind ?? 1],
        plugins: [
          new TreePlugin({ defaultExpanded: true, animation: false }),
          new GroupingRowsPlugin({
            groupOn: (row: Row) => row.section ?? null,
            defaultExpanded: true,
            childGroupsCollapsible: false,
            animation: false,
            groupRowRenderer: () => {
              const title = document.createElement('div');
              title.className = 'cell';
              title.textContent = 'Section';
              return title;
            },
          }),
          new SelectionPlugin({ mode: 'row', checkbox: true }),
          new StickyRowsPlugin({
            mode: 'ancestors',
            isSticky: () => true,
            scrollContainer: external ? owner : undefined,
          }),
          ...(actions ? [pinned] : []),
        ],
      };
      grid.rows = Array.from({ length: 80 }, (_, i) => ({
        id: `root-${i}`,
        kind: 0,
        children: [{ id: `child-${i}`, kind: 2, section: 'Section' }],
      }));
      owner.append(before, grid, after);
      await grid.ready();
      if (external) {
        const viewport = grid.querySelector<HTMLElement>('.rows-viewport')!;
        const body = grid.querySelector<HTMLElement>('.rows')!;
        const header = grid.querySelector<HTMLElement>('.header')!;
        const size = () => {
          const chrome = grid.getBoundingClientRect().height - viewport.getBoundingClientRect().height;
          const height = body.getBoundingClientRect().height + chrome;
          if (Math.abs(grid.getBoundingClientRect().height - height) > 0.5) grid.style.height = `${height}px`;
        };
        const observer = new ResizeObserver(size);
        observer.observe(body);
        observer.observe(header);
        viewport.style.overflow = 'clip';
        size();
        await grid.forceLayout();
      }
    },
    { external, actions },
  );
  await expect(page.locator('#action-root-0')).toBeVisible();
}

async function geometry(page: Page, index: number) {
  return page.evaluate((index) => {
    const grid = document.querySelector<Subject>('#subject')!;
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const header = grid.querySelector<HTMLElement>('.header')!;
    const viewport = grid.querySelector<HTMLElement>('.rows-viewport')!;
    const row = grid.findRenderedRowElement(index);
    return {
      top: row ? row.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
      rowHeight: row?.getBoundingClientRect().height,
      ownerTop: owner.scrollTop,
      fauxTop: grid.querySelector('.faux-vscroll')!.scrollTop,
      headerTop: header.getBoundingClientRect().top,
      viewportHeight: viewport.getBoundingClientRect().height,
      pool: grid.querySelectorAll('.rows > .data-grid-row').length,
      window: grid._virtualization.end - grid._virtualization.start,
      retained: grid.querySelectorAll('.tbw-ancestor-retained').length,
      ids: [...grid.querySelectorAll('.rows > .data-grid-row')].map((row) => row.getAttribute('aria-rowindex')),
    };
  }, index);
}

for (const external of [false, true]) {
  test(`${external ? 'external' : 'internal'}: a 28px live checkbox remains clickable outside its 24px row`, async ({
    page,
  }) => {
    await mount(page, external);
    await page.evaluate(async () => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.toggleAttribute('data-compact', true);
      grid.toggleAttribute('data-control-overflow', true);
      const style = document.createElement('style');
      style.textContent = `
        #subject[data-control-overflow] .data-grid-row { height:var(--tbw-row-height); min-height:0 }
        #subject[data-control-overflow] .cell[data-field="__tbw_checkbox"] { min-height:0; overflow:visible }
      `;
      document.head.append(style);
      grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => ((row.kind ?? 1) === 1 ? 16 : 24) };
      grid.getPluginByName('selection')!.setCheckboxRenderers({
        rowCheckboxRenderer: (context) => {
          let current = context;
          const button = document.createElement('button');
          button.dataset['checkboxFor'] = context.rowId;
          button.setAttribute('role', 'checkbox');
          button.setAttribute('aria-label', context.ariaLabel);
          button.setAttribute('aria-checked', String(context.checked));
          button.style.cssText = 'width:28px;height:28px;min-height:28px;padding:0;flex:none';
          button.onclick = () => current.setChecked(!current.checked);
          return {
            element: button,
            update(next) {
              current = next;
              button.setAttribute('aria-checked', String(next.checked));
            },
          };
        },
      });
      await grid.forceLayout();
    });
    await expect(page.locator('[data-checkbox-for="root-0"]')).toBeVisible();
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 111 : 10;
    }, external);
    await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
    const checkbox = page.locator('[data-checkbox-for="root-0"]');
    const box = await checkbox.boundingBox();
    expect(box?.height).toBe(28);
    expect((await geometry(page, 0)).rowHeight).toBe(24);
    const hit = await checkbox.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 14, rect.top + 27);
      return { ownsHit: hit === button || button.contains(hit), hit: hit?.outerHTML };
    });
    expect(hit).toMatchObject({ ownsHit: true });
    if (!box) throw new Error('Missing checkbox bounds');
    // Use the border-box pixel; locator positions start inside the button border.
    await page.mouse.click(box.x + 14, box.y + 27);
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  test(`${external ? 'external' : 'internal'}: first disclosure click collapses the live sticky occurrence`, async ({
    page,
  }) => {
    await mount(page, external);
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 131 : 30;
    }, external);
    await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
    const root = page.locator('.rows > .data-grid-row:has(#action-root-0)');
    await root.locator('.tree-toggle').click();
    await expect(root).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#action-child-0')).toHaveCount(0);
    await expect(page.locator('.tbw-ancestor-live:has(#action-root-0)')).toHaveCount(0);
    expect(await page.locator('#action-root-0').count()).toBe(1);
  });

  test(`${external ? 'external' : 'internal'}: shared subtree boundary retires entity and title without overlap`, async ({
    page,
  }) => {
    await mount(page, external);
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 191 : 90;
    }, external);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const grid = document.querySelector<Subject>('#subject')!;
          return grid.findRenderedRowElement(1)?.classList.contains('tbw-ancestor-live');
        }),
      )
      .toBe(true);
    const boundary = await page.evaluate(() => {
      const grid = document.querySelector<Subject>('#subject')!;
      const root = grid.findRenderedRowElement(0)!;
      const title = grid.findRenderedRowElement(1)!;
      return {
        rootBottom: root.getBoundingClientRect().bottom,
        titleTop: title.getBoundingClientRect().top,
        titleControls: title.querySelectorAll('button,input,[tabindex="0"]').length,
      };
    });
    expect(boundary.rootBottom).toBeLessThanOrEqual(boundary.titleTop);
    expect(boundary.titleControls).toBe(0);
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 222 : 121;
    }, external);
    await expect(page.locator('.tbw-ancestor-live:has(#action-root-0)')).toHaveCount(0);
  });

  test(`${external ? 'external' : 'internal'}: keyboard paging reveals focus below active context`, async ({
    page,
  }) => {
    await mount(page, external);
    await page.evaluate(() => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.focusCell(6, 'id');
      grid.focus({ preventScroll: true });
    });
    await page.keyboard.press('PageDown');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const grid = document.querySelector<Subject>('#subject')!;
          return grid.focusedCell?.rowIndex;
        }),
      )
      .toBeGreaterThan(6);
    await expect
      .poll(async () =>
        page.evaluate((external) => {
          const grid = document.querySelector<Subject>('#subject')!;
          const row = grid.findRenderedRowElement(grid.focusedCell!.rowIndex)!;
          const header = grid.querySelector('.header')!.getBoundingClientRect();
          const viewport = (
            external ? document.querySelector('#owner')! : grid.querySelector('.rows-viewport')!
          ).getBoundingClientRect();
          const contextBottom = Math.max(
            header.bottom,
            ...[...grid.querySelectorAll('.tbw-ancestor-live')]
              .filter(
                (ancestor) =>
                  Number(ancestor.getAttribute('aria-rowindex')) < Number(row.getAttribute('aria-rowindex')),
              )
              .map((ancestor) => ancestor.getBoundingClientRect().bottom),
          );
          const rect = row.getBoundingClientRect();
          return JSON.stringify({
            visible: rect.top >= contextBottom - 1 && rect.bottom <= viewport.bottom + 1,
            row: grid.focusedCell!.rowIndex,
            top: rect.top,
            bottom: rect.bottom,
            contextBottom,
            viewportBottom: viewport.bottom,
          });
        }, external),
      )
      .toContain('"visible":true');
  });

  test(`${external ? 'external' : 'internal'}: sticky checkbox first click and menu lease keep canonical owners`, async ({
    page,
  }) => {
    test.setTimeout(15_000);
    await mount(page, external, true);
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 130 : 30;
    }, external);
    await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
    const root = page.locator('.rows > .data-grid-row:has(#action-root-0)');
    const checkbox = root.locator('.tbw-select-row-checkbox');
    await root.locator('.cell[data-field="__tbw_checkbox"]').click();
    await expect(checkbox).toBeChecked();
    const actionCell = root.locator('.cell[data-field="actions"]');
    const siblingActions = page.locator('.rows > .data-grid-row:has(#action-root-1) .cell[data-field="actions"]');
    await actionCell.locator('.more').focus();
    await siblingActions.hover();
    await expect(actionCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await expect(siblingActions).not.toHaveAttribute('data-tbw-cell-expanded');
    await actionCell.locator('.more').click();
    await expect(page.locator('#subject')).toHaveAttribute('data-command', 'root-0:More');
    await siblingActions.locator('.more').focus();
    await siblingActions.hover();
    await expect(actionCell).toHaveAttribute('data-tbw-cell-expanded', '');
    await expect(siblingActions).not.toHaveAttribute('data-tbw-cell-expanded');
    await expect(actionCell.locator('.secondary').first()).toBeVisible();
    const shadow = await actionCell.evaluate((cell) => getComputedStyle(cell).boxShadow);
    expect(shadow).not.toBe('none');
    await page.locator('#menu').click();
    await expect(actionCell).not.toHaveAttribute('data-tbw-cell-expanded');
    expect(await page.locator('#action-root-0').count()).toBe(1);
  });

  test(`${external ? 'external' : 'internal'}: CSS sticky alone cannot follow the actual owner`, async ({ page }) => {
    await mount(page, external);
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const row = grid.findRenderedRowElement(0)!;
      Object.assign(row.style, { position: 'sticky', top: '0px', translate: 'none' });
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 130 : 30;
    }, external);
    await expect.poll(async () => (await geometry(page, 0)).top).toBeLessThan(-20);
    const evidence = await page.evaluate(() => {
      const grid = document.querySelector<Subject>('#subject')!;
      const chain = [];
      for (let node: HTMLElement | null = grid.findRenderedRowElement(0); node; node = node.parentElement) {
        const style = getComputedStyle(node);
        chain.push({
          className: node.className,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          transform: style.transform,
          scrollTop: node.scrollTop,
        });
        if (node.id === 'owner') break;
      }
      return chain;
    });
    await test.info().attach('sticky-containing-blocks', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
  });

  test(`${external ? 'external' : 'internal'}: live control identity, real click and bounded pool`, async ({
    page,
  }) => {
    await mount(page, external);
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('#action-root-0')!;
      button.dataset['original'] = 'true';
      button.focus({ preventScroll: true });
    });
    await page.evaluate((external) => {
      const grid = document.querySelector<Subject>('#subject')!;
      const owner = external ? document.querySelector('#owner')! : grid.querySelector('.faux-vscroll')!;
      owner.scrollTop = external ? 130 : 30;
    }, external);
    await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
    await expect(page.locator('#action-root-0')).toHaveAttribute('data-original', 'true');
    await expect(page.locator('#action-root-0')).toBeFocused();
    await page.locator('#action-root-0').click();
    await expect(page.locator('#subject')).toHaveAttribute('data-last-action', 'root-0');
    const value = await geometry(page, 0);
    expect(value.pool).toBeLessThanOrEqual(value.window + value.retained);
    expect(value.ids.map(Number)).toEqual(value.ids.map(Number).sort((a, b) => a - b));
  });
}

test('deep short viewport retains nearest context and reveals a target below the actual stack', async ({ page }) => {
  await mount(page, false);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    let children: Row[] = Array.from({ length: 80 }, (_, i) => ({ id: `leaf-${i}`, kind: 2 }));
    for (let i = 89; i >= 0; i--) children = [{ id: `level-${i}`, kind: 0, children }];
    grid.rows = children;
    await grid.forceLayout();
    grid.getPluginByName('tree')!.expandAll();
    await grid.forceLayout();
    grid.scrollToRowById('leaf-30', { align: 'start', behavior: 'instant' });
  });
  await expect(page.locator('#action-leaf-30')).toBeVisible();
  const value = await geometry(page, 120);
  expect(value.retained).toBeGreaterThan(0);
  expect(value.retained).toBeLessThanOrEqual(4);
  expect(value.pool).toBeLessThanOrEqual(value.window + value.retained);
  expect(value.top).toBe(224);
  await expect(page.locator('#action-level-0')).toHaveCount(0);
  await expect(page.locator('#action-level-89')).toBeVisible();
});

for (const intraOffset of [0, 9]) {
  test(`external callback replacement preserves root30 + ${intraOffset}px through shrink, resize and growth`, async ({
    page,
  }) => {
    await mount(page, true);
    await page.evaluate(() => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.scrollToRowById('root-30', { align: 'start', behavior: 'instant' });
    });
    await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
    await page.evaluate((offset) => {
      const owner = document.querySelector<HTMLElement>('#owner')!;
      owner.style.width = '550px';
      owner.scrollLeft = 37;
      owner.scrollTop += offset;
    }, intraOffset);
    const before = (await geometry(page, 90)).ownerTop;
    expect(before).toBe(3701 + intraOffset);
    await page.evaluate(async () => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.toggleAttribute('data-compact', true);
      grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => [32, 16, 24][row.kind ?? 1] };
      await grid.forceLayout();
    });
    await expect.poll(async () => (await geometry(page, 90)).ownerTop).toBe(before - 1440);
    await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
    expect((await geometry(page, 90)).rowHeight).toBe(32);
    expect((await geometry(page, 90)).viewportHeight).toBe(5760);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#owner')!.style.height = '240px';
    });
    await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
    await page.evaluate(async () => {
      const grid = document.querySelector<Subject>('#subject')!;
      grid.toggleAttribute('data-compact', false);
      grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => [56, 24, 40][row.kind ?? 1] };
      await grid.forceLayout();
    });
    await expect.poll(async () => (await geometry(page, 90)).ownerTop).toBe(before);
    await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
    expect(await page.locator('#owner').evaluate((owner) => owner.scrollLeft)).toBe(37);
  });
}

test('external callback replacement yields to later public navigation', async ({ page }) => {
  await mount(page, true);
  await page.evaluate(() => {
    document.querySelector<Subject>('#subject')!.scrollToRowById('root-30', { align: 'start' });
  });
  await expect.poll(async () => (await geometry(page, 90)).top).toBe(0);
  await page.evaluate(async () => {
    const grid = document.querySelector<Subject>('#subject')!;
    grid.toggleAttribute('data-compact', true);
    grid.gridConfig = { ...grid.gridConfig, rowHeight: (row: Row) => [32, 16, 24][row.kind ?? 1] };
    grid.scrollToRow(0, { align: 'start' });
    await grid.forceLayout();
  });
  await expect.poll(async () => (await geometry(page, 0)).ownerTop).toBe(101);
  await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
});

test('external header exhaustion is diagnosed without reducing row heights', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Header/footer leave no usable ancestor viewport')) diagnostics.push(message.text());
  });
  await mount(page, true);
  await page.evaluate(() => {
    const owner = document.querySelector<HTMLElement>('#owner')!;
    owner.style.height = '20px';
    owner.scrollTop = 101;
  });
  await expect.poll(() => diagnostics.length).toBeGreaterThan(0);
  const evidence = await page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    return {
      ownerHeight: document.querySelector<HTMLElement>('#owner')!.clientHeight,
      headerHeight: grid.querySelector('.header')!.getBoundingClientRect().height,
      naturalRootHeight: grid._virtualization.positionCache![0].height,
      retained: grid.querySelectorAll('.tbw-ancestor-retained').length,
    };
  });
  expect(evidence.headerHeight).toBeGreaterThanOrEqual(evidence.ownerHeight);
  expect(evidence.naturalRootHeight).toBe(56);
  expect(evidence.retained).toBe(0);
  await test.info().attach('exhausted-viewport', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('external ancestors retire after the grid, preserve surrounding extent, and public reveal returns', async ({
  page,
}) => {
  await mount(page, true);
  await page.evaluate(() => {
    const owner = document.querySelector('#owner')!;
    owner.scrollTop = owner.scrollHeight;
  });
  await expect(page.locator('#after')).toBeVisible();
  const end = await geometry(page, 239);
  expect(end.pool).toBeLessThan(30);
  await page.evaluate(() => {
    const grid = document.querySelector<Subject>('#subject')!;
    grid.scrollToRow(0, { align: 'start', behavior: 'instant' });
  });
  await expect.poll(async () => (await geometry(page, 0)).top).toBe(0);
  expect((await geometry(page, 0)).ownerTop).toBe(101);
});
