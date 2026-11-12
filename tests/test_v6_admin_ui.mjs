import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/admin_v6.html", import.meta.url), "utf8");
const adminScript = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");
const adminStyles = await readFile(new URL("../static/css/admin-v6.css", import.meta.url), "utf8");
const fieldValuesScript = await readFile(new URL("../static/js/admin-v6-field-values.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../app.py", import.meta.url), "utf8");

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

test("la edición V6 serializa transmisión y combustible mediante el guardado histórico explícito", () => {
  assert.match(template, /admin-v6-field-values\.js[\s\S]*admin-v6\.js/);
  assert.match(adminScript, /setPreservingCurrentValue\(form\.elements\.namedItem\(name\), vehicle\[name\]\)/);
  assert.match(adminScript, /values\[name\]\s*=\s*vehicleFieldValues\.serializedValue\(form\.elements\.namedItem\(name\)\)/);
  assert.match(adminScript, /vehicleFieldValues\.clearHistoricalValue\(form\.elements\.namedItem\(name\)\)/);
  assert.match(fieldValuesScript, /option\.textContent\s*=\s*`\$\{original\} \(valor actual\)`/);
  assert.match(fieldValuesScript, /select\.value\s*===\s*\(original\s*\?\?\s*""\)/);
});


test("el selector de estado de la bandeja conserva espacio para sus opciones y la flecha en móvil", () => {
  assert.match(adminStyles, /\.admin-chat-list-heading select\s*\{[^}]*width:\s*134px;[^}]*flex:\s*0 0 134px;[^}]*padding:\s*0 34px 0 8px !important;/);
  assert.match(adminStyles, /\.admin-chat-list-heading select\s*\{\s*width:\s*120px;\s*max-width:\s*120px;\s*flex-basis:\s*120px;/);
});

test("la navegación móvil administrativa solo se muestra con sesión y sigue el estado accesible", () => {
  assert.match(template, /id="admin-mobile-menu"[^>]*aria-label="Mostrar navegación"[^>]*aria-expanded="false"[^>]*hidden/);
  assert.match(adminScript, /mobileMenuButton\.hidden = !authenticated \|\| !esMovil/);
  assert.match(adminScript, /mobileMenuButton\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(adminScript, /mobileMenuButton\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(adminScript, /closeMobileNavigation\(\{ restoreFocus: true \}\)/);
  assert.match(adminScript, /window\.addEventListener\("resize", syncMobileNavigation\)/);
  assert.match(adminStyles, /\.admin-menu-button:not\(\[hidden\]\)\s*\{\s*display:\s*inline-grid/);
  assert.match(adminStyles, /@media \(max-width: 360px\)[\s\S]*?\.admin-nav-list\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("los errores de formulario se asocian a sus controles y los estados se anuncian", () => {
  assert.match(adminScript, /field\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(adminScript, /field\.setAttribute\("aria-describedby", descriptions\.join\(" "\)\)/);
  assert.match(adminScript, /field\.removeAttribute\("aria-invalid"\)/);
  assert.match(adminScript, /catch \(error\)[\s\S]*setStatus\(""\);\s*showFormError\(error\.message, error\.fields\)/);
  assert.match(adminScript, /form\?\.addEventListener\("input", recoverFormError\)/);
  assert.match(adminScript, /form\?\.addEventListener\("change", recoverFormError\)/);
  assert.match(adminStyles, /\.admin-v6 :focus-visible\s*\{\s*outline:\s*3px solid var\(--color-focus\)/);
  assert.match(adminStyles, /\.admin-photo-item button\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px;/);
});

test("un error de carga del inventario no se presenta como estado vacío", () => {
  const start = adminScript.indexOf("async function loadInventory");
  const end = adminScript.indexOf('\n  one("#admin-inventory-filters")?.addEventListener', start);
  const handler = adminScript.slice(start, end);
  const renderer = adminScript.slice(adminScript.indexOf("function renderInventory"), start);
  assert.match(renderer, /emptyInventory\.hidden = !empty/);
  assert.match(handler, /catch \(error\)[\s\S]*renderInventory\(\[\]\);\s*emptyInventory\.hidden = true/);
  assert.match(handler, /inventoryFeedback\.textContent = error\.status === 401/);
});
