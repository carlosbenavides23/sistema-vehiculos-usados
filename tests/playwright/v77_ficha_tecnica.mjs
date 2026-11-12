import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const [python, playwrightPath, chromiumPath, evidencePath, requestedWidth = "1440"] = process.argv.slice(2);
if (!python || !playwrightPath || !chromiumPath || !evidencePath) throw new Error("Uso: node v77_ficha_tecnica.mjs <python> <playwright> <chromium> <evidencias> [ancho]");
const width = Number(requestedWidth);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
await fs.mkdir(evidencePath, { recursive: true });
const server = spawn(python, ["tests/fixture_v77_ui.py"], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
let browser;
try {
  const info = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("El fixture PostgreSQL no inició")), 30000);
    createInterface({ input: server.stdout }).on("line", (line) => {
      if (!line.startsWith("V77_SERVER ")) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice("V77_SERVER ".length)));
    });
    server.once("exit", (code) => { clearTimeout(timeout); reject(Error(`El fixture terminó (${code})`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath });
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", (error) => jsErrors.push(error.message));

  await page.goto(info.url);
  await page.locator(".vehicle-card").first().waitFor();
  assert.equal(await page.locator(".vehicle-card").count(), 9);
  assert.equal(await page.locator(".vehicle-card").filter({ hasText: "Toyota RAV4" }).locator(".vehicle-type").textContent(), "SUV");
  await page.locator("#filtros-avanzados-resumen").click();
  await page.locator("#filtro-q").fill("RAV4");
  await page.locator("#filtro-tipo").selectOption("suv");
  await page.getByRole("button", { name: "Buscar vehículos" }).click();
  await page.locator(".vehicle-card").first().waitFor();
  assert.equal(await page.locator(".vehicle-card").count(), 1);
  assert.match(await page.locator(".vehicle-card h3").textContent(), /Toyota RAV4/);

  await page.locator(".detail-link").click();
  await page.locator("#ficha-contenido:not([hidden])").waitFor();
  const technical = (await page.locator("#ficha-caracteristicas").innerText()).replace(/\s+/g, " ");
  for (const expected of ["Versión: Limited", "Motor: <img src=x onerror=alert(1)>", "Puertas: 5", "Pasajeros: 5", "Cámara de reversa: Sí", "Bluetooth: No"]) assert.ok(technical.includes(expected), `Falta en ficha: ${expected}\nFicha recibida:\n${technical}`);
  assert.equal(await page.locator("#ficha-caracteristicas img").count(), 0, "Texto del motor no se interpreta como HTML");

  await page.goto(`${info.url}/vehiculo/9`);
  await page.locator("#ficha-contenido:not([hidden])").waitFor();
  const partialTechnical = (await page.locator("#ficha-caracteristicas").innerText()).replace(/\s+/g, " ");
  assert.doesNotMatch(partialTechnical, /Versión:|Motor:|Puertas:|Pasajeros:|Cámara de reversa:|Bluetooth:/);

  await page.goto(`${info.url}/administracion`);
  await page.locator("#admin-password").fill("v77-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.locator("#admin-workspace:not([hidden])").waitFor();
  if (width < 768) await page.locator("#admin-inventory-mobile .admin-mobile-card").filter({ hasText: "Subaru Legacy Wagon" }).waitFor();
  else await page.locator("#admin-inventory-list tr").filter({ hasText: "Subaru Legacy Wagon" }).waitFor();
  const categoryOptions = await page.locator("#vehicle-type option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  assert.deepEqual(categoryOptions, ["sedan", "hatchback", "suv", "pickup", "coupe", "convertible", "minivan", "van_microbus", "camioneta", "todoterreno", "camion", "otro"]);

  if (width < 768) await page.locator("#admin-inventory-mobile .admin-mobile-card").filter({ hasText: "Subaru Legacy Wagon" }).getByRole("button", { name: "Editar vehículo" }).click();
  else await page.locator("#admin-inventory-list tr").filter({ hasText: "Subaru Legacy Wagon" }).getByRole("button", { name: "Editar" }).click();
  await page.locator('[data-admin-panel="vehicle-form"]:not([hidden])').waitFor();
  assert.equal(await page.locator("#vehicle-type").inputValue(), "Station Wagon clásico");
  assert.equal(await page.locator('#vehicle-type option[data-historical-type]').textContent(), "Tipo histórico · Station Wagon clásico");
  await page.locator("#vehicle-price").fill("13000");
  const save = page.locator('button[type="submit"][form="admin-vehicle-form"]:visible').first();
  await save.click();
  await page.getByText("Cambios guardados.").waitFor();
  assert.equal(await page.locator("#vehicle-type").inputValue(), "Station Wagon clásico");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, `Desbordamiento horizontal a ${width}px`);
  assert.deepEqual(jsErrors, []);
  await page.screenshot({ path: `${evidencePath}/v77-${width}.png`, fullPage: true });
  await context.close();
  console.log(JSON.stringify({ result: "PASS", width, checks: ["categorías canónicas y filtro", "detalle con campos opcionales", "booleanos Sí/No/NULL", "XSS se representa como texto", "tipo histórico se conserva en edición", "formulario responsive", "sin errores JavaScript ni overflow"], jsErrors, screenshot: `${evidencePath}/v77-${width}.png` }));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.stdin.write("\n");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
