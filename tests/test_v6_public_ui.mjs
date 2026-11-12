import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/index.html", import.meta.url), "utf8");
const interfaceScript = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");
const chatScript = await readFile(new URL("../static/js/chat-cuentas.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../app.py", import.meta.url), "utf8");

const publicFilterNames = [
  "q", "disponibilidad", "precio_min", "precio_max", "anio_min", "anio_max", "tipo_vehiculo", "orden",
];

test("el catálogo conserva los filtros soportados por la API y comparte su estado en la URL", () => {
  const form = template.match(/<form\b(?=[^>]*\bid="filtros-catalogo")[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, "Debe existir el formulario público de búsqueda y filtros.");
  for (const name of publicFilterNames) {
    assert.match(form, new RegExp(`\\bname=["']${name}["']`), `Debe conservarse el filtro ${name}.`);
  }
  assert.match(interfaceScript, /new URLSearchParams/);
  assert.match(interfaceScript, /\/api\/vehiculos/);
  assert.match(backend, /@aplicacion\.get\("\/api\/vehiculos"\)/);
  assert.match(backend, /validar_filtros_busqueda\(request\.args\)/);
  assert.match(backend, /from vehiculos import [^\n]*validar_filtros_busqueda/);
});

test("la ficha reutiliza fotografías del API y ofrece galería, miniaturas y contacto por vehículo", () => {
  for (const id of ["ficha-contenido", "ficha-imagen", "ficha-miniaturas", "ficha-anterior", "ficha-siguiente", "comprador-chat", "mostrar-chat"]) {
    assert.match(template, new RegExp(`\\bid=["']${id}["']`), `Falta el control de ficha ${id}.`);
  }
  assert.match(interfaceScript, /vehiculo\.fotografias\s*\|\|\s*\[\]/);
  assert.match(interfaceScript, /\/vehiculo\/\$\{encodeURIComponent\(vehiculo\.id\)\}/);
});
