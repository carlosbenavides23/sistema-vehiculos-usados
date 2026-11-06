import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../static/js/chat.js", import.meta.url), "utf8");
const css = await readFile(new URL("../static/css/estilos.css", import.meta.url), "utf8");
const adminTemplate = await readFile(new URL("../templates/admin_v6.html", import.meta.url), "utf8");
const adminScript = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");

test("el chat queda apagado por defecto y el navegador respeta la capability del servidor", () => {
  assert.match(template, /data-chat-enabled="\{\{ 'true' if chat_habilitado else 'false' \}\}"/);
  assert.match(template, /js\/chat\.js/);
  assert.match(script, /if \(!habilitado\) return/);
  assert.match(script, /cuerpo\.dataset\.chatEnabled === "true"/);
});

test("la ficha ofrece contacto privado e historial asociado al vehículo", () => {
  assert.match(template, /id="comprador-chat"[^>]*hidden/);
  assert.match(template, /id="mostrar-chat"[^>]*>Contactar al vendedor/);
  assert.match(template, /id="chat-comprador-lista"/);
  assert.match(template, /id="chat-comprador-mensajes"[^>]*role="log"/);
  assert.match(script, /const vehiculoDestino = conversacionComprador\?\.vehiculo_id \|\| idVehiculoFicha/);
  assert.match(script, /\/api\/chat\/vehiculos\/\$\{encodeURIComponent\(vehiculoDestino\)\}\/mensajes/);
  assert.match(script, /if \(elegirFicha\) prepararBorradorComprador\(\)/);
  assert.match(script, /porId\("chat-comprador-form"\)\.hidden = false/);
});

test("la interfaz pública no contiene la administración heredada y el chat administrativo vive en V6", () => {
  for (const id of ["abrir-mensajes", "mensajes-dialogo", "chat-admin-lista", "chat-admin-mensajes", "chat-admin-form", "chat-admin-atendida"]) {
    assert.doesNotMatch(template, new RegExp(`\\bid="${id}"`));
  }
  assert.doesNotMatch(script, /\/api\/admin\/chat|function (?:abrirAdmin|comprobarAdmin|enviarAdmin)/);
  assert.match(adminTemplate, /data-admin-view="conversations"/);
  assert.match(adminTemplate, /id="admin-chat-list"/);
  assert.match(adminTemplate, /id="admin-reply-form"/);
  assert.match(adminScript, /\/admin\/chat\/conversaciones/);
  assert.match(adminScript, /atendida: true/);
});

test("el polling del comprador usa cursor, evita consultas concurrentes y se pausa con la pestaña oculta", () => {
  assert.match(script, /const intervalo = 4000/);
  assert.match(script, /despues_de_id=/);
  assert.match(script, /if \(!compradorAbierto \|\| !dialogoComprador\.open \|\| !conversacionComprador \|\| compradorEnVuelo\) return/);
  assert.match(script, /document\.addEventListener\("visibilitychange"/);
  assert.match(script, /if \(document\.hidden\) detenerPollingComprador\(\)/);
});

test("los mensajes se renderizan como texto y los borradores no contienen credenciales", () => {
  assert.match(script, /texto\.textContent = mensaje\.contenido \|\| ""/);
  assert.doesNotMatch(script, /\.innerHTML\s*=|localStorage/);
  assert.match(script, /sessionStorage\.setItem\(claveStorageBorradores/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /csrf: csrfComprador/);
  assert.match(script, /csrfMeta\?\.content \|\| ""/);
});

test("la interfaz conserva reintentos idempotentes y el texto si falla el envío", () => {
  assert.match(script, /No hay conexión\. Conservamos tu texto/);
  assert.match(script, /solicitudCompradorPendiente/);
  assert.match(script, /Idempotency-Key/);
  assert.match(script, /if \(error\.status === 401\)[\s\S]*solicitudCompradorPendiente y su texto se conservan/);
  assert.match(script, /compradorPreparado = false/);
});

test("el aviso de privacidad identifica PostgreSQL como almacenamiento de mensajes", () => {
  assert.match(template, /mensajes se guardan en el servidor PostgreSQL/);
  assert.doesNotMatch(template, /Tu conversación se guarda en este navegador/);
});

test("el comprador tiene un diálogo modal accesible y una acción global independiente de la ficha", () => {
  assert.match(template, /<dialog id="chat-comprador-dialogo"/);
  for (const id of ["chat-comprador-lista-vista", "chat-comprador-hilo", "chat-comprador-volver", "cerrar-chat-comprador"]) {
    assert.ok(template.includes(`id="${id}"`));
  }
  assert.match(script, /dialogoComprador\.showModal\(\)/);
  assert.match(script, /dialogoComprador\.addEventListener\("cancel"/);
  assert.match(script, /const destino = ultimoAbridorComprador[\s\S]*destino\?\.focus\(\)/);
  assert.match(template, /id="abrir-chat-comprador-global"[^>]*>[^]*?Mis mensajes[^]*?<\/button>/);
});

test("los borradores sobreviven a la navegación del mismo tab y el cierre detiene el polling", () => {
  assert.match(script, /vehiculos-chat-borradores-v1/);
  assert.match(script, /sessionStorage\.getItem\(claveStorageBorradores/);
  const cierre = script.slice(script.indexOf("function cerrarComprador"), script.indexOf("function restaurarFocoComprador"));
  assert.match(cierre, /detenerPollingComprador\(\)/);
  assert.match(cierre, /compradorAbierto = false/);
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
  assert.match(css, /min-width:\s*44px/);
});
