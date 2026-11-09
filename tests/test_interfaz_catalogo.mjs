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

test("inicializa las galerías del catálogo cuando las tarjetas ya están conectadas al DOM", () => {
  const inicio = source.indexOf("  function renderizar() {");
  const fin = source.indexOf("\n  function copiarFiltrosDesdeUrl", inicio);
  const renderizar = source.slice(inicio, fin);
  assert.ok(inicio >= 0 && fin > inicio);
  const insercion = renderizar.indexOf("lista.append(fragmento)");
  const inicializacion = renderizar.indexOf("galeriasPendientes.forEach(");
  assert.ok(insercion >= 0 && inicializacion > insercion, "Las animaciones no deben empezar dentro del fragmento desconectado.");
  assert.match(renderizar, /galeriasPendientes\.push\(\[articulo, vehiculo\]\)/);
});

test("la ficha no muestra centavos .00 en precios enteros y conserva centavos reales", () => {
  const declaracion = source.match(/function precioLegible\(centavos\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(declaracion, "Debe existir el formateador del precio de la ficha.");
  const precioLegible = vm.runInNewContext(`(${declaracion})`, {
    dolaresEnteros: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  });
  assert.equal(precioLegible(1_850_000), "$18,500");
  assert.equal(precioLegible(1_250_025), "$12,500.25");
});

test("el catálogo no carga formularios ni diálogos de administración heredados", () => {
  for (const id of ["formulario-dialogo", "login-dialogo", "mensajes-dialogo", "fotografias-dialogo", "abrir-login", "cerrar-sesion", "abrir-mensajes"]) {
    assert.doesNotMatch(plantillaHtml, new RegExp(`\\bid="${id}"`), `El catálogo no debe contener ${id}.`);
  }
  assert.doesNotMatch(plantillaHtml, /vehicle-actions|Prototipo demostrativo|propuesta-[ab]\.css|datos-demo\.js/);
  assert.doesNotMatch(source, /abrirFormulario|abrirFotos|cambiarDisponibilidad|cerrarSesion|api\("\/api\/vehiculos"/);
  const adminLink = plantillaHtml.match(/<a id="admin-panel-link"[\s\S]*?<\/a>/)?.[0] || "";
  assert.match(adminLink, /href="\/administracion"/);
  assert.match(adminLink, /aria-label="Administrar"/);
  assert.match(adminLink, /admin-panel-link-label">Administrar<\/span>/);
  assert.doesNotMatch(plantillaHtml, /js\/fotografias\.js/);
});

test("el panel V6 conserva autenticación, vehículo, fotografías y bandeja", async () => {
  const adminTemplate = await readFile(new URL("../templates/admin_v6.html", import.meta.url), "utf8");
  const adminScript = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");
  assert.match(adminTemplate, /id="admin-login-form"/);
  assert.match(adminTemplate, /data-admin-view="inventory"/);
  assert.match(adminTemplate, /data-admin-view="vehicle-form"/);
  assert.match(adminTemplate, /id="admin-chat-list"/);
  assert.match(adminTemplate, /id="admin-reply-form"/);
  assert.match(adminTemplate, /js\/fotografias\.js/);
  assert.match(adminTemplate, /js\/admin-v6\.js/);
  assert.match(adminScript, /\/vehiculos\/\$\{encodeURIComponent\(savedVehicle\.id\)\}\/fotografias/);
  assert.match(adminScript, /\/admin\/chat\/conversaciones/);
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
    "filtros-catalogo", "mensaje", "admin-panel-link", "filtros-avanzados", "filtros-avanzados-activos",
    "reintentar", "inventario", "cargando", "estado-bloqueado", "estado-vacio",
    "estado-sin-resultados", "titulo-bloqueado", "detalle-bloqueado", "lista-vehiculos",
    "resumen-listado", "limpiar-desde-vacio",
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
    querySelector: (selector) => new ElementoFalso(selector),
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
      const resultado = String(ruta) === "/api/admin/session"
        ? { ok: true, solo_lectura: soloLectura }
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
    adminPanel: elementos.get("admin-panel-link"),
    detallesFiltros: elementos.get("filtros-avanzados"),
    indicadorFiltrosAvanzados: elementos.get("filtros-avanzados-activos"),
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

test("el catálogo enlaza al panel solo cuando el ambiente no es de solo lectura", async () => {
  const enlace = plantillaHtml.match(/<a\b(?=[^>]*\bhref="\/administracion")[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(enlace, "Debe existir un enlace al único panel administrativo.");
  assert.match(enlace[1], /Administrar/);
  assert.match(source, /solicitar\("\/api\/admin\/session"\)/);
  const preview = prepararAplicacion("", true);
  await preview.esperarCarga();
  assert.equal(preview.adminPanel.hidden, true);
  const production = prepararAplicacion();
  await production.esperarCarga();
  assert.equal(production.adminPanel.hidden, false);
});
