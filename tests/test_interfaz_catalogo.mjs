import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");
const plantillaHtml = await readFile(new URL("../templates/index.html", import.meta.url), "utf8");
const estilos = await readFile(new URL("../static/css/estilos.css", import.meta.url), "utf8");

test("las tarjetas públicas muestran solo el resumen y enlazan a la ficha completa", () => {
  const plantilla = plantillaHtml.match(/<template id="plantilla-vehiculo">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(plantilla, "Debe existir la plantilla de tarjetas del catálogo.");
  for (const selector of [
    "vehicle-image", "vehicle-badge", "vehicle-location", "vehicle-year",
    "vehicle-description", "vehicle-mileage", "vehicle-price", "detail-link",
  ]) {
    assert.ok(plantilla.includes(selector), `La tarjeta debe incluir ${selector}.`);
  }
  assert.doesNotMatch(plantilla, /vehicle-extra|vehicle-code|Color:|Transmisión:|Combustible:/);
  assert.ok(source.includes("enlaceFicha.href = `/vehiculo/${encodeURIComponent(vehiculo.id)}?retorno=${encodeURIComponent(retorno)}`"));
  assert.match(source, /enlaceFicha\.setAttribute\("aria-label", `Ver ficha completa de \$\{nombre\}`\)/);
  assert.doesNotMatch(source, /const extras = \[\]/);
  assert.match(estilos, /\.vehicle-description\s*\{[^}]*-webkit-line-clamp:\s*1;/s);
});

test("la ficha individual conserva descripción y detalles del vehículo", () => {
  const renderizadoFicha = source.match(/function renderizarFicha\(vehiculo\)\s*\{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(renderizadoFicha, "Debe existir el renderizado de ficha individual.");
  for (const campo of [
    "vehiculo.descripcion", "vehiculo.tipo_vehiculo", "vehiculo.color",
    "vehiculo.transmision", "vehiculo.combustible", "aire_acondicionado",
    "ventanas_electricas", "pantalla_multimedia",
  ]) {
    assert.ok(renderizadoFicha.includes(campo), `La ficha debe presentar ${campo}.`);
  }
  assert.match(plantillaHtml, /id="ficha-caracteristicas"/);
});

test("las tarjetas conservan las acciones administrativas sin mostrarlas al público", () => {
  const plantilla = plantillaHtml.match(/<template id="plantilla-vehiculo">([\s\S]*?)<\/template>/)?.[1];
  assert.match(plantilla, /class="vehicle-actions" hidden/);
  for (const control of ["edit-button", "photos-button", "availability-button"]) {
    assert.ok(plantilla.includes(control), `Debe conservarse la acción ${control}.`);
  }
  assert.match(source, /acciones\.hidden = !autenticado/);
  assert.match(estilos, /\.vehicle-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
});

test("la plantilla mantiene los controles de filtros y formulario accesibles", () => {
  const detalles = plantillaHtml.match(/<details\b(?=[^>]*\bid="filtros-avanzados")[^>]*>([\s\S]*?)<\/details>/)?.[1];
  assert.ok(detalles, "Los filtros avanzados deben estar dentro del details real de la plantilla.");
  const summary = detalles.match(/<summary\b([^>]*)>/)?.[1];
  assert.ok(summary, "El control debe usar un summary nativo.");
  const controles = summary.match(/\baria-controls="([^"]+)"/)?.[1];
  assert.ok(controles, "El summary debe relacionarse con su contenedor usando aria-controls.");
  assert.match(detalles, new RegExp(`<div\\b[^>]*\\bid="${controles}"`), "aria-controls debe apuntar al contenedor existente.");
  for (const nombre of ["precio_min", "precio_max", "anio_min", "anio_max", "tipo_vehiculo", "orden"]) {
    assert.match(detalles, new RegExp(`\\bname="${nombre}"`), `${nombre} debe permanecer dentro de filtros avanzados.`);
  }

  assert.match(plantillaHtml, /id="filtros-avanzados-activos"[^>]*role="status"|role="status"[^>]*id="filtros-avanzados-activos"/);
  const fieldsets = [...plantillaHtml.matchAll(/<fieldset\b([^>]*)>/g)]
    .filter(([, atributos]) => /\bclass="[^"]*\bformulario-seccion\b[^"]*"/.test(atributos));
  assert.equal(fieldsets.length, 4, "El formulario administrativo debe tener cuatro grupos semánticos.");

  const textarea = plantillaHtml.match(/<textarea\b(?=[^>]*\bid="descripcion")[^>]*>/)?.[0];
  assert.ok(textarea, "Debe existir el textarea real de descripción.");
  assert.match(textarea, /\bmaxlength="1000"/);
  const referencias = textarea.match(/\baria-describedby="([^"]+)"/)?.[1].split(/\s+/) || [];
  assert.ok(referencias.includes("contador-descripcion"), "El contador debe estar asociado con aria-describedby.");
});

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
  getAttribute(nombre) { return this.attributes[nombre] ?? null; }
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
    "filtros-avanzados", "filtros-avanzados-activos", "descripcion", "contador-descripcion",
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
  elementos.get("descripcion").attributes.maxlength = "1000";
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
    detallesFiltros: elementos.get("filtros-avanzados"),
    indicadorFiltrosAvanzados: elementos.get("filtros-avanzados-activos"),
    descripcion: elementos.get("descripcion"),
    contadorDescripcion: elementos.get("contador-descripcion"),
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

test("una URL compartida inicia con los filtros avanzados expandidos y señalados", async () => {
  const app = prepararAplicacion("?q=Toyota&precio_min=12000&anio_max=2022&orden=precio_desc");
  await app.esperarCarga();

  assert.ok(app.rutas.includes("/api/vehiculos?q=Toyota&precio_min=12000&anio_max=2022&orden=precio_desc"), app.rutas.join(", "));
  assert.equal(app.catalogo.elements.find((campo) => campo.name === "precio_min").value, "12000");
  assert.equal(app.catalogo.elements.find((campo) => campo.name === "anio_max").value, "2022");
  assert.equal(app.detallesFiltros.open, true);
  assert.equal(app.indicadorFiltrosAvanzados.hidden, false);
  assert.equal(app.indicadorFiltrosAvanzados.textContent, "3 filtros avanzados aplicados");
});

test("contraer filtros avanzados conserva valores y el submit incluye todos los parámetros", async () => {
  const app = prepararAplicacion("?q=Toyota&precio_min=12000&tipo_vehiculo=SUV&orden=precio_desc");
  await app.esperarCarga();
  app.detallesFiltros.open = false;
  app.catalogo.elements.find((campo) => campo.name === "q").value = "Toyota RAV4";

  app.catalogo.listeners.get("submit")[0]({ preventDefault() {} });
  await app.esperarCarga();

  const ruta = app.rutas.filter((item) => item.startsWith("/api/vehiculos?")).at(-1);
  const parametros = new URLSearchParams(ruta.split("?")[1]);
  assert.equal(parametros.get("q"), "Toyota RAV4");
  assert.equal(parametros.get("precio_min"), "12000");
  assert.equal(parametros.get("tipo_vehiculo"), "SUV");
  assert.equal(parametros.get("orden"), "precio_desc");
  assert.equal(app.catalogo.elements.find((campo) => campo.name === "precio_min").value, "12000");
  assert.equal(app.detallesFiltros.open, false);
  assert.equal(app.indicadorFiltrosAvanzados.hidden, false);
});

test("el contador de descripción se actualiza conforme se escribe", () => {
  const app = prepararAplicacion();
  app.descripcion.value = "Vehículo en buen estado";
  app.descripcion.listeners.get("input")[0]();

  assert.equal(app.contadorDescripcion.textContent, "23 de 1000 caracteres");
});

test("el catálogo en solo lectura mantiene oculto el acceso administrativo", async () => {
  const app = prepararAplicacion("", true);
  await app.esperarCarga();

  assert.equal(app.abrirLogin.hidden, true);
  assert.equal(app.rutas.includes("/api/admin/login"), false);
});
