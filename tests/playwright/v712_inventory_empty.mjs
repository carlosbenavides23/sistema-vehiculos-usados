// Vendedores ficticios y base PostgreSQL desechable mediante fixture_v711_ui.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const [python, playwright, chromiumPath, evidence] = process.argv.slice(2);
if (!python || !playwright || !chromiumPath || !evidence) throw Error('Faltan argumentos de Python, Playwright, Chromium o evidencias.');
const { chromium } = await import(pathToFileURL(playwright).href);
await fs.mkdir(evidence, { recursive: true });
const server = spawn(python, ['tests/fixture_v711_ui.py'], { cwd: process.cwd(), env: { ...process.env, PYTHON_DOTENV_DISABLED: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', browser;
server.stderr.on('data', chunk => stderr += chunk);
try {
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(stderr || 'Flask no inició')), 45000);
    createInterface({ input: server.stdout }).on('line', line => {
      if (line.startsWith('V711_SERVER ')) { clearTimeout(timer); resolve(JSON.parse(line.slice(12))); }
    });
    server.once('exit', code => { clearTimeout(timer); reject(Error(`Flask terminó (${code}): ${stderr}`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === info.url ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    async function login(name) {
      await page.goto(info.url + '/cuenta');
      await page.locator('#email').fill(`${name}@example.test`);
      await page.locator('#password').fill('local-fixture-password');
      await page.locator('#enviar-cuenta').click();
      await page.locator('#salir-cuenta').waitFor();
      await page.goto(info.url + '/vendedor');
      await page.waitForFunction(() => document.querySelector('#admin-inventory-list')?.getAttribute('aria-busy') === 'false');
    }
    await login('seller_empty');
    const empty = page.locator('#admin-inventory-empty');
    assert.equal(await empty.isVisible(), true);
    assert.match(await empty.innerText(), /Todavía no tenés publicaciones/);
    assert.equal(await page.locator('#admin-clear-filters').isVisible(), false);
    assert.equal(await page.locator('#admin-first-vehicle').isVisible(), true);
    await page.screenshot({ path: path.join(evidence, `inventario-vacio-${width}.png`) });
    await page.locator('#admin-first-vehicle').click();
    assert.equal(await page.locator('[data-admin-panel="vehicle-form"]').isVisible(), true);
    await context.close();

    const populated = await browser.newContext({ viewport: { width, height: 900 } });
    await populated.route('**/*', route => new URL(route.request().url()).origin === info.url ? route.continue() : route.abort());
    const p = await populated.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(info.url + '/cuenta');
    await p.locator('#email').fill('seller_a@example.test');
    await p.locator('#password').fill('local-fixture-password');
    await p.locator('#enviar-cuenta').click();
    await p.locator('#salir-cuenta').waitFor();
    await p.goto(info.url + '/vendedor');
    await p.locator('#admin-inventory-list tr').first().waitFor({ state: 'attached' });
    await p.locator('#admin-inventory-filters input[name=q]').fill('NoExisteNingunModelo987');
    const response = p.waitForResponse(r => r.url().includes('/api/vendedor/vehiculos?') && r.status() === 200);
    await p.locator('#admin-inventory-filters button[type=submit]').click();
    await response;
    await p.locator('#admin-inventory-empty').waitFor();
    assert.match(await p.locator('#admin-inventory-empty').innerText(), /No encontramos publicaciones/);
    assert.equal(await p.locator('#admin-first-vehicle').isVisible(), false);
    await p.screenshot({ path: path.join(evidence, `inventario-sin-resultados-${width}.png`) });
    await p.locator('#admin-clear-filters').click();
    await p.locator('#admin-inventory-list tr').first().waitFor({ state: 'attached' });
    assert.equal(await p.locator('#admin-inventory-empty').isVisible(), false);
    assert.deepEqual(errors, []);
    await populated.close();
    console.log(`Inventario vacío y búsqueda sin coincidencias: ${width}px OK`);
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.stdin.end('stop\n');
    await new Promise(resolve => server.once('exit', resolve));
  }
}
