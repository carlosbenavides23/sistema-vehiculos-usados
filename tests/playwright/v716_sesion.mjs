import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {pathToFileURL} from "node:url";

const [python, playwright, chrome] = process.argv.slice(2);
const {chromium} = await import(pathToFileURL(playwright));
const server = spawn(python, ["tests/fixture_v711_ui.py"], {stdio: ["pipe", "pipe", "pipe"]});
let browser, log = "";
server.stderr.on("data", chunk => { log += chunk; });
try {
  const {url, vehicles} = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log || "Flask no inició")), 45000);
    createInterface({input: server.stdout}).on("line", line => {
      if (line.startsWith("V711_SERVER ")) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(12)));
      }
    });
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
  });
  browser = await chromium.launch({executablePath: chrome});
  const errors = [];
  async function context() {
    const ctx = await browser.newContext({viewport: {width: 1920, height: 1080}});
    await ctx.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
    ctx.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    return ctx;
  }
  const header = page => page.getByRole("banner");
  const nav = page => header(page).getByRole("navigation", {name: "Navegación principal"});
  const button = (page, name) => nav(page).getByRole("button", {name, exact: true});
  const link = (page, name) => nav(page).getByRole("link", {name, exact: true});
  const login = async (page, user) => {
    await page.getByLabel("Correo electrónico", {exact: true}).fill(user + "@example.test");
    await page.getByLabel("Contraseña", {exact: true}).fill("local-fixture-password");
    await page.getByRole("button", {name: "Iniciar sesión", exact: true}).click();
  };
  const ficha = url + "/vehiculo/" + vehicles[0];
  const buyerFlowContext = await context();
  const buyerFlow = await buyerFlowContext.newPage();
  await buyerFlow.addInitScript(() => {
    if (location.pathname !== "/cuenta") return;
    const seen = {redirecting: false, account: false, formDuringRedirect: false};
    const inspect = () => {
      const content = document.getElementById("cuenta-contenido");
      const loading = document.getElementById("cuenta-redireccion");
      if (!content || !loading) return;
      if (!content.hidden && document.getElementById("cuenta-titulo").textContent === "Mi cuenta") seen.account = true;
      if (!loading.hidden) {
        seen.redirecting = true;
        if (!content.hidden && !document.getElementById("cuenta-form").hidden) seen.formDuringRedirect = true;
      }
    };
    new MutationObserver(inspect).observe(document, {attributes: true, childList: true, subtree: true});
    window.addEventListener("pagehide", () => {
      inspect();
      sessionStorage.setItem("v7204-login-transition", JSON.stringify(seen));
    });
  });
  await buyerFlow.goto(url + "/cuenta?next=" + encodeURIComponent("https://otro.example/vehiculo/1"));
  await buyerFlow.route("**/api/cuenta/registro", route => route.fulfill({
    status: 202, json: {ok: true},
  }), {times: 1});
  await buyerFlow.getByRole("button", {name: "Crear cuenta", exact: true}).click();
  await buyerFlow.getByLabel("Nombre visible", {exact: true}).fill("Compradora de prueba");
  await buyerFlow.getByLabel("Correo electrónico", {exact: true}).fill("pendiente@example.test");
  await buyerFlow.getByLabel("Contraseña", {exact: true}).fill("local-fixture-password");
  await buyerFlow.getByRole("button", {name: "Crear cuenta", exact: true}).click();
  await buyerFlow.getByRole("heading", {name: "Revisa tu correo electrónico"}).waitFor();
  await buyerFlow.getByRole("button", {name: "Volver a iniciar sesión"}).click();

  await buyerFlow.route("**/api/cuenta/login", route => route.abort(), {times: 1});
  await login(buyerFlow, "buyer_a");
  await buyerFlow.getByText("Revisá la conexión e intentá nuevamente.").waitFor();
  await buyerFlow.getByLabel("Contraseña", {exact: true}).fill("incorrecta-fixture");
  const invalidLogin = buyerFlow.waitForResponse(response => response.url().endsWith("/api/cuenta/login"));
  await buyerFlow.getByRole("button", {name: "Iniciar sesión", exact: true}).click();
  assert.equal((await invalidLogin).status(), 401);
  await buyerFlow.locator("#cuenta-estado[data-type=error]").waitFor();

  let restoreBuyer;
  const pendingBuyer = new Promise(resolve => { restoreBuyer = resolve; });
  await buyerFlow.route(url + "/api/cuenta", async route => {
    if (route.request().headers().referer === url + "/") await pendingBuyer;
    await route.continue();
  });
  try {
    await login(buyerFlow, "buyer_a");
    await buyerFlow.waitForURL(url + "/");
    await buyerFlow.getByRole("link", {name: "Ver ficha completa de Toyota Corolla"}).last().waitFor();
    assert.deepEqual(await buyerFlow.evaluate(() => JSON.parse(sessionStorage.getItem("v7204-login-transition"))),
      {redirecting: true, account: false, formDuringRedirect: false});
    assert.equal(await buyerFlow.locator("#cuenta-form").count(), 0);
    assert.equal(await link(buyerFlow, "Iniciar sesión").isVisible(), false);
    assert.equal(await button(buyerFlow, "Mis conversaciones").isVisible(), false);
  } finally {
    restoreBuyer();
  }
  const myAccount = header(buyerFlow).getByRole("link", {name: "Ana María Rodríguez Benavides del Norte"});
  await myAccount.waitFor();
  await header(buyerFlow).getByText("Comprador", {exact: true}).waitFor();
  assert.equal(await buyerFlow.evaluate(() => document.documentElement.scrollWidth), 1920);
  if (process.env.V7204_CAPTURE) await buyerFlow.screenshot({path: process.env.V7204_CAPTURE});
  await button(buyerFlow, "Mis conversaciones").click();
  await buyerFlow.getByRole("dialog").getByRole("button").filter({hasText: "Toyota Corolla"}).click();
  await buyerFlow.getByRole("log").getByText("Consulta ficticia", {exact: true}).waitFor();
  if (process.env.V7204_CHAT_CAPTURE) await buyerFlow.screenshot({path: process.env.V7204_CHAT_CAPTURE});
  await buyerFlow.getByRole("button", {name: "Cerrar mensajes"}).click();
  await myAccount.click();
  await buyerFlow.getByRole("heading", {name: "Mi cuenta"}).waitFor();
  assert.equal(await buyerFlow.locator("#cuenta-form").isVisible(), false);
  await buyerFlow.goBack();
  await myAccount.waitFor();
  await buyerFlow.reload();
  await myAccount.waitFor();
  await buyerFlow.goBack();
  await buyerFlow.getByRole("heading", {name: "Mi cuenta"}).waitFor();
  assert.equal(await buyerFlow.locator("#cuenta-form").isVisible(), false);
  await buyerFlow.goForward();
  await myAccount.waitFor();
  assert.equal(await link(buyerFlow, "Iniciar sesión").isVisible(), false);
  await button(buyerFlow, "Cerrar sesión").click();
  await link(buyerFlow, "Iniciar sesión").waitFor();
  assert.equal(await myAccount.isVisible(), false);
  assert.equal((await buyerFlow.request.get(url + "/api/cuenta")).status(), 401);
  await buyerFlowContext.close();

  const buyerContext = await context();
  const buyer = await buyerContext.newPage();
  const second = await buyerContext.newPage();
  const initial = buyer.waitForResponse(r => r.url() === url + "/api/cuenta");
  await buyer.goto(url);
  assert.equal((await initial).status(), 401);
  await link(buyer, "Iniciar sesión").waitFor();
  assert.equal(await button(buyer, "Mis conversaciones").count(), 0);
  assert.equal(await link(buyer, "Mi panel").count(), 0);
  await buyer.getByRole("link", {name: "Ver ficha completa de Toyota Corolla"}).last().click();
  await buyer.getByRole("heading", {name: /^Toyota Corolla \d{4}$/, level: 1}).waitFor();
  await second.goto(url);
  await buyer.getByRole("button", {name: "Contactar al vendedor"}).click();
  const chat = buyer.getByRole("dialog");
  await chat.getByRole("link", {name: "Iniciar sesión"}).click();
  await login(buyer, "buyer_a");
  await buyer.waitForURL(u => u.pathname === new URL(ficha).pathname);
  await buyer.getByRole("textbox", {name: "Escribe tu mensaje"}).waitFor();
  await header(buyer).getByText("Ana María Rodríguez Benavides del Norte").waitFor({state: "attached"});
  await buyer.getByRole("button", {name: "Cerrar mensajes"}).click();
  await header(buyer).getByText("Comprador", {exact: true}).waitFor();
  await header(second).getByText("Comprador", {exact: true}).waitFor();
  assert.equal((await buyer.request.get(url + "/api/vendedor/session")).status(), 403);
  assert.equal(await link(buyer, "Mi panel").count(), 0);
  await second.reload();
  await header(second).getByText("Comprador", {exact: true}).waitFor();
  await button(second, "Mis conversaciones").click();
  await second.getByRole("dialog").getByRole("heading", {name: "Mis conversaciones"}).waitFor();
  await second.getByRole("dialog").getByRole("button").filter({hasText: "Toyota Corolla"}).click();
  await second.getByRole("log").getByText("Consulta ficticia", {exact: true}).waitFor();
  await buyer.route("**/api/cuenta/logout", route => route.fulfill({status: 503, json: {ok: false}}));
  await button(buyer, "Cerrar sesión").click();
  await buyer.getByText(/No pudimos confirmar el cierre/).waitFor();
  assert.equal(await button(buyer, "Cerrar sesión").isVisible(), true);
  assert.equal((await buyer.request.post(url + "/api/cuenta/logout")).status(), 403);
  await buyer.unroute("**/api/cuenta/logout");
  await button(buyer, "Cerrar sesión").click();
  await link(buyer, "Iniciar sesión").waitFor();
  await link(second, "Iniciar sesión").waitFor();
  await second.getByRole("dialog").waitFor({state: "hidden"});
  assert.equal(await header(buyer).getByText("Comprador", {exact: true}).count(), 0);
  assert.equal(await second.getByText("Consulta ficticia", {exact: true}).count(), 0);
  assert.equal((await buyer.request.get(url + "/api/cuenta")).status(), 401);
  assert.equal(new URL(buyer.url()).pathname, new URL(ficha).pathname);

  const sellerContext = await context();
  const seller = await sellerContext.newPage();
  const sellerSession = "**/api/vendedor/session";
  await seller.goto(url + "/cuenta?next=" + encodeURIComponent("https://otro.example/vendedor"));
  let releaseSession;
  const pendingSession = new Promise(resolve => { releaseSession = resolve; });
  await seller.route(sellerSession, async route => {
    await pendingSession;
    await route.continue();
  }, {times: 1});
  const sellerLoading = seller.getByText("Cargando panel…", {exact: true});
  const sellerAccess = seller.getByRole("heading", {name: "Acceso de vendedor"});
  const workspace = seller.locator("#admin-workspace");
  const inventory = seller.getByRole("heading", {name: "Gestioná tus vehículos"});
  try {
    await login(seller, "seller_a");
    await seller.waitForURL("**/vendedor");
    await sellerLoading.waitFor();
    assert.equal(await sellerAccess.isVisible(), false);
    assert.equal(await workspace.isVisible(), false);
    if (process.env.V7203_CAPTURE) await seller.screenshot({path: process.env.V7203_CAPTURE});
  } finally {
    releaseSession();
  }
  await inventory.waitFor();
  assert.equal(await sellerLoading.isVisible(), false);
  assert.equal(await sellerAccess.isVisible(), false);

  await seller.route(sellerSession, route => route.abort(), {times: 1});
  await seller.reload();
  await seller.getByRole("heading", {name: "No pudimos cargar el panel"}).waitFor();
  assert.equal(await sellerLoading.isVisible(), false);
  assert.equal(await workspace.isVisible(), false);
  await seller.getByRole("button", {name: "Reintentar", exact: true}).click();
  await inventory.waitFor();
  assert.equal(await seller.locator("#admin-session-error").isVisible(), false);

  await seller.route(sellerSession, route => route.fulfill({status: 503, json: {ok: false}}), {times: 1});
  await seller.reload();
  await seller.getByRole("button", {name: "Reintentar", exact: true}).waitFor();
  assert.equal(await sellerLoading.isVisible(), false);
  assert.equal(await sellerAccess.isVisible(), false);

  await seller.route(sellerSession, route => route.fulfill({status: 401, json: {ok: false}}), {times: 1});
  await seller.reload();
  await seller.getByRole("link", {name: "Iniciar sesión con mi cuenta"}).waitFor();
  assert.equal(await sellerLoading.isVisible(), false);
  assert.equal(await workspace.isVisible(), false);

  await seller.route(sellerSession, route => route.fulfill({
    json: {ok: true, autenticado: true, solo_lectura: true},
  }), {times: 1});
  await seller.reload();
  await seller.getByText(/Este ambiente permite únicamente consultar el catálogo/).waitFor();
  assert.equal(await sellerLoading.isVisible(), false);
  assert.equal(await sellerAccess.isVisible(), false);
  assert.equal(await workspace.isVisible(), false);
  await seller.reload();
  await inventory.waitFor();
  await seller.goto(ficha + "?desde=inventario&contactar=1");
  await seller.getByRole("link", {name: "Volver a mis publicaciones", exact: true}).waitFor();
  assert.equal(await seller.getByRole("button", {name: "Contactar al vendedor", exact: true}).count(), 0);
  assert.equal(await seller.getByRole("dialog").isVisible(), false);
  await seller.goto(url);
  await header(seller).getByText("Vendedora Carla", {exact: true}).waitFor();
  await header(seller).getByText("Vendedor", {exact: true}).waitFor();
  await seller.getByRole("heading", {name: "Vehículos publicados"}).waitFor();
  assert.equal(new URL(seller.url()).pathname, "/");
  assert.equal(await seller.evaluate(() => document.documentElement.scrollWidth), 1920);
  assert.equal(await button(seller, "Mis conversaciones").count(), 0);
  await link(seller, "Mi panel").click();
  await seller.getByRole("heading", {name: "Gestioná tus vehículos"}).waitFor();
  await seller.goto(url + "/cuenta");
  await seller.getByText("Vendedora Carla", {exact: true}).waitFor();
  assert.equal(await seller.getByRole("button", {name: "Iniciar sesión"}).count(), 0);
  await seller.getByRole("link", {name: "Volver al catálogo"}).click();
  await link(seller, "Mis conversaciones").click();
  await seller.waitForURL("**/vendedor#conversaciones");
  await seller.getByRole("option").filter({hasText: "Toyota Corolla"}).waitFor();
  await seller.reload();
  await seller.getByRole("option").filter({hasText: "Toyota Corolla"}).waitFor();
  await seller.getByRole("link", {name: "Explorar catálogo"}).click();
  await seller.waitForURL(url + "/");
  await seller.goBack();
  await seller.getByRole("option").filter({hasText: "Toyota Corolla"}).waitFor();

  const publicTab = await sellerContext.newPage();
  await publicTab.route("**/api/cuenta", route => route.fulfill({status: 503, json: {ok: false}}), {times: 1});
  await publicTab.goto(url);
  await publicTab.getByText(/No pudimos comprobar tu sesión/).waitFor();
  await publicTab.getByRole("heading", {name: "Vehículos publicados"}).waitFor();
  assert.equal(new URL(publicTab.url()).pathname, "/");
  await button(publicTab, "Reintentar sesión").click();
  await header(publicTab).getByText("Vendedor", {exact: true}).waitFor();
  await sellerContext.addCookies([{name: "cuenta_sid", value: "fixture-sesion-vencida", url, httpOnly: true}]);
  await publicTab.reload();
  await link(publicTab, "Iniciar sesión").waitFor();
  await publicTab.getByRole("heading", {name: "Vehículos publicados"}).waitFor();
  assert.equal(await button(publicTab, "Reintentar sesión").count(), 0);
  assert.equal((await publicTab.request.get(url + "/api/vendedor/vehiculos")).status(), 401);
  await publicTab.goto(url + "/cuenta");
  await login(publicTab, "seller_a");
  await publicTab.waitForURL("**/vendedor");
  await publicTab.getByRole("button", {name: "Cerrar sesión"}).click();
  await publicTab.waitForURL("**/cuenta");
  assert.equal((await publicTab.request.get(url + "/vendedor")).status(), 401);
  assert.deepEqual(errors, []);
  console.log("V7.20.4: transición al catálogo, identidad, cuenta, historial, conversaciones, errores de acceso y regresiones de sesión a 1920 × 1080.");
} finally {
  await browser?.close();
  server.stdin.end("stop\n");
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    const timer = setTimeout(() => { server.kill(); resolve(); }, 10000);
    server.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
