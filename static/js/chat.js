"use strict";

(() => {
  const porId = (id) => document.getElementById(id);
  const cuerpo = document.body;
  const habilitado = cuerpo.dataset.chatEnabled === "true";
  if (!habilitado) return;

  const intervalo = 4000;
  const idVehiculoFicha = cuerpo.dataset.vehiculoId || "";
  const fichaChat = porId("comprador-chat");
  const botonMensajesComprador = porId("abrir-chat-comprador-global");
  const dialogoComprador = porId("chat-comprador-dialogo");
  const claveStorageBorradores = "vehiculos-chat-borradores-v1";
  let borradoresComprador = new Map();
  let ultimoAbridorComprador = botonMensajesComprador;
  try {
    const guardados = JSON.parse(sessionStorage.getItem(claveStorageBorradores) || "[]");
    if (Array.isArray(guardados)) borradoresComprador = new Map(guardados.filter((fila) => Array.isArray(fila) && typeof fila[0] === "string" && fila[1] && typeof fila[1].texto === "string"));
  } catch { /* El chat sigue funcionando si el navegador bloquea el almacenamiento de sesión. */ }
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  let csrfComprador = "";
  let compradorPreparado = false;
  let compradorAbierto = false;
  let generacionComprador = 0;
  let conversacionComprador = null;
  let timerComprador = null;
  let compradorEnVuelo = false;
  let listaCompradorEnVuelo = false;
  let cursorComprador = null;
  let idsComprador = new Set();
  let solicitudCompradorPendiente = null;

  async function api(ruta, { metodo = "GET", cuerpoJson = null, csrf = "", idempotencyKey = "" } = {}) {
    const headers = { Accept: "application/json" };
    if (cuerpoJson !== null) headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let respuesta;
    try {
      respuesta = await fetch(ruta, {
        method: metodo,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body: cuerpoJson === null ? undefined : JSON.stringify(cuerpoJson),
      });
    } catch {
      throw new Error("No hay conexión. Conservamos tu texto para que puedas volver a intentarlo.");
    }
    let datos = {};
    try { datos = await respuesta.json(); } catch { /* Respuestas vacías se gestionan con el estado HTTP. */ }
    if (!respuesta.ok || datos.ok === false) {
      const error = new Error(datos.mensaje || "No pudimos completar la operación. Inténtalo de nuevo.");
      error.status = respuesta.status;
      throw error;
    }
    return datos;
  }

  function estado(elemento, texto, tipo = "") {
    elemento.textContent = texto;
    if (tipo) elemento.dataset.tipo = tipo;
    else delete elemento.dataset.tipo;
  }

  function idValido(valor) { return valor !== undefined && valor !== null && String(valor) !== ""; }

  function fechaLegible(valor) {
    if (!valor) return "";
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? "" : new Intl.DateTimeFormat("es-NI", { dateStyle: "short", timeStyle: "short" }).format(fecha);
  }

  function fechaDeMensaje(mensaje) {
    const time = document.createElement("time");
    time.dateTime = mensaje.created_at || "";
    time.textContent = fechaLegible(mensaje.created_at);
    return time;
  }

  function agregarMensajes(contenedor, mensajes, idsVistos, animarNuevos = false) {
    let agregados = 0;
    const estabaAlFinal = contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < 48;
    for (const mensaje of mensajes || []) {
      if (!idValido(mensaje.id) || idsVistos.has(String(mensaje.id))) continue;
      idsVistos.add(String(mensaje.id));
      const articulo = document.createElement("article");
      articulo.className = `chat-message${animarNuevos ? " is-entering" : ""}`;
      articulo.dataset.remitente = ["admin", "administrador"].includes(mensaje.remitente) ? "admin" : "comprador";
      const texto = document.createElement("p");
      texto.textContent = mensaje.contenido || "";
      articulo.append(texto, fechaDeMensaje(mensaje));
      contenedor.append(articulo);
      agregados += 1;
    }
    if (agregados && estabaAlFinal) contenedor.scrollTop = contenedor.scrollHeight;
    return agregados;
  }

  function siguienteCursor(mensajes, actual) {
    if (!mensajes?.length) return actual;
    return mensajes[mensajes.length - 1].id ?? actual;
  }

  function nombreVehiculo(conversacion) {
    return `${conversacion.marca || "Vehículo"} ${conversacion.modelo || ""}`.trim();
  }

  function claveBorradorComprador() { return conversacionComprador ? String(conversacionComprador.id) : `nueva:${idVehiculoFicha}`; }
  function persistirBorradoresComprador() {
    try { sessionStorage.setItem(claveStorageBorradores, JSON.stringify([...borradoresComprador])); } catch { /* borrador disponible durante esta página */ }
  }
  function guardarBorradorComprador() {
    const clave = claveBorradorComprador();
    const texto = porId("chat-comprador-texto").value;
    if (!texto && !solicitudCompradorPendiente) borradoresComprador.delete(clave);
    else borradoresComprador.set(clave, { texto, solicitud: solicitudCompradorPendiente });
    persistirBorradoresComprador();
  }
  function restaurarBorradorComprador() {
    const borrador = borradoresComprador.get(claveBorradorComprador());
    porId("chat-comprador-texto").value = borrador?.texto || "";
    solicitudCompradorPendiente = borrador?.solicitud || null;
  }
  function vistaComprador(vista) {
    porId("chat-comprador-lista-vista").hidden = vista !== "lista";
    porId("chat-comprador-hilo").hidden = vista !== "hilo";
    if (vista === "lista") porId("chat-comprador-volver").hidden = true;
    else porId("chat-comprador-volver").hidden = false;
  }
  function seleccionarConversacionComprador(conversacion) {
    guardarBorradorComprador();
    conversacionComprador = conversacion;
    restaurarBorradorComprador();
    vistaComprador("hilo");
    if (compradorAbierto && dialogoComprador.open) porId("chat-comprador-volver").focus();
    cursorComprador = null;
    idsComprador = new Set();
    porId("chat-comprador-mensajes").replaceChildren();
    porId("chat-comprador-vehiculo").textContent = nombreVehiculo(conversacion);
    porId("chat-comprador-estado").textContent = conversacion.estado === "atendida" ? "Atendida" : "Pendiente de respuesta";
    porId("chat-comprador-form").hidden = false;
    porId("chat-comprador-lista").querySelectorAll("button").forEach((boton) => {
      boton.setAttribute("aria-current", boton.dataset.conversationId === String(conversacion.id) ? "true" : "false");
    });
    cargarMensajesComprador(true);
    reiniciarPollingComprador();
  }

  function prepararBorradorComprador() {
    guardarBorradorComprador();
    conversacionComprador = null;
    restaurarBorradorComprador();
    vistaComprador("hilo");
    cursorComprador = null;
    idsComprador = new Set();
    porId("chat-comprador-mensajes").replaceChildren();
    porId("chat-comprador-vehiculo").textContent = porId("ficha-titulo").textContent || "Nueva conversación";
    porId("chat-comprador-estado").textContent = "Nueva consulta";
    porId("chat-comprador-form").hidden = false;
    estado(porId("chat-comprador-feedback"), "Escribe tu consulta para iniciar la conversación.");
  }

  async function cargarListaComprador({ elegirFicha = false } = {}) {
    if (!compradorAbierto || !dialogoComprador.open) return;
    if (listaCompradorEnVuelo) return;
    listaCompradorEnVuelo = true;
    const generacionSolicitada = generacionComprador;
    try {
      const { conversaciones = [], csrf_token: csrfLista = "" } = await api("/api/chat/conversaciones");
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      if (csrfLista) csrfComprador = csrfLista;
      compradorPreparado = Boolean(csrfComprador);
      const lista = porId("chat-comprador-lista");
      lista.replaceChildren();
      const estadoLista = porId("chat-comprador-lista-estado");
      if (!conversaciones.length) {
        estadoLista.textContent = "Todavía no tienes conversaciones. Explora el catálogo y contacta al vendedor desde la ficha de un vehículo";
        if (elegirFicha) prepararBorradorComprador();
        return;
      }
      estadoLista.textContent = "Selecciona una conversación para continuar.";
      for (const conversacion of conversaciones) {
        const li = document.createElement("li");
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "chat-conversation-button";
        boton.dataset.conversationId = conversacion.id;
        boton.setAttribute("aria-current", conversacionComprador?.id === conversacion.id ? "true" : "false");
        const titulo = document.createElement("strong");
        titulo.textContent = nombreVehiculo(conversacion);
        const extracto = document.createElement("span");
        extracto.textContent = `${conversacion.estado === "atendida" ? "Atendida" : "Pendiente"} · ${conversacion.ultimo_mensaje || "Sin mensajes"}`;
        boton.append(titulo, extracto);
        boton.addEventListener("click", () => seleccionarConversacionComprador(conversacion));
        li.append(boton);
        lista.append(li);
      }
      if (elegirFicha) {
        const existente = conversaciones.find((item) => String(item.vehiculo_id) === idFichaFicha());
        if (existente) seleccionarConversacionComprador(existente);
        else prepararBorradorComprador();
      }
    } catch (error) {
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      estado(porId("chat-comprador-lista-estado"), error.status === 401
        ? "Todavía no tienes conversaciones. Explora el catálogo y contacta al vendedor desde la ficha de un vehículo"
        : error.message, error.status === 401 ? "" : "error");
      if (error.status === 401) {
        compradorPreparado = false;
        conversacionComprador = null;
        porId("chat-comprador-form").hidden = true;
        porId("chat-comprador-lista").replaceChildren();
      }
    } finally {
      listaCompradorEnVuelo = false;
      if (compradorAbierto && dialogoComprador.open && generacionSolicitada !== generacionComprador) {
        queueMicrotask(() => cargarListaComprador());
      }
    }
  }

  function idFichaFicha() { return String(idVehiculoFicha); }

  async function prepararComprador() {
    if (compradorPreparado) return;
    const generacionSolicitada = generacionComprador;
    estado(porId("chat-comprador-feedback"), "Preparando una sesión privada…");
    try {
      const respuesta = await api("/api/chat/sesion", { metodo: "POST", csrf: csrfMeta?.content || "" });
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      csrfComprador = respuesta.csrf_token || "";
      if (!csrfComprador) throw new Error("No pudimos asegurar la sesión. Inténtalo de nuevo.");
      compradorPreparado = true;
      estado(porId("chat-comprador-feedback"), "Tu sesión privada está lista.");
      await cargarListaComprador({ elegirFicha: true });
    } catch (error) {
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      estado(porId("chat-comprador-feedback"), error.status === 503 ? "La mensajería no está habilitada en este entorno." : error.message, "error");
      if (error.status !== 503) porId("mostrar-chat").hidden = false;
      else fichaChat.hidden = true;
    }
  }

  async function cargarMensajesComprador(inicial = false) {
    if (!compradorAbierto || !dialogoComprador.open || !conversacionComprador || compradorEnVuelo) return;
    compradorEnVuelo = true;
    const generacionSolicitada = generacionComprador;
    const conversacionSolicitada = String(conversacionComprador.id);
    try {
      const despues = cursorComprador === null ? 0 : encodeURIComponent(cursorComprador);
      const { mensajes = [] } = await api(`/api/chat/conversaciones/${encodeURIComponent(conversacionComprador.id)}/mensajes?despues_de_id=${despues}`);
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador || String(conversacionComprador?.id) !== conversacionSolicitada) return;
      agregarMensajes(porId("chat-comprador-mensajes"), mensajes, idsComprador, !inicial);
      cursorComprador = siguienteCursor(mensajes, cursorComprador);
      if (mensajes.length) estado(porId("chat-comprador-feedback"), "Conectado. Los mensajes se actualizan automáticamente.");
      else if (inicial && !idsComprador.size) estado(porId("chat-comprador-feedback"), "Aún no hay mensajes. Puedes escribir al vendedor.");
    } catch (error) {
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      if (error.status === 401 || error.status === 404) {
        estado(porId("chat-comprador-feedback"), "La sesión venció o la conversación ya no está disponible. Vuelve a contactar al vendedor.", "error");
        compradorPreparado = false;
        conversacionComprador = null;
        porId("chat-comprador-form").hidden = true;
        detenerPollingComprador();
        cerrarComprador();
      } else estado(porId("chat-comprador-feedback"), "Se perdió la conexión. Seguiremos intentando; el texto escrito se conserva.", "error");
    } finally {
      compradorEnVuelo = false;
      if (compradorAbierto && dialogoComprador.open && (generacionSolicitada !== generacionComprador || String(conversacionComprador?.id) !== conversacionSolicitada)) {
        queueMicrotask(() => cargarMensajesComprador(true));
      }
    }
  }

  function detenerPollingComprador() { clearTimeout(timerComprador); timerComprador = null; }
  function reiniciarPollingComprador() {
    detenerPollingComprador();
    if (!document.hidden && compradorAbierto && conversacionComprador) timerComprador = setTimeout(cicloComprador, intervalo);
  }
  async function cicloComprador() {
    timerComprador = null;
    if (document.hidden || !compradorAbierto || !conversacionComprador || compradorEnVuelo) return reiniciarPollingComprador();
    await cargarMensajesComprador();
    reiniciarPollingComprador();
  }

  async function enviarComprador(evento) {
    evento.preventDefault();
    if (!compradorAbierto || !dialogoComprador.open) return;
    const generacionSolicitada = generacionComprador;
    const texto = porId("chat-comprador-texto").value.trim();
    const boton = porId("chat-comprador-enviar");
    if (!texto || boton.disabled) return;
    if (!solicitudCompradorPendiente || solicitudCompradorPendiente.texto !== texto) {
      solicitudCompradorPendiente = { texto, clave: crypto.randomUUID() };
    }
    const solicitudEnviada = solicitudCompradorPendiente;
    boton.disabled = true;
    estado(porId("chat-comprador-feedback"), "Enviando mensaje…");
    const vehiculoDestino = conversacionComprador?.vehiculo_id || idVehiculoFicha;
    const borradorEnviado = claveBorradorComprador();
    const ruta = `/api/chat/vehiculos/${encodeURIComponent(vehiculoDestino)}/mensajes`;
    try {
      const respuesta = await api(ruta, {
        metodo: "POST",
        cuerpoJson: { contenido: texto },
        csrf: csrfComprador,
        idempotencyKey: solicitudCompradorPendiente.clave,
      });
      const borradorGuardado = borradoresComprador.get(borradorEnviado);
      if (borradorGuardado?.texto.trim() === texto && borradorGuardado.solicitud?.clave === solicitudEnviada.clave) {
        borradoresComprador.delete(borradorEnviado);
        persistirBorradoresComprador();
      }
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      const campoTexto = porId("chat-comprador-texto");
      const sigueSeleccionada = claveBorradorComprador() === borradorEnviado;
      if (!sigueSeleccionada) {
        await cargarListaComprador();
        return;
      }
      if (campoTexto.value.trim() === texto) {
        campoTexto.value = "";
        borradoresComprador.delete(borradorEnviado);
      } else {
        borradoresComprador.set(borradorEnviado, { texto: campoTexto.value, solicitud: null });
      }
      solicitudCompradorPendiente = null;
      persistirBorradoresComprador();
      if (respuesta.conversacion) {
        conversacionComprador = respuesta.conversacion;
        porId("chat-comprador-vehiculo").textContent = nombreVehiculo(respuesta.conversacion);
        porId("chat-comprador-estado").textContent = respuesta.conversacion.estado === "atendida" ? "Atendida" : "Pendiente de respuesta";
        porId("chat-comprador-form").hidden = false;
      } else if (!conversacionComprador) {
        conversacionComprador = {
          id: respuesta.conversacion_id, vehiculo_id: idVehiculoFicha,
          marca: porId("ficha-titulo").textContent, modelo: "", estado: "abierta",
        };
        cursorComprador = null;
        idsComprador = new Set();
        porId("chat-comprador-vehiculo").textContent = porId("ficha-titulo").textContent;
        porId("chat-comprador-estado").textContent = "Pendiente de respuesta";
        porId("chat-comprador-form").hidden = false;
      }
      if (respuesta.mensaje) {
        agregarMensajes(porId("chat-comprador-mensajes"), [respuesta.mensaje], idsComprador, true);
        cursorComprador = respuesta.mensaje.id;
      }
      estado(porId("chat-comprador-feedback"), "Mensaje enviado.");
      await cargarListaComprador();
      reiniciarPollingComprador();
      porId("chat-comprador-texto").focus();
    } catch (error) {
      if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador) return;
      if (error.status === 401) {
        estado(porId("chat-comprador-feedback"), "La sesión venció. Vuelve a iniciar el contacto para continuar.", "error");
        compradorPreparado = false;
        compradorAbierto = false;
        detenerPollingComprador();
        porId("chat-comprador-form").hidden = true;
        cerrarComprador();
        const botonContacto = porId("mostrar-chat");
        if (botonContacto) botonContacto.textContent = "Reiniciar contacto";
        // solicitudCompradorPendiente y su texto se conservan para un reintento
        // idempotente después de establecer una sesión nueva.
      } else estado(porId("chat-comprador-feedback"), error.message, "error");
    } finally { boton.disabled = false; }
  }

  function sincronizarBloqueoScroll() {
    document.body.classList.toggle("dialog-open", Boolean(dialogoComprador.open));
  }

  function abrirComprador(abridor, vista) {
    ultimoAbridorComprador = abridor;
    generacionComprador += 1;
    compradorAbierto = true;
    porId("chat-comprador-panel").hidden = false;
    vistaComprador(vista);
    if (!dialogoComprador.open) dialogoComprador.showModal();
    sincronizarBloqueoScroll();
    porId("cerrar-chat-comprador").focus();
  }

  function cerrarComprador() {
    if (!compradorAbierto && !dialogoComprador.open && timerComprador === null) {
      sincronizarBloqueoScroll();
      return;
    }
    if (porId("chat-comprador-hilo").hidden === false) guardarBorradorComprador();
    compradorAbierto = false;
    generacionComprador += 1;
    detenerPollingComprador();
    if (dialogoComprador.open) dialogoComprador.close();
    sincronizarBloqueoScroll();
    restaurarFocoComprador();
  }

  function restaurarFocoComprador() {
    const destino = ultimoAbridorComprador?.isConnected && !ultimoAbridorComprador.hidden
      ? ultimoAbridorComprador
      : (botonMensajesComprador?.isConnected && !botonMensajesComprador.hidden ? botonMensajesComprador : null);
    destino?.focus();
  }

  function dialogoCompradorCerrado() {
    // El evento close anterior puede llegar después de una reapertura inmediata.
    if (dialogoComprador.open) return;
    if (compradorAbierto || timerComprador !== null) cerrarComprador();
    else sincronizarBloqueoScroll();
  }

  async function abrirBandejaCompradorGlobal() {
    abrirComprador(botonMensajesComprador, "lista");
    estado(porId("chat-comprador-lista-estado"), "Cargando conversaciones…");
    await cargarListaComprador();
  }

  botonMensajesComprador?.addEventListener("click", abrirBandejaCompradorGlobal);
  porId("chat-comprador-texto").addEventListener("input", guardarBorradorComprador);

  porId("cerrar-chat-comprador").addEventListener("click", cerrarComprador);
  dialogoComprador.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarComprador(); });
  dialogoComprador.addEventListener("close", dialogoCompradorCerrado);
  porId("chat-comprador-volver").addEventListener("click", async () => {
    if (!compradorAbierto || !dialogoComprador.open) return;
    guardarBorradorComprador();
    vistaComprador("lista");
    const generacionSolicitada = generacionComprador;
    await cargarListaComprador();
    if (!compradorAbierto || !dialogoComprador.open || generacionSolicitada !== generacionComprador || porId("chat-comprador-lista-vista").hidden) return;
    (porId("chat-comprador-lista").querySelector("button") || porId("cerrar-chat-comprador")).focus();
  });
  porId("chat-comprador-form").addEventListener("submit", enviarComprador);

  if (idVehiculoFicha && fichaChat) {
    fichaChat.hidden = false;
    porId("mostrar-chat").addEventListener("click", async () => {
      abrirComprador(porId("mostrar-chat"), "hilo");
      if (compradorPreparado) await cargarListaComprador({ elegirFicha: true });
      else await prepararComprador();
      if (!compradorAbierto || !dialogoComprador.open) return;
      reiniciarPollingComprador();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) detenerPollingComprador();
    else reiniciarPollingComprador();
  });
})();
