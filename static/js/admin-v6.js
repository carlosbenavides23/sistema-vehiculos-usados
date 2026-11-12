"use strict";

(() => {
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const body = document.body;
  const csrfMeta = one('meta[name="csrf-token"]');
  const csrf = () => csrfMeta?.content || "";
  const sellerPanel = document.body.dataset.sellerPanel === 'true';
  const apiRoot = '/api/vendedor';
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 0 });
  const readonly = body.dataset.readOnly === "true";
  const vehicleFieldValues = window.AdminV6FieldValues;
  const historicalVehicleSelects = ["transmision", "combustible"];
  const typeAliasData = JSON.parse(one("#vehicle-type-aliases")?.textContent || "{}");

  function typeAliasKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function setVehicleType(value) {
    const field = form?.elements.namedItem("tipo_vehiculo");
    if (!field) return;
    field.querySelectorAll("option[data-historical-type]").forEach((option) => option.remove());
    const canonical = typeAliasData[typeAliasKey(value)];
    if (canonical) {
      field.value = canonical;
      return;
    }
    if (value === null || value === undefined || value === "") {
      field.value = "";
      return;
    }
    const historical = document.createElement("option");
    historical.value = String(value);
    historical.textContent = `Tipo histórico · ${value}`;
    historical.dataset.historicalType = "true";
    field.append(historical);
    field.value = historical.value;
  }

  const auth = one("#admin-auth");
  const workspace = one("#admin-workspace");
  const loginError = one("#admin-login-error");
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

  let csrfToken = csrf();
  let authenticated = false;
  let readOnly = readonly;
  let vehicles = [];
  let editingId = null;
  let savedVehicle = null;
  let pendingCreate = null;
  let pendingPhoto = null;
  let deleteTarget = null;
  let retireTarget = null;
  let retireBusy = false;
  let inventoryGeneration = 0;
  let inventoryLoading = false;
  let inventoryFocus = null;
  let availabilityBusy = false;
  let availabilityUndo = null;
  let availabilitySession = 0;
  const fieldErrorNames = new Set();
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
      let url = `${apiRoot}${path}`;
      if (path === '/logout') url = '/api/cuenta/logout';
      try { response = await fetch(url, init); }
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
    } else {
      availabilitySession += 1;
      availabilityUndo = null;
      one("#availability-notice").hidden = true;
      if (sellerPanel) document.dispatchEvent(new Event("seller-account-session-ended"));
    }
  }

  if (sellerPanel) document.addEventListener("seller-account-session-invalid", () => {
    setAuthenticated(false);
    setLoginError("Tu sesión venció. Inicia sesión de nuevo para continuar.");
  });

  function currentView() {
    return one(".admin-view:not([hidden])")?.dataset.adminPanel || "inventory";
  }

  async function checkSession() {
    if (readOnly) return;
    try {
      const state = await request("/session");
      readOnly = Boolean(state.solo_lectura);
      if (readOnly) {
        one("#admin-readonly").hidden = false;
        auth.hidden = true;
        workspace.hidden = true;
        return;
      }
      setAuthenticated(Boolean(state.autenticado));
    } catch (error) {
      setLoginError(error.message);
    }
  }

  async function logoutAdmin() {
    if (!authenticated) return;
    if (!confirmVehicleDeparture()) return;
    try {
      const result = await request("/logout", { method: "POST", body: {} });
      if (sellerPanel) { window.CuentaSesion?.changed(); location.assign('/cuenta'); return; }
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
  }

  all("[data-admin-logout]").forEach((button) => button.addEventListener("click", logoutAdmin));
  logout?.addEventListener("click", logoutAdmin);

  function showView(view) {
    const validView = view;
    if (currentView() !== validView && statusBox?.dataset.type !== "error") setStatus("");
    all("[data-admin-panel]").forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== validView; });
    all("[data-admin-view]").forEach((button) => {
      const active = button.dataset.adminView === validView;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    closeMobileNavigation();
    if (validView === "inventory") loadInventory();
    if (validView === "vehicle-form") one("#vehicle-brand")?.focus();
  }

  one('[data-archive-link]')?.addEventListener('click', (event) => {
    if (!confirmVehicleDeparture()) event.preventDefault();
  });

  all("[data-admin-view]").forEach((button) => button.addEventListener("click", () => {
    if (!authenticated) return;
    if ((button.dataset.adminView !== "vehicle-form" || button.hasAttribute("data-new-vehicle")) && !confirmVehicleDeparture()) return;
    if (currentView() === "vehicle-form" && button.dataset.adminView !== "vehicle-form") clearPhotoDraft();
    const cerrarEnMovil = !mobileMenuButton.hidden;
    if (button.hasAttribute("data-new-vehicle")) resetVehicleForm();
    showView(button.dataset.adminView);
    if (cerrarEnMovil && button.dataset.adminView !== "vehicle-form") {
      const tituloSelector = button.dataset.adminView === "conversations" ? "#conversations-title"
        : button.dataset.adminView === "account-conversations" ? "#seller-chat-title" : "#inventory-title";
      const titulo = one(tituloSelector);
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
    button.disabled = inventoryLoading;
    button.addEventListener("click", () => { if (!inventoryLoading) callback(); });
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
    row.dataset.vehicleId = String(vehicle.id);
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
    actions.lastElementChild.classList.add("availability-toggle");
    actions.lastElementChild.disabled = availabilityBusy || inventoryLoading;
    actions.append(actionButton("Retirar", () => openRetireDialog(vehicle), "secondary"));
    actionsCell.append(actions);
    row.append(infoCell, priceCell, stateCell, actionsCell);
    return row;
  }

  function makeMobileVehicle(vehicle) {
    const article = document.createElement("article");
    article.className = "admin-mobile-card";
    article.dataset.vehicleId = String(vehicle.id);
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
    actions.lastElementChild.disabled = availabilityBusy || inventoryLoading;
    actions.append(actionButton("Retirar publicación", () => openRetireDialog(vehicle), "secondary"));
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

  function openRetireDialog(vehicle) {
    if (!authenticated || retireBusy || inventoryLoading) return;
    retireTarget = vehicle;
    one("#admin-retire-title").textContent = `Retirar ${vehicleTitle(vehicle)}`;
    one("#admin-retire-feedback").textContent = "";
    one("#admin-retire-dialog").showModal();
    one("#admin-retire-cancel").focus();
  }

  one("#admin-retire-dialog").addEventListener("cancel", (event) => { if (retireBusy) event.preventDefault(); });
  one("#admin-retire-dialog").addEventListener("close", () => { retireTarget = null; });
  one("#admin-retire-confirm").addEventListener("click", async () => {
    if (!authenticated || !retireTarget || retireBusy) return;
    const vehicle = retireTarget;
    if (!vehicle.updated_at) {
      one("#admin-retire-feedback").textContent = "No se puede comprobar la versión. Actualizá el inventario.";
      return;
    }
    retireBusy = true;
    one("#admin-retire-confirm").disabled = true;
    one("#admin-retire-cancel").disabled = true;
    one("#admin-retire-feedback").textContent = "Retirando publicación…";
    try {
      await request(`/vehiculos/${encodeURIComponent(vehicle.id)}/retirar`, { method: "POST", body: { version_esperada: vehicle.updated_at } });
      if (availabilityUndo && String(availabilityUndo.id) === String(vehicle.id)) {
        availabilityUndo = null;
        one("#availability-notice").hidden = true;
      }
      one("#admin-retire-dialog").close();
      setStatus(`Publicación retirada: ${vehicleTitle(vehicle)}.`);
      await loadInventory();
      one("#inventory-title")?.focus();
    } catch (error) {
      one("#admin-retire-feedback").textContent = error.message;
      if (error.status === 401) setAuthenticated(false);
    } finally {
      retireBusy = false;
      one("#admin-retire-confirm").disabled = false;
      one("#admin-retire-cancel").disabled = false;
    }
  });

  async function loadInventory() {
    if (!authenticated || currentView() !== "inventory") return;
    const generation = ++inventoryGeneration;
    const focused = document.activeElement;
    const focusedRow = focused?.closest('[data-vehicle-id]');
    const focusId = focusedRow?.dataset.vehicleId;
    const focusIndex = focusedRow ? [...focusedRow.querySelectorAll('button')].indexOf(focused) : -1;
    if (focusId && focusIndex >= 0) inventoryFocus = { id: focusId, index: focusIndex, element: focused };
    else if (!inventoryLoading) inventoryFocus = null;
    inventoryLoading = true;
    [inventoryList, inventoryCards].forEach(root => {
      root.setAttribute("aria-busy", "true");
      all("button", root).forEach(button => { button.disabled = true; });
    });
    inventoryFeedback.textContent = "Cargando publicaciones…";
    const params = new URLSearchParams(new FormData(one("#admin-inventory-filters")));
    const query = params.toString();
    try {
      const result = await request(`/vehiculos${query ? `?${query}` : ""}`);
      if (generation !== inventoryGeneration || !authenticated) return;
      vehicles = Array.isArray(result.vehiculos) ? result.vehiculos : [];
      inventoryLoading = false;
      renderInventory(vehicles);
      const recovery = inventoryFocus;
      if (recovery && (document.activeElement === recovery.element || document.activeElement === body)) {
        const selector = `[data-vehicle-id="${CSS.escape(recovery.id)}"]`;
        const target = all(selector).find(row => row.getClientRects().length);
        target?.querySelectorAll("button")[recovery.index]?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (generation !== inventoryGeneration || !authenticated) return;
      vehicles = [];
      renderInventory([]);
      emptyInventory.hidden = true;
      inventoryFeedback.textContent = error.status === 401 ? "Tu sesión administrativa venció. Ingresá nuevamente." : error.message;
      if (error.status === 401) setAuthenticated(false);
    } finally {
      if (generation === inventoryGeneration) {
        inventoryLoading = false;
        inventoryFocus = null;
        [inventoryList, inventoryCards].forEach(root => root.setAttribute("aria-busy", "false"));
      }
    }
  }

  one("#admin-inventory-filters")?.addEventListener("submit", (event) => { event.preventDefault(); loadInventory(); });
  one("#admin-clear-filters")?.addEventListener("click", () => { one("#admin-inventory-filters").reset(); loadInventory(); });

  function showAvailabilityNotice(message, canUndo = false, type = "success") {
    const notice = one("#availability-notice");
    notice.hidden = false;
    notice.dataset.type = type;
    one("#availability-message").textContent = message;
    one("#availability-undo").hidden = !canUndo;
  }

  function setAvailabilityBusy(busy) {
    availabilityBusy = busy;
    all(".availability-toggle").forEach((button) => { button.disabled = busy || inventoryLoading; });
    one("#availability-undo").disabled = busy;
  }

  async function changeAvailability(vehicle, next, undoing = false) {
    if (availabilityBusy || inventoryLoading) return;
    availabilityUndo = null;
    if (!vehicle.updated_at) {
      showAvailabilityNotice("No se puede comprobar la versión. Actualizá el inventario antes de cambiar la disponibilidad.", false, "error");
      await loadInventory();
      return;
    }
    setAvailabilityBusy(true);
    const session = availabilitySession;
    showAvailabilityNotice(undoing ? "Revirtiendo disponibilidad…" : "Actualizando disponibilidad…");
    try {
      const result = await request(`/vehiculos/${encodeURIComponent(vehicle.id)}/disponibilidad`, { method: "PATCH", body: { disponibilidad: next, version_esperada: vehicle.updated_at } });
      if (!authenticated || session !== availabilitySession) return;
      if (!undoing && result.vehiculo?.updated_at) {
        availabilityUndo = { id: vehicle.id, disponibilidad: vehicle.disponibilidad, updated_at: result.vehiculo.updated_at, title: vehicleTitle(vehicle) };
      }
      const title = vehicle.title || vehicleTitle(vehicle) || `Vehículo ${vehicle.id}`;
      showAvailabilityNotice(`${undoing ? "Cambio deshecho" : "Disponibilidad actualizada"}: ${title}, ${next}.`, Boolean(availabilityUndo));
      await loadInventory();
    } catch (error) {
      if (!authenticated || session !== availabilitySession) return;
      showAvailabilityNotice(error.status === 401 ? "Tu sesión administrativa venció." : `${error.message} Revisá el inventario antes de volver a intentar.`, false, "error");
      if (error.status === 401) setAuthenticated(false);
      else await loadInventory();
    } finally {
      setAvailabilityBusy(false);
    }
  }

  function toggleAvailability(vehicle) {
    const next = vehicle.disponibilidad === "vendido" ? "disponible" : "vendido";
    return changeAvailability(vehicle, next);
  }

  one("#availability-undo").addEventListener("click", () => {
    if (!availabilityUndo || availabilityBusy) return;
    const previous = availabilityUndo;
    changeAvailability(previous, previous.disponibilidad, true);
  });

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
    setVehicleType(null);
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
    ["marca", "modelo", "anio", "kilometraje", "ubicacion", "descripcion", "disponibilidad", "color", "placa", "version", "motor", "numero_puertas", "capacidad_pasajeros"].forEach((name) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = vehicle[name] ?? "";
    });
    setVehicleType(vehicle.tipo_vehiculo);
    historicalVehicleSelects.forEach((name) => {
      vehicleFieldValues.setPreservingCurrentValue(form.elements.namedItem(name), vehicle[name]);
    });
    ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia", "camara_reversa", "bluetooth"].forEach((name) => {
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
    ["color", "placa", "version", "motor"].forEach((name) => { values[name] = values[name]?.trim() || null; });
    const tipoVehiculo = form.elements.namedItem("tipo_vehiculo")?.value;
    values.tipo_vehiculo = tipoVehiculo || null;
    ["numero_puertas", "capacidad_pasajeros"].forEach((name) => { values[name] = values[name] === "" ? null : values[name]; });
    historicalVehicleSelects.forEach((name) => {
      values[name] = vehicleFieldValues.serializedValue(form.elements.namedItem(name));
    });
    ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia", "camara_reversa", "bluetooth"].forEach((name) => {
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
      if (availabilityUndo && String(availabilityUndo.id) === String(savedVehicle.id)) {
        availabilityUndo = null;
        showAvailabilityNotice("El vehículo se editó; ya no se puede deshacer el cambio anterior.");
      }
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

  checkSession();
})();
