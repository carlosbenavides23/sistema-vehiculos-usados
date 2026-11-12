"use strict";

(() => {
  function limpiarArchivo() {
    document.getElementById("archivo")?.replaceChildren();
  }
  document.addEventListener("cuenta-sesion-cambio", () => {
    limpiarArchivo();
    location.replace("/cuenta");
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      limpiarArchivo();
      location.reload();
    }
  });
})();
