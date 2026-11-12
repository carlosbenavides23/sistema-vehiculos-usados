// Verificación de la pantalla de cuenta con Flask local y Auth completamente simulado.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const [python, playwright, chromiumPath, evidence] = process.argv.slice(2);
if (!python || !playwright || !chromiumPath || !evidence) {
  throw new Error("Uso: node cuenta_auth_ux.mjs <python> <playwright/index.mjs> <chromium.exe> <directorio-evidencias>");
}

const { chromium } = await import(pathToFileURL(playwright).href);
await fs.mkdir(evidence, { recursive: true });
const server = spawn(python, ["tests/fixture_cuenta_auth_ui.py"], {
  env: { ...process.env, PYTHON_DOTENV_DISABLED: "1", FLASK_SECRET_KEY: "v75-ui-fixture-secret-only-not-for-production" },
  stdio: ["pipe", "pipe", "inherit"],
});
const checks = [];
const jsErrors = [];
let browser;

try {
  const info = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Flask local no inició")), 20000);
    createInterface({ input: server.stdout }).on("line", line => {
      if (!line.startsWith("AUTH_UI_SERVER ")) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice("AUTH_UI_SERVER ".length)));
    });
    server.once("exit", code => {
      clearTimeout(timeout);
      reject(Error(`Flask terminó antes de iniciar (${code})`));
    });
  });

  browser = await chromium.launch({ headless: true, executablePath: chromiumPath });

  async function openPage(width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", error => jsErrors.push(error.message));
    const assets = [];
    page.on("response", response => {
      if (/\/(?:css|js)\//.test(response.url())) assets.push({ url: response.url(), status: response.status() });
    });
    await page.route("**/api/cuenta**", async route => {
      const request = route.request();
      if (request.method() === "GET") {
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, mensaje: "Iniciá sesión para continuar." }) });
      }
      const path = new URL(request.url()).pathname;
      const body = JSON.parse(request.postData() || "{}");
      if (path.endsWith("/registro")) {
        if (body.email === "network@example.test") return route.abort("failed");
        if (body.email === "error@example.test") {
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, mensaje: "No pudimos completar el acceso. Intentá de nuevo." }) });
        }
        if (body.email === "instant@example.test") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, usuario: { id: "fixture-user", email: body.email, rol: body.rol } }) });
        }
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mensaje: "Respuesta del proveedor" }) });
      }
      if (path.endsWith("/login")) {
        if (body.password !== "fixture-pass") {
          return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, mensaje: "No pudimos completar el acceso. Revisá los datos o intentá más tarde." }) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, usuario: { id: "fixture-user", email: body.email, rol: "comprador" } }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mensaje: "Sesión cerrada." }) });
    });
    const cssResponses = Promise.all([
      page.waitForResponse(response => response.url().includes("/static/css/estilos.css")),
      page.waitForResponse(response => response.url().includes("/static/css/admin-v6.css")),
      page.waitForResponse(response => response.url().includes("/static/js/cuenta.js")),
    ]);
    await page.goto(`${info.url}/cuenta`);
    await cssResponses;
    assert.ok(assets.length >= 3 && assets.every(asset => asset.status === 200), "CSS y JavaScript de la cuenta deben responder 200.");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `No debe existir desbordamiento horizontal a ${width}px.`);
    assert.equal(await page.locator("#cuenta-titulo").innerText(), "Iniciar sesión");
    assert.equal(await page.locator("#cuenta-descripcion").innerText(), "Accede a tu cuenta para continuar.");
    assert.equal(await page.locator("#registro-aviso").isVisible(), false);
    await page.screenshot({ path: `${evidence}/cuenta-login-${width}.png`, fullPage: true });
    return { context, page };
  }

  for (const width of [1440, 390]) {
    const { context, page } = await openPage(width);
    const password = page.locator("#password");
    const toggle = page.locator("#mostrar-password");
    await password.fill("mi-password-fixture");
    await password.focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "mostrar-password", "El control del ojo debe estar en el orden de teclado.");
    await page.keyboard.press("Space");
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "mi-password-fixture");
    assert.equal(await toggle.getAttribute("aria-label"), "Ocultar contraseña");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => document.activeElement.id), "mostrar-password", "El foco se conserva en el botón accesible.");
    await page.keyboard.press("Space");
    assert.equal(await password.getAttribute("type"), "password");
    assert.equal(await toggle.getAttribute("aria-label"), "Mostrar contraseña");
    const geometry = await page.evaluate(() => {
      const input = document.querySelector("#password").getBoundingClientRect();
      const button = document.querySelector("#mostrar-password").getBoundingClientRect();
      return { inputWidth: input.width, buttonWidth: button.width, buttonHeight: button.height, rightInset: input.right - button.right };
    });
    assert.ok(geometry.buttonWidth >= 44 && geometry.buttonHeight >= 44);
    assert.ok(geometry.inputWidth > geometry.buttonWidth + 20 && geometry.rightInset >= 1);
    checks.push(`visibilidad de contraseña por teclado, foco y valor conservados (${width}px)`);

    await page.locator("#modo-cuenta").click();
    assert.equal(await page.locator("#cuenta-titulo").innerText(), "Crear cuenta");
    assert.equal(await page.locator("#cuenta-descripcion").innerText(), "Regístrate como comprador o vendedor para utilizar la plataforma.");
    assert.equal(await page.locator("#rol-field").isVisible(), true);
    assert.equal(await page.locator("#registro-aviso").innerText(), "Te enviaremos un correo de confirmación para activar tu cuenta.");
    assert.equal(await page.locator("#enviar-cuenta").innerText(), "Crear cuenta");
    assert.equal(await page.locator("#modo-ayuda").innerText(), "¿Ya tienes cuenta?");
    assert.equal(await page.locator("#modo-cuenta").innerText(), "Iniciar sesión");
    assert.equal(await page.locator("#cuenta-form").evaluate(form => form.checkValidity()), false, "El formulario incompleto no debe enviarse.");
    await page.screenshot({ path: `${evidence}/cuenta-registro-${width}.png`, fullPage: true });

    await page.locator("#email").fill("error@example.test");
    await page.locator("#password").fill("password-fixture");
    await page.locator("#rol").selectOption("vendedor");
    await page.locator("#enviar-cuenta").click();
    await page.getByRole("status").filter({ hasText: "No pudimos completar el acceso" }).waitFor();
    assert.equal(await page.locator("#cuenta-form").isVisible(), true);
    assert.equal(await page.locator("#email").inputValue(), "error@example.test");
    assert.equal(await page.locator("#password").inputValue(), "password-fixture");
    assert.equal(await page.locator("#registro-confirmacion").isVisible(), false);

    await page.locator("#email").fill("network@example.test");
    await page.locator("#enviar-cuenta").click();
    await page.getByRole("status").filter({ hasText: "Revisá la conexión e intentá nuevamente." }).waitFor();
    assert.equal(await page.locator("#password").inputValue(), "password-fixture");

    await page.locator("#email").fill("pending@example.test");
    await page.locator("#enviar-cuenta").click();
    await page.getByRole("status").filter({ hasText: "Revisa tu correo electrónico para confirmar tu cuenta. Después podrás iniciar sesión." }).waitFor();
    assert.equal(await page.locator("#cuenta-form").isVisible(), false);
    assert.equal(await page.locator("#volver-login").innerText(), "Volver a iniciar sesión");
    await page.screenshot({ path: `${evidence}/cuenta-confirmacion-${width}.png`, fullPage: true });
    await page.locator("#volver-login").click();
    assert.equal(await page.locator("#cuenta-titulo").innerText(), "Iniciar sesión");
    assert.equal(await page.locator("#cuenta-descripcion").innerText(), "Accede a tu cuenta para continuar.");
    assert.equal(await page.locator("#registro-aviso").isVisible(), false);
    assert.equal(await page.locator("#email").inputValue(), "pending@example.test");
    assert.equal(await page.evaluate(() => document.activeElement.id), "email");
    checks.push(`confirmación 202, errores/red y regreso al login (${width}px)`);

    await page.locator("#password").fill("wrong-password");
    await page.locator("#enviar-cuenta").click();
    await page.getByRole("status").filter({ hasText: "No pudimos completar el acceso." }).waitFor();
    assert.equal(await page.locator("#password").inputValue(), "wrong-password");
    assert.equal(await page.locator("#registro-confirmacion").isVisible(), false);
    await page.locator("#password").fill("fixture-pass");
    await page.locator("#enviar-cuenta").click();
    await page.getByText("Sesión iniciada: pending@example.test · comprador", { exact: true }).waitFor();
    assert.equal(await page.locator("#cuenta-form").isVisible(), false);
    assert.equal(await page.locator("#registro-confirmacion").isVisible(), false, "El login no debe mostrar confirmación de correo.");
    checks.push(`login exitoso y credenciales incorrectas sin perder estado (${width}px)`);
    await context.close();

    const immediate = await openPage(width);
    await immediate.page.locator("#modo-cuenta").click();
    await immediate.page.locator("#email").fill("instant@example.test");
    await immediate.page.locator("#password").fill("password-fixture");
    await immediate.page.locator("#rol").selectOption("vendedor");
    await immediate.page.locator("#enviar-cuenta").click();
    await immediate.page.getByText("Sesión iniciada: instant@example.test · vendedor", { exact: true }).waitFor();
    assert.equal(await immediate.page.locator("#registro-confirmacion").isVisible(), false, "La sesión inmediata no debe mostrar confirmación pendiente.");
    assert.equal(await immediate.page.locator("#panel-vendedor").isVisible(), true);
    assert.equal(await immediate.page.locator("#mis-conversaciones-cuenta").isVisible(), false);
    checks.push(`registro con sesión inmediata sin estado de confirmación (${width}px)`);
    await immediate.context.close();
  }

  assert.deepEqual(jsErrors, [], `No deben aparecer errores JavaScript: ${jsErrors.join(" | ")}`);
  console.log(JSON.stringify({ checks, jsErrors, evidence }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.stdin.write("stop\n");
    server.stdin.end();
    await new Promise(resolve => server.once("exit", resolve));
  }
}
