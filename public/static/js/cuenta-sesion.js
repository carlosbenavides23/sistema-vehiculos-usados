"use strict";

// Solo transmite invalidación. Nunca identidad, tokens, borradores ni mensajes.
(() => {
  const changed = () => document.dispatchEvent(new Event("cuenta-sesion-cambio"));
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("vehiculos-cuenta-v7") : null;
  if (channel) channel.onmessage = (event) => { if (event.data === "changed") changed(); };
  window.CuentaSesion = { changed() { changed(); channel?.postMessage("changed"); } };
})();
