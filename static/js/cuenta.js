"use strict";
(() => {
  const one = id => document.getElementById(id);
  const form = one("cuenta-form");
  const estado = one("cuenta-estado");
  let registro = false;

  async function api(path, body, method = body ? "POST" : "GET") {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Revisá la conexión e intentá nuevamente.");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("No pudimos completar la operación. Intentá nuevamente.");
    }
    if (!response.ok) {
      const error = new Error(data.mensaje || "No se pudo completar la operación.");
      error.status = response.status;
      throw error;
    }
    Object.defineProperty(data, "httpStatus", { value: response.status });
    return data;
  }

  function feedback(message, type = "info") {
    estado.textContent = message || "";
    estado.dataset.type = type;
    estado.hidden = !message;
  }

  function normalizeDisplayName(value) {
    if (/\p{Cc}/u.test(value)) throw new Error("El nombre visible no puede contener caracteres de control.");
    const normalized = value.trim().replace(/\s+/gu, " ");
    const length = Array.from(normalized).length;
    if (length < 2 || length > 40) throw new Error("El nombre visible debe tener entre 2 y 40 caracteres.");
    return normalized;
  }

  function destinoSiguienteSeguro() {
    const valor = new URLSearchParams(location.search).get("next");
    if (!valor) return "";
    try {
      const destino = new URL(valor, location.origin);
      if (destino.origin !== location.origin || !(/^\/$|^\/vehiculo\/[1-9]\d*$/.test(destino.pathname))) return "";
      return `${destino.pathname}${destino.search}${destino.hash}`;
    } catch {
      return "";
    }
  }

  function mostrar(data) {
    const user = data.usuario;
    if (user) {
      one("cuenta-titulo").textContent = "Mi cuenta";
      one("cuenta-descripcion").textContent = "Gestioná tu cuenta y accedé a tus actividades.";
    } else {
      registro = false;
      actualizarModo();
    }
    form.hidden = Boolean(user);
    one("registro-confirmacion").hidden = true;
    one("salir-cuenta").hidden = !user;
    one("panel-vendedor").hidden = user?.rol !== "vendedor";
    one("mis-conversaciones-cuenta").hidden = user?.rol !== "comprador";
    one("cuenta-perfil").hidden = !user;
    one("nombre-perfil-lectura").textContent = user?.nombre_visible || "Sin nombre visible registrado";
    if (user) feedback(`Sesión iniciada: ${user.email} · ${user.rol}`, "success");
    else if (data.mensaje) feedback(data.mensaje, "success");
  }

  function actualizarModo() {
    one("cuenta-titulo").textContent = registro ? "Crear cuenta" : "Iniciar sesión";
    one("cuenta-descripcion").textContent = registro
      ? "Regístrate como comprador o vendedor para utilizar la plataforma."
      : "Accede a tu cuenta para continuar.";
    one("rol-field").hidden = !registro;
    one("nombre-visible-field").hidden = !registro;
    one("nombre-visible").required = registro;
    one("nombre-visible").disabled = !registro;
    one("registro-aviso").hidden = !registro;
    one("password").autocomplete = registro ? "new-password" : "current-password";
    one("enviar-cuenta").textContent = registro ? "Crear cuenta" : "Iniciar sesión";
    one("modo-ayuda").textContent = registro ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?";
    one("modo-cuenta").textContent = registro ? "Iniciar sesión" : "Crear cuenta";
  }

  function mostrarContrasena(visible) {
    const campo = one("password");
    const boton = one("mostrar-password");
    campo.type = visible ? "text" : "password";
    boton.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
    boton.setAttribute("aria-pressed", String(visible));
    boton.querySelector('[data-password-icon="hidden"]').hidden = visible;
    boton.querySelector('[data-password-icon="visible"]').hidden = !visible;
  }

  function mostrarConfirmacion() {
    feedback("");
    one("cuenta-titulo").textContent = "Revisa tu correo electrónico";
    one("cuenta-descripcion").textContent = "Tu registro está pendiente de confirmación.";
    form.hidden = true;
    one("registro-confirmacion").hidden = false;
    one("volver-login").focus();
  }

  api("/api/cuenta").then(data => {
    if (data.usuario) mostrar(data);
  }).catch(error => {
    if (error.status !== 401) feedback(error.message || "No pudimos comprobar tu sesión.", "error");
  });

  one("mostrar-password").addEventListener("click", () => {
    const campo = one("password");
    const visible = campo.type === "password";
    mostrarContrasena(visible);
  });

  one("modo-cuenta").addEventListener("click", () => {
    registro = !registro;
    mostrarContrasena(false);
    one("registro-confirmacion").hidden = true;
    form.hidden = false;
    feedback("");
    actualizarModo();
  });

  one("volver-login").addEventListener("click", () => {
    registro = false;
    form.hidden = false;
    one("registro-confirmacion").hidden = true;
    feedback("");
    actualizarModo();
    one("email").focus();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = one("enviar-cuenta");
    const esRegistro = registro;
    button.disabled = true;
    feedback("Procesando…", "loading");
    try {
      const body = { email: one("email").value, password: one("password").value };
      if (esRegistro) {
        body.rol = one("rol").value;
        try {
          body.nombre_visible = normalizeDisplayName(one("nombre-visible").value);
          one("nombre-visible").value = body.nombre_visible;
        } catch (error) {
          feedback(error.message, "error");
          button.disabled = false;
          return;
        }
      }
      const result = await api(`/api/cuenta/${esRegistro ? "registro" : "login"}`, body);
      if (esRegistro && !result.usuario && result.httpStatus === 202) {
        one("password").value = "";
        mostrarContrasena(false);
        mostrarConfirmacion();
        return;
      }
      if (!result.usuario) {
        feedback("No pudimos completar el acceso. Revisá tus datos e intentá nuevamente.", "error");
        return;
      }
      registro = false;
      actualizarModo();
      window.CuentaSesion?.changed();
      mostrar(result);
      one("password").value = "";
      mostrarContrasena(false);
      const destino = destinoSiguienteSeguro();
      if (destino) location.assign(destino);
    } catch (error) {
      feedback(error.message || "Revisá la conexión e intentá nuevamente.", "error");
    } finally {
      button.disabled = false;
    }
  });

  one("salir-cuenta").addEventListener("click", async () => {
    const button = one("salir-cuenta");
    button.disabled = true;
    try {
      const result = await api("/api/cuenta/logout", {});
      window.CuentaSesion?.changed();
      mostrar(result);
    } catch (error) {
      feedback(error.message || "Revisá la conexión e intentá nuevamente.", "error");
    } finally {
      button.disabled = false;
    }
  });
})();
