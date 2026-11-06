import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/admin_v6.html", import.meta.url), "utf8");
const adminScript = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../app.py", import.meta.url), "utf8");

const apiContracts = new Set([
  "GET /api/admin/session", "POST /api/admin/login", "POST /api/admin/logout",
  "POST /api/chat/sesion", "GET /api/chat/conversaciones", "POST /api/chat/vehiculos/<int:identificador>/mensajes",
  "GET /api/chat/conversaciones/<uuid:conversacion_id>/mensajes",
  "GET /api/admin/chat/conversaciones", "GET /api/admin/chat/conversaciones/<uuid:conversacion_id>/mensajes",
  "POST /api/admin/chat/conversaciones/<uuid:conversacion_id>/mensajes",
  "PATCH /api/admin/chat/conversaciones/<uuid:conversacion_id>/atendida",
  "GET /api/vehiculos", "GET /api/vehiculos/<int:identificador>", "POST /api/vehiculos",
  "PUT /api/vehiculos/<int:identificador>", "PATCH /api/vehiculos/<int:identificador>/disponibilidad",
  "POST /api/vehiculos/<int:identificador>/fotografias",
  "PUT /api/vehiculos/<int:identificador>/fotografias/<int:fotografia_id>",
  "DELETE /api/vehiculos/<int:identificador>/fotografias/<int:fotografia_id>",
]);

function declaredApiContracts(source) {
  return new Set([...source.matchAll(/@aplicacion\.(get|post|put|patch|delete)\("(\/api\/[^\"]+)"\)/g)]
    .map(([, method, path]) => `${method.toUpperCase()} ${path}`));
}

test("el acceso administrativo usa únicamente la contraseña existente", () => {
  assert.match(template, /<form\b(?=[^>]*\bid="admin-login-form")[^>]*>/);
  assert.match(template, /<input\b(?=[^>]*\bname="password")(?=[^>]*\btype="password")/);
  assert.doesNotMatch(template, /name=["'](?:username|usuario|user|email)["']/i);
  assert.doesNotMatch(template, /id=["'](?:admin-username|admin-user|admin-email)["']/i);
  assert.match(adminScript, /\/admin\/login"[^\n]*body:\s*\{\s*password:\s*loginPassword\.value\s*\}/);
  assert.match(template, /meta name="csrf-token"/);
  assert.match(adminScript, /X-CSRF-Token/);
});

test("el panel consulta inventario real y no presenta métricas de ejemplo como datos", () => {
  for (const id of ["admin-workspace", "admin-inventory-filters", "admin-inventory-list", "admin-inventory-mobile", "vehicle-form-title"]) {
    assert.match(template, new RegExp(`\\bid=["']${id}["']`), `Falta la vista administrativa ${id}.`);
  }
  assert.match(adminScript, /request\(`\/vehiculos\$\{query \? `\?\$\{query\}` : ""\}`\)/);
  assert.doesNotMatch(template, /id=["']total-(?:vehiculos|disponibles|vendidos)["']/);
  assert.doesNotMatch(template, /\b(?:1,?248|1,?284|147)\s+(?:vehículos|publicaciones|consultas)\b/i);
});

test("registro, edición y fotografías mantienen sesión, CSRF, idempotencia y guardado secuencial", () => {
  assert.match(template, /id="admin-vehicle-form"/);
  for (const name of ["marca", "modelo", "anio", "kilometraje", "precio_venta", "ubicacion", "descripcion"]) {
    assert.match(template, new RegExp(`\\bname=["']${name}["']`), `El formulario debe conservar ${name}.`);
  }
  assert.match(template, /id="vehicle-photo-input"[^>]*type="file"/);
  assert.match(adminScript, /credentials:\s*["']same-origin["']/);
  assert.match(adminScript, /X-CSRF-Token/);
  assert.match(adminScript, /Idempotency-Key/);
  const submit = adminScript.slice(adminScript.indexOf('form?.addEventListener("submit"'), adminScript.indexOf("function openPhotos"));
  const savePosition = submit.indexOf("await request(isNew ? \"/vehiculos\"");
  const photoEnablePosition = submit.indexOf('one("#vehicle-photo-upload").hidden = false');
  assert.ok(savePosition >= 0 && photoEnablePosition > savePosition, "La subida de fotos se habilita después de confirmar el guardado del vehículo.");
  assert.match(adminScript, /\/vehiculos\/\$\{encodeURIComponent\(savedVehicle\.id\)\}\/fotografias/);
  assert.doesNotMatch(adminScript, /localStorage/);
});

test("la bandeja y respuestas admin usan endpoints existentes y el estado real del chat", () => {
  assert.match(template, /data-admin-panel="conversations"/);
  assert.match(template, /data-chat-enabled=/);
  for (const id of ["admin-chat-list", "admin-chat-thread", "admin-reply-form", "admin-thread-resolve"]) {
    assert.match(template, new RegExp(`\\bid=["']${id}["']`), `Falta el componente de bandeja ${id}.`);
  }
  assert.match(adminScript, /\/admin\/chat\/conversaciones/);
  assert.match(adminScript, /\/mensajes/);
  assert.match(adminScript, /\/atendida/);
  assert.match(adminScript, /Idempotency-Key/);
  assert.doesNotMatch(adminScript, /localStorage/);
});

test("la página nueva no amplía el contrato de APIs ni expone datos en la ruta HTML", () => {
  assert.match(backend, /@aplicacion\.get\("\/administracion"\)/);
  const pageRoute = backend.slice(backend.indexOf('@aplicacion.get("/administracion")'), backend.indexOf('@aplicacion.get("/api/admin/session")'));
  assert.match(pageRoute, /render_template\(/);
  assert.match(pageRoute, /csrf_token=token_csrf\(\)/);
  assert.match(pageRoute, /solo_lectura=current_app\.config\["APP_READ_ONLY"\]/);
  assert.match(pageRoute, /chat_habilitado=chat_publico_habilitado\(\)/);
  assert.doesNotMatch(pageRoute, /listar_vehiculos|persistencia|password_hash|DATABASE_URL|SUPABASE_/);
  assert.deepEqual(declaredApiContracts(backend), apiContracts);
});
