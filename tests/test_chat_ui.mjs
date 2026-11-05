import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../static/js/chat.js", import.meta.url), "utf8");
const css = await readFile(new URL("../static/css/estilos.css", import.meta.url), "utf8");

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

test("la mensajería administrativa está separada y permite atender conversaciones", () => {
  for (const id of ["abrir-mensajes", "mensajes-dialogo", "chat-admin-lista", "chat-admin-mensajes", "chat-admin-form", "chat-admin-atendida"]) {
    assert.ok(template.includes(`id="${id}"`), `Falta ${id}`);
  }
  assert.match(script, /\/api\/admin\/chat\/conversaciones/);
  assert.match(script, /atendida: true/);
  assert.match(script, /botonAbrirAdmin\.hidden = !siguiente/);
});

test("el polling usa cursor, una sola petición por hilo y se pausa con la pestaña oculta", () => {
  assert.match(script, /const intervalo = 4000/);
  assert.match(script, /despues_de_id=/);
  assert.match(script, /if \(!conversacionComprador \|\| compradorEnVuelo\) return/);
  assert.match(script, /if \(!conversacionAdmin \|\| adminEnVuelo \|\| !adminAutenticado\) return/);
  assert.match(script, /document\.addEventListener\("visibilitychange"/);
  assert.match(script, /if \(document\.hidden\)/);
});

test("los mensajes se renderizan como texto y no se guardan credenciales en web storage", () => {
  assert.match(script, /texto\.textContent = mensaje\.contenido \|\| ""/);
  assert.match(script, /\["admin", "administrador"\]\.includes\(mensaje\.remitente\)/);
  assert.doesNotMatch(script, /\.innerHTML\s*=|localStorage|sessionStorage/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /csrf: csrfComprador/);
  assert.match(script, /csrf: csrfAdmin\(\)/);
});

test("la interfaz conserva la composición ante error y ofrece tamaños responsive", () => {
  assert.match(script, /No hay conexión\. Conservamos tu texto/);
  assert.match(script, /solicitudCompradorPendiente/);
  assert.match(script, /Idempotency-Key/);
  assert.match(script, /if \(error\.status === 401\)[\s\S]*solicitudCompradorPendiente y su texto se conservan/);
  assert.match(script, /compradorPreparado = false/);
  assert.match(css, /\.chat-workspace:not\(\[hidden\]\)/);
  assert.match(css, /@media\(max-width:650px\)[\s\S]*\.admin-chat-workspace \{ grid-template-columns:minmax\(0,1fr\)/);
});

test("al seleccionar una conversación no reduce el listado lateral", () => {
  const seleccionar = script.slice(script.indexOf("function seleccionarConversacionAdmin"), script.indexOf("async function cargarMensajesAdmin"));
  assert.doesNotMatch(seleccionar, /listarConversacionesAdmin\(\s*\[/);
  assert.match(seleccionar, /listaAdminMarcarSeleccionada\(conversacion\.id\)/);
});

test("si se cambia de conversación durante una consulta, carga los mensajes de la selección vigente", () => {
  const cargar = script.slice(script.indexOf("async function cargarMensajesAdmin"), script.indexOf("function detenerPollingAdmin"));
  assert.match(cargar, /if \(String\(conversacionAdmin\?\.id\) !== conversacionSolicitada\) return/);
  assert.match(cargar, /queueMicrotask\(\(\) => cargarMensajesAdmin\(\)\)/);
});

test("el polling actualiza nodos existentes y conserva el foco del teclado", () => {
  const render = script.slice(script.indexOf("function listarConversacionesAdmin"), script.indexOf("async function cargarListaAdmin"));
  assert.match(render, /new Map\(Array\.from\(lista\.children/);
  assert.match(render, /lista\.insertBefore/);
  assert.match(render, /botonEnFoco\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(render, /replaceChildren/);
});

test("el listado administrativo permite cargar páginas cursor y conserva lo ya cargado", () => {
  assert.match(template, /id="chat-admin-cargar-mas"[^>]*hidden/);
  assert.match(script, /parametros\.set\("cursor_id", cursorSiguienteAdmin\)/);
  assert.match(script, /hay_mas: hayMas/);
  assert.match(script, /siguiente_cursor: siguienteCursorLista/);
  assert.match(script, /paginasAdminCargadas/);
});

test("el aviso de privacidad identifica PostgreSQL como almacenamiento de mensajes", () => {
  assert.match(template, /mensajes se almacenan en PostgreSQL/);
  assert.doesNotMatch(template, /Tu conversación se guarda en este navegador/);
});
