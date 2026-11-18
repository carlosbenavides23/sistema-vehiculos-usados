"use strict";

// Solo transmite invalidación. Nunca identidad, tokens, borradores ni mensajes.
(() => {
  let pending;
  let generation = 0;
  function invalidate() {
    generation += 1;
    pending = null;
  }
  const changed = () => {
    invalidate();
    document.dispatchEvent(new Event("cuenta-sesion-cambio"));
  };
  window.addEventListener("pagehide", invalidate);
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("vehiculos-cuenta-v7") : null;
  if (channel) channel.onmessage = (event) => { if (event.data === "changed") changed(); };

  function read() {
    if (pending) return pending;
    const epoch = generation;
    pending = (async () => {
      try {
        const response = await fetch("/api/cuenta", {
          credentials: "same-origin", cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Object.assign(new Error("No pudimos comprobar tu sesión."), { status: response.status });
        const { usuario } = await response.json();
        if (!usuario?.id || !["comprador", "vendedor"].includes(usuario.rol)) {
          throw new Error("No pudimos comprobar tu sesión.");
        }
        if (epoch !== generation) throw { stale: true };
        return usuario;
      } catch (error) {
        if (epoch !== generation) throw { stale: true };
        throw Object.assign(new Error("No pudimos comprobar tu sesión. Volvé a intentarlo."), { status: error.status });
      } finally {
        if (epoch === generation) pending = null;
      }
    })();
    return pending;
  }

  async function logout() {
    let response, result;
    try {
      response = await fetch("/api/cuenta/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content },
        signal: AbortSignal.timeout(15000),
      });
      result = await response.json();
    } catch {
      throw new Error("No pudimos confirmar el cierre de sesión. Volvé a intentarlo.");
    }
    if (!response.ok || result.ok !== true) throw new Error(result.mensaje || "No pudimos confirmar el cierre de sesión.");
    changed();
    channel?.postMessage("changed");
    return result;
  }

  window.CuentaSesion = { read, logout, changed() { changed(); channel?.postMessage("changed"); } };
})();
