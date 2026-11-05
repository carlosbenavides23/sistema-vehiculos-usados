"use strict";

(() => {
  const porId = (id) => document.getElementById(id);
  const cuerpo = document.body;
  const habilitado = cuerpo.dataset.chatEnabled === "true";
  if (!habilitado) return;

  const intervalo = 4000;
  const idVehiculoFicha = cuerpo.dataset.vehiculoId || "";
  const fichaChat = porId("comprador-chat");
  const botonAbrirAdmin = porId("abrir-mensajes");
  const botonMensajesComprador = porId("abrir-chat-comprador-global");
  const dialogoAdmin = porId("mensajes-dialogo");
  const dialogoComprador = porId("chat-comprador-dialogo");
  const claveStorageBorradores = "vehiculos-chat-borradores-v1";
  let borradoresComprador = new Map();
  let ultimoAbridorComprador = botonMensajesComprador;
  try {
    const guardados = JSON.parse(sessionStorage.getItem(claveStorageBorradores) || "[]");
    if (Array.isArray(guardados)) borradoresComprador = new Map(guardados.filter((fila) => Array.isArray(fila) && typeof fila[0] === "string" && fila[1] && typeof fila[1].texto === "string"));
  } catch { /* El chat sigue funcionando si el navegador bloquea el almacenamiento de sesión. */ }
  const borradoresAdmin = new Map();
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  let csrfComprador = "";
  let adminAutenticado = false;
  let compradorPreparado = false;
  let compradorAbierto = false;
  let generacionComprador = 0;
  let conversacionComprador = null;
  let conversacionAdmin = null;
  let timerComprador = null;
  let timerAdmin = null;
  let compradorEnVuelo = false;
  let adminEnVuelo = false;
  let listaAdminEnVuelo = false;
  let listaCompradorEnVuelo = false;
  let cursorComprador = null;
  let cursorAdmin = null;
  let idsComprador = new Set();
  let idsAdmin = new Set();
  let solicitudCompradorPendiente = null;
  let solicitudAdminPendiente = null;
  let conversacionesAdmin = [];
  let filtroListaAdmin = null;
  let cursorSiguienteAdmin = null;
  let hayMasAdmin = false;
  let paginasAdminCargadas = false;

  function csrfAdmin() { return csrfMeta?.content || ""; }

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

  function agregarMensajes(contenedor, mensajes, idsVistos) {
    let agregados = 0;
    const estabaAlFinal = contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < 48;
    for (const mensaje of mensajes || []) {
      if (!idValido(mensaje.id) || idsVistos.has(String(mensaje.id))) continue;
      idsVistos.add(String(mensaje.id));
      const articulo = document.createElement("article");
      articulo.className = "chat-message";
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
      const respuesta = await api("/api/chat/sesion", { metodo: "POST", csrf: csrfAdmin() });
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
      agregarMensajes(porId("chat-comprador-mensajes"), mensajes, idsComprador);
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
        agregarMensajes(porId("chat-comprador-mensajes"), [respuesta.mensaje], idsComprador);
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

  async function comprobarAdmin() {
    try {
      const respuesta = await api("/api/admin/session");
      const siguiente = Boolean(respuesta.autenticado) && !respuesta.solo_lectura;
      adminAutenticado = siguiente;
      botonAbrirAdmin.hidden = !siguiente;
      if (!siguiente && dialogoAdmin.open) cerrarAdmin();
    } catch {
      adminAutenticado = false;
      botonAbrirAdmin.hidden = true;
      if (dialogoAdmin.open) cerrarAdmin();
    }
  }

  function listarConversacionesAdmin(conversaciones) {
    const lista = porId("chat-admin-lista");
    const elementoEnFoco = document.activeElement?.closest?.("button[data-conversation-id]");
    const idEnFoco = elementoEnFoco?.dataset.conversationId;
    const existentes = new Map(Array.from(lista.children, (li) => [li.firstElementChild?.dataset.conversationId, li]));
    const ordenNuevo = [];
    const idsActuales = new Set();
    for (const conversacion of conversaciones) {
      const id = String(conversacion.id);
      idsActuales.add(id);
      let li = existentes.get(id);
      if (!li) {
        li = document.createElement("li");
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "chat-conversation-button";
        const titulo = document.createElement("strong");
        const extracto = document.createElement("span");
        boton.append(titulo, extracto);
        boton.addEventListener("click", () => seleccionarConversacionAdmin(boton._conversation));
        li.append(boton);
      }
      const boton = li.firstElementChild;
      boton._conversation = conversacion;
      boton.dataset.conversationId = conversacion.id;
      boton.setAttribute("aria-current", conversacionAdmin?.id === conversacion.id ? "true" : "false");
      const titulo = boton.querySelector("strong");
      const extracto = boton.querySelector("span");
      const textoTitulo = nombreVehiculo(conversacion);
      const textoExtracto = `${conversacion.estado === "atendida" ? "Atendida" : "Pendiente"} · ${conversacion.ultimo_mensaje || "Sin mensajes"}`;
      if (titulo.textContent !== textoTitulo) titulo.textContent = textoTitulo;
      if (extracto.textContent !== textoExtracto) extracto.textContent = textoExtracto;
      const seleccionActual = conversacionAdmin?.id === conversacion.id ? "true" : "false";
      if (boton.getAttribute("aria-current") !== seleccionActual) boton.setAttribute("aria-current", seleccionActual);
      ordenNuevo.push(li);
      existentes.delete(id);
      if (String(conversacionAdmin?.id) === id) conversacionAdmin = conversacion;
    }
    for (const li of existentes.values()) li.remove();
    // Mantiene los nodos y el foco entre polls; solo mueve elementos si cambió
    // realmente el orden (por ejemplo, al llegar un mensaje nuevo).
    ordenNuevo.forEach((li, indice) => {
      if (lista.children[indice] !== li) lista.insertBefore(li, lista.children[indice] || null);
    });
    const estadoLista = porId("chat-admin-estado");
    const textoEstado = conversaciones.length
      ? `${conversaciones.length} conversación${conversaciones.length === 1 ? "" : "es"}${hayMasAdmin ? " cargadas; hay más disponibles." : "."}`
      : "No hay conversaciones en esta vista.";
    if (estadoLista.textContent !== textoEstado) estadoLista.textContent = textoEstado;
    if (idEnFoco) {
      const botonEnFoco = lista.querySelector(`[data-conversation-id="${CSS.escape(idEnFoco)}"]`);
      if (botonEnFoco && document.activeElement !== botonEnFoco) botonEnFoco.focus({ preventScroll: true });
    }
  }

  async function cargarListaAdmin({ append = false } = {}) {
    if (listaAdminEnVuelo || !adminAutenticado) return;
    listaAdminEnVuelo = true;
    try {
      const filtro = porId("chat-admin-filtro").value;
      if (filtro !== filtroListaAdmin) {
        filtroListaAdmin = filtro;
        conversacionesAdmin = [];
        cursorSiguienteAdmin = null;
        hayMasAdmin = false;
        paginasAdminCargadas = false;
      }
      const parametros = new URLSearchParams();
      if (filtro !== "todas") parametros.set("estado", filtro);
      if (append && cursorSiguienteAdmin) parametros.set("cursor_id", cursorSiguienteAdmin);
      const query = parametros.size ? `?${parametros}` : "";
      const { conversaciones = [], hay_mas: hayMas = false, siguiente_cursor: siguienteCursorLista = null } = await api(`/api/admin/chat/conversaciones${query}`);
      if (append) {
        const yaCargadas = new Set(conversacionesAdmin.map((item) => String(item.id)));
        conversacionesAdmin = [...conversacionesAdmin, ...conversaciones.filter((item) => !yaCargadas.has(String(item.id)))];
        paginasAdminCargadas = true;
        cursorSiguienteAdmin = siguienteCursorLista;
        hayMasAdmin = hayMas;
      } else {
        const idsPaginaReciente = new Set(conversaciones.map((item) => String(item.id)));
        const paginadasAnteriores = paginasAdminCargadas
          ? conversacionesAdmin.filter((item) => !idsPaginaReciente.has(String(item.id)))
          : [];
        conversacionesAdmin = [...conversaciones, ...paginadasAnteriores];
        if (!paginasAdminCargadas) cursorSiguienteAdmin = siguienteCursorLista;
        hayMasAdmin = paginasAdminCargadas ? hayMasAdmin : hayMas;
      }
      porId("chat-admin-cargar-mas").hidden = !hayMasAdmin;
      listarConversacionesAdmin(conversacionesAdmin);
    } catch (error) {
      estado(porId("chat-admin-estado"), error.status === 401 ? "Tu sesión administrativa venció." : error.message, "error");
      if (error.status === 401) comprobarAdmin();
    } finally { listaAdminEnVuelo = false; }
  }

  function seleccionarConversacionAdmin(conversacion) {
    if (conversacionAdmin) borradoresAdmin.set(String(conversacionAdmin.id), {
      texto: porId("chat-admin-texto").value, solicitud: solicitudAdminPendiente,
    });
    conversacionAdmin = conversacion;
    const borrador = borradoresAdmin.get(String(conversacion.id));
    porId("chat-admin-texto").value = borrador?.texto || "";
    solicitudAdminPendiente = borrador?.solicitud || null;
    cursorAdmin = null;
    idsAdmin = new Set();
    porId("chat-admin-mensajes").replaceChildren();
    porId("chat-admin-vehiculo").textContent = nombreVehiculo(conversacion);
    porId("chat-admin-estado-conversacion").textContent = conversacion.estado === "atendida" ? "Atendida" : "Pendiente";
    porId("chat-admin-atendida").hidden = conversacion.estado === "atendida";
    porId("chat-admin-form").hidden = false;
    cargarMensajesAdmin(true);
    reiniciarPollingAdmin();
    listaAdminMarcarSeleccionada(conversacion.id);
    dialogoAdmin.dataset.vista = "hilo";
    if (window.matchMedia("(max-width: 650px)").matches) porId("chat-admin-volver").focus();
  }

  function listaAdminMarcarSeleccionada(identificador) {
    porId("chat-admin-lista").querySelectorAll("button[data-conversation-id]").forEach((boton) => {
      boton.setAttribute("aria-current", boton.dataset.conversationId === String(identificador) ? "true" : "false");
    });
  }

  async function cargarMensajesAdmin() {
    if (!conversacionAdmin || adminEnVuelo || !adminAutenticado) return;
    adminEnVuelo = true;
    const conversacionSolicitada = String(conversacionAdmin.id);
    try {
      const despues = cursorAdmin === null ? 0 : encodeURIComponent(cursorAdmin);
      const { mensajes = [] } = await api(`/api/admin/chat/conversaciones/${encodeURIComponent(conversacionAdmin.id)}/mensajes?despues_de_id=${despues}`);
      if (String(conversacionAdmin?.id) !== conversacionSolicitada) return;
      agregarMensajes(porId("chat-admin-mensajes"), mensajes, idsAdmin);
      cursorAdmin = siguienteCursor(mensajes, cursorAdmin);
      if (mensajes.length) estado(porId("chat-admin-feedback"), "Conectado.");
    } catch (error) {
      estado(porId("chat-admin-feedback"), error.status === 401 ? "Tu sesión administrativa venció." : "No pudimos actualizar los mensajes. Reintentaremos automáticamente.", "error");
      if (error.status === 401) comprobarAdmin();
    } finally {
      adminEnVuelo = false;
      if (String(conversacionAdmin?.id) !== conversacionSolicitada && dialogoAdmin.open && adminAutenticado) {
        queueMicrotask(() => cargarMensajesAdmin());
      }
    }
  }

  function detenerPollingAdmin() { clearTimeout(timerAdmin); timerAdmin = null; }
  function reiniciarPollingAdmin() {
    detenerPollingAdmin();
    if (!document.hidden && dialogoAdmin.open && adminAutenticado) timerAdmin = setTimeout(cicloAdmin, intervalo);
  }
  async function cicloAdmin() {
    timerAdmin = null;
    if (document.hidden || !dialogoAdmin.open || !adminAutenticado || adminEnVuelo || listaAdminEnVuelo) return reiniciarPollingAdmin();
    await cargarListaAdmin();
    await cargarMensajesAdmin();
    reiniciarPollingAdmin();
  }

  async function enviarAdmin(evento) {
    evento.preventDefault();
    const texto = porId("chat-admin-texto").value.trim();
    const boton = porId("chat-admin-enviar");
    if (!texto || boton.disabled || !conversacionAdmin) return;
    if (!solicitudAdminPendiente || solicitudAdminPendiente.texto !== texto) solicitudAdminPendiente = { texto, clave: crypto.randomUUID() };
    const destino = String(conversacionAdmin.id);
    boton.disabled = true;
    estado(porId("chat-admin-feedback"), "Enviando respuesta…");
    try {
      const respuesta = await api(`/api/admin/chat/conversaciones/${encodeURIComponent(conversacionAdmin.id)}/mensajes`, {
        metodo: "POST", cuerpoJson: { contenido: texto }, csrf: csrfAdmin(), idempotencyKey: solicitudAdminPendiente.clave,
      });
      borradoresAdmin.delete(destino);
      if (String(conversacionAdmin?.id) !== destino) {
        await cargarListaAdmin();
        return;
      }
      const campoTexto = porId("chat-admin-texto");
      if (campoTexto.value.trim() === texto) campoTexto.value = "";
      solicitudAdminPendiente = null;
      if (respuesta.mensaje) {
        agregarMensajes(porId("chat-admin-mensajes"), [respuesta.mensaje], idsAdmin);
        cursorAdmin = respuesta.mensaje.id;
      }
      estado(porId("chat-admin-feedback"), "Respuesta enviada.");
      await cargarListaAdmin();
      porId("chat-admin-texto").focus();
    } catch (error) {
      estado(porId("chat-admin-feedback"), error.status === 401 ? "Tu sesión administrativa venció." : error.message, "error");
      if (error.status === 401) comprobarAdmin();
    } finally { boton.disabled = false; }
  }

  async function marcarAtendida() {
    if (!conversacionAdmin || !adminAutenticado) return;
    const boton = porId("chat-admin-atendida");
    boton.disabled = true;
    try {
      await api(`/api/admin/chat/conversaciones/${encodeURIComponent(conversacionAdmin.id)}/atendida`, {
        metodo: "PATCH", cuerpoJson: { atendida: true }, csrf: csrfAdmin(),
      });
      conversacionAdmin = { ...conversacionAdmin, estado: "atendida" };
      porId("chat-admin-estado-conversacion").textContent = "Atendida";
      boton.hidden = true;
      estado(porId("chat-admin-feedback"), "Conversación marcada como atendida.");
      await cargarListaAdmin();
    } catch (error) {
      estado(porId("chat-admin-feedback"), error.message, "error");
    } finally { boton.disabled = false; }
  }

  async function abrirAdmin() {
    await comprobarAdmin();
    if (!adminAutenticado) return;
    dialogoAdmin.dataset.vista = "lista";
    dialogoAdmin.showModal();
    sincronizarBloqueoScroll();
    await cargarListaAdmin();
    reiniciarPollingAdmin();
    porId("chat-admin-filtro").focus();
  }

  function cerrarAdmin() {
    detenerPollingAdmin();
    if (dialogoAdmin.open) dialogoAdmin.close();
    sincronizarBloqueoScroll();
    porId("abrir-mensajes").focus();
  }

  function sincronizarBloqueoScroll() {
    document.body.classList.toggle("dialog-open", Boolean(dialogoComprador.open || dialogoAdmin.open));
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

  botonAbrirAdmin.addEventListener("click", abrirAdmin);
  porId("cerrar-mensajes").addEventListener("click", cerrarAdmin);
  porId("chat-admin-volver").addEventListener("click", () => {
    dialogoAdmin.dataset.vista = "lista";
    porId("chat-admin-lista").querySelector('[aria-current="true"]')?.focus();
  });
  porId("cerrar-mensajes-pie").addEventListener("click", cerrarAdmin);
  porId("chat-admin-form").addEventListener("submit", enviarAdmin);
  porId("chat-admin-atendida").addEventListener("click", marcarAtendida);
  porId("chat-admin-filtro").addEventListener("change", cargarListaAdmin);
  porId("chat-admin-cargar-mas").addEventListener("click", () => cargarListaAdmin({ append: true }));
  porId("actualizar-conversaciones").addEventListener("click", async () => {
    await cargarListaAdmin();
    await cargarMensajesAdmin();
  });
  dialogoAdmin.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarAdmin(); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      detenerPollingComprador();
      detenerPollingAdmin();
    } else {
      reiniciarPollingComprador();
      reiniciarPollingAdmin();
    }
  });

  const observadorSesion = new MutationObserver(() => comprobarAdmin());
  ["abrir-login", "cerrar-sesion"].forEach((id) => {
    const boton = porId(id);
    if (boton) observadorSesion.observe(boton, { attributes: true, attributeFilter: ["hidden"] });
  });

  comprobarAdmin();
})();
