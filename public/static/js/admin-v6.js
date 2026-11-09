"use strict";

(() => {
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const body = document.body;
  const csrfMeta = one('meta[name="csrf-token"]');
  const csrf = () => csrfMeta?.content || "";
  const apiRoot = "/api";
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 0 });
  const readonly = body.dataset.readOnly === "true";
  const chatEnabled = body.dataset.chatEnabled === "true";
  const vehicleFieldValues = window.AdminV6FieldValues;
  const historicalVehicleSelects = ["transmision", "combustible"];

  const auth = one("#admin-auth");
  const workspace = one("#admin-workspace");
  const loginForm = one("#admin-login-form");
  const loginPassword = one("#admin-password");
  const loginError = one("#admin-login-error");
  const loginStatus = one("#admin-login-status");
  const logout = one("#admin-logout");
  const mobileMenuButton = one("#admin-mobile-menu");
  const adminNavigation = one("#admin-navigation");
  const statusBox = one("#admin-status");
  const inventoryList = one("#admin-inventory-list");
  const inventoryCards = one("#admin-inventory-mobile");
  const inventoryFeedback = one("#inventory-feedback");
  const emptyInventory = one("#admin-inventory-empty");
  const form = one("#admin-vehicle-form");
  const formError = one("#vehicle-form-error");
  const description = one("#vehicle-description");
  const photoInput = one("#vehicle-photo-input");
  const photoConfirm = one("#vehicle-photo-upload-confirm");
  const deleteDialog = one("#admin-photo-delete-dialog");
  const inboxList = one("#admin-chat-list");
  const threadMessages = one("#admin-thread-messages");
  const replyForm = one("#admin-reply-form");

  let csrfToken = csrf();
  let authenticated = false;
  let readOnly = readonly;
  let vehicles = [];
  let editingId = null;
  let savedVehicle = null;
  let pendingCreate = null;
  let pendingPhoto = null;
  let deleteTarget = null;
  let currentConversation = null;
  let inboxCursor = null;
  let hasMoreInbox = false;
  let inboxBusy = false;
  let threadGeneration = 0;
  let messageCursor = 0;
  let pollTimer = null;
  let pollBusy = false;
  let pendingReply = null;
  let inventoryGeneration = 0;
  const messageIds = new Set();
  const fieldErrorNames = new Set();
  const drafts = new Map();
  let savedFormSnapshot = null;
  let photoPreparing = false;
  let photoDraftGeneration = 0;

  function hasPendingVehicleChanges() {
    return authenticated && currentView() === "vehicle-form" &&
      (photoPreparing || Boolean(pendingPhoto) || (savedFormSnapshot !== null && JSON.stringify(formData()) !== savedFormSnapshot));
  }

  function confirmVehicleDeparture() {
    return !hasPendingVehicleChanges() || window.confirm("Hay cambios o una fotografía sin guardar. ¿Querés descartarlos y salir?");
  }

  window.addEventListener("beforeunload", (event) => {
    if (!hasPendingVehicleChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  function setStatus(message, type = "success") {
    if (!statusBox) return;
    statusBox.textContent = message || "";
    statusBox.dataset.type = type;
    statusBox.hidden = !message;
  }

  function setLoginError(message) {
    loginError.textContent = message || "";
    loginError.hidden = !message;
    if (message) loginError.focus();
  }

  function closeMobileNavigation({ restoreFocus = false } = {}) {
    if (!mobileMenuButton || !adminNavigation) return;
    const estabaAbierta = adminNavigation.classList.contains("is-open");
    adminNavigation.classList.remove("is-open");
    mobileMenuButton.setAttribute("aria-expanded", "false");
    mobileMenuButton.setAttribute("aria-label", "Mostrar navegación");
    if (restoreFocus && estabaAbierta && !mobileMenuButton.hidden) mobileMenuButton.focus();
  }

  function syncMobileNavigation() {
    if (!mobileMenuButton || !adminNavigation) return;
    const esMovil = window.matchMedia("(max-width: 820px)").matches;
    mobileMenuButton.hidden = !authenticated || !esMovil;
    if (!authenticated || !esMovil) closeMobileNavigation();
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = new Headers(options.headers || {});
    const init = { method, credentials: "same-origin", cache: "no-store", headers };
    if (options.body !== undefined) {
      if (options.body instanceof FormData) init.body = options.body;
      else {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(options.body);
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
      if (!csrfToken) throw new Error("La sesión de seguridad no está disponible. Recargá esta página.");
      headers.set("X-CSRF-Token", csrfToken);
    }
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
    init.signal = controller.signal;
    try {
      let response;
      try { response = await fetch(`${apiRoot}${path}`, init); }
      catch { throw new Error("No pudimos comunicarnos con el servidor. Revisá la conexión e intentá de nuevo."); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("El servidor devolvió una respuesta no válida."); }
      if (!response.ok || data.ok !== true) {
        const error = new Error(data.mensaje || "No se pudo completar la operación. Intentá de nuevo.");
        error.status = response.status;
        error.fields = data.errores || {};
        error.retryAfter = response.headers.get("Retry-After");
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  function setAuthenticated(value) {
    authenticated = Boolean(value) && !readOnly;
    auth.hidden = authenticated || readOnly;
    workspace.hidden = !authenticated;
    logout.hidden = !authenticated;
    syncMobileNavigation();
    if (authenticated) {
      loadInventory();
      if (chatEnabled && currentView() === "conversations") loadInbox();
    } else {
      stopPolling();
      currentConversation = null;
      drafts.clear();
      pendingReply = null;
    }
  }

  function currentView() {
    return one(".admin-view:not([hidden])")?.dataset.adminPanel || "inventory";
  }

  async function checkSession() {
    if (readOnly) return;
    try {
      const state = await request("/admin/session");
      readOnly = Boolean(state.solo_lectura);
      if (readOnly) {
        one("#admin-readonly").hidden = false;
        auth.hidden = true;
        workspace.hidden = true;
        return;
      }
      setAuthenticated(Boolean(state.autenticado));
      if (!state.autenticado) loginPassword.focus();
    } catch (error) {
      setLoginError(error.message);
    }
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (readOnly) return;
    const button = one('button[type="submit"]', loginForm);
    setLoginError("");
    button.disabled = true;
    loginForm.setAttribute("aria-busy", "true");
    loginStatus.textContent = "Verificando acceso…";
    try {
      const result = await request("/admin/login", { method: "POST", body: { password: loginPassword.value } });
      if (result.csrf_token) {
        csrfToken = result.csrf_token;
        csrfMeta.content = csrfToken;
      }
      loginForm.reset();
      setAuthenticated(true);
      showView("inventory");
      one('[data-admin-view="inventory"]')?.focus();
    } catch (error) {
      if (error.status === 503 && /únicamente consultar/i.test(error.message)) {
        readOnly = true;
        one("#admin-readonly").hidden = false;
        auth.hidden = true;
        return;
      }
      setLoginError(error.status === 429 ? `${error.message}${error.retryAfter ? ` Esperá ${error.retryAfter} segundos.` : ""}` : error.message);
      if (error.status === 401) loginPassword.select();
    } finally {
      button.disabled = false;
      loginForm.removeAttribute("aria-busy");
      loginStatus.textContent = "";
    }
  });

  async function logoutAdmin() {
    if (!authenticated) return;
    if (!confirmVehicleDeparture()) return;
    stopPolling();
    try {
      const result = await request("/admin/logout", { method: "POST", body: {} });
      if (result.csrf_token) {
        csrfToken = result.csrf_token;
        csrfMeta.content = csrfToken;
      }
    } catch (error) {
      setStatus(error.message, "error");
      if (error.status !== 401) return;
    }
    setAuthenticated(false);
    clearPhotoDraft();
    showView("inventory");
    setLoginError("");
    loginPassword.value = "";
    loginPassword.focus();
  }

  all("[data-admin-logout]").forEach((button) => button.addEventListener("click", logoutAdmin));
  logout?.addEventListener("click", logoutAdmin);

  function showView(view) {
    const validView = view === "conversations" && !chatEnabled ? "inventory" : view;
    all("[data-admin-panel]").forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== validView; });
    all("[data-admin-view]").forEach((button) => {
      const active = button.dataset.adminView === validView;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    closeMobileNavigation();
    if (validView === "inventory") loadInventory();
    if (validView === "conversations") { loadInbox(); restartPolling(); }
    else stopPolling();
    if (validView === "vehicle-form") one("#vehicle-brand")?.focus();
  }

  all("[data-admin-view]").forEach((button) => button.addEventListener("click", () => {
    if (!authenticated) return;
    if ((button.dataset.adminView !== "vehicle-form" || button.hasAttribute("data-new-vehicle")) && !confirmVehicleDeparture()) return;
    if (currentView() === "vehicle-form" && button.dataset.adminView !== "vehicle-form") clearPhotoDraft();
    const cerrarEnMovil = !mobileMenuButton.hidden;
    if (button.hasAttribute("data-new-vehicle")) resetVehicleForm();
    showView(button.dataset.adminView);
    if (cerrarEnMovil && button.dataset.adminView !== "vehicle-form") {
      const titulo = one(button.dataset.adminView === "conversations" ? "#conversations-title" : "#inventory-title");
      titulo?.focus({ preventScroll: true });
    }
  }));

  mobileMenuButton?.addEventListener("click", () => {
    if (!authenticated || mobileMenuButton.hidden) return;
    const open = mobileMenuButton.getAttribute("aria-expanded") !== "true";
    if (!open) {
      closeMobileNavigation({ restoreFocus: true });
      return;
    }
    adminNavigation.classList.add("is-open");
    mobileMenuButton.setAttribute("aria-expanded", "true");
    mobileMenuButton.setAttribute("aria-label", "Ocultar navegación");
    one(".admin-nav-link:not([hidden])", adminNavigation)?.focus();
  });
  document.addEventListener("click", (event) => {
    if (adminNavigation?.classList.contains("is-open") && !adminNavigation.contains(event.target) && !mobileMenuButton?.contains(event.target)) {
      closeMobileNavigation();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenuButton?.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      closeMobileNavigation({ restoreFocus: true });
    }
  });
  window.addEventListener("resize", syncMobileNavigation);

  function safePhotoUrl(value) {
    if (typeof value !== "string" || !value) return "/static/img/vehiculo.svg";
    try {
      const url = new URL(value, location.origin);
      return url.protocol === "https:" || (url.protocol === "http:" && url.origin === location.origin) ? url.href : "/static/img/vehiculo.svg";
    } catch { return "/static/img/vehiculo.svg"; }
  }

  function vehiclePhoto(vehicle) {
    const photo = [...(vehicle.fotografias || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))[0];
    const image = document.createElement("img");
    image.className = "admin-vehicle-photo";
    image.src = safePhotoUrl(photo?.url);
    image.alt = photo ? `Fotografía de ${vehicle.marca} ${vehicle.modelo}` : "Sin fotografía disponible";
    image.loading = "lazy";
    image.onerror = () => { image.onerror = null; image.src = "/static/img/vehiculo.svg"; };
    return image;
  }

  function vehicleTitle(vehicle) { return `${vehicle.marca || ""} ${vehicle.modelo || ""}`.trim(); }
  function vehicleMeta(vehicle) { return [vehicle.anio, vehicle.ubicacion].filter(Boolean).join(" · "); }

  function makeVehicleInfo(vehicle) {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-vehicle-cell";
    wrapper.append(vehiclePhoto(vehicle));
    const info = document.createElement("div");
    const title = document.createElement("a");
    title.className = "admin-vehicle-name";
    title.href = `/vehiculo/${encodeURIComponent(vehicle.id)}`;
    title.textContent = vehicleTitle(vehicle);
    const meta = document.createElement("span");
    meta.className = "admin-vehicle-meta";
    meta.textContent = vehicleMeta(vehicle);
    info.append(title, meta);
    wrapper.append(info);
    return wrapper;
  }

  function stateBadge(disponibilidad) {
    const badge = document.createElement("span");
    const vendido = disponibilidad === "vendido";
    badge.className = `admin-state-pill${vendido ? " is-sold" : ""}`;
    badge.textContent = vendido ? "Vendido" : "Disponible";
    return badge;
  }

  function actionButton(label, callback, variant = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-button admin-button-${variant}`;
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
  }

  function iconAction(label, iconName, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-icon-button";
    button.setAttribute("aria-label", label);
    button.append(window.AppIcons.create(iconName, { size: 16 }));
    button.addEventListener("click", callback);
    return button;
  }

  function makeVehicleRow(vehicle) {
    const row = document.createElement("tr");
    const infoCell = document.createElement("td");
    infoCell.append(makeVehicleInfo(vehicle));
    const priceCell = document.createElement("td");
    priceCell.className = "admin-price";
    priceCell.textContent = money.format((vehicle.precio_centavos || 0) / 100);
    const stateCell = document.createElement("td");
    stateCell.append(stateBadge(vehicle.disponibilidad));
    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "admin-table-actions";
    actions.append(actionButton("Editar", () => editVehicle(vehicle.id)));
    actions.append(actionButton("Fotos", () => openPhotos(vehicle.id)));
    actions.append(actionButton(vehicle.disponibilidad === "vendido" ? "Marcar disponible" : "Marcar vendido", () => toggleAvailability(vehicle), "secondary"));
    actionsCell.append(actions);
    row.append(infoCell, priceCell, stateCell, actionsCell);
    return row;
  }

  function makeMobileVehicle(vehicle) {
    const article = document.createElement("article");
    article.className = "admin-mobile-card";
    const top = document.createElement("div");
    top.className = "admin-mobile-card-top";
    top.append(vehiclePhoto(vehicle));
    const text = document.createElement("div");
    const title = document.createElement("a");
    title.className = "admin-vehicle-name";
    title.href = `/vehiculo/${encodeURIComponent(vehicle.id)}`;
    title.textContent = vehicleTitle(vehicle);
    const meta = document.createElement("span");
    meta.className = "admin-vehicle-meta";
    meta.textContent = vehicleMeta(vehicle);
    const price = document.createElement("strong");
    price.className = "admin-price";
    price.textContent = money.format((vehicle.precio_centavos || 0) / 100);
    text.append(title, meta, price, stateBadge(vehicle.disponibilidad));
    top.append(text);
    const actions = document.createElement("div");
    actions.className = "admin-mobile-actions";
    actions.append(actionButton("Editar vehículo", () => editVehicle(vehicle.id)));
    actions.append(actionButton("Fotografías", () => openPhotos(vehicle.id)));
    actions.append(actionButton(vehicle.disponibilidad === "vendido" ? "Marcar disponible" : "Marcar vendido", () => toggleAvailability(vehicle), "secondary"));
    actions.lastElementChild.classList.add("availability-toggle");
    article.append(top, actions);
    return article;
  }

  function renderInventory(list) {
    inventoryList.replaceChildren();
    inventoryCards.replaceChildren();
    list.forEach((vehicle) => {
      inventoryList.append(makeVehicleRow(vehicle));
      inventoryCards.append(makeMobileVehicle(vehicle));
    });
    const empty = list.length === 0;
    emptyInventory.hidden = !empty;
    inventoryFeedback.textContent = empty ? "" : "";
    one("#inventory-result-label").textContent = `${list.length} ${list.length === 1 ? "publicación" : "publicaciones"} encontradas`;
  }

  async function loadInventory() {
    if (!authenticated || currentView() !== "inventory") return;
    const generation = ++inventoryGeneration;
    inventoryFeedback.textContent = "Cargando publicaciones…";
    const params = new URLSearchParams(new FormData(one("#admin-inventory-filters")));
    const query = params.toString();
    try {
      const result = await request(`/vehiculos${query ? `?${query}` : ""}`);
      if (generation !== inventoryGeneration) return;
      vehicles = Array.isArray(result.vehiculos) ? result.vehiculos : [];
      renderInventory(vehicles);
    } catch (error) {
      if (generation !== inventoryGeneration) return;
      vehicles = [];
      renderInventory([]);
      emptyInventory.hidden = true;
      inventoryFeedback.textContent = error.status === 401 ? "Tu sesión administrativa venció. Ingresá nuevamente." : error.message;
      if (error.status === 401) setAuthenticated(false);
    }
  }

  one("#admin-inventory-filters")?.addEventListener("submit", (event) => { event.preventDefault(); loadInventory(); });
  one("#admin-clear-filters")?.addEventListener("click", () => { one("#admin-inventory-filters").reset(); loadInventory(); });

  async function toggleAvailability(vehicle) {
    const next = vehicle.disponibilidad === "vendido" ? "disponible" : "vendido";
    try {
      await request(`/vehiculos/${encodeURIComponent(vehicle.id)}/disponibilidad`, { method: "PATCH", body: { disponibilidad: next } });
      setStatus(`Disponibilidad actualizada: ${next === "vendido" ? "vendido" : "disponible"}.`);
      await loadInventory();
    } catch (error) {
      setStatus(error.status === 401 ? "Tu sesión administrativa venció." : error.message, "error");
      if (error.status === 401) setAuthenticated(false);
    }
  }

  function clearFormErrors() {
    fieldErrorNames.clear();
    formError.textContent = "";
    formError.hidden = true;
    all("[data-error-for]").forEach((node) => {
      node.textContent = "";
      const field = form.elements.namedItem(node.dataset.errorFor);
      if (!field || !node.id) return;
      const remaining = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== node.id);
      if (remaining.length) field.setAttribute("aria-describedby", remaining.join(" "));
      else field.removeAttribute("aria-describedby");
    });
    all("[aria-invalid='true']", form).forEach((field) => { field.removeAttribute("aria-invalid"); });
  }

  function clearFieldError(field) {
    if (!field?.name || !fieldErrorNames.has(field.name)) return;
    const note = one(`[data-error-for="${CSS.escape(field.name)}"]`, form);
    if (!note) return;
    note.textContent = "";
    if (note.id) {
      const remaining = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== note.id);
      if (remaining.length) field.setAttribute("aria-describedby", remaining.join(" "));
      else field.removeAttribute("aria-describedby");
    }
    field.removeAttribute("aria-invalid");
    fieldErrorNames.delete(field.name);
  }

  function recoverFormError(event) {
    if (!fieldErrorNames.has(event.target?.name)) return;
    clearFieldError(event.target);
    if (fieldErrorNames.size === 0) {
      formError.textContent = "";
      formError.hidden = true;
    }
  }
  form?.addEventListener("input", recoverFormError);
  form?.addEventListener("change", recoverFormError);

  function showFormError(message, fields = {}) {
    clearFormErrors();
    if (Object.keys(fields).length) {
      let first = null;
      Object.entries(fields).forEach(([name, text]) => {
        const field = form.elements.namedItem(name);
        const note = one(`[data-error-for="${CSS.escape(name)}"]`, form);
        if (field && note) {
          note.id ||= `vehicle-error-${name}`;
          const descriptions = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
          if (!descriptions.includes(note.id)) descriptions.push(note.id);
          field.setAttribute("aria-describedby", descriptions.join(" "));
          field.setAttribute("aria-invalid", "true");
          note.textContent = text;
          fieldErrorNames.add(name);
          first ||= field;
        }
      });
      formError.textContent = message || "Revisá los campos indicados.";
      formError.hidden = false;
      (first || formError).focus();
    } else {
      formError.textContent = message;
      formError.hidden = !message;
      if (message) formError.focus();
    }
  }

  function updateDescriptionCount() {
    one("#vehicle-description-count").textContent = `${description.value.length} / 1000`;
  }
  description.addEventListener("input", updateDescriptionCount);

  function clearPhotoDraft() {
    photoDraftGeneration += 1;
    photoPreparing = false;
    const preview = one("#vehicle-photo-preview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    preview.dataset.objectUrl = "";
    pendingPhoto = null;
    one("#vehicle-photo-pending").hidden = true;
    one("#vehicle-photo-preview").removeAttribute("src");
    if (photoInput) photoInput.disabled = false;
    if (photoConfirm) photoConfirm.disabled = false;
    if (photoInput) {
      photoInput.value = "";
      photoInput.dataset.replacingId = "";
    }
  }

  function resetVehicleForm() {
    editingId = null;
    savedVehicle = null;
    pendingCreate = null;
    clearFormErrors();
    historicalVehicleSelects.forEach((name) => vehicleFieldValues.clearHistoricalValue(form.elements.namedItem(name)));
    form.reset();
    one("#vehicle-form-title").textContent = "Registrar vehículo";
    one("#vehicle-form-subtitle").textContent = "Completá los datos para registrar un vehículo.";
    one("#vehicle-basic-title").textContent = "Datos principales";
    one("#vehicle-photo-upload").hidden = true;
    one("#vehicle-photo-list").replaceChildren();
    one("#vehicle-photo-empty").hidden = false;
    one("#vehicle-photo-feedback").textContent = "Guardá el vehículo para habilitar la carga de fotografías.";
    one(".admin-desktop-save span").textContent = "Publicar vehículo";
    one(".admin-mobile-form-actions span").textContent = "Guardar vehículo";
    one(".admin-photo-card").classList.add("is-unavailable");
    clearPhotoDraft();
    updateDescriptionCount();
    setStatus("");
    savedFormSnapshot = JSON.stringify(formData());
  }

  function populateForm(vehicle) {
    editingId = vehicle.id;
    savedVehicle = vehicle;
    clearFormErrors();
    historicalVehicleSelects.forEach((name) => vehicleFieldValues.clearHistoricalValue(form.elements.namedItem(name)));
    form.reset();
    ["marca", "modelo", "anio", "kilometraje", "ubicacion", "descripcion", "disponibilidad", "color", "placa", "tipo_vehiculo"].forEach((name) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = vehicle[name] ?? "";
    });
    historicalVehicleSelects.forEach((name) => {
      vehicleFieldValues.setPreservingCurrentValue(form.elements.namedItem(name), vehicle[name]);
    });
    ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia"].forEach((name) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = vehicle[name] === null || vehicle[name] === undefined ? "" : String(vehicle[name]);
    });
    form.elements.precio_venta.value = `${Math.floor(vehicle.precio_centavos / 100)}.${String(vehicle.precio_centavos % 100).padStart(2, "0")}`;
    one("#vehicle-form-title").textContent = "Editar vehículo";
    one("#vehicle-form-subtitle").textContent = `${vehicleTitle(vehicle)} · N.º ${vehicle.id}`;
    one("#vehicle-basic-title").textContent = "Datos principales";
    one(".admin-desktop-save span").textContent = "Guardar cambios";
    one(".admin-mobile-form-actions span").textContent = "Guardar cambios";
    one(".admin-photo-card").classList.remove("is-unavailable");
    one("#vehicle-photo-upload").hidden = false;
    one("#vehicle-photo-feedback").textContent = "Las fotografías se gestionan por separado de los datos del vehículo.";
    renderPhotos(vehicle);
    updateDescriptionCount();
    savedFormSnapshot = JSON.stringify(formData());
  }

  async function editVehicle(id) {
    const vehicle = vehicles.find((item) => String(item.id) === String(id));
    if (!vehicle) return;
    populateForm(vehicle);
    showView("vehicle-form");
    one("#vehicle-brand")?.focus();
  }

  function formData() {
    const values = Object.fromEntries(new FormData(form));
    ["color", "placa", "tipo_vehiculo"].forEach((name) => { values[name] = values[name]?.trim() || null; });
    historicalVehicleSelects.forEach((name) => {
      values[name] = vehicleFieldValues.serializedValue(form.elements.namedItem(name));
    });
    ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia"].forEach((name) => {
      values[name] = values[name] === "" ? null : values[name] === "true";
    });
    return values;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authenticated) return;
    clearFormErrors();
    const data = formData();
    const fingerprint = JSON.stringify(data);
    let dataToSave = data;
    if (editingId === null && pendingCreate?.uncertain) {
      dataToSave = pendingCreate.data;
      Object.entries(dataToSave).forEach(([name, value]) => {
        const field = form.elements.namedItem(name);
        if (field) field.value = value === null ? "" : String(value);
      });
      updateDescriptionCount();
      setStatus("Verificando el envío anterior con la misma clave segura.");
    } else if (editingId === null && (!pendingCreate || pendingCreate.fingerprint !== fingerprint)) {
      pendingCreate = { fingerprint, data, key: crypto.randomUUID(), uncertain: false };
    }
    const finalFingerprint = JSON.stringify(dataToSave);
    if (editingId === null && pendingCreate.fingerprint !== finalFingerprint) {
      showFormError("No se pudo confirmar el registro anterior. Reintentá con los mismos datos para evitar una publicación duplicada.");
      return;
    }
    const buttons = all('button[type="submit"]', one("#admin-vehicle-form").parentElement.parentElement);
    buttons.forEach((button) => { button.disabled = true; });
    form.setAttribute("aria-busy", "true");
    setStatus("Guardando vehículo…", "loading");
    try {
      const isNew = editingId === null;
      const result = await request(isNew ? "/vehiculos" : `/vehiculos/${encodeURIComponent(editingId)}`, {
        method: isNew ? "POST" : "PUT", body: { vehiculo: dataToSave }, idempotencyKey: isNew ? pendingCreate.key : undefined,
      });
      savedVehicle = result.vehiculo;
      historicalVehicleSelects.forEach((name) => {
        vehicleFieldValues.setPreservingCurrentValue(form.elements.namedItem(name), savedVehicle[name]);
      });
      editingId = savedVehicle.id;
      savedFormSnapshot = fingerprint;
      pendingCreate = null;
      one("#vehicle-form-title").textContent = "Editar vehículo";
      one("#vehicle-form-subtitle").textContent = `${vehicleTitle(savedVehicle)} · N.º ${savedVehicle.id}`;
      one(".admin-desktop-save span").textContent = "Guardar cambios";
      one(".admin-mobile-form-actions span").textContent = "Guardar cambios";
      one(".admin-photo-card").classList.remove("is-unavailable");
      one("#vehicle-photo-upload").hidden = false;
      one("#vehicle-photo-feedback").textContent = isNew
        ? "Vehículo guardado. Ahora podés agregar fotografías, o hacerlo más tarde desde el inventario."
        : "Los datos del vehículo se guardaron. Las fotografías permanecen independientes.";
      renderPhotos(savedVehicle);
      await loadInventory();
      setStatus(isNew ? "Vehículo registrado en el catálogo." : "Cambios guardados.");
      if (isNew) one("#vehicle-photos-title").focus?.();
    } catch (error) {
      if (editingId === null && pendingCreate && (!error.status || error.status >= 500)) pendingCreate.uncertain = true;
      setStatus("");
      showFormError(error.message, error.fields);
    } finally {
      form.removeAttribute("aria-busy");
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  function openPhotos(id) {
    const vehicle = vehicles.find((item) => String(item.id) === String(id));
    if (!vehicle) return;
    populateForm(vehicle);
    showView("vehicle-form");
    one("#vehicle-photos-title").scrollIntoView({ behavior: "smooth", block: "start" });
    one("#vehicle-photo-upload")?.focus();
  }

  function renderPhotos(vehicle) {
    const list = one("#vehicle-photo-list");
    list.replaceChildren();
    const photos = [...(vehicle?.fotografias || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    one("#vehicle-photo-empty").hidden = photos.length > 0;
    one("#vehicle-photo-upload").hidden = !vehicle || photos.length >= 5;
    photos.forEach((photo, index) => {
      const figure = document.createElement("figure");
      figure.className = "admin-photo-item";
      const image = document.createElement("img");
      image.src = safePhotoUrl(photo.url);
      image.alt = `Fotografía ${index + 1} de ${vehicleTitle(vehicle)}`;
      image.loading = "lazy";
      image.onerror = () => { image.onerror = null; image.src = "/static/img/vehiculo.svg"; };
      const caption = document.createElement("figcaption");
      const label = document.createElement("span");
      label.textContent = `Foto ${index + 1}`;
      const actions = document.createElement("div");
      const replace = document.createElement("button");
      replace.type = "button";
      replace.textContent = "Sustituir";
      replace.addEventListener("click", () => choosePhoto(photo.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", () => confirmDeletePhoto(photo, index + 1));
      actions.append(replace, remove);
      caption.append(label, actions);
      figure.append(image, caption);
      list.append(figure);
    });
  }

  function choosePhoto(replacingId = null) {
    if (!authenticated || !savedVehicle || pendingPhoto) return;
    photoInput.dataset.replacingId = replacingId || "";
    photoInput.click();
  }

  one("#vehicle-photo-upload")?.addEventListener("click", (event) => {
    if (event.target.closest("input")) return;
    if (!savedVehicle || pendingPhoto) return;
  });
  one("#vehicle-photo-upload")?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || event.target !== one("#vehicle-photo-upload")) return;
    event.preventDefault();
    if (!savedVehicle || pendingPhoto) return;
    photoInput.dataset.replacingId = "";
    photoInput.click();
  });
  photoInput?.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    const replacingId = photoInput.dataset.replacingId || null;
    photoInput.value = "";
    if (!file || !savedVehicle || !window.Fotografias) return;
    const generation = ++photoDraftGeneration;
    photoPreparing = true;
    photoInput.disabled = true;
    one("#vehicle-photo-feedback").textContent = "Preparando fotografía…";
    try {
      const prepared = await window.Fotografias.preparar(file);
      if (generation !== photoDraftGeneration) return;
      pendingPhoto = { file: prepared.archivo, key: crypto.randomUUID(), replacingId };
      const preview = one("#vehicle-photo-preview");
      preview.src = URL.createObjectURL(prepared.archivo);
      preview.dataset.objectUrl = preview.src;
      one("#vehicle-photo-pending-name").textContent = file.name;
      one("#vehicle-photo-pending-detail").textContent = `${prepared.ancho} × ${prepared.alto} px · ${Math.ceil(prepared.archivo.size / 1000)} KB. Revisá la vista previa antes de confirmar.`;
      one("#vehicle-photo-pending").hidden = false;
      one("#vehicle-photo-feedback").textContent = "La vista previa no se ha subido todavía.";
    } catch (error) {
      if (generation !== photoDraftGeneration) return;
      photoInput.disabled = false;
      one("#vehicle-photo-feedback").textContent = error.message;
    } finally {
      if (generation === photoDraftGeneration) photoPreparing = false;
    }
  });

  photoConfirm?.addEventListener("click", async () => {
    if (!pendingPhoto || !savedVehicle) return;
    photoConfirm.disabled = true;
    photoInput.disabled = true;
    one("#vehicle-photo-feedback").textContent = "Guardando fotografía…";
    const formData = new FormData();
    formData.append("fotografia", pendingPhoto.file);
    const replacingId = pendingPhoto.replacingId;
    try {
      const result = await request(`/vehiculos/${encodeURIComponent(savedVehicle.id)}/fotografias${replacingId ? `/${encodeURIComponent(replacingId)}` : ""}`, {
        method: replacingId ? "PUT" : "POST", body: formData, idempotencyKey: pendingPhoto.key,
      });
      savedVehicle = { ...savedVehicle, fotografias: result.fotografias || [] };
      vehicles = vehicles.map((item) => String(item.id) === String(savedVehicle.id) ? savedVehicle : item);
      clearPhotoDraft();
      renderPhotos(savedVehicle);
      one("#vehicle-photo-feedback").textContent = result.advertencia || "Fotografía guardada.";
      await loadInventory();
    } catch (error) {
      one("#vehicle-photo-feedback").textContent = `${error.message} La vista previa y la clave de reintento se conservaron.`;
      photoConfirm.disabled = false;
    } finally { if (!pendingPhoto) photoInput.disabled = false; }
  });

  function confirmDeletePhoto(photo, position) {
    deleteTarget = photo;
    one("#admin-photo-delete-title").textContent = `Eliminar fotografía ${position}`;
    one("#admin-photo-delete-confirm").disabled = false;
    deleteDialog.showModal();
    one("#admin-photo-delete-cancel").focus();
  }

  one("#admin-photo-delete-confirm")?.addEventListener("click", async () => {
    if (!deleteTarget || !savedVehicle) return;
    const button = one("#admin-photo-delete-confirm");
    button.disabled = true;
    try {
      const result = await request(`/vehiculos/${encodeURIComponent(savedVehicle.id)}/fotografias/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      savedVehicle = { ...savedVehicle, fotografias: result.fotografias || [] };
      vehicles = vehicles.map((item) => String(item.id) === String(savedVehicle.id) ? savedVehicle : item);
      deleteDialog.close();
      deleteTarget = null;
      renderPhotos(savedVehicle);
      one("#vehicle-photo-feedback").textContent = result.advertencia || "Fotografía eliminada.";
      await loadInventory();
    } catch (error) {
      one("#vehicle-photo-feedback").textContent = error.message;
      button.disabled = false;
    }
  });

  deleteDialog?.addEventListener("close", () => { deleteTarget = null; });
  one("#admin-photo-delete-cancel")?.addEventListener("click", () => { deleteTarget = null; });

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-NI", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function makeInboxItem(conversation) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-chat-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(String(currentConversation?.id) === String(conversation.id)));
    button.dataset.conversationId = conversation.id;
    const title = document.createElement("strong");
    title.textContent = `${conversation.marca || "Vehículo"} ${conversation.modelo || ""}`.trim();
    const time = document.createElement("time");
    time.textContent = formatTime(conversation.ultimo_mensaje_en || conversation.updated_at);
    const excerpt = document.createElement("span");
    excerpt.textContent = `${conversation.estado === "atendida" ? "Atendida" : "Pendiente"} · ${conversation.ultimo_mensaje || "Sin mensajes"}`;
    button.append(title, time, excerpt);
    button.addEventListener("click", () => selectConversation(conversation));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const options = all(".admin-chat-item", inboxList);
      const current = options.indexOf(button);
      options[(current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
    });
    return button;
  }

  function renderInbox(items, append = false) {
    if (!append) inboxList.replaceChildren();
    items.forEach((item) => {
      const existing = one(`[data-conversation-id="${CSS.escape(String(item.id))}"]`, inboxList);
      const node = makeInboxItem(item);
      if (existing) existing.replaceWith(node);
      else inboxList.append(node);
    });
    one("#admin-chat-load-more").hidden = !hasMoreInbox;
  }

  async function loadInbox({ append = false } = {}) {
    if (!authenticated || !chatEnabled || inboxBusy) return;
    if (!append) inboxCursor = null;
    inboxBusy = true;
    const params = new URLSearchParams();
    const status = one("#admin-chat-status").value;
    if (status) params.set("estado", status);
    if (append && inboxCursor) params.set("cursor_id", inboxCursor);
    one("#admin-chat-list-feedback").textContent = append ? "Cargando más conversaciones…" : "Cargando conversaciones…";
    try {
      const query = params.toString();
      const result = await request(`/admin/chat/conversaciones${query ? `?${query}` : ""}`);
      hasMoreInbox = Boolean(result.hay_mas);
      inboxCursor = result.siguiente_cursor || null;
      renderInbox(result.conversaciones || [], append);
      one("#admin-chat-list-feedback").textContent = result.conversaciones?.length || append ? "" : "No hay conversaciones en este filtro.";
    } catch (error) {
      one("#admin-chat-list-feedback").textContent = error.status === 401 ? "Tu sesión administrativa venció." : error.message;
      if (error.status === 401) setAuthenticated(false);
    } finally { inboxBusy = false; }
  }

  one("#admin-chat-status")?.addEventListener("change", () => loadInbox());
  one("#admin-chat-load-more")?.addEventListener("click", () => loadInbox({ append: true }));

  function appendMessage(message, animateNew = false) {
    const id = String(message.id);
    if (messageIds.has(id)) return;
    messageIds.add(id);
    const node = document.createElement("article");
    node.className = `admin-message${message.remitente === "administrador" ? " is-admin" : ""}${animateNew ? " is-entering" : ""}`;
    node.dataset.messageId = id;
    const content = document.createElement("span");
    content.textContent = message.contenido || "";
    const time = document.createElement("time");
    time.textContent = formatTime(message.created_at);
    node.append(content, time);
    threadMessages.append(node);
    const parsedId = Number(message.id);
    if (Number.isSafeInteger(parsedId)) messageCursor = Math.max(messageCursor, parsedId);
    threadMessages.scrollTop = threadMessages.scrollHeight;
  }

  function setThreadView(selected) {
    one("#admin-chat-workspace").classList.toggle("has-selected", selected);
    one("#admin-chat-empty").hidden = selected;
    one("#admin-chat-thread").hidden = !selected;
  }

  async function selectConversation(conversation) {
    if (currentConversation) drafts.set(String(currentConversation.id), one("#admin-reply-text").value);
    currentConversation = conversation;
    const generation = ++threadGeneration;
    messageCursor = 0;
    messageIds.clear();
    one("#admin-reply-text").value = drafts.get(String(conversation.id)) || "";
    threadMessages.replaceChildren();
    setThreadView(true);
    one("#admin-thread-title").textContent = `${conversation.marca || "Vehículo"} ${conversation.modelo || ""}`.trim();
    one("#admin-thread-state").textContent = conversation.estado === "atendida" ? "Atendida" : "Pendiente";
    one("#admin-thread-state").dataset.state = conversation.estado;
    one("#admin-thread-resolve").hidden = conversation.estado === "atendida";
    all(".admin-chat-item", inboxList).forEach((item) => item.setAttribute("aria-selected", String(item.dataset.conversationId === String(conversation.id))));
    one("#admin-thread-feedback").textContent = "Cargando mensajes…";
    renderInbox([], true);
    try {
      const result = await request(`/admin/chat/conversaciones/${encodeURIComponent(conversation.id)}/mensajes?despues_de_id=0`);
      if (generation !== threadGeneration || String(currentConversation?.id) !== String(conversation.id)) return;
      (result.mensajes || []).forEach(appendMessage);
      one("#admin-thread-feedback").textContent = result.mensajes?.length ? "" : "Esta conversación aún no tiene mensajes.";
      if (window.matchMedia("(max-width: 640px)").matches) one("#admin-chat-back").focus();
      restartPolling();
    } catch (error) {
      one("#admin-thread-feedback").textContent = error.status === 401 ? "Tu sesión administrativa venció." : error.message;
      if (error.status === 401) setAuthenticated(false);
    }
  }

  one("#admin-chat-back")?.addEventListener("click", () => {
    drafts.set(String(currentConversation?.id), one("#admin-reply-text").value);
    currentConversation = null;
    threadGeneration += 1;
    setThreadView(false);
    stopPolling();
    one(".admin-chat-item")?.focus();
  });

  async function pollMessages() {
    if (pollBusy || !currentConversation || document.hidden || currentView() !== "conversations" || !authenticated) return;
    pollBusy = true;
    const selectedId = String(currentConversation.id);
    const generation = threadGeneration;
    try {
      const result = await request(`/admin/chat/conversaciones/${encodeURIComponent(selectedId)}/mensajes?despues_de_id=${encodeURIComponent(messageCursor)}`);
      if (generation !== threadGeneration || String(currentConversation?.id) !== selectedId) return;
      (result.mensajes || []).forEach((message) => appendMessage(message, true));
      if (result.mensajes?.length) one("#admin-thread-feedback").textContent = "";
    } catch (error) {
      if (error.status === 401) {
        one("#admin-thread-feedback").textContent = "Tu sesión administrativa venció.";
        setAuthenticated(false);
      } else one("#admin-thread-feedback").textContent = error.message;
    } finally { pollBusy = false; }
  }

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
  function restartPolling() {
    stopPolling();
    if (!authenticated || !currentConversation || currentView() !== "conversations" || document.hidden) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await pollMessages();
      restartPolling();
    }, 4000);
  }

  one("#admin-reply-text")?.addEventListener("input", (event) => {
    if (currentConversation) drafts.set(String(currentConversation.id), event.currentTarget.value);
  });

  replyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    let content = one("#admin-reply-text").value.trim();
    if (!content || !authenticated || !currentConversation) return;
    if (pendingReply?.uncertain && pendingReply.conversationId === String(currentConversation.id) && pendingReply.content !== content) {
      content = pendingReply.content;
      one("#admin-reply-text").value = content;
      one("#admin-thread-feedback").textContent = "Restauré el texto del envío pendiente para reintentar sin duplicarlo.";
    }
    if (!pendingReply || pendingReply.conversationId !== String(currentConversation.id) || pendingReply.content !== content) {
      pendingReply = { conversationId: String(currentConversation.id), content, key: crypto.randomUUID() };
    }
    const conversationId = String(currentConversation.id);
    const button = one("#admin-reply-submit");
    button.disabled = true;
    one("#admin-thread-feedback").textContent = "Enviando respuesta…";
    try {
      const result = await request(`/admin/chat/conversaciones/${encodeURIComponent(conversationId)}/mensajes`, {
        method: "POST", body: { contenido: content }, idempotencyKey: pendingReply.key,
      });
      if (result.mensaje && String(currentConversation?.id) === conversationId) appendMessage(result.mensaje, true);
      if (drafts.get(conversationId)?.trim() === content) drafts.delete(conversationId);
      if (String(currentConversation?.id) === conversationId && one("#admin-reply-text").value.trim() === content) {
        one("#admin-reply-text").value = "";
      }
      pendingReply = null;
      one("#admin-thread-feedback").textContent = "Respuesta enviada.";
      await loadInbox();
    } catch (error) {
      if (pendingReply && (!error.status || error.status >= 500)) pendingReply.uncertain = true;
      one("#admin-thread-feedback").textContent = `${error.message} Si reintentás el mismo texto, se reutiliza la clave para evitar duplicarlo.`;
      if (error.status === 401) setAuthenticated(false);
    } finally { button.disabled = false; }
  });

  one("#admin-thread-resolve")?.addEventListener("click", async () => {
    if (!currentConversation || currentConversation.estado === "atendida") return;
    const button = one("#admin-thread-resolve");
    button.disabled = true;
    try {
      const result = await request(`/admin/chat/conversaciones/${encodeURIComponent(currentConversation.id)}/atendida`, { method: "PATCH", body: { atendida: true } });
      currentConversation = result.conversacion || { ...currentConversation, estado: "atendida" };
      one("#admin-thread-state").textContent = "Atendida";
      one("#admin-thread-state").dataset.state = "atendida";
      button.hidden = true;
      setStatus("Conversación marcada como atendida.");
      await loadInbox();
    } catch (error) {
      one("#admin-thread-feedback").textContent = error.message;
      if (error.status === 401) setAuthenticated(false);
    } finally { button.disabled = false; }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else restartPolling();
  });

  checkSession();
})();
