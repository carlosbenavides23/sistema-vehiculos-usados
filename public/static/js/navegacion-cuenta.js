"use strict";

(() => {
  const one = id => document.getElementById(id);
  const login = one("header-login");
  const logout = one("header-logout");
  const identity = one("header-identity");
  const status = one("header-session-status");
  const retry = one("header-session-retry");
  const ownerLinks = document.querySelectorAll("[data-owner-navigation]");
  const session = window.CuentaSesion;
  let revision = 0;

  if (document.body.dataset.vehiculoId) {
    login.href = `/cuenta?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  function feedback(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }

  function render(user) {
    const seller = user?.rol === "vendedor";
    identity.hidden = !user;
    one("header-display-name").textContent = user ? user.nombre_visible || "Sin nombre visible" : "";
    one("header-role").textContent = user ? (seller ? "Vendedor" : "Comprador") : "";
    login.hidden = Boolean(user);
    logout.hidden = !user;
    one("header-panel").hidden = !seller;
    one("header-seller-inbox").hidden = !seller;
    one("abrir-chat-cuentas").hidden = user?.rol !== "comprador";
    ownerLinks.forEach(link => { link.hidden = true; });
  }

  async function restore() {
    const epoch = ++revision;
    try {
      const user = await session.read();
      if (epoch !== revision) return;
      render(user);
      if (!retry.hidden) feedback();
      retry.hidden = true;
      // El contexto lo fija Flask al renderizar la página, antes de consultar la sesión.
      if (user.rol === "vendedor" && ownerLinks.length && globalThis.crypto?.subtle) {
        const bytes = new TextEncoder().encode(user.id);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        if (epoch !== revision) return;
        const owner = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        ownerLinks.forEach(link => { link.hidden = link.dataset.ownerNavigation !== owner; });
      }
    } catch (error) {
      if (epoch !== revision || error.stale) return;
      render(null);
      if (error.status === 401) {
        if (!retry.hidden) feedback();
        retry.hidden = true;
      } else {
        retry.hidden = false;
        feedback("No pudimos comprobar tu sesión. Podés seguir explorando o reintentar.");
      }
    }
  }

  function clear() {
    revision += 1;
    render(null);
    retry.hidden = true;
    feedback();
  }

  logout.addEventListener("click", async () => {
    if (logout.disabled) return;
    logout.disabled = true;
    try {
      const result = await session.logout();
      login.focus();
      feedback(result.mensaje || "Sesión cerrada.");
    } catch {
      feedback("No pudimos confirmar el cierre de sesión. Volvé a intentarlo.");
    } finally {
      logout.disabled = false;
    }
  });
  retry.addEventListener("click", restore);
  document.addEventListener("cuenta-sesion-cambio", () => { clear(); restore(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) restore(); });
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", event => { if (event.persisted) restore(); });
  restore();
})();
