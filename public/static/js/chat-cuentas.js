"use strict";

(() => {
  const body = document.body;
  if (body.dataset.userAuthEnabled !== "true") return;

  const one = (id) => document.getElementById(id);
  const trigger = one("abrir-chat-cuentas");
  const dialog = one("chat-comprador-dialogo");
  if (!trigger || !dialog) return;

  const listView = one("chat-comprador-lista-vista");
  const threadView = one("chat-comprador-hilo");
  const listStatus = one("chat-comprador-lista-estado");
  const list = one("chat-comprador-lista");
  const threadStatus = one("chat-comprador-feedback");
  const messages = one("chat-comprador-mensajes");
  const form = one("chat-comprador-form");
  const textarea = one("chat-comprador-texto");
  const submit = one("chat-comprador-enviar");
  const fichaButton = one("chat-comprador-ver-ficha");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const drafts = new Map();
  const messageIds = new Set();
  let accountId = null;
  let accountRole = null;
  let conversations = [];
  let currentConversation = null;
  let currentVehicle = null;
  let threadScope = null;
  const pendingSends = new Map();
  const requests = new Set();
  let identityGeneration = 0;
  let cursor = 0;
  let listCursor = null;
  let hasMore = false;
  let listBusy = false;
  let sendBusy = false;
  let pollBusy = false;
  let pollTimer = null;
  let generation = 0;
  let openedBy = null;

  async function api(url, options = {}) {
    const epoch = identityGeneration;
    if (url !== "/api/cuenta") {
      const expected = accountId;
      await verifyAccount();
      if (expected !== accountId) { sessionExpired(); throw { stale: true }; }
    }
    if (epoch !== identityGeneration) throw { stale: true };
    const controller = new AbortController();
    requests.add(controller);
    const headers = { Accept: "application/json" };
    const init = { method: options.method || "GET", credentials: "same-origin", cache: "no-store", headers, signal: controller.signal };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrf;
      if (options.key) headers["Idempotency-Key"] = options.key;
      init.body = JSON.stringify(options.body);
    }
    let response;
    try { response = await fetch(url, init); }
    catch {
      if (epoch !== identityGeneration) throw { stale: true };
      throw Object.assign(new Error("No hay conexión. Inténtalo de nuevo; el texto escrito se conserva."), { network: true });
    } finally { requests.delete(controller); }
    let result = {};
    try { result = await response.json(); } catch { /* El estado HTTP basta para informar el fallo. */ }
    if (epoch !== identityGeneration) throw { stale: true };
    if (!response.ok || result.ok === false) {
      const error = new Error(result.mensaje || "No pudimos completar la operación. Inténtalo de nuevo.");
      error.status = response.status;
      error.retryAfter = response.headers.get("Retry-After");
      throw error;
    }
    return result;
  }

  function setStatus(element, text, type = "") {
    element.textContent = text || "";
    if (type) element.dataset.tipo = type;
    else delete element.dataset.tipo;
  }

  function switchView(name) {
    listView.hidden = name !== "list";
    threadView.hidden = name !== "thread";
    one("chat-comprador-volver").hidden = name === "list";
  }

  function setLoginPrompt(text) {
    const link = document.createElement("a");
    link.href = `/cuenta?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
    link.textContent = "Iniciar sesión";
    link.className = "chat-account-link";
    listStatus.replaceChildren(document.createTextNode(`${text} `), link);
  }

  function setSellerPrompt() {
    const link = document.createElement("a");
    link.href = "/vendedor";
    link.textContent = "Abrir panel de vendedor";
    link.className = "chat-account-link";
    listStatus.replaceChildren(document.createTextNode("Esta bandeja es para compradores. "), link);
  }

  function clearPrivateState() {
    generation += 1;
    identityGeneration += 1;
    requests.forEach((controller) => controller.abort());
    requests.clear();
    conversations = [];
    currentConversation = null;
    currentVehicle = null;
    threadScope = null;
    pendingSends.clear();
    cursor = 0;
    listCursor = null;
    hasMore = false;
    drafts.clear();
    messageIds.clear();
    list.replaceChildren();
    messages.replaceChildren();
    textarea.value = "";
    form.hidden = true;
    one("chat-comprador-panel").hidden = false;
    one("chat-comprador-ficha-no-disponible").hidden = true;
    fichaButton.hidden = true;
    one("chat-comprador-vehiculo").textContent = "";
    one("chat-comprador-vendedor").textContent = "Vendedor";
    one("chat-comprador-estado").textContent = "";
    threadStatus.textContent = "";
    stopPolling();
  }

  function sessionExpired() {
    clearPrivateState();
    accountId = null;
    accountRole = null;
    switchView("list");
    setLoginPrompt("Tu sesión venció. Inicia sesión para consultar tus conversaciones.");
  }

  async function verifyAccount() {
    const result = await api("/api/cuenta");
    if (!result.usuario?.id || !["comprador", "vendedor"].includes(result.usuario.rol)) {
      throw Object.assign(new Error("Inicia sesión para consultar tus conversaciones."), { status: 401 });
    }
    if (accountId && accountId !== String(result.usuario.id)) clearPrivateState();
    accountId = String(result.usuario.id);
    accountRole = result.usuario.rol;
    return result.usuario;
  }

  async function requireBuyer() {
    try {
      const user = await verifyAccount();
      if (user.rol !== "comprador") {
        clearPrivateState();
        switchView("list");
        setSellerPrompt();
        return false;
      }
      return true;
    } catch (error) {
      if (error.stale) return false;
      clearPrivateState();
      switchView("list");
      if (error.status === 401) setLoginPrompt("Inicia sesión para consultar y enviar mensajes privados.");
      else setStatus(listStatus, error.message, "error");
      return false;
    }
  }

  function titleOf(conversation) {
    return `${conversation.vehiculo?.marca || conversation.marca || "Vehículo"} ${conversation.vehiculo?.modelo || conversation.modelo || ""}`.trim();
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-NI", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function conversationButton(conversation) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-conversation-button";
    button.dataset.conversationId = String(conversation.id);
    button.setAttribute("aria-current", String(String(currentConversation?.id) === String(conversation.id)));
    const title = document.createElement("strong");
    title.textContent = titleOf(conversation);
    const contact = document.createElement("span");
    contact.className = "chat-conversation-contact";
    contact.textContent = `Vendedor: ${conversation.nombre_contacto || "Vendedor"}`;
    const preview = document.createElement("span");
    const status = conversation.vehiculo_retirado ? "Publicación retirada · historial" : conversation.estado === "atendida" ? "Atendida" : "Pendiente de respuesta";
    preview.textContent = `${status} · ${conversation.ultimo_mensaje || "Sin mensajes"}`;
    const time = document.createElement("time");
    time.dateTime = conversation.ultimo_mensaje_en || conversation.updated_at || "";
    time.textContent = formatDate(time.dateTime);
    button.append(title, contact, preview, time);
    button.addEventListener("click", () => openConversation(conversation));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const buttons = [...list.querySelectorAll("button")];
      const index = buttons.indexOf(button);
      const next = buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
      if (next) { event.preventDefault(); next.focus(); }
    });
    return button;
  }

  function renderConversations(append = false) {
    if (!append) list.replaceChildren();
    for (const conversation of conversations) {
      const button = conversationButton(conversation);
      const item = document.createElement("li");
      item.dataset.conversationId = String(conversation.id);
      item.append(button);
      const previous = list.querySelector(`[data-conversation-id="${CSS.escape(String(conversation.id))}"]`);
      if (previous) previous.replaceWith(item);
      else list.append(item);
    }
    const loadMore = one("chat-comprador-cargar-mas");
    if (loadMore) loadMore.hidden = !hasMore;
  }

  async function loadConversations({ append = false } = {}) {
    if (listBusy || !accountId || accountRole !== "comprador") return;
    listBusy = true;
    if (!append) { listCursor = null; conversations = []; }
    list.setAttribute("aria-busy", "true");
    setStatus(listStatus, append ? "Cargando más conversaciones…" : "Cargando conversaciones…");
    const query = new URLSearchParams({ limite: "50" });
    if (append && listCursor) query.set("cursor_id", listCursor);
    const requestGeneration = generation;
    try {
      const result = await api(`/api/cuenta/chat/comprador/conversaciones?${query}`);
      if (requestGeneration !== generation || !dialog.open) return;
      const incoming = result.conversaciones || [];
      hasMore = Boolean(result.hay_mas);
      listCursor = result.siguiente_cursor || null;
      conversations = append ? [...conversations, ...incoming] : incoming;
      renderConversations();
      setStatus(listStatus, conversations.length ? "" : "Todavía no tienes conversaciones. Explora el catálogo y contacta al vendedor desde la ficha de un vehículo.");
    } catch (error) {
      if (error.stale || requestGeneration !== generation) return;
      if (error.status === 401) { sessionExpired(); return; }
      setStatus(listStatus, error.message, "error");
    } finally { listBusy = false; list.setAttribute("aria-busy", "false"); }
  }

  function saveDraft() {
    if (threadScope) drafts.set(threadScope, textarea.value);
  }

  function updateVehicleLink(conversation) {
    const retired = Boolean(conversation?.vehiculo_retirado);
    const id = conversation?.vehiculo_id ?? conversation?.vehiculo?.id;
    const valid = Number.isSafeInteger(Number(id)) && Number(id) > 0;
    fichaButton.hidden = retired || !valid;
    one("chat-comprador-ficha-no-disponible").hidden = !retired;
    fichaButton.dataset.vehicleId = valid ? String(id) : "";
  }

  function appendMessage(message, own = false) {
    const id = String(message.id);
    if (messageIds.has(id)) return;
    messageIds.add(id);
    const node = document.createElement("article");
    node.className = "chat-message";
    node.dataset.messageId = id;
    node.dataset.remitente = message.remitente || "";
    node.dataset.own = String(own || message.remitente === "comprador");
    const text = document.createElement("p");
    text.textContent = message.contenido || "";
    const time = document.createElement("time");
    time.dateTime = message.created_at || "";
    time.textContent = formatDate(message.created_at);
    node.append(text, time);
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    if (/^\d+$/.test(id)) cursor = Math.max(cursor, Number(id));
  }

  async function loadMessages(initial = false) {
    if (!currentConversation || !dialog.open || (pollBusy && !initial)) return;
    const polling = !initial;
    if (polling) pollBusy = true;
    const id = String(currentConversation.id);
    const requestGeneration = generation;
    try {
      const result = await api(`/api/cuenta/chat/comprador/conversaciones/${encodeURIComponent(id)}/mensajes?despues_de_id=${initial ? 0 : cursor}`);
      if (requestGeneration !== generation || String(currentConversation?.id) !== id || !dialog.open) return;
      (result.mensajes || []).forEach((message) => appendMessage(message, message.remitente === "comprador"));
      if (initial) setStatus(threadStatus, result.mensajes?.length ? "Conectado. Los mensajes se actualizan automáticamente." : "Aún no hay mensajes. Puedes escribir al vendedor.");
      else if (result.mensajes?.length) setStatus(threadStatus, "");
      restartPolling();
    } catch (error) {
      if (error.stale || requestGeneration !== generation) return;
      if ([401, 403, 404].includes(error.status)) { sessionExpired(); return; }
      setStatus(threadStatus, error.message, "error");
    } finally { if (polling) pollBusy = false; messages.setAttribute("aria-busy", "false"); }
  }

  async function openConversation(conversation) {
    saveDraft();
    stopPolling();
    generation += 1;
    currentConversation = conversation;
    currentVehicle = { id: conversation.vehiculo_id, marca: conversation.vehiculo?.marca || conversation.marca, modelo: conversation.vehiculo?.modelo || conversation.modelo, anio: conversation.vehiculo?.anio || conversation.anio, vehiculo_retirado: Boolean(conversation.vehiculo_retirado) };
    threadScope = `vehicle:${conversation.vehiculo_id}`;
    cursor = 0;
    messageIds.clear();
    messages.replaceChildren();
    one("chat-comprador-vehiculo").textContent = titleOf(conversation);
    one("chat-comprador-vendedor").textContent = `Vendedor: ${conversation.nombre_contacto || "Vendedor"}`;
    one("chat-comprador-estado").textContent = conversation.vehiculo_retirado ? "Historial de publicación retirada" : conversation.estado === "atendida" ? "Atendida" : "Pendiente de respuesta";
    updateVehicleLink(conversation);
    form.hidden = Boolean(conversation.vehiculo_retirado);
    textarea.value = drafts.get(threadScope) || "";
    one("chat-comprador-panel").hidden = false;
    switchView("thread");
    messages.setAttribute("aria-busy", "true");
    setStatus(threadStatus, "Cargando mensajes…");
    await loadMessages(true);
    if (dialog.open && currentConversation?.id === conversation.id) textarea.focus({ preventScroll: true });
  }

  function openNewVehicleThread(vehicleId) {
    stopPolling();
    generation += 1;
    currentConversation = null;
    const heading = one("ficha-titulo")?.textContent?.trim() || "Vehículo";
    const [marca, ...modelo] = heading.split(/\s+/);
    currentVehicle = { id: Number(vehicleId), marca, modelo: modelo.join(" "), vehiculo_retirado: false };
    threadScope = `vehicle:${vehicleId}`;
    cursor = 0;
    messageIds.clear();
    messages.replaceChildren();
    one("chat-comprador-vehiculo").textContent = heading;
    one("chat-comprador-vendedor").textContent = "Vendedor";
    one("chat-comprador-estado").textContent = "Nueva consulta";
    updateVehicleLink({ vehiculo_id: Number(vehicleId) });
    form.hidden = false;
    textarea.value = drafts.get(threadScope) || "";
    one("chat-comprador-panel").hidden = false;
    switchView("thread");
    setStatus(threadStatus, "El mensaje iniciará una conversación privada con el vendedor.");
    textarea.focus({ preventScroll: true });
  }

  async function startContact() {
    const vehicleId = body.dataset.vehiculoId;
    if (!/^[1-9]\d*$/.test(vehicleId || "")) return;
    openDialog(one("mostrar-chat"), "thread");
    if (!await requireBuyer() || !dialog.open) return;
    setStatus(threadStatus, "Comprobando tu conversación…");
    try {
      const result = await api(`/api/cuenta/chat/comprador/vehiculos/${encodeURIComponent(vehicleId)}/conversacion`);
      if (!dialog.open) return;
      if (result.conversacion) await openConversation(result.conversacion);
      else openNewVehicleThread(vehicleId);
    } catch (error) {
      if (error.stale) return;
      if (error.status === 401) { sessionExpired(); return; }
      switchView("thread");
      form.hidden = true;
      setStatus(threadStatus, error.status === 404 ? "Este vehículo ya no está disponible para iniciar una conversación." : error.message, "error");
    }
  }

  async function openInbox() {
    openDialog(trigger, "list");
    saveDraft();
    switchView("list");
    if (!await requireBuyer() || !dialog.open) return;
    await loadConversations();
  }

  function openDialog(opener, view) {
    openedBy = opener;
    generation += 1;
    switchView(view);
    if (!dialog.open) dialog.showModal();
    body.classList.add("dialog-open");
    one("cerrar-chat-comprador").focus();
  }

  function closeDialog() {
    saveDraft();
    generation += 1;
    stopPolling();
    if (dialog.open) dialog.close();
    body.classList.remove("dialog-open");
    const target = openedBy?.isConnected && !openedBy.hidden ? openedBy : trigger;
    target?.focus();
  }

  function restartPolling() {
    stopPolling();
    if (!currentConversation || !dialog.open || document.hidden) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await loadMessages(false);
    }, 4000);
  }

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  async function sendMessage(event) {
    event.preventDefault();
    if (sendBusy || !accountId || accountRole !== "comprador" || !currentVehicle || currentVehicle.vehiculo_retirado) return;
    let content = textarea.value.trim();
    if (!content) { textarea.focus(); return; }
    const scope = threadScope;
    let pendingSend = pendingSends.get(scope);
    if (pendingSend?.uncertain && pendingSend.scope === scope && pendingSend.content !== content) {
      content = pendingSend.content;
      setStatus(threadStatus, "Comprobando el envío pendiente. El texto nuevo se conserva sin enviar.");
    }
    if (!pendingSend || pendingSend.scope !== scope || pendingSend.content !== content) {
      pendingSend = { scope, content, key: crypto.randomUUID() };
      pendingSends.set(scope, pendingSend);
    }
    const requestGeneration = generation;
    const sendingIdentity = identityGeneration;
    pendingSend.uncertain = true; // También conserva la clave si se abandona el hilo durante el envío.
    sendBusy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    setStatus(threadStatus, "Enviando mensaje…");
    try {
      const result = await api(`/api/cuenta/chat/comprador/vehiculos/${encodeURIComponent(currentVehicle.id)}/mensajes`, {
        method: "POST", body: { contenido: content }, key: pendingSend.key,
      });
      if (sendingIdentity !== identityGeneration) return;
      pendingSends.delete(scope);
      if (drafts.get(scope)?.trim() === content) drafts.delete(scope);
      if (threadScope === scope && textarea.value.trim() === content) textarea.value = "";
      if (requestGeneration !== generation || !dialog.open) return;
      currentConversation = result.conversacion;
      one("chat-comprador-vendedor").textContent = `Vendedor: ${result.conversacion.nombre_contacto || "Vendedor"}`;
      currentVehicle = { id: result.conversacion.vehiculo_id, vehiculo_retirado: Boolean(result.conversacion.vehiculo_retirado) };
      if (textarea.value.trim() === content) textarea.value = "";
      appendMessage(result.mensaje, true);
      one("chat-comprador-estado").textContent = result.conversacion.estado === "atendida" ? "Atendida" : "Pendiente de respuesta";
      const index = conversations.findIndex((item) => String(item.id) === String(result.conversacion.id));
      if (index >= 0) conversations[index] = result.conversacion;
      else conversations.unshift(result.conversacion);
      renderConversations();
      setStatus(threadStatus, textarea.value.trim() ? "Envío pendiente confirmado. Tu texto nuevo sigue sin enviar." : "Mensaje enviado.");
      restartPolling();
    } catch (error) {
      if (error.stale || sendingIdentity !== identityGeneration) return;
      if ([401, 403, 404].includes(error.status)) { sessionExpired(); return; }
      if (error.status && error.status < 500 && error.status !== 429) pendingSends.delete(scope);
      if (requestGeneration !== generation) return;
      const retry = error.status === 429 && error.retryAfter ? ` Espera ${error.retryAfter} segundos.` : "";
      setStatus(threadStatus, `${error.message}${retry}`, "error");
    } finally { sendBusy = false; submit.disabled = false; form.removeAttribute("aria-busy"); }
  }

  trigger.addEventListener("click", openInbox);
  one("mostrar-chat")?.addEventListener("click", startContact);
  one("cerrar-chat-comprador").addEventListener("click", closeDialog);
  one("chat-comprador-volver").addEventListener("click", async () => {
    if (!dialog.open) return;
    saveDraft();
    stopPolling();
    generation += 1;
    currentConversation = null;
    currentVehicle = null;
    threadScope = null;
    switchView("list");
    await loadConversations();
    if (dialog.open) (list.querySelector("button") || one("cerrar-chat-comprador")).focus();
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    stopPolling();
    body.classList.remove("dialog-open");
  });
  form.addEventListener("submit", sendMessage);
  textarea.addEventListener("input", saveDraft);
  one("chat-comprador-cargar-mas")?.addEventListener("click", () => loadConversations({ append: true }));
  fichaButton.addEventListener("click", () => {
    const id = fichaButton.dataset.vehicleId;
    if (!/^[1-9]\d*$/.test(id || "")) return;
    if (textarea.value.trim() && !window.confirm("Tenés un mensaje sin enviar. ¿Querés descartarlo y ver la ficha del vehículo?")) return;
    saveDraft();
    location.assign(`/vehiculo/${encodeURIComponent(id)}?retorno=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else recheckIdentity();
  });
  async function recheckIdentity() {
    if (!accountId) return;
    const expected = accountId;
    try {
      await verifyAccount();
      if (expected !== accountId) sessionExpired();
      else restartPolling();
    } catch (error) { if (!error.stale && error.status === 401) sessionExpired(); }
  }
  window.addEventListener("focus", recheckIdentity);
  document.addEventListener("cuenta-sesion-cambio", sessionExpired);

  const ficha = one("ficha-contenido");
  if (ficha && body.dataset.vehiculoId) {
    const revelarContacto = () => {
      if (ficha.hidden) return;
      const disponible = one("ficha-estado").textContent === "Disponible";
      one("comprador-chat").hidden = !disponible;
    };
    new MutationObserver(revelarContacto).observe(ficha, { attributes: true, attributeFilter: ["hidden"] });
    revelarContacto();
  }

  if (new URLSearchParams(location.search).get("mensajes") === "1") {
    const next = new URL(location.href);
    next.searchParams.delete("mensajes");
    history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
    requestAnimationFrame(() => trigger.click());
  }
})();
