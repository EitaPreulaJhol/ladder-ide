import { expect, test, type Page } from '@playwright/test';

const watch = (page: Page, tag: string) => page.getByTestId(`watch-${tag}`);

async function openExample(page: Page, id: string) {
  await page.getByTestId('nav-projects').click();
  await page.getByTestId(`example-${id}`).click();
  await expect(page.getByTestId('nav-editor')).toHaveClass(/active/);
}

test('seal-in circuit: start latches the lamp, stop releases it', async ({ page }) => {
  await page.goto('/');
  await openExample(page, 'sealIn');
  await page.getByTestId('dock-panel').click();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('plc-status')).toHaveText('RUN');

  const lamp = page.getByTestId('lamp-K_LAMPADA');
  await expect(lamp).not.toHaveClass(/on/);
  const start = page.getByTestId('pb-B_LIGA');
  await start.hover();
  await page.mouse.down();
  await expect(lamp).toHaveClass(/on/);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(lamp).toHaveClass(/on/); // sealed

  await page.getByTestId('pb-B_DESLIGA').hover();
  await page.mouse.down();
  await expect(lamp).not.toHaveClass(/on/);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(lamp).not.toHaveClass(/on/);

  await page.getByTestId('stop').click();
  await expect(page.getByTestId('plc-status')).toHaveText('STOP');
});

test('build a rung from the palette, auto-create tags and switch dialects', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();

  await page.getByTestId('palette-NO').click();
  const op = page.locator('.props input[data-operand="0"]');
  await op.fill('SENSOR');
  await op.press('Enter');
  await page.getByTestId('palette-COIL').click();
  await op.fill('%QX0.0');
  await op.press('Enter');

  await expect(page.getByTestId('el-NO-SENSOR')).toBeVisible();
  await expect(page.getByTestId('el-COIL-_QX0_0')).toBeVisible();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(0\)/);

  // Force the input from the watch table and see the output follow.
  await page.getByTestId('run').click();
  await watch(page, 'SENSOR').getByRole('button').click();
  await expect(watch(page, '_QX0_0').getByRole('button')).toHaveText('1');

  await page.getByTestId('dialect').selectOption('ab');
  await expect(page.getByTestId('el-NO-SENSOR')).toContainText('XIC');
  await page.getByTestId('dialect').selectOption('siemens');
  await expect(page.getByTestId('el-COIL-_QX0_0')).toContainText('Q0.0');
});

test('traffic light scenario cycles through all lights', async ({ page }) => {
  await page.goto('/');
  await openExample(page, 'scenario:traffic');
  await page.getByTestId('run').click();
  await page.locator('.sim-controls select').selectOption('10');
  for (const light of ['L_GREEN', 'L_YELLOW', 'L_RED']) {
    await expect(watch(page, light).getByRole('button')).toHaveText('1', { timeout: 10_000 });
  }
});

test('share a snapshot, open it read-only and fork it', async ({ page }) => {
  await page.goto('/');
  await openExample(page, 'blinker');
  await page.getByTestId('share').click();
  await page.getByTestId('create-share').click();
  const url = await page.getByTestId('share-url').inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9]{10}$/);

  await page.goto(url);
  await expect(page.getByTestId('fork')).toBeVisible();
  await expect(page.locator('.palette')).toHaveCount(0);
  await page.getByTestId('fork').click();
  await expect(page.getByTestId('fork')).toHaveCount(0);
  await expect(page.locator('.palette')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  const missing = await page.goto('/s/doesNotExist1');
  expect(missing?.status()).toBe(200);
  await expect(page.getByText('Link de compartilhamento não encontrado.')).toBeVisible();
});

test('real PLC model: S7-1200 rack, typed address binds to the on-board input', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();

  await page.getByTestId('nav-hardware').click();
  await page.getByTestId('family-select').selectOption('s7-1200');
  await page.getByTestId('cpu-select').selectOption('1214C');
  await expect(page.getByTestId('dialect')).toBeDisabled();
  await expect(page.getByTestId('dialect')).toHaveValue('siemens');
  await expect(page.getByTestId('io-DI-13-1')).toHaveText('I1.5');
  await page.getByTestId('catalog-select').selectOption('sm1221-di8');
  await page.getByTestId('add-module').click();
  await expect(page.getByTestId('io-DI-0-2')).toHaveText('I8.0');

  await page.getByTestId('nav-editor').click();
  await page.getByTestId('palette-NO').click();
  const op = page.locator('.props input[data-operand="0"]');
  await op.fill('I0.3');
  await op.press('Enter');
  await expect(page.getByTestId('el-NO-I0_3')).toContainText('I0.3');

  // MicroLogix has no pulse timer: the palette disables it.
  await page.getByTestId('nav-hardware').click();
  await page.getByTestId('family-select').selectOption('micrologix');
  await page.getByTestId('nav-editor').click();
  await expect(page.getByTestId('palette-TP')).toBeDisabled();
  await expect(page.getByTestId('el-NO-I0_3')).toContainText('I:0/3');
});

test('theme toggle cycles automatic → light → dark and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
  const systemDark = await bg();

  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const light = await bg();
  expect(light).not.toBe(systemDark);

  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe(systemDark);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('theme-toggle').click(); // back to automatic
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bg()).toBe(light);
});

test('trend chart records a one-scan pulse while running', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-counter').click();
  await page.getByTestId('trend-tab').click();
  await page.getByTestId('trend-add').selectOption('S_PECA');
  await page.getByTestId('trend-add').selectOption('C_PECAS.ACC');
  await expect(page.locator('.trend-lane')).toHaveCount(2);

  await page.getByTestId('run').click();
  await page.getByTestId('dock-panel').click();
  await page.getByTestId('pb-S_PECA').hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  // The counter lane must have moved off zero and the input lane must contain a rising step.
  const paths = await page
    .locator('.trend-lane .trend-line')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  expect(paths[0]).toMatch(/V/);
  expect(paths[1]).toMatch(/V/);
});

test('automatic grading: reference passes, a broken program fails and shows its recording', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:traffic').click();
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('checks-score')).toHaveText(/4 de 4/);

  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:motor').click();
  await page.getByTestId('el-NO-K_MOTOR').first().click(); // the seal-in contact (rung 1)
  await page.keyboard.press('Delete');
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('checks-score')).toHaveText(/1 de 4/);
  await expect(page.getByTestId('check-startSeal')).toContainText('Esperado K_MOTOR = 1');

  await page.getByTestId('check-trace-startSeal').click();
  await expect(page.getByTestId('trend-live')).toBeVisible();
  await expect(page.locator('.trend-marker')).toHaveCount(1);
  await page.getByTestId('trend-live').click();
  await expect(page.getByTestId('trend-add')).toBeVisible();
});
