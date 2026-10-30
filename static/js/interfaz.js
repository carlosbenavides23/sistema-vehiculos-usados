"use strict";

(() => {
  const porId = (id) => document.getElementById(id);
  const formulario = porId("formulario-vehiculo");
  const dialogo = porId("formulario-dialogo");
  const dialogoLogin = porId("login-dialogo");
  const formularioLogin = porId("login-form");
  const dialogoFotos = porId("fotografias-dialogo");
  const filtrosCatalogo = porId("filtros-catalogo");
  const idFicha = document.body.dataset.vehiculoId || "";
  const dolaresEnteros = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const entero = new Intl.NumberFormat("es-NI");
  const metaCsrf = document.querySelector('meta[name="csrf-token"]');
  let csrfToken = metaCsrf?.content || "";
  let vehiculos = [];
  let ocupado = false;
  let habilitado = false;
  let autenticado = false;
  let soloLectura = false;
  let idEnEdicion = null;
  let origenFormulario = null;
  let origenLogin = null;
  let origenFotos = null;
  let idFotos = null;
  let fotoPreparada = null;
  let fotoSustituida = null;
  let fotoParaSeleccionar = null;
  let fotoPorEliminar = null;
  let claveFoto = null;
  let urlVistaPrevia = null;
  let intentoAlta = null;
  let parametrosCatalogoActivos = new URLSearchParams();

  function nuevaClave() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return [...bytes].map((byte, indice) => `${[4, 6, 8, 10].includes(indice) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`).join("");
  }

  function mensaje(texto, tipo = "error") {
    const elemento = porId("mensaje");
    elemento.textContent = texto;
    elemento.className = `message${tipo === "error" ? " message-error" : tipo === "info" ? " message-info" : ""}`;
    elemento.hidden = !texto;
  }

  function actualizarToken(token) {
    if (typeof token !== "string" || !token) return;
    csrfToken = token;
    if (metaCsrf) metaCsrf.content = token;
  }

  function actualizarControles() {
    const sinAcceso = ocupado || !habilitado || !autenticado;
    porId("abrir-login").hidden = autenticado || soloLectura;
    porId("abrir-login").disabled = ocupado;
    porId("cerrar-sesion").hidden = !autenticado;
    porId("cerrar-sesion").disabled = ocupado;
    porId("nuevo-vehiculo").hidden = !autenticado;
    porId("nuevo-vehiculo").disabled = sinAcceso;
    porId("nuevo-desde-vacio").hidden = !autenticado;
    porId("nuevo-desde-vacio").disabled = sinAcceso;
    porId("reintentar").disabled = ocupado;
    document.querySelectorAll(".vehicle-actions").forEach((acciones) => { acciones.hidden = !autenticado; });
    document.querySelectorAll(".vehicle-actions button").forEach((boton) => { boton.disabled = sinAcceso; });
    formulario.querySelectorAll("input, select, textarea").forEach((campo) => {
      campo.disabled = ocupado || (idEnEdicion === null && intentoAlta?.incierto === true);
    });
    formulario.querySelectorAll("button").forEach((campo) => { campo.disabled = ocupado; });
    porId("guardar-vehiculo").disabled = sinAcceso;
    porId("cerrar-formulario").disabled = ocupado;
    porId("inventario").setAttribute("aria-busy", String(ocupado));
    porId("guardar-vehiculo").textContent = ocupado ? "Guardando…" : idEnEdicion === null ? intentoAlta?.incierto ? "Confirmar registro" : "Registrar vehículo" : "Guardar cambios";
    formularioLogin.querySelectorAll("input, button").forEach((campo) => { campo.disabled = ocupado; });
    filtrosCatalogo.querySelectorAll("input, select, button").forEach((campo) => { campo.disabled = ocupado; });
    porId("cerrar-login").disabled = ocupado;
    dialogoFotos.querySelectorAll("button, input").forEach((campo) => { campo.disabled = ocupado || !autenticado; });
    porId("confirmar-foto").disabled = ocupado || !autenticado || !fotoPreparada;
    porId("inventario").setAttribute("aria-busy", String(ocupado));
  }

  function bloquear(titulo, detalle) {
    habilitado = false;
    porId("cargando").hidden = true;
    porId("estado-vacio").hidden = true;
    porId("estado-sin-resultados").hidden = true;
    porId("estado-bloqueado").hidden = false;
    porId("titulo-bloqueado").textContent = titulo;
    porId("detalle-bloqueado").textContent = detalle;
    porId("lista-vehiculos").replaceChildren();
    ["total-vehiculos", "total-disponibles", "total-vendidos"].forEach((id) => { porId(id).textContent = "—"; });
    porId("resumen-listado").textContent = "El catálogo no está disponible temporalmente.";
    actualizarControles();
  }

  async function solicitar(ruta, metodo = "GET", cuerpo = null, extras = {}) {
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), extras.limiteMs || 15000);
    const opciones = {
      method: metodo,
      headers: { ...extras.headers },
      credentials: "same-origin",
      cache: "no-store",
      signal: control.signal
    };
    if (cuerpo instanceof FormData) {
      opciones.body = cuerpo;
    } else if (cuerpo !== null) {
      opciones.headers["Content-Type"] = "application/json";
      opciones.body = JSON.stringify(cuerpo);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) {
      if (!csrfToken) {
        clearTimeout(limite);
        throw new Error("No se encontró el token de seguridad. Recarga la página e inténtalo de nuevo.");
      }
      opciones.headers["X-CSRF-Token"] = csrfToken;
    }
    try {
      let respuesta;
      try {
        respuesta = await fetch(ruta, opciones);
      } catch (error) {
        throw new Error("No pudimos comunicarnos con el servidor. Comprueba la conexión e inténtalo de nuevo.");
      }
      let resultado;
      try { resultado = await respuesta.json(); }
      catch (error) { throw new Error("El servidor no devolvió una respuesta válida. Inténtalo de nuevo."); }
      if (!respuesta.ok || resultado.ok !== true) {
        const error = new Error(resultado.mensaje || "No pudimos completar la operación. Inténtalo de nuevo.");
        error.errores = resultado.errores || {};
        error.status = respuesta.status;
        error.espera = respuesta.headers.get("Retry-After");
        throw error;
      }
      return resultado;
    } finally { clearTimeout(limite); }
  }

  async function cargarCatalogo() {
    const query = parametrosCatalogoActivos.toString();
    const ruta = query ? `/api/vehiculos?${query}` : "/api/vehiculos";
    const resultado = await solicitar(ruta);
    if (!Array.isArray(resultado.vehiculos)) throw new Error("El servidor no devolvió una lista de vehículos válida.");
    vehiculos = resultado.vehiculos;
    habilitado = true;
    renderizar();
  }

  function urlFotoSegura(valor) {
    if (typeof valor !== "string" || !valor) return null;
    try {
      const url = new URL(valor, location.origin);
      return url.protocol === "https:" || (url.protocol === "http:" && url.origin === location.origin) ? url.href : null;
    } catch (error) { return null; }
  }

  function galeriaTarjeta(tarjeta, vehiculo) {
    const fotos = (vehiculo.fotografias || []).filter((foto) => urlFotoSegura(foto.url));
    if (!fotos.length) return;
    const arte = tarjeta.querySelector(".vehicle-art");
    const imagen = tarjeta.querySelector(".vehicle-image");
    const respaldo = imagen.src;
    const navegacion = tarjeta.querySelector(".photo-navigation");
    const contador = tarjeta.querySelector(".photo-count");
    let posicion = 0;
    function mostrar() {
      arte.classList.add("has-photos");
      imagen.alt = `Fotografía ${posicion + 1} de ${fotos.length}: ${vehiculo.marca} ${vehiculo.modelo}`;
      imagen.onerror = () => {
        imagen.onerror = null;
        arte.classList.remove("has-photos");
        imagen.src = respaldo;
        imagen.alt = "Fotografía no disponible temporalmente; ilustración del vehículo";
        contador.textContent = `${posicion + 1} / ${fotos.length} · No disponible`;
      };
      imagen.src = urlFotoSegura(fotos[posicion].url);
      contador.textContent = `${posicion + 1} / ${fotos.length}`;
    }
    navegacion.hidden = fotos.length <= 1;
    tarjeta.querySelector(".photo-prev").setAttribute("aria-label", `Fotografía anterior de ${vehiculo.marca} ${vehiculo.modelo}`);
    tarjeta.querySelector(".photo-next").setAttribute("aria-label", `Fotografía siguiente de ${vehiculo.marca} ${vehiculo.modelo}`);
    tarjeta.querySelector(".photo-prev").addEventListener("click", () => {
      posicion = (posicion - 1 + fotos.length) % fotos.length;
      mostrar();
    });
    tarjeta.querySelector(".photo-next").addEventListener("click", () => {
      posicion = (posicion + 1) % fotos.length;
      mostrar();
    });
    mostrar();
  }

  function mensajeFotos(texto, tipo = "error") {
    const elemento = porId("mensaje-fotografias");
    elemento.textContent = texto;
    elemento.className = `message${tipo === "error" ? " message-error" : tipo === "info" ? " message-info" : ""}`;
    elemento.hidden = !texto;
  }

  function descartarFoto() {
    if (urlVistaPrevia) URL.revokeObjectURL(urlVistaPrevia);
    urlVistaPrevia = null;
    fotoPreparada = null;
    fotoSustituida = null;
    fotoParaSeleccionar = null;
    claveFoto = null;
    porId("foto-preparada").hidden = true;
    porId("foto-vista-previa").removeAttribute("src");
    porId("fotografia-archivo").value = "";
    porId("fotografia-sustituta").value = "";
  }

  function cancelarBorradoFoto() {
    fotoPorEliminar = null;
    porId("confirmar-borrado-foto").hidden = true;
  }

  function renderizarFotos() {
    const vehiculo = vehiculos.find((actual) => actual.id === idFotos);
    if (!vehiculo) return;
    const fotos = [...(vehiculo.fotografias || [])].sort((a, b) => a.orden - b.orden);
    porId("contador-fotografias").textContent = `${fotos.length} de 5 fotografías`;
    porId("fotografias-vacias").hidden = fotos.length !== 0;
    porId("selector-fotografia").hidden = fotos.length >= 5;
    const lista = porId("fotografias-actuales");
    lista.replaceChildren();
    fotos.forEach((foto, posicion) => {
      const figura = document.createElement("figure");
      figura.className = "photo-editor-item";
      const imagen = document.createElement("img");
      imagen.alt = `Fotografía ${posicion + 1} de ${vehiculo.marca} ${vehiculo.modelo}`;
      imagen.src = urlFotoSegura(foto.url) || "/static/img/vehiculo.svg";
      imagen.onerror = () => { imagen.onerror = null; imagen.src = "/static/img/vehiculo.svg"; imagen.alt = "Fotografía no disponible temporalmente"; };
      const pie = document.createElement("figcaption");
      const etiqueta = document.createElement("span");
      etiqueta.textContent = `Fotografía ${posicion + 1}`;
      const acciones = document.createElement("div");
      acciones.className = "photo-item-actions";
      const reemplazar = document.createElement("button");
      reemplazar.type = "button";
      reemplazar.className = "photo-replace";
      reemplazar.dataset.fotoId = foto.id;
      reemplazar.textContent = "Sustituir";
      reemplazar.setAttribute("aria-label", `Sustituir fotografía ${posicion + 1}`);
      reemplazar.addEventListener("click", () => {
        if (ocupado || !autenticado) return;
        fotoParaSeleccionar = foto;
        porId("fotografia-sustituta").value = "";
        porId("fotografia-sustituta").click();
      });
      const eliminar = document.createElement("button");
      eliminar.type = "button";
      eliminar.className = "photo-delete";
      eliminar.dataset.fotoId = foto.id;
      eliminar.textContent = "Eliminar";
      eliminar.setAttribute("aria-label", `Eliminar fotografía ${posicion + 1}`);
      eliminar.addEventListener("click", () => {
        if (ocupado || !autenticado) return;
        descartarFoto();
        fotoPorEliminar = foto;
        porId("texto-borrado-foto").textContent = `¿Eliminar la fotografía ${posicion + 1} del vehículo? Esta acción se confirma por separado de los demás datos.`;
        porId("confirmar-borrado-foto").hidden = false;
        porId("cancelar-borrado-foto").focus();
      });
      acciones.append(reemplazar, eliminar);
      pie.append(etiqueta, acciones);
      figura.append(imagen, pie);
      lista.append(figura);
    });
    actualizarControles();
  }

  function abrirFotos(vehiculo, origen = null, registrado = false) {
    if (ocupado || !autenticado || !habilitado) return;
    idFotos = vehiculo.id;
    origenFotos = origen;
    descartarFoto();
    cancelarBorradoFoto();
    porId("fotografias-vehiculo").textContent = `${vehiculo.marca} ${vehiculo.modelo} · N.º ${vehiculo.id}`;
    mensajeFotos(registrado ? "El vehículo ya está guardado. Puedes añadir fotografías ahora o cerrar esta ventana y hacerlo después." : "", "info");
    renderizarFotos();
    dialogoFotos.showModal();
    document.body.classList.add("dialog-open");
    porId("terminar-fotografias").focus();
  }

  function cerrarFotos() {
    if (ocupado) return;
    descartarFoto();
    cancelarBorradoFoto();
    dialogoFotos.close();
    document.body.classList.remove("dialog-open");
    if (origenFotos?.isConnected) origenFotos.focus();
    else document.querySelector(`[data-fotografias-id="${idFotos}"]`)?.focus();
    idFotos = null;
  }

  async function prepararSeleccion(archivo, reemplazo = null) {
    if (!archivo || ocupado || !autenticado) return;
    ocupado = true;
    descartarFoto();
    cancelarBorradoFoto();
    mensajeFotos("Preparando la fotografía…", "info");
    actualizarControles();
    try {
      fotoPreparada = await window.Fotografias.preparar(archivo);
      fotoSustituida = reemplazo;
      claveFoto = nuevaClave();
      urlVistaPrevia = URL.createObjectURL(fotoPreparada.archivo);
      porId("foto-vista-previa").src = urlVistaPrevia;
      porId("foto-detalle").textContent = `${fotoPreparada.ancho} × ${fotoPreparada.alto} px · ${Math.ceil(fotoPreparada.archivo.size / 1000)} KB. ${reemplazo ? "La foto actual se conserva hasta que confirmes y se complete la sustitución." : "La vista previa aún no se ha guardado."}`;
      porId("confirmar-foto").textContent = reemplazo ? "Confirmar sustitución" : "Subir fotografía";
      porId("foto-preparada").hidden = false;
      mensajeFotos("");
    } catch (error) {
      descartarFoto();
      mensajeFotos(error.message);
    } finally {
      ocupado = false;
      actualizarControles();
      if (fotoPreparada) porId("confirmar-foto").focus();
    }
  }

  function aplicarFotos(resultado) {
    if (!Array.isArray(resultado.fotografias)) throw new Error("No pudimos confirmar el estado de las fotos. Pulsa Actualizar fotos antes de repetir.");
    vehiculos = vehiculos.map((vehiculo) => vehiculo.id === idFotos ? { ...vehiculo, fotografias: resultado.fotografias } : vehiculo);
    renderizar();
    renderizarFotos();
  }

  async function subirFoto() {
    if (ocupado || !autenticado || !fotoPreparada || idFotos === null) return;
    ocupado = true;
    actualizarControles();
    const reemplazo = fotoSustituida;
    const cuerpo = new FormData();
    cuerpo.append("fotografia", fotoPreparada.archivo);
    mensajeFotos(reemplazo ? "Guardando la sustitución…" : "Subiendo fotografía…", "info");
    try {
      const ruta = `/api/vehiculos/${idFotos}/fotografias${reemplazo ? `/${reemplazo.id}` : ""}`;
      const resultado = await solicitar(ruta, reemplazo ? "PUT" : "POST", cuerpo, { headers: { "Idempotency-Key": claveFoto }, limiteMs: 30000 });
      aplicarFotos(resultado);
      descartarFoto();
      mensajeFotos(reemplazo ? "Fotografía sustituida." : "Fotografía guardada.", "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      else mensajeFotos(`${error.message} La selección se conserva para que puedas reintentar; las demás fotos no se modifican.`);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

  async function eliminarFoto() {
    if (ocupado || !autenticado || !fotoPorEliminar || idFotos === null) return;
    ocupado = true;
    actualizarControles();
    try {
      const resultado = await solicitar(`/api/vehiculos/${idFotos}/fotografias/${fotoPorEliminar.id}`, "DELETE");
      aplicarFotos(resultado);
      cancelarBorradoFoto();
      mensajeFotos("Fotografía eliminada del vehículo.", "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      else mensajeFotos(`${error.message} Pulsa Actualizar fotos para comprobar el estado antes de repetir.`);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

  async function actualizarFotos() {
    if (ocupado || !autenticado || idFotos === null) return;
    ocupado = true;
    actualizarControles();
    try {
      const resultado = await solicitar(`/api/vehiculos/${idFotos}`);
      if (!resultado.vehiculo) throw new Error("No pudimos obtener el vehículo.");
      vehiculos = vehiculos.map((actual) => actual.id === idFotos ? resultado.vehiculo : actual);
      cancelarBorradoFoto();
      renderizar();
      renderizarFotos();
      mensajeFotos("Fotografías actualizadas.", "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      else mensajeFotos(error.message);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

  function quitarPlacasEnMemoria() {
    vehiculos = vehiculos.map((vehiculo) => {
      const { placa, ...datosPublicos } = vehiculo;
      return datosPublicos;
    });
    const campoPlaca = formulario.elements.namedItem("placa");
    if (campoPlaca) campoPlaca.value = "";
  }

  async function manejarSesionExpirada() {
    autenticado = false;
    quitarPlacasEnMemoria();
    descartarFoto();
    cancelarBorradoFoto();
    if (dialogoFotos.open) dialogoFotos.close();
    if (dialogo.open) dialogo.close();
    document.body.classList.remove("dialog-open");
    renderizar();
    try { await cargarCatalogo(); }
    catch (error) {
      // Se retira la placa de memoria aunque falle la recarga pública.
      mensaje("Tu sesión expiró. Se ocultaron los datos administrativos; vuelve a cargar el catálogo.", "info");
      return;
    }
    mensaje("Tu sesión expiró. Inicia sesión otra vez para modificar el catálogo.", "info");
  }

  function renderizar() {
    const lista = porId("lista-vehiculos");
    lista.replaceChildren();
    const fragmento = document.createDocumentFragment();
    vehiculos.forEach((vehiculo) => {
      const tarjeta = porId("plantilla-vehiculo").content.cloneNode(true);
      tarjeta.querySelector("article").dataset.vehiculoId = vehiculo.id;
      const disponible = vehiculo.disponibilidad === "disponible";
      const nombre = `${vehiculo.marca} ${vehiculo.modelo}`;
      tarjeta.querySelector("h3").textContent = nombre;
      tarjeta.querySelector(".vehicle-year").textContent = vehiculo.anio;
      tarjeta.querySelector(".vehicle-location").textContent = vehiculo.ubicacion;
      tarjeta.querySelector(".vehicle-description").textContent = vehiculo.descripcion;
      tarjeta.querySelector(".vehicle-mileage").textContent = `${entero.format(vehiculo.kilometraje)} km`;
      const parteEntera = dolaresEnteros.format(Math.floor(vehiculo.precio_centavos / 100));
      const parteDecimal = String(vehiculo.precio_centavos % 100).padStart(2, "0");
      tarjeta.querySelector(".vehicle-price").textContent = `$${parteEntera}.${parteDecimal}`;
      const enlaceFicha = tarjeta.querySelector(".detail-link");
      const retorno = `${location.pathname}${location.search}`;
      enlaceFicha.href = `/vehiculo/${encodeURIComponent(vehiculo.id)}?retorno=${encodeURIComponent(retorno)}`;
      enlaceFicha.setAttribute("aria-label", `Ver ficha completa de ${nombre}`);

      const insignia = tarjeta.querySelector(".vehicle-badge");
      insignia.textContent = disponible ? "Disponible" : "Vendido";
      insignia.classList.toggle("sold", !disponible);
      const acciones = tarjeta.querySelector(".vehicle-actions");
      acciones.hidden = !autenticado;
      const editar = tarjeta.querySelector(".edit-button");
      editar.setAttribute("aria-label", `Editar ${nombre}, registro ${vehiculo.id}`);
      editar.addEventListener("click", () => abrirFormulario(vehiculo, editar));
      const fotografias = tarjeta.querySelector(".photos-button");
      fotografias.dataset.fotografiasId = vehiculo.id;
      fotografias.setAttribute("aria-label", `Fotografías de ${nombre}, registro ${vehiculo.id}`);
      fotografias.addEventListener("click", () => abrirFotos(vehiculo, fotografias));
      const botonDisponibilidad = tarjeta.querySelector(".availability-button");
      botonDisponibilidad.dataset.disponibilidadId = vehiculo.id;
      botonDisponibilidad.textContent = disponible ? "Marcar vendido" : "Marcar disponible";
      botonDisponibilidad.setAttribute("aria-label", `${disponible ? "Marcar vendido" : "Marcar disponible"}: ${nombre}, registro ${vehiculo.id}`);
      botonDisponibilidad.addEventListener("click", () => cambiarDisponibilidad(vehiculo));
      galeriaTarjeta(tarjeta, vehiculo);
      fragmento.append(tarjeta);
    });
    lista.append(fragmento);

    const total = vehiculos.length;
    const filtrosActivos = parametrosCatalogoActivos.size > 0;
    const disponibles = vehiculos.filter((vehiculo) => vehiculo.disponibilidad === "disponible").length;
    porId("total-vehiculos").textContent = total;
    porId("total-disponibles").textContent = disponibles;
    porId("total-vendidos").textContent = total - disponibles;
    porId("resumen-listado").textContent = total === 0
      ? (filtrosActivos ? "No hay resultados para esta búsqueda." : "Todavía no hay vehículos publicados.")
      : `${total} ${total === 1 ? "vehículo encontrado" : "vehículos encontrados"}`;
    porId("cargando").hidden = true;
    porId("estado-bloqueado").hidden = true;
    porId("estado-vacio").hidden = total !== 0 || filtrosActivos;
    porId("estado-sin-resultados").hidden = total !== 0 || !filtrosActivos;
    actualizarControles();
  }

  function copiarFiltrosDesdeUrl() {
    const parametros = new URLSearchParams(location.search);
    for (const campo of filtrosCatalogo.elements) {
      if (campo.name && parametros.has(campo.name)) campo.value = parametros.get(campo.name);
    }
    parametrosCatalogoActivos = leerParametrosCatalogo();
  }

  function leerParametrosCatalogo() {
    const parametros = new URLSearchParams(new FormData(filtrosCatalogo));
    for (const [clave, valor] of [...parametros.entries()]) {
      if (!valor.trim()) parametros.delete(clave);
    }
    return parametros;
  }

  async function buscarConFiltros(actualizarHistorial = true) {
    if (ocupado || idFicha) return;
    parametrosCatalogoActivos = leerParametrosCatalogo();
    const query = parametrosCatalogoActivos.toString();
    if (actualizarHistorial) {
      history.pushState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
    }
    ocupado = true;
    habilitado = false;
    porId("cargando").hidden = false;
    porId("estado-vacio").hidden = true;
    porId("estado-sin-resultados").hidden = true;
    porId("estado-bloqueado").hidden = true;
    porId("lista-vehiculos").replaceChildren();
    actualizarControles();
    try {
      await cargarCatalogo();
      mensaje("");
    } catch (error) {
      bloquear("No pudimos actualizar el catálogo", error.message);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

  function mostrarFichaError(error) {
    porId("ficha-vehiculo").setAttribute("aria-busy", "false");
    porId("ficha-cargando").hidden = true;
    porId("ficha-contenido").hidden = true;
    porId("ficha-error-detalle").textContent = error.message || "Inténtalo de nuevo más tarde.";
    porId("ficha-error").hidden = false;
  }

  function precioLegible(centavos) {
    const enteroPrecio = dolaresEnteros.format(Math.floor(centavos / 100));
    const centavosPrecio = String(centavos % 100).padStart(2, "0");
    return `$${enteroPrecio}.${centavosPrecio} USD`;
  }

  function inicializarGaleriaFicha(vehiculo) {
    const imagen = porId("ficha-imagen");
    const navegacion = porId("ficha-navegacion");
    const contador = porId("ficha-contador");
    const fotos = [...(vehiculo.fotografias || [])]
      .filter((foto) => urlFotoSegura(foto.url))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const respaldo = "/static/img/vehiculo.svg";
    if (!fotos.length) {
      imagen.src = respaldo;
      imagen.alt = `Ilustración de ${vehiculo.marca} ${vehiculo.modelo}; no hay fotografías publicadas.`;
      navegacion.hidden = true;
      return;
    }
    let posicion = 0;
    function mostrar() {
      imagen.onerror = () => {
        imagen.onerror = null;
        imagen.src = respaldo;
        imagen.alt = `Fotografía no disponible. Ilustración de ${vehiculo.marca} ${vehiculo.modelo}.`;
        contador.textContent = `${posicion + 1} / ${fotos.length} · No disponible`;
      };
      imagen.alt = `Fotografía ${posicion + 1} de ${fotos.length}: ${vehiculo.marca} ${vehiculo.modelo}`;
      imagen.src = urlFotoSegura(fotos[posicion].url);
      contador.textContent = `${posicion + 1} / ${fotos.length}`;
    }
    navegacion.hidden = fotos.length < 2;
    porId("ficha-anterior").onclick = () => {
      posicion = (posicion - 1 + fotos.length) % fotos.length;
      mostrar();
    };
    porId("ficha-siguiente").onclick = () => {
      posicion = (posicion + 1) % fotos.length;
      mostrar();
    };
    mostrar();
  }

  function renderizarFicha(vehiculo) {
    const disponible = vehiculo.disponibilidad === "disponible";
    porId("ficha-titulo").textContent = `${vehiculo.marca} ${vehiculo.modelo}`;
    porId("ficha-estado").textContent = disponible ? "Disponible" : "Vendido";
    porId("ficha-estado").classList.toggle("sold", !disponible);
    porId("ficha-ubicacion").textContent = vehiculo.ubicacion || "Ubicación no especificada";
    porId("ficha-anio").textContent = `Año ${vehiculo.anio}`;
    porId("ficha-precio").textContent = precioLegible(vehiculo.precio_centavos);
    porId("ficha-kilometraje").textContent = `${entero.format(vehiculo.kilometraje)} km recorridos`;
    porId("ficha-descripcion").textContent = vehiculo.descripcion || "Sin descripción publicada.";
    const lista = porId("ficha-caracteristicas");
    lista.replaceChildren();
    const caracteristicas = [];
    if (vehiculo.tipo_vehiculo) caracteristicas.push(["Tipo", vehiculo.tipo_vehiculo]);
    if (vehiculo.color) caracteristicas.push(["Color", vehiculo.color]);
    if (vehiculo.transmision) caracteristicas.push(["Transmisión", vehiculo.transmision]);
    if (vehiculo.combustible) caracteristicas.push(["Combustible", vehiculo.combustible]);
    [
      ["aire_acondicionado", "Aire acondicionado"],
      ["ventanas_electricas", "Ventanas eléctricas"],
      ["pantalla_multimedia", "Pantalla multimedia"]
    ].forEach(([campo, etiqueta]) => {
      if (vehiculo[campo] !== null && vehiculo[campo] !== undefined) {
        caracteristicas.push([etiqueta, vehiculo[campo] ? "Sí" : "No"]);
      }
    });
    caracteristicas.forEach(([etiqueta, valor]) => {
      const item = document.createElement("li");
      item.textContent = `${etiqueta}: ${valor}`;
      lista.append(item);
    });
    porId("ficha-caracteristicas-seccion").hidden = caracteristicas.length === 0;
    inicializarGaleriaFicha(vehiculo);
    document.title = `${vehiculo.marca} ${vehiculo.modelo} · Vehículos usados`;
    porId("ficha-vehiculo").setAttribute("aria-busy", "false");
    porId("ficha-cargando").hidden = true;
    porId("ficha-error").hidden = true;
    porId("ficha-contenido").hidden = false;
  }

  async function inicializarFicha() {
    porId("catalogo-intro").hidden = true;
    porId("resumen-inventario").hidden = true;
    porId("inventario").hidden = true;
    porId("ficha-vehiculo").hidden = false;
    porId("abrir-login").hidden = true;
    porId("cerrar-sesion").hidden = true;
    porId("nuevo-vehiculo").hidden = true;
    document.querySelector(".skip-link").href = "#ficha-vehiculo";
    porId("volver-catalogo").href = "/";
    const retorno = new URLSearchParams(location.search).get("retorno");
    if (retorno) {
      try {
        const url = new URL(retorno, location.origin);
        if (url.origin === location.origin && url.pathname === "/") {
          porId("volver-catalogo").href = `${url.pathname}${url.search}`;
        }
      } catch (error) { /* Se conserva el enlace seguro al catálogo. */ }
    }
    try {
      const resultado = await solicitar(`/api/vehiculos/${encodeURIComponent(idFicha)}`);
      if (!resultado.vehiculo || typeof resultado.vehiculo !== "object") throw new Error("El servidor no devolvió los detalles del vehículo.");
      renderizarFicha(resultado.vehiculo);
    } catch (error) {
      mostrarFichaError(error);
    }
  }

  async function inicializar() {
    if (ocupado) return;
    ocupado = true;
    habilitado = false;
    mensaje("");
    porId("cargando").hidden = false;
    porId("estado-bloqueado").hidden = true;
    porId("estado-vacio").hidden = true;
    actualizarControles();
    try {
      try {
        const sesion = await solicitar("/api/admin/session");
        soloLectura = sesion.solo_lectura === true;
        autenticado = !soloLectura && sesion.autenticado === true;
      } catch (error) {
        autenticado = false;
      }
      if (!autenticado) quitarPlacasEnMemoria();
      await cargarCatalogo();
    } catch (error) {
      bloquear("No pudimos abrir el catálogo", error.message);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

  function limpiarErrores() {
    porId("error-formulario").hidden = true;
    porId("error-formulario").textContent = "";
    formulario.querySelectorAll(".field-error").forEach((campo) => { campo.textContent = ""; });
    formulario.querySelectorAll("[aria-invalid]").forEach((campo) => campo.removeAttribute("aria-invalid"));
  }

  function erroresFormulario(error) {
    limpiarErrores();
    porId("error-formulario").textContent = error.message;
    porId("error-formulario").hidden = false;
    let primerCampo = null;
    Object.entries(error.errores || {}).forEach(([nombre, texto]) => {
      const campo = formulario.elements.namedItem(nombre);
      const salida = porId(`error-${nombre}`);
      if (campo && salida) {
        campo.setAttribute("aria-invalid", "true");
        salida.textContent = texto;
        if (!primerCampo) primerCampo = campo;
      }
    });
    (primerCampo || porId("error-formulario")).focus();
  }

  function abrirFormulario(vehiculo = null, origen = porId("nuevo-vehiculo")) {
    if (ocupado || !habilitado || !autenticado) return;
    idEnEdicion = vehiculo ? vehiculo.id : null;
    origenFormulario = origen;
    formulario.reset();
    limpiarErrores();
    if (vehiculo) {
      ["marca", "modelo", "anio", "kilometraje", "ubicacion", "descripcion", "disponibilidad", "color", "placa", "tipo_vehiculo", "transmision", "combustible"].forEach((nombre) => {
        formulario.elements.namedItem(nombre).value = vehiculo[nombre] ?? "";
      });
      ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia"].forEach((nombre) => {
        formulario.elements.namedItem(nombre).value = vehiculo[nombre] === null || vehiculo[nombre] === undefined ? "" : String(vehiculo[nombre]);
      });
      formulario.elements.precio_venta.value = `${Math.floor(vehiculo.precio_centavos / 100)}.${String(vehiculo.precio_centavos % 100).padStart(2, "0")}`;
    } else if (intentoAlta?.incierto) {
      Object.entries(intentoAlta.datos).forEach(([nombre, valor]) => {
        const campo = formulario.elements.namedItem(nombre);
        if (campo) campo.value = valor === null ? "" : String(valor);
      });
      erroresFormulario(new Error("El registro anterior no se confirmó. Pulsa Confirmar registro para consultar su resultado sin crear otro vehículo."));
    }
    porId("titulo-formulario").textContent = vehiculo ? "Editar vehículo" : "Registrar vehículo";
    actualizarControles();
    dialogo.showModal();
    document.body.classList.add("dialog-open");
    if (idEnEdicion === null && intentoAlta?.incierto) porId("error-formulario").focus();
    else formulario.elements.marca.focus();
  }

  function cerrarFormulario() {
    if (ocupado) return;
    dialogo.close();
    document.body.classList.remove("dialog-open");
    if (origenFormulario?.isConnected) origenFormulario.focus();
    else porId("nuevo-vehiculo").focus();
  }

  function datosFormulario() {
    const datos = Object.fromEntries(new FormData(formulario));
    ["color", "placa", "tipo_vehiculo", "transmision", "combustible"].forEach((nombre) => {
      datos[nombre] = datos[nombre].trim() || null;
    });
    ["aire_acondicionado", "ventanas_electricas", "pantalla_multimedia"].forEach((nombre) => {
      datos[nombre] = datos[nombre] === "" ? null : datos[nombre] === "true";
    });
    return datos;
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado || !habilitado || !autenticado) return;
    const id = idEnEdicion;
    const datos = id === null && intentoAlta?.incierto ? intentoAlta.datos : datosFormulario();
    if (id === null) {
      const firma = JSON.stringify(datos);
      if (!intentoAlta || intentoAlta.firma !== firma) {
        intentoAlta = { firma, datos: JSON.parse(firma), clave: nuevaClave(), incierto: false };
      }
    }
    const ruta = id === null ? "/api/vehiculos" : `/api/vehiculos/${id}`;
    const metodo = id === null ? "POST" : "PUT";
    ocupado = true;
    actualizarControles();
    limpiarErrores();
    let guardado = false;
    let vehiculoGuardado = null;
    try {
      const resultado = await solicitar(ruta, metodo, { vehiculo: datos }, id === null ? { headers: { "Idempotency-Key": intentoAlta.clave } } : {});
      vehiculoGuardado = resultado.vehiculo;
      if (id === null) {
        vehiculos = [...vehiculos.filter((vehiculo) => vehiculo.id !== resultado.vehiculo.id), resultado.vehiculo];
        intentoAlta = null;
      } else vehiculos = vehiculos.map((vehiculo) => vehiculo.id === id ? { ...vehiculo, ...resultado.vehiculo } : vehiculo);
      habilitado = true;
      renderizar();
      guardado = true;
      mensaje(id === null ? "Vehículo registrado en el catálogo." : "Cambios guardados.", "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      if (id === null && intentoAlta) {
        intentoAlta.incierto = !error.status || error.status >= 500;
        if (intentoAlta.incierto) error.message += " No se confirmó el registro. Pulsa Confirmar registro sin cambiar los datos para reintentar con seguridad.";
      }
      ocupado = false;
      actualizarControles();
      erroresFormulario(error);
    } finally {
      ocupado = false;
      actualizarControles();
      if (guardado) {
        cerrarFormulario();
        if (id === null && vehiculoGuardado) abrirFotos(vehiculoGuardado, null, true);
      }
    }
  });

  async function cambiarDisponibilidad(vehiculo) {
    if (ocupado || !habilitado || !autenticado) return;
    ocupado = true;
    actualizarControles();
    try {
      const nuevaDisponibilidad = vehiculo.disponibilidad === "disponible" ? "vendido" : "disponible";
      const resultado = await solicitar(`/api/vehiculos/${vehiculo.id}/disponibilidad`, "PATCH", { disponibilidad: nuevaDisponibilidad });
      vehiculos = vehiculos.map((actual) => actual.id === vehiculo.id ? { ...actual, ...resultado.vehiculo } : actual);
      renderizar();
      mensaje(`Disponibilidad actualizada para ${vehiculo.marca} ${vehiculo.modelo}.`, "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      else mensaje(error.message);
    } finally {
      ocupado = false;
      actualizarControles();
      document.querySelector(`[data-disponibilidad-id="${vehiculo.id}"]`)?.focus();
    }
  }

  function abrirLogin(origen = porId("abrir-login")) {
    if (ocupado || autenticado || soloLectura) return;
    origenLogin = origen;
    formularioLogin.reset();
    porId("error-login").hidden = true;
    porId("error-login").textContent = "";
    dialogoLogin.showModal();
    document.body.classList.add("dialog-open");
    porId("admin-password").focus();
  }

  function cerrarLogin() {
    if (ocupado) return;
    dialogoLogin.close();
    document.body.classList.remove("dialog-open");
    if (origenLogin?.isConnected) origenLogin.focus();
    else porId("abrir-login").focus();
  }

  formularioLogin.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado || autenticado) return;
    const password = formularioLogin.elements.password.value;
    if (!password) {
      porId("error-login").textContent = "Escribe la contraseña administrativa.";
      porId("error-login").hidden = false;
      formularioLogin.elements.password.focus();
      return;
    }
    ocupado = true;
    porId("error-login").hidden = true;
    porId("error-login").textContent = "";
    actualizarControles();
    try {
      const resultado = await solicitar("/api/admin/login", "POST", { password });
      actualizarToken(resultado.csrf_token);
      autenticado = resultado.autenticado === true;
      if (!autenticado) throw new Error("No se pudo iniciar la sesión administrativa.");
      try {
        await cargarCatalogo();
      } catch (error) {
        dialogoLogin.close();
        document.body.classList.remove("dialog-open");
        bloquear("Sesión iniciada, catálogo pendiente", error.message);
        mensaje("La sesión inició, pero no pudimos cargar el inventario. Pulsa Volver a intentar.", "info");
        return;
      }
      formularioLogin.reset();
      mensaje("Sesión administrativa iniciada.", "exito");
      dialogoLogin.close();
      document.body.classList.remove("dialog-open");
      porId("nuevo-vehiculo").focus();
    } catch (error) {
      porId("error-login").textContent = error.message + (error.espera ? ` Vuelve a intentar en ${error.espera} segundos.` : "");
      porId("error-login").hidden = false;
      formularioLogin.elements.password.value = "";
      formularioLogin.elements.password.focus();
    } finally {
      ocupado = false;
      actualizarControles();
    }
  });

  async function cerrarSesion() {
    if (ocupado || !autenticado) return;
    ocupado = true;
    actualizarControles();
    try {
      const resultado = await solicitar("/api/admin/logout", "POST", {});
      actualizarToken(resultado.csrf_token);
      autenticado = false;
      quitarPlacasEnMemoria();
      descartarFoto();
      cancelarBorradoFoto();
      if (dialogoFotos.open) dialogoFotos.close();
      if (dialogo.open) {
        dialogo.close();
      }
      document.body.classList.remove("dialog-open");
      try { await cargarCatalogo(); }
      catch (error) {
        // La placa ya se retiró y el listado anterior permanece visible hasta reintentar.
        renderizar();
        mensaje("Sesión cerrada. No pudimos actualizar el catálogo; pulsa Volver a intentar.", "info");
        return;
      }
      mensaje("Sesión cerrada.", "exito");
    } catch (error) {
      if (error.status === 401) await manejarSesionExpirada();
      else mensaje(error.message);
    } finally {
      ocupado = false;
      actualizarControles();
      porId("abrir-login").focus();
    }
  }

  porId("nuevo-vehiculo").addEventListener("click", (evento) => abrirFormulario(null, evento.currentTarget));
  porId("nuevo-desde-vacio").addEventListener("click", (evento) => abrirFormulario(null, evento.currentTarget));
  porId("cerrar-formulario").addEventListener("click", cerrarFormulario);
  porId("cancelar-formulario").addEventListener("click", cerrarFormulario);
  porId("abrir-login").addEventListener("click", (evento) => abrirLogin(evento.currentTarget));
  porId("cerrar-login").addEventListener("click", cerrarLogin);
  porId("cancelar-login").addEventListener("click", cerrarLogin);
  porId("cerrar-sesion").addEventListener("click", cerrarSesion);
  porId("reintentar").addEventListener("click", inicializar);
  filtrosCatalogo.addEventListener("submit", (evento) => {
    evento.preventDefault();
    buscarConFiltros();
  });
  filtrosCatalogo.addEventListener("reset", () => {
    setTimeout(() => buscarConFiltros(), 0);
  });
  porId("limpiar-desde-vacio").addEventListener("click", () => filtrosCatalogo.reset());
  window.addEventListener("popstate", () => {
    if (idFicha) return;
    copiarFiltrosDesdeUrl();
    buscarConFiltros(false);
  });
  porId("fotografia-archivo").addEventListener("change", (evento) => prepararSeleccion(evento.target.files[0]));
  porId("fotografia-sustituta").addEventListener("change", (evento) => prepararSeleccion(evento.target.files[0], fotoParaSeleccionar));
  porId("confirmar-foto").addEventListener("click", subirFoto);
  porId("cancelar-foto-preparada").addEventListener("click", () => {
    if (ocupado) return;
    descartarFoto();
    mensajeFotos("Selección descartada. Las fotografías guardadas no cambiaron.", "info");
    actualizarControles();
  });
  porId("actualizar-fotografias").addEventListener("click", actualizarFotos);
  porId("eliminar-foto").addEventListener("click", eliminarFoto);
  porId("cancelar-borrado-foto").addEventListener("click", () => {
    if (!ocupado) cancelarBorradoFoto();
  });
  porId("cerrar-fotografias").addEventListener("click", cerrarFotos);
  porId("terminar-fotografias").addEventListener("click", cerrarFotos);
  dialogo.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarFormulario(); });
  dialogoLogin.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarLogin(); });
  dialogoFotos.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarFotos(); });
  if (idFicha) {
    inicializarFicha();
  } else {
    copiarFiltrosDesdeUrl();
    inicializar();
  }
})();
