import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");

class ElementoFalso {
  constructor(id = "") {
    this.id = id;
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  addEventListener(nombre, listener) {
    const listeners = this.listeners.get(nombre) || [];
    listeners.push(listener);
    this.listeners.set(nombre, listeners);
  }

  querySelectorAll() { return []; }
  setAttribute(nombre, valor) { this.attributes[nombre] = valor; }
  replaceChildren() {}
  append() {}
  focus() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
}

class FormDataFalso {
  constructor(formulario) {
    this.pares = formulario.elements
      .filter((campo) => campo.name && !campo.disabled)
      .map((campo) => [campo.name, campo.value]);
  }

  entries() { return this.pares[Symbol.iterator](); }
  values() { return this.pares.map((par) => par[1])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
}

function prepararAplicacion(busquedaInicial = "", soloLectura = false) {
  const nombres = [
    "formulario-vehiculo", "formulario-dialogo", "login-dialogo", "login-form",
    "fotografias-dialogo", "filtros-catalogo", "mensaje", "abrir-login",
    "cerrar-sesion", "nuevo-vehiculo", "nuevo-desde-vacio", "reintentar",
    "guardar-vehiculo", "cerrar-formulario", "inventario", "cargando",
    "estado-bloqueado", "estado-vacio", "estado-sin-resultados", "lista-vehiculos",
    "resumen-listado", "total-vehiculos", "total-disponibles", "total-vendidos",
    "cerrar-login", "confirmar-foto", "fotografia-archivo", "fotografia-sustituta",
    "actualizar-fotografias", "eliminar-foto", "cancelar-borrado-foto",
    "cerrar-fotografias", "terminar-fotografias", "cancelar-foto-preparada",
    "limpiar-desde-vacio", "cancelar-formulario", "cancelar-login",
  ];
  const elementos = new Map(nombres.map((nombre) => [nombre, new ElementoFalso(nombre)]));
  const catalogo = elementos.get("filtros-catalogo");
  catalogo.elements = [
    { name: "q", value: "", disabled: false },
    { name: "disponibilidad", value: "", disabled: false },
    { name: "precio_min", value: "", disabled: false },
    { name: "precio_max", value: "", disabled: false },
    { name: "anio_min", value: "", disabled: false },
    { name: "anio_max", value: "", disabled: false },
    { name: "tipo_vehiculo", value: "", disabled: false },
    { name: "orden", value: "", disabled: false },
  ];
  catalogo.querySelectorAll = () => catalogo.elements;
  const formulario = elementos.get("formulario-vehiculo");
  formulario.elements = { namedItem: () => null };
  const formularioLogin = elementos.get("login-form");
  formularioLogin.elements = { password: { value: "" } };

  const rutas = [];
  const urlActual = new URL(`https://catalogo.example/${busquedaInicial}`);
  const location = {
    origin: urlActual.origin,
    pathname: urlActual.pathname,
    search: urlActual.search,
  };
  const document = {
    body: { dataset: { vehiculoId: "" }, classList: { add() {}, remove() {} } },
    title: "Vehículos usados",
    getElementById: (id) => elementos.get(id) || new ElementoFalso(id),
    querySelector: (selector) => selector === 'meta[name="csrf-token"]'
      ? { content: "token-local" }
      : new ElementoFalso(selector),
    querySelectorAll: () => [],
    createDocumentFragment: () => new ElementoFalso("fragmento"),
  };
  const contexto = {
    AbortController,
    FormData: FormDataFalso,
    URL,
    URLSearchParams,
    Intl,
    document,
    location,
    history: {
      pushState(_estado, _titulo, ruta) {
        const nueva = new URL(ruta, location.origin);
        location.pathname = nueva.pathname;
        location.search = nueva.search;
      },
    },
    window: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    fetch: async (ruta) => {
      rutas.push(String(ruta));
      const resultado = ruta === "/api/admin/session"
        ? { ok: true, solo_lectura: soloLectura, autenticado: false }
        : { ok: true, vehiculos: [] };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => resultado,
      };
    },
  };
  vm.runInNewContext(source, contexto, { filename: "interfaz.js" });

  return {
    rutas,
    catalogo,
    abrirLogin: elementos.get("abrir-login"),
    async esperarCarga() { await new Promise((resolver) => setTimeout(resolver, 0)); },
  };
}

test("el submit conserva los filtros al deshabilitar los controles", async () => {
  const app = prepararAplicacion();
  await app.esperarCarga();
  app.catalogo.elements[0].value = "Toyota";

  const submit = app.catalogo.listeners.get("submit")[0];
  let prevenido = false;
  submit({ preventDefault() { prevenido = true; } });
  await app.esperarCarga();

  assert.equal(prevenido, true);
  assert.ok(app.rutas.includes("/api/vehiculos?q=Toyota"), app.rutas.join(", "));
});

test("una URL compartida inicia el catálogo con sus filtros aunque estén deshabilitados", async () => {
  const app = prepararAplicacion("?q=Toyota");
  await app.esperarCarga();

  assert.ok(app.rutas.includes("/api/vehiculos?q=Toyota"), app.rutas.join(", "));
});

test("el catálogo en solo lectura mantiene oculto el acceso administrativo", async () => {
  const app = prepararAplicacion("", true);
  await app.esperarCarga();

  assert.equal(app.abrirLogin.hidden, true);
  assert.equal(app.rutas.includes("/api/admin/login"), false);
});
