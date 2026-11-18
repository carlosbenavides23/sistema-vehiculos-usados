// PostgreSQL local desechable; Auth y Storage simulados. Solo escritorio 1920 × 1080.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const [python, playwright, chrome, out] = process.argv.slice(2);
const {chromium} = await import(pathToFileURL(playwright));
const server = spawn(python, ['tests/fixture_v711_ui.py'], {
  env: {...process.env, PYTHON_DOTENV_DISABLED: '1'}, stdio: ['pipe', 'pipe', 'pipe'],
});
let log = '', browser;
const pages = [], errors = [], resources = [];
server.stderr.on('data', data => log += data);
await fs.mkdir(out, {recursive: true});
try {
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log || 'Flask no inició')), 45000);
    createInterface({input: server.stdout}).on('line', line => {
      if (line.startsWith('V711_SERVER ')) {clearTimeout(timer); resolve(JSON.parse(line.slice(12)));}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error(log));});
  });
  browser = await chromium.launch({headless: true, executablePath: chrome});
  async function account(name) {
    const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
    await context.route('**/*', route => new URL(route.request().url()).origin === info.url ? route.continue() : route.abort());
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      // 304 es una revalidación de caché correcta, no un recurso fallido.
      if (response.url().includes('/static/') && response.status() >= 400) resources.push({url: response.url(), status: response.status()});
    });
    await page.goto(info.url + '/cuenta');
    assert.equal(await page.locator('#email').evaluate(e => getComputedStyle(e).fontSize), '16px');
    if (name === 'seller_empty') await page.screenshot({path: `${out}/cuenta-1920.png`});
    await page.getByLabel('Correo electrónico', {exact: true}).fill(name + '@example.test');
    await page.getByLabel('Contraseña', {exact: true}).fill('local-fixture-password');
    await page.getByRole('button', {name: 'Iniciar sesión', exact: true}).click();
    if (name.startsWith('seller_')) await page.waitForURL('**/vendedor');
    else await page.getByRole('button', {name: 'Cerrar sesión', exact: true}).waitFor();
    return page;
  }
  async function capture(page, name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ': desbordamiento');
    await page.screenshot({path: `${out}/${name}.png`});
  }
  const s = await account('seller_empty');
  await s.getByRole('button', {name: 'Registrar mi primer vehículo', exact: true}).click();
  await s.getByRole('heading', {name: 'Registrar vehículo', exact: true}).waitFor();
  assert.equal(await s.locator('#vehicle-photo-upload').isVisible(), false);
  assert.equal(await s.locator('#vehicle-next-actions').isVisible(), false);
  await s.getByRole('button', {name: 'Publicar vehículo', exact: true}).last().click();
  await s.locator('#vehicle-form-error').waitFor();
  for (const id of ['brand', 'model', 'year', 'price', 'location', 'mileage', 'description']) {
    const field = s.locator('#vehicle-' + id);
    assert.equal(await field.getAttribute('aria-invalid'), 'true');
    assert.ok(await field.getAttribute('aria-describedby'));
  }
  await s.waitForFunction(() => !document.querySelector('#admin-vehicle-form').hasAttribute('aria-busy'));
  await capture(s, 'registro-validacion-1920');
  const values = {brand: 'Suzuki', model: 'Swift UX ficticio', year: '2020', price: '12500', location: 'Managua', mileage: '42000', description: 'Vehículo ficticio para verificar el recorrido de publicación en una base aislada.'};
  for (const [id, value] of Object.entries(values)) await s.locator('#vehicle-' + id).fill(value);
  assert.equal(await s.locator('#vehicle-form-error').isVisible(), false);
  const savedResponse = s.waitForResponse(r => r.url().endsWith('/api/vendedor/vehiculos') && r.request().method() === 'POST');
  await s.getByRole('button', {name: 'Publicar vehículo', exact: true}).last().click();
  const response = await savedResponse;
  assert.equal(response.status(), 201);
  const {vehiculo} = await response.json();
  for (const name of ['version', 'motor', 'numero_puertas', 'capacidad_pasajeros', 'transmision', 'combustible', 'color', 'tipo_vehiculo', 'aire_acondicionado']) assert.equal(vehiculo[name], null, name);
  await s.getByText('Vehículo registrado en el catálogo.', {exact: true}).waitFor();
  assert.equal(await s.locator('#vehicle-next-actions').isVisible(), true);
  assert.equal(await s.locator('#vehicle-public-link').getAttribute('href'), `/vehiculo/${vehiculo.id}?desde=inventario`);
  // The contextual action must not repopulate the form and discard pending changes.
  await s.locator('#vehicle-price').fill('12501');
  await s.getByRole('button', {name: 'Añadir fotografías', exact: true}).click();
  assert.equal(await s.locator('#vehicle-price').inputValue(), '12501');
  assert.equal(await s.locator('#vehicle-photos-title').evaluate(e => e === document.activeElement), true);
  await s.locator('#vehicle-price').fill('12500');
  const photoResponse = await s.request.get(info.url + '/api/vehiculos/' + info.vehicles[0]);
  const sample = (await photoResponse.json()).vehiculo.fotografias[0].url;
  const bytes = await (await s.request.get(new URL(sample, info.url).href)).body();
  await s.locator('#vehicle-photo-input').setInputFiles({name: 'foto-ficticia.webp', mimeType: 'image/webp', buffer: bytes});
  await s.locator('#vehicle-photo-pending').waitFor();
  await s.waitForFunction(() => document.querySelector('#vehicle-photo-preview').naturalWidth > 0);
  assert.equal(await s.locator('.admin-photo-item').count(), 0);
  await s.getByText('Vista previa sin guardar. Confirmá con «Guardar fotografía».', {exact: true}).waitFor();
  await s.locator('#vehicle-photo-pending').scrollIntoViewIfNeeded();
  await capture(s, 'fotografia-vista-previa-1920');
  await s.getByRole('button', {name: 'Guardar fotografía', exact: true}).click();
  await s.getByText('Fotografía guardada.', {exact: true}).waitFor();
  assert.equal(await s.locator('#vehicle-photo-pending').isVisible(), false);
  await s.getByText('Foto 1 · Guardada', {exact: true}).waitFor();
  await s.locator('#vehicle-next-actions').scrollIntoViewIfNeeded();
  await capture(s, 'fotografia-guardada-1920');
  await s.getByRole('link', {name: 'Ver ficha pública', exact: true}).click();
  await s.getByRole('heading', {name: 'Suzuki Swift UX ficticio', exact: true}).waitFor();
  await s.waitForFunction(() => document.querySelector('#ficha-imagen').naturalWidth > 0 && document.querySelector('#ficha-imagen').src.includes('/fixture-images/'));
  assert.equal(await s.locator('#ficha-precio').evaluate(e => getComputedStyle(e).fontSize), '34px');
  await capture(s, 'ficha-publicada-1920');
  await s.getByRole('link', {name: 'Volver a mis publicaciones', exact: true}).click();
  await s.getByRole('link', {name: 'Suzuki Swift UX ficticio', exact: true}).waitFor();
  assert.equal(await s.locator('.admin-nav-link').first().evaluate(e => getComputedStyle(e).fontSize), '16px');
  await capture(s, 'inventario-1920');
  const b = await account('buyer_a');
  await b.getByRole('link', {name: 'Volver al catálogo', exact: true}).click();
  await b.getByLabel('Buscar vehículos', {exact: true}).fill('Toyota');
  await b.getByRole('button', {name: 'Buscar vehículos', exact: true}).click();
  // La semilla local incluye otro Toyota histórico sin propietario.
  await b.waitForFunction(() => document.querySelectorAll('#lista-vehiculos article').length === 2);
  await b.evaluate(() => scrollTo(0, 0));
  await capture(b, 'catalogo-1920');
  await b.getByRole('link', {name: 'Ver ficha completa de Toyota Corolla', exact: true}).last().click();
  await b.getByRole('link', {name: 'Volver al catálogo', exact: true}).click();
  assert.match(b.url(), /q=Toyota/);
  await b.waitForFunction(() => document.querySelector('#filtro-q').value === 'Toyota');
  assert.equal(await b.getByLabel('Buscar vehículos', {exact: true}).inputValue(), 'Toyota');
  await b.getByRole('link', {name: 'Ver ficha completa de Toyota Corolla', exact: true}).last().click();
  await b.getByRole('link', {name: 'Vendedora Carla', exact: true}).click();
  await b.getByRole('heading', {name: 'Vendedora Carla', exact: true}).waitFor();
  await b.waitForFunction(() => document.querySelector('#inventario').getAttribute('aria-busy') === 'false');
  await capture(b, 'perfil-1920');
  await b.getByRole('link', {name: 'Ver ficha completa de Toyota Corolla', exact: true}).click();
  await b.getByRole('button', {name: 'Contactar al vendedor', exact: true}).click();
  const editor = b.getByRole('textbox', {name: 'Escribe tu mensaje', exact: true});
  await editor.waitFor();
  await editor.fill('Mensaje ficticio de verificación V7.15');
  await editor.press('Shift+Enter');
  assert.match(await editor.inputValue(), /\n/);
  await editor.fill('Mensaje ficticio de verificación V7.15');
  await editor.press('Enter');
  await b.getByText('Mensaje ficticio de verificación V7.15', {exact: true}).waitFor();
  await capture(b, 'conversacion-1920');
  await b.getByRole('button', {name: 'Cerrar mensajes', exact: true}).click();
  await b.getByRole('link', {name: 'Volver al catálogo', exact: true}).click();
  await b.getByRole('heading', {name: 'Vehículos publicados', exact: true}).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(resources, []);
  console.log('PASS V7.15: errores requeridos, opcionales nulos, alta, foco sin pérdida, vista previa/guardado, ficha/retorno, catálogo/filtros/perfil y chat Enter/Shift+Enter a 1920×1080; PostgreSQL real local, Auth/Storage dobles.');
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({path: `${out}/fallo-${index}.png`});
  throw error;
} finally {
  await browser?.close();
  server.stdin.end('stop\n');
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    const timer = setTimeout(() => {server.kill(); resolve();}, 10000);
    server.once('exit', () => {clearTimeout(timer); resolve();});
  });
}
