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
  let owner;

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
    ownerLinks.forEach(link => { link.hidden = !seller || owner !== user.id; });
  }

  async function restore() {
    const epoch = ++revision;
    try {
      const user = await session.read();
      if (epoch !== revision) return;
      if (owner === undefined) owner = user.rol === "vendedor" ? user.id : null;
      render(user);
      if (!retry.hidden) feedback();
      retry.hidden = true;
    } catch (error) {
      if (epoch !== revision || error.stale) return;
      if (error.status === 401) owner = null;
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
  document.addEventListener("cuenta-sesion-cambio", () => { owner = null; clear(); restore(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) restore(); });
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", event => { if (event.persisted) restore(); });
  restore();
})();
