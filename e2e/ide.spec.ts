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

test('cross reference and "why?" explanation of a coil', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:motor').click();

  // Cross reference from the tags table navigates to the instruction.
  await page.getByTestId('nav-tags').click();
  await page.getByTestId('xref-K_MOTOR').click();
  const refs = page.locator('.xref-row .xref-list li');
  await expect(refs).toHaveCount(3);
  await refs.nth(1).getByRole('button').click(); // the coil (write) in rung 1
  await expect(page.getByTestId('nav-editor')).toHaveClass(/active/);
  await expect(page.locator('.cell.selected')).toHaveCount(1);

  // Explanation while running: blocked, then energized through the seal-in.
  await page.getByTestId('run').click();
  await page.getByTestId('explain-watch-K_MOTOR').click();
  const explain = page.getByTestId('explain');
  await expect(explain).toContainText('bloqueia aqui');
  await expect(explain).toContainText('sem energia');
  await expect(page.locator('.cell.explain-block')).not.toHaveCount(0);

  await page.getByTestId('dock-plant').click();
  await page.getByTestId('plant-B_START').hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.locator('.dock .tabs button').first().click();
  await expect(explain).toContainText('energizada');
  await expect(explain).not.toContainText('bloqueia aqui');
});

test('field faults: burnt contactor and hidden fault challenge', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:motor').click();
  await page.getByTestId('run').click();
  await page.getByTestId('faults-tab').click();

  // Output fault: the PLC commands K_MOTOR, but the contactor never pulls in.
  await page.getByTestId('fault-signal').selectOption('K_MOTOR');
  await page.getByTestId('fault-kind').selectOption('stuckOff');
  await page.getByTestId('fault-add').click();
  await expect(page.getByTestId('fault-K_MOTOR')).toBeVisible();
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('plant-B_START').hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await expect(page.locator('.plant-svg').getByText('M 0%')).toBeVisible();
  await page.getByTestId('fault-K_MOTOR').getByRole('button').click();
  await expect(page.locator('.plant-svg').getByText('M 0%')).toHaveCount(0, { timeout: 5000 });

  // Challenge: a hidden fault, a wrong guess, then give up and reveal it.
  await page.getByTestId('challenge-start').click();
  await expect(page.getByTestId('guess-signal')).toBeVisible();
  await expect(page.getByTestId('faults-tab')).toContainText('🕵');
  await page.getByTestId('guess-signal').selectOption('H_FAULT');
  await page.getByTestId('guess-kind').selectOption('stuckOn');
  await page.getByTestId('guess-submit').click();
  await expect(page.getByTestId('challenge-result')).toContainText(/✗|✓/);
  if (await page.getByText('Desistir e revelar').isVisible()) {
    await page.getByText('Desistir e revelar').click();
    await expect(page.getByTestId('challenge-result')).toContainText('A falha era');
  }
  await expect(page.getByTestId('challenge-start')).toBeVisible();
});

test('trend shows timer accumulators as time', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-blinker').click();
  await page.getByTestId('trend-tab').click();
  await page.getByTestId('trend-add').selectOption('T_OFF.ACC');
  await page.getByTestId('run').click();
  await page.getByTestId('dock-panel').click();
  await page.getByTestId('sw-S_HABILITA').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.trend-range').first()).toHaveText(/^\d+(ms|[.,]\d+s)$/);
});

test('subroutines and jumps: program tabs, CALL and JMP/LBL', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-subroutines').click();
  await expect(page.getByTestId('program-tab-Principal')).toBeVisible();
  await expect(page.getByTestId('program-tab-Alarmes')).toBeVisible();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(0\)/);

  await page.getByTestId('run').click();
  await page.getByTestId('dock-panel').click();
  await page.getByTestId('sw-S_SENSOR').click();
  await expect(page.getByTestId('lamp-H_AUTO')).toHaveClass(/on/);
  // Maintenance jumps over the automatic logic: H_AUTO freezes even when the sensor drops.
  await page.getByTestId('sw-S_MANUT').click();
  await page.getByTestId('sw-S_SENSOR').click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('lamp-H_AUTO')).toHaveClass(/on/);
  // The alarm subroutine only runs when called: the lamp blinks.
  await page.getByTestId('sw-S_ALARME').click();
  await expect(page.getByTestId('lamp-H_ALARME')).toHaveClass(/on/, { timeout: 3000 });
  await expect(page.getByTestId('lamp-H_ALARME')).not.toHaveClass(/on/, { timeout: 3000 });

  // A new subroutine that nobody calls is flagged.
  await page.getByTestId('stop').click();
  await page.getByTestId('add-sub').click();
  await page.getByTestId('problems-tab').click();
  await expect(page.locator('.bottom')).toContainText('nunca é chamada');
});

test('PID level control passes the automatic checks', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:tankPid').click();
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('checks-score')).toHaveText(/4 de 4/, { timeout: 10_000 });
});
