import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const motion = await readFile(new URL("../static/css/motion.css", import.meta.url), "utf8");
const publicTemplate = await readFile(new URL("../templates/index.html", import.meta.url), "utf8");
const adminTemplate = await readFile(new URL("../templates/admin_v6.html", import.meta.url), "utf8");
const publicScript = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");
const buyerChat = await readFile(new URL("../static/js/chat.js", import.meta.url), "utf8");
const adminScript = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");

test("define una escala breve de movimiento y no anima layout", () => {
  for (const token of [
    "--motion-duration-feedback: 140ms",
    "--motion-duration-state: 180ms",
    "--motion-duration-panel: 220ms",
    "--motion-duration-panel-exit: 150ms",
    "--motion-duration-gallery: 180ms",
    "--motion-duration-message: 180ms",
  ]) assert.ok(motion.includes(token), `Falta el token ${token}`);
  assert.ok(motion.includes("--motion-ease-enter: cubic-bezier"));
  assert.ok(motion.includes("--motion-ease-exit: cubic-bezier"));
  assert.doesNotMatch(motion, /transition(?:-property)?\s*:\s*all\b/i);
  assert.doesNotMatch(motion, /(?:width|height|top|left)\s+var\(--motion-/);
});

test("limita hover a puntero preciso y conserva movimiento reducido global", () => {
  assert.match(motion, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  assert.match(motion, /\.vehicle-card:hover\s*\{[^}]*translateY\(-3px\)/s);
  assert.match(motion, /\.vehicle-card:hover \.vehicle-art\.has-photos \.vehicle-image\s*\{[^}]*scale\(1\.02\)/s);
  assert.doesNotMatch(motion, /vehicle-card[^{}]*animation:/);
  assert.match(motion, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important[\s\S]*?transition:\s*none\s*!important/);
  assert.match(motion, /\.buyer-chat-drawer::backdrop,\s*\.admin-confirm-dialog::backdrop\s*\{\s*animation:\s*none !important;\s*transition:\s*none !important;/);
});

test("carga el sistema de movimiento tras los estilos V6 públicos y administrativos", () => {
  assert.match(publicTemplate, /redesign-public-v6\.css[\s\S]*motion\.css/);
  assert.match(adminTemplate, /admin-v6\.css[\s\S]*motion\.css/);
  assert.match(motion, /\.admin-v6 \.admin-view:not\(\[hidden\]\)/);
  assert.match(motion, /\.buyer-chat-drawer\[open\]/);
  assert.match(motion, /\.admin-confirm-dialog\[open\]/);
  assert.match(motion, /#filtros-avanzados\[open\] > \.filtros-avanzados-contenido/);
});

test("solo marca como entrantes los mensajes nuevos de polling y envíos", () => {
  assert.match(buyerChat, /idsVistos\.has\(String\(mensaje\.id\)\)/);
  assert.match(buyerChat, /agregarMensajes\(porId\("chat-comprador-mensajes"\), mensajes, idsComprador, !inicial\)/);
  assert.match(buyerChat, /agregarMensajes\(porId\("chat-comprador-mensajes"\), \[respuesta\.mensaje\], idsComprador, true\)/);
  assert.match(adminScript, /\(result\.mensajes \|\| \[\]\)\.forEach\(appendMessage\)/);
  assert.match(adminScript, /\(result\.mensajes \|\| \[\]\)\.forEach\(\(message\) => appendMessage\(message, true\)\)/);
  assert.match(adminScript, /appendMessage\(result\.mensaje, true\)/);
});

test("prepara la foto antes del fundido de entrada y no espera la animación para mostrarla", () => {
  assert.match(publicScript, /function mostrarFotoPreparada\(/);
  assert.match(publicScript, /const precarga = new Image\(\)/);
  assert.match(publicScript, /generacionesFoto\.set\(imagen, generacion\)/);
  assert.match(publicScript, /if \(!vigente\(\) \|\| finalizado\) return/);
  assert.ok(publicScript.includes('window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches'));
  assert.match(publicScript, /imagen\.animate\(/);
  assert.match(publicScript, /imagen\.onerror = fallar/);
  assert.match(publicScript, /imagen\.currentSrc !== url/);
  assert.match(publicScript, /!imagen\.isConnected/);
  assert.match(publicScript, /animacion\.finished\.then\(limpiarAnimacion, limpiarAnimacion\)/);
  const completar = publicScript.indexOf("      alCompletar();", publicScript.indexOf("function mostrarFotoPreparada("));
  const animar = publicScript.indexOf("const animacion = imagen.animate(", publicScript.indexOf("function mostrarFotoPreparada("));
  assert.ok(completar >= 0 && animar > completar, "La carga finaliza antes de comenzar el fundido opcional.");
});
