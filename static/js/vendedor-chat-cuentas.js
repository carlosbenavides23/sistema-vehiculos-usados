"use strict";

(() => {
  if (document.body.dataset.sellerPanel !== "true") return;
  const one = (id) => document.getElementById(id);
  const nav = one("seller-chat-nav");
  const workspace = one("seller-chat-workspace");
  if (!nav || !workspace) return;

  const list = one("seller-chat-list");
  const listFeedback = one("seller-chat-list-feedback");
  const thread = one("seller-chat-thread");
  const threadMessages = one("seller-thread-messages");
  const threadFeedback = one("seller-thread-feedback");
  const replyForm = one("seller-reply-form");
  const replyText = one("seller-reply-text");
  const replyButton = one("seller-reply-submit");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const drafts = new Map();
  const messageIds = new Set();
  let conversations = [];
  let currentConversation = null;
  let cursor = null;
  let hasMore = false;
  let listBusy = false;
  let messageCursor = 0;
  let generation = 0;
  let pollTimer = null;
  let pollBusy = false;
  let sendBusy = false;
  const pendingReplies = new Map();
  const requests = new Set();
  let accountId = null;
  let identityGeneration = 0;

  async function api(url, options = {}) {
    const epoch = identityGeneration;
    if (url !== "/api/cuenta") {
      const result = await api("/api/cuenta");
      if (result.usuario?.rol !== "vendedor" || (accountId && accountId !== result.usuario.id)) {
        expireSession();
        throw { stale: true };
      }
      accountId = result.usuario.id;
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
      throw Object.assign(new Error("No hay conexión. El texto de respuesta se conserva."), { network: true });
    } finally { requests.delete(controller); }
    let result = {};
    try { result = await response.json(); } catch { /* El estado HTTP da el contexto suficiente. */ }
    if (epoch !== identityGeneration) throw { stale: true };
    if (!response.ok || result.ok === false) {
      const error = new Error(result.mensaje || "No pudimos completar la operación.");
      error.status = response.status;
      error.retryAfter = response.headers.get("Retry-After");
      throw error;
    }
    return result;
  }

  function status(element, text, type = "") {
    element.textContent = text || "";
    if (type) element.dataset.tipo = type;
    else delete element.dataset.tipo;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-NI", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function conversationTitle(conversation) {
    const vehicle = conversation.vehiculo || {};
    return `${vehicle.marca || conversation.marca || "Vehículo"} ${vehicle.modelo || conversation.modelo || ""}${vehicle.anio || conversation.anio ? ` · ${vehicle.anio || conversation.anio}` : ""}`.trim();
  }

  function renderItem(conversation) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-chat-item";
    button.dataset.conversationId = String(conversation.id);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(String(currentConversation?.id) === String(conversation.id)));
    const title = document.createElement("strong");
    title.textContent = conversationTitle(conversation);
    const time = document.createElement("time");
    time.dateTime = conversation.ultimo_mensaje_en || conversation.updated_at || "";
    time.textContent = formatDate(time.dateTime);
    const excerpt = document.createElement("span");
    const state = conversation.vehiculo_retirado ? "Publicación retirada · solo lectura" : conversation.estado === "atendida" ? "Atendida" : "Pendiente";
    excerpt.textContent = `${state} · ${conversation.ultimo_mensaje || "Sin mensajes"}`;
    button.append(title, time, excerpt);
    button.addEventListener("click", () => openConversation(conversation));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const items = [...list.querySelectorAll(".admin-chat-item")];
      const index = items.indexOf(button);
      const next = items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      if (next) { event.preventDefault(); next.focus(); }
    });
    return button;
  }

  function renderList() {
    for (const conversation of conversations) {
      const next = renderItem(conversation);
      const existing = list.querySelector(`[data-conversation-id="${CSS.escape(String(conversation.id))}"]`);
      if (existing) existing.replaceWith(next);
      else list.append(next);
    }
    one("seller-chat-load-more").hidden = !hasMore;
  }

  async function loadInbox({ append = false } = {}) {
    if (listBusy) return;
    listBusy = true;
    const requestGeneration = generation;
    if (!append) { cursor = null; conversations = []; list.replaceChildren(); }
    list.setAttribute("aria-busy", "true");
    status(listFeedback, append ? "Cargando más conversaciones…" : "Cargando conversaciones…");
    const query = new URLSearchParams({ limite: "50" });
    if (append && cursor) query.set("cursor_id", cursor);
    try {
      const result = await api(`/api/cuenta/chat/vendedor/conversaciones?${query}`);
      if (requestGeneration !== generation) return;
      const incoming = result.conversaciones || [];
      conversations = append ? [...conversations, ...incoming] : incoming;
      cursor = result.siguiente_cursor || null;
      hasMore = Boolean(result.hay_mas);
      renderList();
      status(listFeedback, conversations.length ? "" : "Todavía no hay consultas de tus publicaciones.");
    } catch (error) {
      if (error.stale || requestGeneration !== generation) return;
      if ([401, 403, 404].includes(error.status)) return expireSession();
      status(listFeedback, error.status === 404 ? "La mensajería no está habilitada en este entorno." : error.message, "error");
    } finally { listBusy = false; list.setAttribute("aria-busy", "false"); }
  }

  function saveDraft() {
    if (currentConversation) drafts.set(String(currentConversation.id), replyText.value);
  }

  function appendMessage(message) {
    const id = String(message.id);
    if (messageIds.has(id)) return;
    messageIds.add(id);
    const node = document.createElement("article");
    node.className = `admin-message${message.remitente === "vendedor" ? " is-admin" : ""}`;
    node.dataset.messageId = id;
    node.dataset.remitente = message.remitente || "";
    node.dataset.own = String(message.remitente === "vendedor");
    const content = document.createElement("span");
    content.textContent = message.contenido || "";
    const time = document.createElement("time");
    time.dateTime = message.created_at || "";
    time.textContent = formatDate(message.created_at);
    node.append(content, time);
    threadMessages.append(node);
    threadMessages.scrollTop = threadMessages.scrollHeight;
    if (/^\d+$/.test(id)) messageCursor = Math.max(messageCursor, Number(id));
  }

  async function loadMessages({ initial = false, requestGeneration = generation } = {}) {
    if (!currentConversation || !workspace.classList.contains("has-selected") || (pollBusy && !initial)) return;
    const polling = !initial;
    if (polling) pollBusy = true;
    const conversationId = String(currentConversation.id);
    const cursorValue = initial ? 0 : messageCursor;
    threadMessages.setAttribute("aria-busy", "true");
    try {
      const result = await api(`/api/cuenta/chat/vendedor/conversaciones/${encodeURIComponent(conversationId)}/mensajes?despues_de_id=${cursorValue}`);
      if (requestGeneration !== generation || String(currentConversation?.id) !== conversationId) return;
      (result.mensajes || []).forEach(appendMessage);
      if (initial) status(threadFeedback, result.mensajes?.length ? "" : "Esta conversación aún no tiene mensajes.");
      else if (result.mensajes?.length) status(threadFeedback, "");
      restartPolling();
    } catch (error) {
      if (error.stale || requestGeneration !== generation) return;
      if ([401, 403, 404].includes(error.status)) return expireSession();
      status(threadFeedback, error.message, "error");
    } finally {
      if (polling) pollBusy = false;
      threadMessages.setAttribute("aria-busy", "false");
    }
  }

  async function openConversation(conversation) {
    saveDraft();
    stopPolling();
    generation += 1;
    const requestGeneration = generation;
    currentConversation = conversation;
    messageCursor = 0;
    messageIds.clear();
    threadMessages.replaceChildren();
    one("seller-thread-title").textContent = conversationTitle(conversation);
    one("seller-thread-state").textContent = conversation.estado === "atendida" ? "Atendida" : "Pendiente";
    one("seller-thread-state").dataset.state = conversation.estado === "atendida" ? "atendida" : "abierta";
    const retired = Boolean(conversation.vehiculo_retirado);
    one("seller-thread-retired").hidden = !retired;
    const vehicleId = conversation.vehiculo_id ?? conversation.vehiculo?.id;
    const vehicleLink = one("seller-thread-vehicle-link");
    vehicleLink.hidden = retired || !Number.isSafeInteger(Number(vehicleId)) || Number(vehicleId) < 1;
    vehicleLink.href = vehicleLink.hidden ? "#" : `/vehiculo/${encodeURIComponent(vehicleId)}`;
    one("seller-chat-empty").hidden = true;
    thread.hidden = false;
    replyForm.hidden = retired;
    replyText.value = drafts.get(String(conversation.id)) || "";
    workspace.classList.add("has-selected");
    status(threadFeedback, "Cargando mensajes…");
    await loadMessages({ initial: true, requestGeneration });
    if (requestGeneration === generation && !retired) replyText.focus({ preventScroll: true });
    else if (requestGeneration === generation) one("seller-chat-back").focus({ preventScroll: true });
  }

  function returnToList() {
    saveDraft();
    generation += 1;
    currentConversation = null;
    thread.hidden = true;
    one("seller-chat-empty").hidden = false;
    workspace.classList.remove("has-selected");
    stopPolling();
    (list.querySelector(".admin-chat-item") || nav).focus();
  }

  function restartPolling() {
    stopPolling();
    const panel = document.querySelector('[data-admin-panel="account-conversations"]');
    if (!currentConversation || !workspace.classList.contains("has-selected") || document.hidden || !panel || panel.hidden) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await loadMessages();
    }, 4000);
  }

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  function expireSession() {
    clearPrivateState();
    status(listFeedback, "Tu sesión venció. Vuelve a iniciar sesión para consultar tus conversaciones.", "error");
    document.dispatchEvent(new Event("seller-account-session-invalid"));
    one("seller-chat-title").focus({ preventScroll: true });
  }

  function clearPrivateState() {
    generation += 1;
    identityGeneration += 1;
    accountId = null;
    requests.forEach((controller) => controller.abort());
    requests.clear();
    stopPolling();
    currentConversation = null;
    conversations = [];
    drafts.clear();
    pendingReplies.clear();
    messageCursor = 0;
    messageIds.clear();
    list.replaceChildren();
    threadMessages.replaceChildren();
    replyText.value = "";
    one("seller-thread-title").textContent = "";
    one("seller-thread-state").textContent = "";
    one("seller-thread-vehicle-link").removeAttribute("href");
    thread.hidden = true;
    one("seller-chat-empty").hidden = false;
    workspace.classList.remove("has-selected");
    status(listFeedback, "");
    status(threadFeedback, "");
  }

  nav.addEventListener("click", () => loadInbox());
  one("seller-chat-load-more").addEventListener("click", () => loadInbox({ append: true }));
  one("seller-chat-back").addEventListener("click", returnToList);
  replyText.addEventListener("input", saveDraft);
  replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sendBusy || !currentConversation || currentConversation.vehiculo_retirado) return;
    let content = replyText.value.trim();
    if (!content) { replyText.focus(); return; }
    const conversationId = String(currentConversation.id);
    let pendingReply = pendingReplies.get(conversationId);
    if (pendingReply?.uncertain && pendingReply.conversationId === conversationId && pendingReply.content !== content) {
      content = pendingReply.content;
      status(threadFeedback, "Comprobando el envío pendiente. El texto nuevo se conserva sin enviar.");
    }
    if (!pendingReply || pendingReply.conversationId !== conversationId || pendingReply.content !== content) {
      pendingReply = { conversationId, content, key: crypto.randomUUID() };
      pendingReplies.set(conversationId, pendingReply);
    }
    const requestGeneration = generation;
    const sendingIdentity = identityGeneration;
    pendingReply.uncertain = true;
    sendBusy = true;
    replyButton.disabled = true;
    replyForm.setAttribute("aria-busy", "true");
    status(threadFeedback, "Enviando respuesta…");
    try {
      const result = await api(`/api/cuenta/chat/vendedor/conversaciones/${encodeURIComponent(conversationId)}/mensajes`, {
        method: "POST", body: { contenido: content }, key: pendingReply.key,
      });
      if (sendingIdentity !== identityGeneration) return;
      pendingReplies.delete(conversationId);
      if (drafts.get(conversationId)?.trim() === content) drafts.delete(conversationId);
      if (requestGeneration !== generation || String(currentConversation?.id) !== conversationId) return;
      appendMessage(result.mensaje);
      if (replyText.value.trim() === content) replyText.value = "";
      status(threadFeedback, replyText.value.trim() ? "Envío pendiente confirmado. Tu texto nuevo sigue sin enviar." : "Respuesta enviada.");
      const index = conversations.findIndex((row) => String(row.id) === conversationId);
      if (index >= 0) {
        conversations[index] = { ...conversations[index], ultimo_mensaje: result.mensaje.contenido, ultimo_remitente: result.mensaje.remitente, ultimo_mensaje_en: result.mensaje.created_at, updated_at: result.mensaje.created_at };
        renderList();
      }
      restartPolling();
    } catch (error) {
      if (error.stale || sendingIdentity !== identityGeneration) return;
      if ([401, 403, 404].includes(error.status)) return expireSession();
      if (error.status && error.status < 500 && error.status !== 429) pendingReplies.delete(conversationId);
      if (requestGeneration !== generation) return;
      const retry = error.status === 429 && error.retryAfter ? ` Espera ${error.retryAfter} segundos.` : "";
      status(threadFeedback, `${error.message}${retry}`, "error");
    } finally { sendBusy = false; replyButton.disabled = false; replyForm.removeAttribute("aria-busy"); }
  });
  document.addEventListener("seller-account-session-ended", clearPrivateState);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else recheckIdentity();
  });
  async function recheckIdentity() {
    if (!accountId) return;
    try {
      const result = await api("/api/cuenta");
      if (result.usuario?.id !== accountId || result.usuario?.rol !== "vendedor") expireSession();
      else restartPolling();
    } catch (error) { if (!error.stale && error.status === 401) expireSession(); }
  }
  window.addEventListener("focus", recheckIdentity);
  document.addEventListener("cuenta-sesion-cambio", expireSession);
})();
