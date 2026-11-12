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
  let inboxGeneration = 0;
  let inboxRevision = 0;
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
    const contact = document.createElement("span");
    contact.className = "admin-chat-contact";
    contact.textContent = `Comprador: ${conversation.nombre_contacto || "Comprador"}`;
    const time = document.createElement("time");
    time.dateTime = conversation.ultimo_mensaje_en || conversation.updated_at || "";
    time.textContent = formatDate(time.dateTime);
    const excerpt = document.createElement("span");
    const state = conversation.vehiculo_retirado ? "Publicación retirada · solo lectura" : conversation.estado === "atendida" ? "Atendida" : "Pendiente";
    excerpt.textContent = `${state} · ${conversation.ultimo_mensaje || "Sin mensajes"}`;
    button.append(title, contact, time, excerpt);
    button.addEventListener("click", () => {
      const latest = conversations.find(row => String(row.id) === button.dataset.conversationId);
      if (latest) openConversation(latest);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const items = [...list.querySelectorAll(".admin-chat-item")];
      const index = items.indexOf(button);
      const next = items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      if (next) { event.preventDefault(); next.focus(); }
    });
    return button;
  }

  function syncSelection() {
    list.querySelectorAll('[role="option"]').forEach(button => {
      button.setAttribute("aria-selected", String(button.dataset.conversationId === String(currentConversation?.id)));
    });
  }

  function renderList() {
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const scroll = list.scrollTop;
    let position = list.firstElementChild;
    const ids = new Set(conversations.map(row => String(row.id)));
    for (const conversation of conversations) {
      const id = String(conversation.id);
      const signature = JSON.stringify(conversation);
      let existing = list.querySelector(`[data-conversation-id="${CSS.escape(id)}"]`);
      if (!existing) existing = renderItem(conversation);
      else if (existing.dataset.signature !== signature) {
        const updated = renderItem(conversation);
        existing.replaceChildren(...updated.childNodes);
      }
      existing.dataset.signature = signature;
      if (existing !== position) list.insertBefore(existing, position);
      position = existing.nextElementSibling;
    }
    [...list.children].forEach(node => { if (!ids.has(node.dataset.conversationId)) node.remove(); });
    syncSelection();
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    list.scrollTop = scroll;
    one("seller-chat-load-more").hidden = !hasMore;
  }

  async function loadInbox({ append = false, refresh = false } = {}) {
    if (listBusy || !panelVisible()) return;
    listBusy = true;
    const ticket = ++inboxGeneration;
    const revision = inboxRevision;
    const epoch = identityGeneration;
    list.setAttribute("aria-busy", "true");
    if (!refresh) status(listFeedback, append ? "Cargando más conversaciones…" : "Cargando conversaciones…");
    try {
      // Refresh the loaded window, including rows pushed onto another page by
      // new activity. Do not discard expanded pages or change the API cursor.
      const remaining = new Set(refresh ? conversations.map(row => String(row.id)) : []);
      const incoming = [];
      let next = append ? cursor : null;
      let result;
      do {
        const query = new URLSearchParams({ limite: "50" });
        if (next) query.set("cursor_id", next);
        result = await api(`/api/cuenta/chat/vendedor/conversaciones?${query}`);
        if (ticket !== inboxGeneration || epoch !== identityGeneration || revision !== inboxRevision || !panelVisible()) return;
        for (const row of result.conversaciones || []) {
          incoming.push(row);
          remaining.delete(String(row.id));
        }
        const previous = next;
        next = result.siguiente_cursor || null;
        if (next === previous) break;
      } while (refresh && remaining.size && result.hay_mas && next);
      conversations = [...new Map((append ? [...conversations, ...incoming] : incoming).map(row => [String(row.id), row])).values()];
      cursor = next;
      hasMore = Boolean(result.hay_mas);
      renderList();
      status(listFeedback, conversations.length ? "" : "Todavía no hay consultas de tus publicaciones.");
    } catch (error) {
      if (error.stale || ticket !== inboxGeneration || epoch !== identityGeneration) return;
      if ([401, 403, 404].includes(error.status)) return expireSession();
      status(listFeedback, error.message, "error");
    } finally {
      if (ticket === inboxGeneration) {
        listBusy = false;
        list.setAttribute("aria-busy", "false");
        restartPolling();
      }
    }
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
      const follow = initial || threadMessages.scrollHeight - threadMessages.clientHeight - threadMessages.scrollTop <= 48;
      (result.mensajes || []).forEach(appendMessage);
      if (follow) threadMessages.scrollTop = threadMessages.scrollHeight;
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
    syncSelection();
    messageCursor = 0;
    messageIds.clear();
    threadMessages.replaceChildren();
    one("seller-thread-title").textContent = conversationTitle(conversation);
    one("seller-thread-contact").textContent = `Comprador: ${conversation.nombre_contacto || "Comprador"}`;
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
    fitWorkspace();
    status(threadFeedback, "Cargando mensajes…");
    await loadMessages({ initial: true, requestGeneration });
    if (requestGeneration === generation && !retired) replyText.focus({ preventScroll: true });
    else if (requestGeneration === generation) one("seller-chat-back").focus({ preventScroll: true });
  }

  function returnToList() {
    saveDraft();
    generation += 1;
    currentConversation = null;
    syncSelection();
    thread.hidden = true;
    one("seller-chat-empty").hidden = false;
    workspace.classList.remove("has-selected");
    restartPolling();
    (list.querySelector(".admin-chat-item") || nav).focus();
  }

  function panelVisible() {
    const panel = document.querySelector('[data-admin-panel="account-conversations"]');
    return !document.hidden && !one("admin-workspace").hidden && panel && !panel.hidden;
  }

  function fitWorkspace() {
    if (!panelVisible()) return;
    const height = window.visualViewport?.height || window.innerHeight;
    const controls = (thread.querySelector('.admin-thread-heading')?.offsetHeight || 0) + replyForm.offsetHeight + threadFeedback.offsetHeight;
    const minimum = Math.min(Math.max(0, height - 16), controls + 64);
    workspace.style.setProperty("--seller-chat-height", `${Math.max(minimum, height - Math.max(0, workspace.getBoundingClientRect().top) - 16)}px`);
    // A virtual keyboard can leave less room than the header and editor need.
    // Keep usable controls and let the document bring the focused editor into view.
    if (document.activeElement === replyText && replyText.getBoundingClientRect().bottom > height) {
      replyText.scrollIntoView({ block: "end", behavior: "instant" });
    }
  }

  function restartPolling() {
    stopPolling();
    if (!accountId || !panelVisible()) return;
    fitWorkspace();
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!panelVisible()) return;
      await loadInbox({ refresh: true });
      if (panelVisible()) await loadMessages();
      restartPolling();
    }, 4000);
  }

  window.addEventListener("resize", fitWorkspace);
  window.visualViewport?.addEventListener("resize", fitWorkspace);
  new MutationObserver(() => {
    if (panelVisible()) { fitWorkspace(); restartPolling(); }
    else stopPolling();
  }).observe(document.querySelector('[data-admin-panel="account-conversations"]'), { attributes: true, attributeFilter: ["hidden"] });

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  function expireSession() {
    clearPrivateState();
    status(listFeedback, "Tu sesión venció. Vuelve a iniciar sesión para consultar tus conversaciones.", "error");
    document.dispatchEvent(new Event("seller-account-session-invalid"));
    one("seller-chat-title").focus({ preventScroll: true });
  }

  function clearPrivateState() {
    generation += 1;
    inboxGeneration += 1;
    listBusy = false;
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
      threadMessages.scrollTop = threadMessages.scrollHeight;
      inboxRevision += 1;
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
