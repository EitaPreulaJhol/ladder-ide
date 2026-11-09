import { expect, test, type Page } from '@playwright/test';

const watch = (page: Page, tag: string) => page.getByTestId(`watch-${tag}`);
const lastToast = (page: Page) => page.getByTestId('toast').last();

/** Opens the app and, from the welcome page, the seal-in example (the former default project). */
async function openApp(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome-example-sealIn').click();
  await expect(page.getByTestId('nav-editor')).toBeVisible();
}

/** Reloads the page and continues the last project from the welcome page. */
async function resume(page: Page) {
  await page.reload();
  await page.getByTestId('welcome-continue').click();
  await expect(page.getByTestId('nav-editor')).toBeVisible();
}

async function openExample(page: Page, id: string) {
  await page.getByTestId('nav-projects').click();
  await page.getByTestId(`example-${id}`).click();
  await expect(page.getByTestId('nav-editor')).toHaveClass(/active/);
}

test('seal-in circuit: start latches the lamp, stop releases it', async ({ page }) => {
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
  await openExample(page, 'scenario:traffic');
  await page.getByTestId('run').click();
  await page.locator('.sim-controls select').selectOption('10');
  for (const light of ['L_GREEN', 'L_YELLOW', 'L_RED']) {
    await expect(watch(page, light).getByRole('button')).toHaveText('1', { timeout: 10_000 });
  }
});

test('share a snapshot, open it read-only and fork it', async ({ page }) => {
  await openApp(page);
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
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();

  await page.getByTestId('nav-hardware').click();
  await page.getByTestId('family-select').selectOption('s7-1200');
  // Applied at once (no confirmation), with a summary and "Undo".
  await expect(lastToast(page)).toContainText('Modelo de CLP alterado para Siemens');
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
  await openApp(page);
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

  await resume(page);
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('theme-toggle').click(); // back to automatic
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bg()).toBe(light);
});

test('trend chart records a one-scan pulse while running', async ({ page }) => {
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:tankPid').click();
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('checks-score')).toHaveText(/4 de 4/, { timeout: 10_000 });
});

test('share with expiration and report a shared link', async ({ page }) => {
  const cspErrors: string[] = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && /Content Security Policy/i.test(m.text()) && cspErrors.push(m.text()),
  );
  await openApp(page);
  await page.getByTestId('share').click();
  await page.getByTestId('share-expiration').selectOption('7');
  await page.getByTestId('create-share').click();
  await expect(page.getByText('O link expira em')).toBeVisible();
  const url = await page.getByTestId('share-url').inputValue();

  await page.goto(url);
  await page.getByTestId('report').click();
  await page.getByLabel('Conteúdo ofensivo').check();
  await page.getByTestId('report-send').click();
  await expect(page.getByTestId('report-done')).toBeVisible();
  expect(cspErrors).toEqual([]);
});

test('works offline after the first visit (service worker)', async ({ page, context }) => {
  await openApp(page);
  await expect(page.getByTestId('nav-editor')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await resume(page);
  await expect(page.getByTestId('nav-editor')).toBeVisible();
  await expect(page.getByTestId('offline')).toBeVisible();
  await expect(page.getByTestId('share')).toBeDisabled();
  // The simulator works offline too.
  await page.getByTestId('run').click();
  await expect(page.getByTestId('plc-status')).toHaveText('RUN');
  await context.setOffline(false);
});

test('project documentation lists programs, tags and I/O', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-subroutines').click();
  await page.getByTestId('nav-doc').click();
  await expect(page.locator('.doc-cover h1')).toHaveText('Exemplo: sub-rotinas e saltos');
  await expect(page.locator('.doc-program h2')).toHaveCount(2);
  await expect(page.locator('.doc-program').nth(1)).toContainText('sub-rotina');
  await expect(page.locator('.doc-rung')).toHaveCount(6);
  await expect(page.locator('.doc-table').first()).toContainText('H_ALARME');
  await expect(page.getByTestId('doc-print')).toBeVisible();
});

test('GRAFCET: live steps, generated ladder and automatic checks', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-grafcetCylinders').click();
  await expect(page.getByTestId('grafcet')).toBeVisible();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(0\)/);

  await page.getByTestId('run').click();
  await expect(page.getByTestId('g-step-0')).toHaveClass(/active/);
  await page.getByTestId('dock-plant').click();
  await page.getByTestId('plant-B_START').hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page.getByTestId('g-step-1')).toHaveClass(/active/);
  await expect(page.getByTestId('g-step-2')).toHaveClass(/active/, { timeout: 4000 });

  // The ladder is generated and read-only.
  await page.getByTestId('show-ladder').click();
  await expect(page.getByTestId('el-COIL-Y_A')).toBeVisible();
  await expect(page.locator('.palette')).toHaveCount(0);
  await page.getByTestId('show-grafcet').click();

  await page.getByTestId('stop').click();
  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('checks-score')).toHaveText(/4 de 4/, { timeout: 10_000 });

  // Breaking a condition shows up in the problems and in the checks.
  await page.getByTestId('g-cond-1').fill('');
  await page.getByTestId('g-cond-1').press('Enter');
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(1\)/);
});

test('a new GRAFCET starts with two steps and empty conditions flagged', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();
  await page.getByTestId('add-grafcet').click();
  await expect(page.getByTestId('g-step-0')).toBeVisible();
  await expect(page.getByTestId('g-step-1')).toBeVisible();
  await page.getByTestId('g-add-1').click();
  await expect(page.getByTestId('g-step-2')).toBeVisible();
  await page.getByTestId('g-actions-1').fill('LAMPADA');
  await page.getByTestId('g-actions-1').press('Enter');
  await page.getByTestId('show-ladder').click();
  await expect(page.getByTestId('el-COIL-LAMPADA')).toBeVisible();
});

test('interface language: English and Spanish, remembered across reloads', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('run')).toContainText('Executar');
  await page.getByTestId('language').selectOption('en');
  await expect(page.getByTestId('run')).toContainText('Run');
  await expect(page.getByTestId('nav-hardware')).toContainText('Hardware');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await resume(page);
  await expect(page.getByTestId('run')).toContainText('Run');
  await page.getByTestId('language').selectOption('es');
  await expect(page.getByTestId('run')).toContainText('Ejecutar');
  await page.getByTestId('nav-projects').click();
  await expect(page.getByText('Los proyectos de ejemplo')).toBeVisible();
  await page.getByTestId('language').selectOption('pt-BR');
  await expect(page.getByTestId('run')).toContainText('Executar');
});

test('PLCopen XML: export from the UI and import it back', async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-scenario:starDelta').click();
  await page.getByTestId('nav-projects').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-plcopen').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.plcopen\.xml$/);
  const file = testInfo.outputPath('star.xml');
  await download.saveAs(file);

  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByTestId('nav-editor')).toHaveClass(/active/);
  await expect(page.getByTestId('el-TON-T_STAR')).toBeVisible();
  await expect(page.getByTestId('el-COIL-K3_DELTA')).toBeVisible();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(0\)/);
});

test('HMI: screen from the I/O panel, add a bar and operate it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-counter').click();
  await page.getByTestId('nav-hmi').click();
  await page.getByTestId('hmi-from-panel').click();
  await expect(page.getByTestId('hmi-screen').getByTestId('pb-S_PECA')).toBeVisible();

  await page.getByTestId('hmi-edit').click();
  await page.getByTestId('hmi-add-bar').click();
  await page.getByTestId('hmi-prop-tag').selectOption('PECAS');
  await page.getByTestId('hmi-prop-label').fill('Peças');
  await page.getByTestId('hmi-prop-label').press('Tab');
  await page.getByTestId('hmi-add-nav').click();
  await page.getByTestId('hmi-edit').click(); // back to operate

  await page.getByTestId('run').click();
  const button = page.getByTestId('hmi-screen').getByTestId('pb-S_PECA');
  for (let i = 0; i < 3; i++) {
    await button.hover();
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(80);
  }
  await expect(page.getByTestId('hmi-w-bar-PECAS')).toContainText('3');
  await expect(page.getByTestId('hmi-w-bar-PECAS')).toContainText('Peças');
  // Saved with the project: still there after a reload.
  await resume(page);
  await page.getByTestId('nav-hmi').click();
  await expect(page.getByTestId('hmi-w-bar-PECAS')).toBeVisible();
});

test('Modbus TCP bridge: a real Modbus client operates the simulation', async ({ page }) => {
  const { spawn } = await import('node:child_process');
  const net = await import('node:net');
  const bridge = spawn(
    process.execPath,
    ['apps/bridge/src/index.ts', '--token', 'E2ETOKEN', '--ws-port', '18765', '--modbus-port', '15020'],
    {
      stdio: 'pipe',
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      bridge.stdout!.on('data', (d: Buffer) => d.toString().includes('Código de pareamento') && resolve());
      bridge.once('exit', (c) => reject(new Error(`bridge exited ${c}`)));
    });

    await openApp(page);
    await page.getByTestId('nav-projects').click();
    await page.getByTestId('example-sealIn').click();
    await page.getByTestId('nav-hardware').click();
    await page.getByTestId('modbus-port').fill('18765');
    await page.getByTestId('modbus-token').fill('e2etoken'); // case-insensitive
    await page.getByTestId('modbus-connect').click();
    await expect(page.getByTestId('modbus-status')).toContainText('conectada');
    await page.getByTestId('run').click();

    // Automatic map of the seal-in example: B_LIGA = coil 0, B_DESLIGA = coil 1, K_LAMPADA = coil 2.
    const sock = net.connect(15020, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    let tid = 0;
    const req = (pdu: number[]) =>
      new Promise<Buffer>((resolve) => {
        const h = Buffer.from([0, ++tid, 0, 0, 0, pdu.length + 1, 1]);
        sock.once('data', (d: Buffer) => resolve(d.subarray(7)));
        sock.write(Buffer.concat([h, Buffer.from(pdu)]));
      });
    const readLamp = async () => ((await req([1, 0, 2, 0, 1]))[2]! & 1) === 1;

    await expect.poll(readLamp).toBe(false);
    await req([5, 0, 0, 0xff, 0]); // HMI presses "Liga"
    await page.waitForTimeout(200);
    await req([5, 0, 0, 0, 0]); // and releases it
    await expect.poll(readLamp, { timeout: 5000 }).toBe(true); // sealed in
    await page.getByTestId('dock-panel').click();
    await expect(page.getByTestId('lamp-K_LAMPADA')).toHaveClass(/on/);
    await expect(page.getByTestId('modbus-status')).toContainText('requisições');
    sock.destroy();
  } finally {
    bridge.kill();
  }
});

test('editable plant: conveyor exercise rebuilt with components sorts a tall part', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-plant').click();
  await page.getByTestId('plant-template').selectOption('conveyor');
  await page.getByTestId('plant-with-solution').check();
  await page.getByTestId('plant-from-template').click();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(0\)/);

  await page.getByTestId('run').click();
  await page.locator('.sim-controls select').selectOption('10');
  const main = page.locator('.pc-main');
  await main.getByTestId('pc-pushbutton-B_START').locator('circle').hover();
  await page.mouse.down();
  await expect(watch(page, 'M_BELT').getByRole('button')).toHaveText('1');
  await page.mouse.up();

  await main.getByRole('button', { name: '+ peça alta' }).click();
  await expect(main.getByTestId('pc-bin-Rejeito')).toContainText('1', { timeout: 10_000 });
  await expect(main.getByTestId('pc-bin-Saída')).toContainText('0');
});

test('editable plant: build from scratch, create tags, drag and operate', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();
  await page.getByTestId('nav-plant').click();
  await page.getByTestId('plant-blank').click();
  await page.getByTestId('pc-add-selector').click();
  await page.getByTestId('pc-add-lamp').click();
  // The empty rung of the new project, plus the two unbound signals.
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(3\)/);
  await page.locator('.pc-canvas-wrap svg').click({ position: { x: 5, y: 5 } });
  await page.getByTestId('plant-create-tags').click();
  await expect(page.getByTestId('problems-tab')).toHaveText(/\(1\)/);

  // Drag the lamp 100 px to the right.
  const lamp = page.locator('.pc-main').getByTestId('pc-lamp-H1');
  const before = await lamp.getAttribute('transform');
  const box = (await page.getByTestId('pc-hit-H1').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(lamp).not.toHaveAttribute('transform', before!);

  // H1 := SW1
  await page.getByTestId('nav-editor').click();
  await page.getByTestId('palette-NO').click();
  const op = page.locator('.props input[data-operand="0"]');
  await op.fill('SW1');
  await op.press('Enter');
  await page.getByTestId('palette-COIL').click();
  await op.fill('H1');
  await op.press('Enter');

  await page.getByTestId('nav-plant').click();
  await page.getByTestId('plant-edit').click(); // back to operate mode
  await page.getByTestId('run').click();
  const bulb = page.locator('.pc-main [data-testid="pc-lamp-H1"] circle');
  await expect(bulb).toHaveAttribute('fill', '#1f2937');
  await page.locator('.pc-main [data-testid="pc-selector-SW1"]').click();
  await expect(bulb).toHaveAttribute('fill', '#22c55e');
});

test('destructive edits run at once with an "Undo" toast', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('example-subroutines').click();
  await page.getByTestId('program-tab-Alarmes').click();
  await page.getByTestId('delete-program').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(page.getByTestId('program-tab-Alarmes')).toHaveCount(0);
  await expect(lastToast(page)).toContainText('Programa “Alarmes” excluído');
  await expect(lastToast(page)).toContainText('CALL'); // it was still called
  await lastToast(page).getByTestId('toast-action').click();
  await expect(page.getByTestId('program-tab-Alarmes')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('deleted projects go to the trash and can be restored', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('new-project').click();
  await page.getByTestId('nav-projects').click();
  const list = page.locator('.project-list').first();
  await expect(list.locator('li')).toHaveCount(2);

  // Undo straight from the toast.
  await page.getByTestId('project-delete').click();
  await expect(list.locator('li')).toHaveCount(1);
  await expect(page.getByTestId('trash')).toContainText('Lixeira (1 projeto)');
  await lastToast(page).getByTestId('toast-action').click();
  await expect(list.locator('li')).toHaveCount(2);
  await expect(page.getByTestId('trash')).toHaveCount(0);

  // Restore from the trash later.
  await page.getByTestId('project-delete').click();
  await page.getByTestId('trash').locator('summary').click();
  await page.getByTestId('project-restore').click();
  await expect(list.locator('li')).toHaveCount(2);

  // Deleting for good still asks first.
  await page.getByTestId('project-delete').click();
  await page.getByTestId('trash').locator('summary').click();
  await page.getByRole('button', { name: 'Excluir de vez' }).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('trash')).toBeVisible();
  await page.getByRole('button', { name: 'Excluir de vez' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('trash')).toHaveCount(0);
});

test('"?" opens the keyboard shortcuts; Esc closes them without touching the editor', async ({ page }) => {
  await openApp(page);
  await openExample(page, 'sealIn');
  await page.locator('.rung-gutter').first().click(); // a selected rung: Delete would remove it
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await expect(page.getByTestId('shortcuts')).toContainText('Criar ramo em paralelo');
  const rungs = await page.locator('.rung').count();
  await page.keyboard.press('Delete'); // stays inside the dialog
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);
  await expect(page.locator('.rung')).toHaveCount(rungs);
});

test('narrow screens: less used top bar actions move to the "⋯" menu', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openApp(page);
  await expect(page.getByTestId('language')).toBeHidden();
  await expect(page.getByTestId('share')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('more-menu').click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('nav-projects')).toContainText('Projects');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});

test('welcome page: blank project, examples, saved projects and opening a file', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('welcome-continue')).toHaveCount(0); // nothing saved yet
  await expect(page.getByTestId('welcome')).toContainText('Nenhum projeto salvo ainda');

  await page.getByTestId('welcome-new').click();
  await expect(page.locator('.project-name')).toHaveValue('Novo projeto');

  // The logo goes back; "Continue" returns to the open project.
  await page.getByTestId('home').click();
  await expect(page.getByTestId('welcome-continue')).toContainText('Novo projeto');
  await expect(page.getByTestId('welcome-saved-project')).toHaveCount(1);
  await page.getByTestId('welcome-example-blinker').click();
  await expect(page.getByTestId('nav-editor')).toHaveClass(/active/);
  const blinker = await page.locator('.project-name').inputValue();

  // On a new visit, "Continue" reopens the last project.
  await page.reload();
  await expect(page.getByTestId('welcome-continue')).toContainText(blinker);
  await expect(page.getByTestId('welcome-saved-project')).toHaveCount(2);
  await page.getByTestId('welcome-continue').click();
  await expect(page.locator('.project-name')).toHaveValue(blinker);

  // Open a file: the exported project comes back as a copy with a unique name.
  const download = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const file = await (await download).path();
  await page.getByTestId('home').click();
  await page.getByTestId('welcome-file').setInputFiles(file);
  await expect(page.locator('.project-name')).toHaveValue(`${blinker} 2`);
  await expect(lastToast(page)).toContainText('importado');
});
