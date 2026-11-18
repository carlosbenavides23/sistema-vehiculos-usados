import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {setImmediate} from "node:timers/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";

const script = await readFile(new URL("../static/js/navegacion-cuenta.js", import.meta.url), "utf8");
const hash = value => createHash("sha256").update(value).digest();
const owner = {id: "seller-a", rol: "vendedor"};
const other = {id: "seller-b", rol: "vendedor"};

function openPage(markers, initial) {
  const document = new EventTarget();
  const window = new EventTarget();
  const links = markers.map(ownerNavigation => ({hidden: true, dataset: {ownerNavigation}}));
  const elements = new Map();
  let user = initial;
  document.body = {dataset: {}};
  document.querySelectorAll = () => links;
  document.getElementById = id => {
    if (!elements.has(id)) {
      const element = new EventTarget();
      element.setAttribute = (name, value) => { element[name] = value; };
      element.removeAttribute = name => { delete element[name]; };
      elements.set(id, element);
    }
    return elements.get(id);
  };
  window.CuentaSesion = {async read() {
    if (!user) throw {status: 401};
    return user;
  }};
  runInNewContext(script, {window, document, TextEncoder, crypto: {subtle: {async digest(_, bytes) {
    return hash(bytes);
  }}}});
  return {links, elements, async change(next) {
    user = next;
    document.dispatchEvent(new Event("cuenta-sesion-cambio"));
    assert.ok(links.every(link => link.hidden));
    assert.equal(elements.get("header-login").hidden, true, "no se muestra una sesión de visitante mientras se comprueba");
    await setImmediate();
  }};
}

test("el contexto emitido por Flask sobrevive al cierre y solo reaparece para el mismo vendedor", async () => {
  const marker = hash(owner.id).toString("hex");
  const page = openPage([marker], other);
  await setImmediate();
  assert.equal(page.links[0].hidden, true, "la primera sesión leída tampoco puede apropiarse del contexto");
  await page.change(owner);
  assert.equal(page.links[0].hidden, false);
  for (const user of [null, other, {...owner, rol: "comprador"}]) {
    await page.change(user);
    assert.equal(page.links[0].hidden, true);
  }
  await page.change(owner);
  assert.equal(page.links[0].hidden, false);

  const publicPage = openPage([], null);
  await publicPage.change(owner);
  assert.equal(publicPage.links.length, 0);
});

test("solo el comprador tiene el enlace a Mi cuenta en su nombre visible", async () => {
  const page = openPage([], null);
  await setImmediate();
  const link = page.elements.get("header-display-name");
  assert.equal(page.elements.get("header-login").hidden, false);
  assert.equal(link.href, undefined);
  await page.change({id: "buyer", rol: "comprador", nombre_visible: "Ana"});
  assert.equal(link.href, "/cuenta");
  assert.equal(link.textContent, "Ana");
  await page.change(owner);
  assert.equal(link.href, undefined);
});
