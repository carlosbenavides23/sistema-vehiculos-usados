import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../static/js/chat.js", import.meta.url), "utf8");

class Element {
  constructor(id = "") {
    this.id = id;
    this.listeners = new Map();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.open = false;
    this.isConnected = true;
    this.disabled = false;
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
  }
  addEventListener(type, listener) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(listener);
    this.listeners.set(type, callbacks);
  }
  async fire(type, event = {}) {
    const callbacks = this.listeners.get(type) || [];
    const dispatched = { preventDefault() {}, ...event };
    for (const callback of callbacks) await callback(dispatched);
    return dispatched;
  }
  async click() { await this.fire("click"); }
  async submit() { await this.fire("submit", { preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; void this.fire("close"); } }
  append(...items) { this.children.push(...items); for (const item of items) item.parentElement = this; }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll(selector) {
    if (selector === "button") return this.children.flatMap((child) => child.tagName === "button" ? [child] : child.querySelectorAll("button"));
    if (selector === "button[data-conversation-id]") return this.querySelectorAll("button").filter((item) => item.dataset.conversationId);
    return [];
  }
  querySelector(selector) {
    if (selector === "button") return this.querySelectorAll("button")[0] || null;
    if (selector === "strong" || selector === "span") return this.children.find((child) => child.tagName === selector) || null;
    if (selector.startsWith("[data-conversation-id=\"")) {
      const id = selector.match(/"([^"]+)"/)?.[1];
      return this.querySelectorAll("button").find((item) => item.dataset.conversationId === id) || null;
    }
    return null;
  }
  appendChild(item) { this.append(item); return item; }
  insertBefore(item, before) {
    const old = this.children.indexOf(item);
    if (old >= 0) this.children.splice(old, 1);
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(item); else this.children.splice(index, 0, item);
    item.parentElement = this;
  }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.isConnected = false; }
}

async function iniciar({ ficha = false, admin = false, demoraLista = false, demoraEnvio = false } = {}) {
  const ids = new Set([...source.matchAll(/porId\("([^"]+)"\)/g)].map((match) => match[1]));
  const elementos = new Map([...ids].map((id) => [id, new Element(id)]));
  const cuerpo = new Element("body");
  cuerpo.dataset = { chatEnabled: "true", ...(ficha ? { vehiculoId: "2" } : {}) };
  cuerpo.classList = {
    values: new Set(),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    toggle(value, force) { if (force) this.values.add(value); else this.values.delete(value); },
    contains(value) { return this.values.has(value); },
  };
  const documento = {
    body: cuerpo,
    hidden: false,
    activeElement: null,
    listeners: new Map(),
    getElementById(id) { return id === "body" ? cuerpo : elementos.get(id) || null; },
    querySelector() { return { content: "test-csrf" }; },
    createElement(tag) { const element = new Element(); element.tagName = tag; element.ownerDocument = documento; return element; },
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); },
  };
  for (const element of elementos.values()) { element.ownerDocument = documento; element.tagName = element.id.includes("form") ? "form" : "button"; }
  for (const id of ["abrir-chat-comprador-global", "mostrar-chat", "abrir-mensajes", "cerrar-chat-comprador", "chat-comprador-volver", "chat-comprador-texto", "chat-comprador-enviar", "chat-admin-filtro"]) {
    if (elementos.has(id)) elementos.get(id).tagName = "button";
  }
  elementos.get("chat-admin-filtro").value = "todas";
  elementos.get("chat-comprador-hilo").hidden = true;
  elementos.get("chat-comprador-lista-vista").hidden = true;
  elementos.get("chat-comprador-form").hidden = true;
  elementos.get("chat-admin-cargar-mas").hidden = true;
  if (ficha) {
    elementos.get("mostrar-chat").hidden = false;
    elementos.get("ficha-titulo").textContent = "Toyota Corolla";
  }
  const conversaciones = [{ id: 22, vehiculo_id: 2, marca: "Toyota", modelo: "Corolla", estado: "abierta", ultimo_mensaje: "Hola" }];
  const requests = [];
  let liberarLista;
  let liberarEnvio;
  const fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (demoraLista && path === "/api/chat/conversaciones") {
      await new Promise((resolve) => { liberarLista = resolve; });
    }
    if (demoraEnvio && path.endsWith("/mensajes") && options.method === "POST") {
      await new Promise((resolve) => { liberarEnvio = resolve; });
    }
    let data = {};
    if (path === "/api/admin/session") data = { ok: true, autenticado: admin, solo_lectura: false };
    else if (path === "/api/chat/conversaciones") data = { ok: true, conversaciones, csrf_token: "buyer-csrf" };
    else if (path === "/api/chat/sesion") data = { ok: true, csrf_token: "buyer-csrf" };
    else if (path.startsWith("/api/admin/chat/conversaciones")) data = { ok: true, conversaciones, hay_mas: false };
    else if (path.includes("/mensajes") && options.method === "POST") data = { ok: true, conversacion: conversaciones[0], mensaje: { id: 30, contenido: "Prueba", remitente: "comprador" } };
    else if (path.includes("/mensajes")) data = { ok: true, mensajes: [] };
    return { ok: true, status: 200, async json() { return data; } };
  };
  const timers = new Map();
  const storage = new Map();
  let nextTimer = 0;
  const context = {
    document: documento,
    window: { matchMedia: () => ({ matches: false }) },
    fetch,
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); } },
    crypto: { randomUUID },
    MutationObserver: class { observe() {} },
    setTimeout(callback) { const timer = ++nextTimer; timers.set(timer, callback); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    queueMicrotask,
    CSS: { escape: (value) => value },
    URLSearchParams,
    Intl,
    Date,
    Map,
    Set,
    JSON,
    Error,
    Boolean,
    String,
    Array,
    Number,
    encodeURIComponent,
    console,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "chat.js" });
  await new Promise((resolve) => setImmediate(resolve));
  return { elementos, documento, cuerpo, requests, timers, storage, terminarCargaLista: () => liberarLista?.(), terminarEnvio: () => liberarEnvio?.() };
}

test("desde catálogo abre, vuelve y cierra X/Escape liberando scroll, polling y foco sin duplicar eventos", async () => {
  const app = await iniciar();
  const { elementos: e, cuerpo, documento, timers } = app;
  const boton = e.get("abrir-chat-comprador-global");
  assert.equal(boton.listeners.get("click").length, 1);
  assert.equal(e.get("cerrar-chat-comprador").listeners.get("click").length, 1);
  assert.equal(e.get("chat-comprador-volver").listeners.get("click").length, 1);
  assert.equal(e.get("chat-comprador-form").listeners.get("submit").length, 1);
  assert.equal(e.get("chat-comprador-dialogo").listeners.get("cancel").length, 1);
  assert.equal(e.get("chat-comprador-dialogo").listeners.get("close").length, 1);

  await boton.click();
  assert.equal(e.get("chat-comprador-dialogo").open, true);
  assert.equal(cuerpo.classList.contains("dialog-open"), true);
  await e.get("chat-comprador-lista").querySelector("button").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(e.get("chat-comprador-hilo").hidden, false);
  assert.equal(timers.size, 1);
  await e.get("chat-comprador-volver").click();
  assert.equal(e.get("chat-comprador-lista-vista").hidden, false);

  await e.get("chat-comprador-volver").click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  e.get("chat-comprador-texto").value = "Consulta desde catálogo";
  await e.get("chat-comprador-form").submit();
  assert.ok(app.requests.some(({ path, options }) => path === "/api/chat/vehiculos/2/mensajes" && options.method === "POST"));
  e.get("chat-comprador-texto").value = "Borrador conservado";
  await e.get("chat-comprador-texto").fire("input");

  await e.get("cerrar-chat-comprador").click();
  assert.equal(e.get("chat-comprador-dialogo").open, false);
  assert.equal(cuerpo.classList.contains("dialog-open"), false);
  assert.equal(timers.size, 0);
  assert.equal(documento.activeElement, boton);
  await boton.click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  assert.equal(e.get("chat-comprador-texto").value, "Borrador conservado");
  await e.get("cerrar-chat-comprador").click();
  await boton.click();
  const cancel = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  const cancelEvent = await e.get("chat-comprador-dialogo").fire("cancel", cancel);
  assert.equal(cancelEvent.defaultPrevented, true);
  assert.equal(e.get("chat-comprador-dialogo").open, false);
  assert.equal(cuerpo.classList.contains("dialog-open"), false);
  assert.equal(documento.activeElement, boton);
});

test("Contactar al vendedor sigue abriendo el hilo desde ficha y la bandeja administrativa conserva su modal", async () => {
  const ficha = await iniciar({ ficha: true });
  await ficha.elementos.get("mostrar-chat").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ficha.elementos.get("chat-comprador-dialogo").open, true);
  assert.equal(ficha.elementos.get("chat-comprador-hilo").hidden, false);
  assert.ok(ficha.requests.some(({ path }) => path === "/api/chat/sesion"));

  const app = await iniciar({ admin: true });
  await app.elementos.get("abrir-mensajes").click();
  assert.equal(app.elementos.get("mensajes-dialogo").open, true);
  assert.equal(app.cuerpo.classList.contains("dialog-open"), true);
  await app.elementos.get("cerrar-mensajes").click();
  assert.equal(app.elementos.get("mensajes-dialogo").open, false);
  assert.equal(app.cuerpo.classList.contains("dialog-open"), false);
});

test("una respuesta de conversaciones que llega después de cerrar no altera el estado ni vuelve a abrir el diálogo", async () => {
  const app = await iniciar({ demoraLista: true });
  const apertura = app.elementos.get("abrir-chat-comprador-global").click();
  await new Promise((resolve) => setImmediate(resolve));
  await app.elementos.get("cerrar-chat-comprador").click();
  app.elementos.get("chat-comprador-lista-estado").textContent = "Cerrado mientras cargaba";
  app.terminarCargaLista();
  await apertura;
  assert.equal(app.elementos.get("chat-comprador-dialogo").open, false);
  assert.equal(app.cuerpo.classList.contains("dialog-open"), false);
  assert.equal(app.elementos.get("chat-comprador-lista-estado").textContent, "Cerrado mientras cargaba");
  assert.equal(app.timers.size, 0);
});

test("un envío aceptado después del cierre limpia el borrador ya enviado sin reabrir ni bloquear la página", async () => {
  const app = await iniciar({ demoraEnvio: true });
  const e = app.elementos;
  await e.get("abrir-chat-comprador-global").click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  e.get("chat-comprador-texto").value = "Mensaje enviado durante cierre";
  await e.get("chat-comprador-texto").fire("input");
  const envio = e.get("chat-comprador-form").submit();
  await new Promise((resolve) => setImmediate(resolve));
  await e.get("cerrar-chat-comprador").click();
  assert.equal(app.cuerpo.classList.contains("dialog-open"), false);
  app.terminarEnvio();
  await envio;
  const borradores = JSON.parse(app.storage.get("vehiculos-chat-borradores-v1"));
  assert.deepEqual(borradores, []);
  assert.equal(e.get("chat-comprador-dialogo").open, false);
  assert.equal(app.cuerpo.classList.contains("dialog-open"), false);
  assert.equal(app.timers.size, 0);
});
