import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { DataGridElement } from '@toolbox-web/grid';
import { resolve } from 'node:path';
import { openDemo } from './utils';

const demo = 'selection/SelectionEmbeddedCheckboxDemo';
const root = '#selection-embedded-checkbox-demo';

test('embedded native checked Shift activation reconciles unchanged canonical state', async ({ page }) => {
  await openDemo(page, demo);
  const grid = page.locator('#embedded-checkbox-dom');
  const input = grid.locator('input[type=checkbox]').first();
  await input.focus();
  await input.press('Space');
  await expect(input).toBeChecked();
  await input.click({ modifiers: ['Shift'] });
  await expect(input).toBeChecked();
  await expect(page.locator('[data-event-log]')).toHaveText('2 selection changes');
});

for (const replace of [false, true]) {
  test(`embedded ${replace ? 'replacement' : 'dispose'} during selection-change preserves original click ownership only`, async ({
    page,
  }) => {
    await openDemo(page, demo);
    await page.evaluate(
      async ({ url, replace }) => {
        const { SelectionPlugin }: typeof import('@toolbox-web/grid/plugins/selection') = await import(url);
        type Row = { id: string; name: string };
        const grid = document.createElement('tbw-grid') as DataGridElement<Row>;
        grid.id = 'reentrant-checkbox';
        grid.style.height = '200px';
        class ObservedSelection extends SelectionPlugin<Row> {
          override onCellClick(event: Parameters<SelectionPlugin<Row>['onCellClick']>[0]) {
            grid.dataset.pluginClicks = String(Number(grid.dataset.pluginClicks) + 1);
            return super.onCellClick(event);
          }
        }
        const selection = new ObservedSelection({ mode: 'row', checkbox: false });
        grid.gridConfig = {
          columns: [
            {
              field: 'name',
              renderer(context) {
                const host = document.createElement('span');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.disabled = true;
                host.append(input);
                const publish = (
                  state: import('@toolbox-web/grid/plugins/selection').SelectionRowCheckboxContext<Row> | null,
                ) => {
                  input.disabled = !state || state.disabled;
                  input.checked = state?.checked ?? false;
                  input.onclick = state
                    ? (event) => {
                        if (context.row.id === 'b' && !host.dataset.retired) {
                          grid.addEventListener(
                            'selection-change',
                            () => {
                              binding.dispose();
                              host.dataset.retired = 'true';
                              if (replace) {
                                const successor = selection.bindRowCheckbox(context, host, publish);
                                // Repeated predecessor cleanup cannot clear the replacement.
                                binding.dispose();
                                grid.addEventListener('retire-successor', () => successor.dispose(), { once: true });
                              }
                            },
                            { once: true },
                          );
                        }
                        state.setChecked(input.checked, event);
                      }
                    : null;
                };
                const binding = selection.bindRowCheckbox(context, host, (state) => {
                  // A retired renderer must not reset a successor's controls.
                  if (!host.dataset.retired) publish(state);
                });
                return host;
              },
            },
          ],
          plugins: [selection],
        };
        grid.rows = [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ];
        document.body.append(grid);
        await grid.ready();
        selection.selectRows([0]);
        await grid.ready();
        grid.dataset.events = '0';
        grid.dataset.clicks = '0';
        grid.dataset.pluginClicks = '0';
        grid.addEventListener('selection-change', () => {
          grid.dataset.events = String(Number(grid.dataset.events) + 1);
        });
        grid.addEventListener('cell-click', () => {
          grid.dataset.clicks = String(Number(grid.dataset.clicks) + 1);
        });
      },
      { url: `/@fs/${resolve('libs/grid/src/lib/plugins/selection/index.ts')}`, replace },
    );
    const grid = page.locator('#reentrant-checkbox');
    await grid.locator('input').nth(1).click();
    await expect(grid).toHaveAttribute('data-events', '1');
    await expect(grid).toHaveAttribute('data-clicks', '0');
    await expect(grid).toHaveAttribute('data-plugin-clicks', '0');
    expect(
      await grid.evaluate((element) =>
        (element as DataGridElement).getPluginByName('selection')!.getSelectedRowIndices(),
      ),
    ).toEqual([0, 1]);
    if (replace) {
      await grid.locator('input').nth(1).click();
      await expect(grid).toHaveAttribute('data-events', '2');
      await expect(grid).toHaveAttribute('data-plugin-clicks', '0');
      expect(
        await grid.evaluate((element) =>
          (element as DataGridElement).getPluginByName('selection')!.getSelectedRowIndices(),
        ),
      ).toEqual([0]);
      await grid.evaluate((element) => element.dispatchEvent(new Event('retire-successor')));
    }
    await grid.locator('.cell[data-row="1"]').click();
    await expect(grid).toHaveAttribute('data-clicks', '1');
    await expect(grid).toHaveAttribute('data-plugin-clicks', '1');
  });
}

test('embedded native checkbox: hover/focus, native keys, modifiers and programmatic STYLE', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page, demo);
  const grid = page.locator('#embedded-checkbox-dom');
  const inputs = grid.locator('.embedded-action input');
  await expect(inputs).toHaveCount(4);
  await expect(grid.locator('[data-field="__tbw_checkbox"]')).toHaveCount(0);
  await expect(inputs.nth(1)).toBeDisabled();
  await page.mouse.move(0, 0);
  await expect(inputs.first().locator('..')).toHaveCSS('opacity', '0');
  await inputs.first().focus();
  await expect(inputs.first().locator('..')).toHaveCSS('opacity', '1');
  await inputs.first().press('Enter');
  await expect(page.locator('[data-event-log]')).toHaveText('0 selection changes');
  await inputs.first().press('Space');
  await expect(inputs.first()).toBeChecked();
  await expect(inputs.first()).toBeFocused();
  await expect(page.locator('[data-event-log]')).toHaveText('1 selection changes');
  await grid.locator('.data-grid-row').nth(3).hover();
  await inputs.nth(3).click({ modifiers: ['Shift'] });
  await expect(grid.locator('.embedded-action input:checked')).toHaveCount(3);
  await expect(page.locator('[data-event-log]')).toHaveText('2 selection changes');
  await inputs.nth(3).evaluate((element) => element.setAttribute('data-preserved', 'yes'));
  await grid.evaluate((element) => (element as DataGridElement).getPluginByName('selection')!.selectRows([3]));
  await expect(inputs.nth(3)).toBeChecked();
  await expect(inputs.first()).not.toBeChecked();
  await expect(inputs.nth(3)).toHaveAttribute('data-preserved', 'yes');
  await page.locator('[data-select-mode]').check();
  await page.mouse.move(0, 0);
  await expect(inputs.first().locator('..')).toHaveCSS('opacity', '1');
  await expect(grid.locator('a').first()).toHaveText('Alice');
  expect(errors).toEqual([]);
});

test('embedded React button: Name-local provider, native activation once, focus and cancellation', async ({ page }) => {
  await openDemo(page, demo);
  const grid = page.locator('#embedded-checkbox-react tbw-grid');
  const button = grid.getByRole('checkbox').first();
  await expect(button).toHaveAttribute('data-provider', 'name:a');
  await button.focus();
  await button.press('Enter');
  await expect(button).toBeChecked();
  await expect(button).toBeFocused();
  await expect(page.locator('[data-event-log]')).toHaveText('1 selection changes');
  await button.press('Space');
  await expect(button).not.toBeChecked();
  await expect(page.locator('[data-event-log]')).toHaveText('2 selection changes');
  await button.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault(), { once: true });
    element.setAttribute('data-preserved', 'yes');
  });
  await button.press('Enter');
  await expect(button).not.toBeChecked();
  await expect(page.locator('[data-event-log]')).toHaveText('2 selection changes');
  await button.press('Enter');
  await expect(button).toBeChecked();
  await expect(button).toHaveAttribute('data-preserved', 'yes');
  await expect(button).toBeFocused();
  await expect(page.locator('#embedded-checkbox-dom .embedded-action input:checked')).toHaveCount(0);
  await grid.evaluate((element) => {
    const grid = element as DataGridElement;
    grid.rows = grid.rows.map((row) => ({ ...row, name: `${row.name} refreshed` }));
  });
  await expect(grid.locator('a').first()).toHaveText('Alice refreshed');
  await expect(grid.getByRole('checkbox').first()).toHaveAttribute('data-provider', 'name:a');
  await expect(button).toHaveAttribute('data-preserved', 'yes');
  await expect(button).toBeFocused();
  await grid.evaluate((element) => {
    (element as DataGridElement).rows = [{ id: 'replacement', name: 'Replacement' }];
  });
  await expect(grid.getByRole('checkbox')).toHaveCount(1);
  await expect(grid.getByRole('checkbox')).toHaveAttribute('data-provider', 'name:replacement');
  await expect(grid.getByRole('checkbox')).toHaveAttribute('data-action-row', 'replacement');
  const selected = await grid.evaluate((element) =>
    (element as DataGridElement).getPluginByName('selection')!.getSelectedRowIndices().includes(0),
  );
  await expect(grid.getByRole('checkbox')).toBeChecked({ checked: selected });
  await grid.getByRole('checkbox').focus();
  await grid.getByRole('checkbox').press('Space');
  await expect(grid.getByRole('checkbox')).toBeChecked({ checked: !selected });
});

test('embedded presentation: touch path, accessible names/state and target sizes', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 420, height: 850 },
  });
  const page = await context.newPage();
  try {
    await openDemo(page, demo);
    const input = page.locator('#embedded-checkbox-dom .embedded-action input').first();
    await expect(input.locator('..')).toHaveCSS('opacity', '1');
    await input.tap();
    await expect(input).toBeChecked();
    const button = page.locator('#embedded-checkbox-react').getByRole('checkbox').first();
    await button.tap();
    await expect(button).toBeChecked();
    for (const control of [input, button]) {
      await expect(control).toHaveAccessibleName(/Select row/);
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(24);
      expect(box?.height).toBeGreaterThanOrEqual(24);
    }
    const audit = await new AxeBuilder({ page })
      .include(root)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  } finally {
    await context.close();
  }
});

test('embedded React controls follow virtual recycling without accumulating hosts', async ({ page }) => {
  await openDemo(page, demo);
  const grid = page.locator('#embedded-checkbox-react tbw-grid');
  await grid.evaluate(async (element) => {
    const grid = element as DataGridElement;
    grid.rows = Array.from({ length: 1000 }, (_, index) => ({ id: `row:${index}`, name: `Name ${index}` }));
    await grid.ready();
  });
  await expect(grid.getByRole('checkbox').first()).toHaveAttribute('data-action-row', 'row:0');
  for (let index = 1; index <= 16; index++) {
    await grid.evaluate(async (element, offset) => {
      const grid = element as DataGridElement;
      grid._virtualization.container!.scrollTop = offset;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }, index * 200);
    expect(await grid.getByRole('checkbox').count()).toBeLessThan(40);
  }
  await expect(grid.getByRole('checkbox').first()).not.toHaveAttribute('data-action-row', 'row:0');
  const id = await grid.getByRole('checkbox').first().getAttribute('data-action-row');
  const checkbox = grid.locator(`[data-action-row="${id}"]`);
  await expect(checkbox).toHaveAttribute('data-provider', `name:${id}`);
  const checked = await checkbox.isChecked();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).toBeChecked({ checked: !checked });
});
