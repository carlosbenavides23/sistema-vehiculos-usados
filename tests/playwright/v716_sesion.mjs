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
  await buyer.getByRole("heading", {name: "Toyota Corolla", exact: true}).waitFor();
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
  await second.getByText("Consulta ficticia", {exact: true}).first().waitFor();
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
  await seller.goto(url + "/cuenta?next=" + encodeURIComponent("https://otro.example/vendedor"));
  await login(seller, "seller_a");
  await seller.waitForURL("**/vendedor");
  await seller.getByRole("heading", {name: "Gestioná tus vehículos"}).waitFor();
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
  assert.deepEqual(errors, []);
  console.log("V7.16: visitante, comprador, vendedor, retorno seguro, caducidad, reintento, cierre confirmado y dos pestañas a 1920 × 1080.");
} finally {
  await browser?.close();
  server.stdin.end("stop\n");
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    const timer = setTimeout(() => { server.kill(); resolve(); }, 10000);
    server.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
