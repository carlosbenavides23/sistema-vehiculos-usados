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

async function iniciar({
  ficha = false,
  demoraLista = false,
  demoraEnvio = false,
  errorLista = null,
  errorEnvio = null,
  errorPrimerEnvio = null,
  conversacionesIniciales = null,
  conversacionCreada = null,
  storageInicial = null,
  vehiculoStatus = 200,
} = {}) {
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
  for (const id of ["abrir-chat-comprador-global", "mostrar-chat", "cerrar-chat-comprador", "chat-comprador-volver", "chat-comprador-texto", "chat-comprador-enviar"]) {
    if (elementos.has(id)) elementos.get(id).tagName = "button";
  }
  elementos.get("chat-comprador-hilo").hidden = true;
  elementos.get("chat-comprador-lista-vista").hidden = true;
  elementos.get("chat-comprador-form").hidden = true;
  if (ficha) {
    elementos.get("mostrar-chat").hidden = false;
    elementos.get("ficha-titulo").textContent = "Toyota Corolla";
  }
  const conversaciones = conversacionesIniciales || [{ id: "22", vehiculo_id: 2, marca: "Toyota", modelo: "Corolla", estado: "abierta", ultimo_mensaje: "Hola" }];
  const requests = [];
  let envios = 0;
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
    let status = 200;
    if (path === "/api/vehiculos/2") {
      status = vehiculoStatus;
      data = status === 200 ? { ok: true, vehiculo: { id: 2 } } : { ok: false, mensaje: "No existe" };
    } else if (path === "/api/chat/conversaciones") {
      if (errorLista) { status = errorLista.status; data = { ok: false, mensaje: errorLista.mensaje }; }
      else data = { ok: true, conversaciones, csrf_token: "buyer-csrf" };
    } else if (path === "/api/chat/sesion") data = { ok: true, csrf_token: "buyer-csrf" };
    else if (path.includes("/mensajes") && options.method === "POST") {
      envios += 1;
      const fallo = envios === 1 ? errorPrimerEnvio || errorEnvio : errorEnvio;
      if (fallo) {
        status = fallo.status;
        data = { ok: false, mensaje: fallo.mensaje || "Respuesta de prueba" };
      } else {
        const nueva = conversacionCreada || conversaciones[0] || { id: 44, vehiculo_id: 2, marca: "Toyota", modelo: "Corolla", estado: "abierta", ultimo_mensaje: "Consulta inicial" };
        if (!conversaciones.some((item) => String(item.id) === String(nueva.id))) conversaciones.push(nueva);
        data = { ok: true, conversacion: nueva, mensaje: { id: 30 + envios, contenido: options.body ? JSON.parse(options.body).contenido : "Prueba", remitente: "comprador" } };
      }
    } else if (path.includes("/mensajes")) data = { ok: true, mensajes: [] };
    return { ok: status >= 200 && status < 300, status, async json() { return data; } };
  };
  const timers = new Map();
  const storage = storageInicial || new Map();
  let nextTimer = 0;
  const location = { pathname: ficha ? "/vehiculo/2" : "/", search: ficha ? "" : "?q=Toyota", destino: "", assign(url) { this.destino = url; } };
  const context = {
    document: documento,
    window: { matchMedia: () => ({ matches: false }) },
    fetch,
    location,
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); } },
    crypto: { randomUUID },
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
  return { elementos, documento, cuerpo, requests, timers, storage, location, terminarCargaLista: () => liberarLista?.(), terminarEnvio: () => liberarEnvio?.() };
}

test("el hilo recuperado abre su ficha por ID y conserva el borrador y la búsqueda", async () => {
  const app = await iniciar();
  const e = app.elementos;
  await e.get("abrir-chat-comprador-global").click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  e.get("chat-comprador-texto").value = "Consulta pendiente";
  await e.get("chat-comprador-texto").fire("input");
  const enlace = e.get("chat-comprador-ver-ficha");
  assert.equal(enlace.hidden, false);
  await enlace.fire("click", { currentTarget: enlace });
  assert.equal(app.location.destino, "/vehiculo/2?retorno=%2F%3Fq%3DToyota");
  assert.equal(JSON.parse(app.storage.get("vehiculos-chat-borradores-v1"))[0][1].texto, "Consulta pendiente");
});

test("el vehículo ausente conserva el hilo y el texto, sin navegar", async () => {
  const app = await iniciar({ vehiculoStatus: 404 });
  const e = app.elementos;
  await e.get("abrir-chat-comprador-global").click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  e.get("chat-comprador-texto").value = "Borrador";
  const enlace = e.get("chat-comprador-ver-ficha");
  await enlace.fire("click", { currentTarget: enlace });
  assert.equal(app.location.destino, "");
  assert.equal(e.get("chat-comprador-dialogo").open, true);
  assert.equal(e.get("chat-comprador-texto").value, "Borrador");
  assert.match(e.get("chat-comprador-feedback").textContent, /ya no está disponible/);
});

test("una conversación sin identificador no ofrece un destino inválido", async () => {
  const app = await iniciar({ conversacionesIniciales: [{ id: "22", vehiculo_id: null, marca: "Toyota", modelo: "Corolla" }] });
  const e = app.elementos;
  await e.get("abrir-chat-comprador-global").click();
  await e.get("chat-comprador-lista").querySelector("button").click();
  assert.equal(e.get("chat-comprador-ver-ficha").hidden, true);
  assert.equal(e.get("chat-comprador-ficha-no-disponible").hidden, false);
});

test("una conversación nueva permite cerrar el panel para volver a la ficha", async () => {
  const app = await iniciar({ ficha: true, conversacionesIniciales: [] });
  const e = app.elementos;
  await e.get("mostrar-chat").click();
  e.get("chat-comprador-texto").value = "Consulta nueva";
  const enlace = e.get("chat-comprador-ver-ficha");
  assert.equal(enlace.hidden, false);
  await enlace.fire("click", { currentTarget: enlace });
  assert.equal(e.get("chat-comprador-dialogo").open, false);
  assert.equal(app.cuerpo.classList.contains("dialog-open"), false);
  assert.equal(JSON.parse(app.storage.get("vehiculos-chat-borradores-v1"))[0][1].texto, "Consulta nueva");
});

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
  const conversacion = e.get("chat-comprador-lista").querySelector("button");
  await conversacion.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(e.get("chat-comprador-hilo").hidden, false);
  assert.equal(e.get("chat-comprador-vehiculo").textContent, "Toyota Corolla");
  assert.equal(e.get("chat-comprador-estado").textContent, "Pendiente de respuesta");
  assert.equal(conversacion.getAttribute("aria-current"), "true");
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

  const paginaSiguiente = await iniciar({ storageInicial: app.storage });
  await paginaSiguiente.elementos.get("abrir-chat-comprador-global").click();
  await paginaSiguiente.elementos.get("chat-comprador-lista").querySelector("button").click();
  assert.equal(paginaSiguiente.elementos.get("chat-comprador-vehiculo").textContent, "Toyota Corolla");
  assert.equal(paginaSiguiente.elementos.get("chat-comprador-texto").value, "Borrador conservado");
});

test("Contactar al vendedor sigue abriendo el hilo desde la ficha y crea la sesión al iniciar contacto", async () => {
  const ficha = await iniciar({ ficha: true });
  await ficha.elementos.get("mostrar-chat").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ficha.elementos.get("chat-comprador-dialogo").open, true);
  assert.equal(ficha.elementos.get("chat-comprador-hilo").hidden, false);
  assert.ok(ficha.requests.some(({ path }) => path === "/api/chat/sesion"));
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

test("un listado 401 muestra el estado vacío sin crear sesión y un envío 401 conserva borrador y libera el diálogo", async () => {
  const lista = await iniciar({ errorLista: { status: 401, mensaje: "Sesión no disponible" } });
  await lista.elementos.get("abrir-chat-comprador-global").click();
  assert.equal(lista.elementos.get("chat-comprador-lista-estado").textContent, "Todavía no tienes conversaciones. Explora el catálogo y contacta al vendedor desde la ficha de un vehículo");
  assert.equal(lista.elementos.get("chat-comprador-dialogo").open, true);
  assert.equal(lista.requests.some(({ path }) => path === "/api/chat/sesion"), false);
  assert.equal(lista.elementos.get("chat-comprador-form").hidden, true);

  const ficha = await iniciar({ ficha: true, errorEnvio: { status: 401, mensaje: "Sesión vencida" } });
  const contacto = ficha.elementos.get("mostrar-chat");
  await contacto.click();
  ficha.elementos.get("chat-comprador-texto").value = "Conservar esta consulta";
  await ficha.elementos.get("chat-comprador-texto").fire("input");
  await ficha.elementos.get("chat-comprador-form").submit();

  assert.equal(ficha.elementos.get("chat-comprador-dialogo").open, false);
  assert.equal(ficha.cuerpo.classList.contains("dialog-open"), false);
  assert.equal(ficha.timers.size, 0);
  assert.equal(ficha.documento.activeElement, contacto);
  assert.equal(contacto.textContent, "Reiniciar contacto");
  assert.equal(ficha.elementos.get("chat-comprador-texto").value, "Conservar esta consulta");
  const borradores = JSON.parse(ficha.storage.get("vehiculos-chat-borradores-v1"));
  assert.equal(borradores[0][1].texto, "Conservar esta consulta");
  assert.ok(borradores[0][1].solicitud.clave);
});

test("el primer mensaje adopta el hilo creado por el servidor y actualiza el listado", async () => {
  const creada = { id: "44", vehiculo_id: 2, marca: "Toyota", modelo: "Corolla", estado: "abierta", ultimo_mensaje: "Consulta inicial" };
  const app = await iniciar({ ficha: true, conversacionesIniciales: [], conversacionCreada: creada });
  const e = app.elementos;
  await e.get("mostrar-chat").click();
  assert.equal(e.get("chat-comprador-form").hidden, false);
  e.get("chat-comprador-texto").value = "¿Sigue disponible?";
  await e.get("chat-comprador-texto").fire("input");
  await e.get("chat-comprador-form").submit();

  assert.equal(e.get("chat-comprador-vehiculo").textContent, "Toyota Corolla");
  assert.equal(e.get("chat-comprador-estado").textContent, "Pendiente de respuesta");
  assert.equal(e.get("chat-comprador-mensajes").children.length, 1);
  const item = e.get("chat-comprador-lista").querySelector('[data-conversation-id="44"]');
  assert.ok(item, "El listado debe incorporar la conversación recién creada.");
  assert.equal(item.children[1].textContent, "Pendiente · Consulta inicial");
  assert.ok(app.requests.some(({ path, options }) => path === "/api/chat/vehiculos/2/mensajes" && options.method === "POST"));
});

test("un reintento tras un error transitorio reutiliza la clave idempotente y envía el borrador una vez", async () => {
  const creada = { id: "45", vehiculo_id: 2, marca: "Toyota", modelo: "Corolla", estado: "abierta", ultimo_mensaje: "Consulta" };
  const app = await iniciar({
    ficha: true,
    conversacionesIniciales: [],
    conversacionCreada: creada,
    errorPrimerEnvio: { status: 503, mensaje: "Servicio temporalmente no disponible" },
  });
  const e = app.elementos;
  await e.get("mostrar-chat").click();
  e.get("chat-comprador-texto").value = "Consulta idempotente";
  await e.get("chat-comprador-texto").fire("input");
  await e.get("chat-comprador-form").submit();
  assert.equal(e.get("chat-comprador-texto").value, "Consulta idempotente");

  await e.get("chat-comprador-form").submit();
  const envios = app.requests.filter(({ path, options }) => path === "/api/chat/vehiculos/2/mensajes" && options.method === "POST");
  assert.equal(envios.length, 2);
  assert.ok(envios[0].options.headers["Idempotency-Key"]);
  assert.equal(envios[0].options.headers["Idempotency-Key"], envios[1].options.headers["Idempotency-Key"]);
  assert.equal(e.get("chat-comprador-texto").value, "");
  assert.equal(e.get("chat-comprador-mensajes").children.length, 1);
});
