"use strict";

(() => {
  const porId = (id) => document.getElementById(id);
  const filtrosCatalogo = porId("filtros-catalogo");
  const detallesFiltros = porId("filtros-avanzados");
  const indicadorFiltrosAvanzados = porId("filtros-avanzados-activos");
  const nombresFiltrosAvanzados = ["precio_min", "precio_max", "anio_min", "anio_max", "tipo_vehiculo", "orden"];
  const idFicha = document.body.dataset.vehiculoId || "";
  const aliasTipos = JSON.parse(porId("vehicle-type-aliases")?.textContent || "{}");
  const dolaresEnteros = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const entero = new Intl.NumberFormat("es-NI");
  let vehiculos = [];
  let ocupado = false;
  let parametrosCatalogoActivos = new URLSearchParams();
  const generacionesFoto = new WeakMap();
  const animacionesFoto = new WeakMap();

  function duracionMovimiento(nombre, predeterminado) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    const numero = Number.parseFloat(valor);
    if (!Number.isFinite(numero)) return predeterminado;
    if (valor.endsWith("ms")) return numero;
    if (valor.endsWith("s")) return numero * 1000;
    return predeterminado;
  }

  function curvaMovimiento(nombre, predeterminada) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || predeterminada;
  }

  function actualizarControles() {
    porId("reintentar").disabled = ocupado;
    filtrosCatalogo.querySelectorAll("input, select, button").forEach((campo) => { campo.disabled = ocupado; });
    porId("inventario").setAttribute("aria-busy", String(ocupado));
  }

  function bloquear(titulo, detalle) {
    porId("cargando").hidden = true;
    porId("estado-vacio").hidden = true;
    porId("estado-sin-resultados").hidden = true;
    porId("estado-bloqueado").hidden = false;
    porId("titulo-bloqueado").textContent = titulo;
    porId("detalle-bloqueado").textContent = detalle;
    porId("lista-vehiculos").replaceChildren();
    porId("resumen-listado").textContent = "El catálogo no está disponible temporalmente.";
    actualizarControles();
  }

  function datosPublicos(vehiculo) {
    if (!vehiculo || typeof vehiculo !== "object") return vehiculo;
    const { placa, ...publicado } = vehiculo;
    return publicado;
  }

  function mensaje(texto, tipo = "error") {
    const elemento = porId("mensaje");
    elemento.textContent = texto;
    elemento.className = `message${tipo === "error" ? " message-error" : tipo === "info" ? " message-info" : ""}`;
    elemento.hidden = !texto;
  }

  async function solicitar(ruta) {
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), 15000);
    try {
      let respuesta;
      try {
        respuesta = await fetch(ruta, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: control.signal,
        });
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
    vehiculos = resultado.vehiculos.map(datosPublicos);
    renderizar();
  }

  function urlFotoSegura(valor) {
    if (typeof valor !== "string" || !valor) return null;
    try {
      const url = new URL(valor, location.origin);
      return url.protocol === "https:" || (url.protocol === "http:" && url.origin === location.origin) ? url.href : null;
    } catch (error) { return null; }
  }

  function mostrarFotoPreparada(imagen, valorUrl, textoAlternativo, alFallar, alCompletar = () => {}) {
    const url = urlFotoSegura(valorUrl);
    const generacion = (generacionesFoto.get(imagen) || 0) + 1;
    generacionesFoto.set(imagen, generacion);
    const animacionAnterior = animacionesFoto.get(imagen);
    animacionesFoto.delete(imagen);
    animacionAnterior?.cancel();

    const vigente = () => generacionesFoto.get(imagen) === generacion;
    let finalizado = false;
    let preparado = false;
    const fallar = () => {
      if (!vigente() || finalizado) return;
      finalizado = true;
      imagen.onload = null;
      imagen.onerror = null;
      const animacion = animacionesFoto.get(imagen);
      animacionesFoto.delete(imagen);
      animacion?.cancel();
      alFallar();
    };
    if (!url) {
      fallar();
      return;
    }

    const terminarCarga = () => {
      if (!vigente() || finalizado || !preparado) return;
      if (!imagen.complete || !imagen.naturalWidth || imagen.currentSrc !== url) return;
      finalizado = true;
      imagen.onload = null;
      imagen.onerror = null;
      alCompletar();

      // El fundido es solo una mejora visual: la foto y el estado accesible ya
      // se actualizaron, así que un WAAPI ausente o cancelado no puede bloquearlos.
      try {
        const duracion = duracionMovimiento("--motion-duration-gallery", 180);
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          || !imagen.isConnected || typeof imagen.animate !== "function" || duracion < 2) return;
        const animacion = imagen.animate(
          [{ opacity: 0.84 }, { opacity: 1 }],
          { duration: duracion, easing: curvaMovimiento("--motion-ease-enter", "ease-out") },
        );
        animacionesFoto.set(imagen, animacion);
        const limpiarAnimacion = () => {
          if (animacionesFoto.get(imagen) === animacion) animacionesFoto.delete(imagen);
        };
        animacion.finished.then(limpiarAnimacion, limpiarAnimacion).catch(() => {});
      } catch (error) {
        // Un error de animación no cambia el resultado de la carga de la foto.
      }
    };

    const mostrar = () => {
      if (!vigente() || finalizado || preparado) return;
      preparado = true;
      imagen.alt = textoAlternativo;
      imagen.onload = terminarCarga;
      imagen.onerror = fallar;
      imagen.src = url;
      if (imagen.complete && imagen.currentSrc === url) requestAnimationFrame(terminarCarga);
    };

    imagen.onload = null;
    imagen.onerror = fallar;
    const precarga = new Image();
    precarga.onload = mostrar;
    precarga.onerror = fallar;
    precarga.src = url;
    if (precarga.complete) {
      if (precarga.naturalWidth) mostrar();
      else fallar();
    }
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
      mostrarFotoPreparada(
        imagen,
        fotos[posicion].url,
        `Fotografía ${posicion + 1} de ${fotos.length}: ${vehiculo.marca} ${vehiculo.modelo}`,
        () => {
          arte.classList.remove("has-photos");
          imagen.src = respaldo;
          imagen.alt = "Fotografía no disponible temporalmente; ilustración del vehículo";
          contador.textContent = `${posicion + 1} / ${fotos.length} · No disponible`;
        },
      );
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

  function renderizar() {
    const lista = porId("lista-vehiculos");
    lista.replaceChildren();
    const fragmento = document.createDocumentFragment();
    const galeriasPendientes = [];
    vehiculos.forEach((vehiculo) => {
      const tarjeta = porId("plantilla-vehiculo").content.cloneNode(true);
      const articulo = tarjeta.querySelector("article");
      articulo.dataset.vehiculoId = vehiculo.id;
      const disponible = vehiculo.disponibilidad === "disponible";
      const nombre = `${vehiculo.marca} ${vehiculo.modelo}`;
      tarjeta.querySelector("h3").textContent = nombre;
      tarjeta.querySelector(".vehicle-year").textContent = vehiculo.anio;
      tarjeta.querySelector(".vehicle-location-text").textContent = vehiculo.ubicacion;
      tarjeta.querySelector(".vehicle-description").textContent = vehiculo.descripcion;
      tarjeta.querySelector(".vehicle-mileage").textContent = `${entero.format(vehiculo.kilometraje)} km`;
      const tipoVehiculo = vehiculo.tipo_vehiculo_etiqueta || vehiculo.tipo_vehiculo || "";
      tarjeta.querySelector(".vehicle-type").textContent = tipoVehiculo;
      tarjeta.querySelector(".vehicle-type-attribute").hidden = !tipoVehiculo;
      for (const [selector, valor] of [[".vehicle-transmission", vehiculo.transmision], [".vehicle-fuel", vehiculo.combustible]]) {
        const campo = tarjeta.querySelector(selector);
        campo.textContent = valor || "";
        campo.parentElement.hidden = !valor;
      }
      const parteEntera = dolaresEnteros.format(Math.floor(vehiculo.precio_centavos / 100));
      const parteDecimal = String(vehiculo.precio_centavos % 100).padStart(2, "0");
      tarjeta.querySelector(".vehicle-price").textContent = `$${parteEntera}${parteDecimal === "00" ? "" : `.${parteDecimal}`}`;
      const enlaceFicha = tarjeta.querySelector(".detail-link");
      const retorno = `${location.pathname}${location.search}`;
      enlaceFicha.href = `/vehiculo/${encodeURIComponent(vehiculo.id)}?retorno=${encodeURIComponent(retorno)}`;
      enlaceFicha.setAttribute("aria-label", `Ver ficha completa de ${nombre}`);
      const enlaceContacto = tarjeta.querySelector(".detail-contact-link");
      if (enlaceContacto) {
        enlaceContacto.href = `/vehiculo/${encodeURIComponent(vehiculo.id)}?${new URLSearchParams({ retorno, contactar: "1" })}`;
        enlaceContacto.setAttribute("aria-label", `Contactar al vendedor de ${nombre}`);
      }
      const insignia = tarjeta.querySelector(".vehicle-badge");
      insignia.textContent = disponible ? "Disponible" : "Vendido";
      insignia.classList.toggle("sold", !disponible);
      galeriasPendientes.push([articulo, vehiculo]);
      fragmento.append(tarjeta);
    });
    lista.append(fragmento);
    galeriasPendientes.forEach(([tarjeta, vehiculo]) => galeriaTarjeta(tarjeta, vehiculo));

    const total = vehiculos.length;
    const filtrosActivos = parametrosCatalogoActivos.size > 0;
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
      if (!campo.name || !parametros.has(campo.name)) continue;
      const valor = parametros.get(campo.name);
      if (campo.name === "tipo_vehiculo" && valor && campo.options && typeof campo.options[Symbol.iterator] === "function") {
        const clave = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const canonico = aliasTipos[clave];
        if (canonico) campo.value = canonico;
        else {
          let historico = [...campo.options].find((opcion) => opcion.value === valor);
          if (!historico) {
            historico = document.createElement("option");
            historico.value = valor;
            historico.textContent = `Tipo histórico · ${valor}`;
            campo.append(historico);
          }
          campo.value = valor;
        }
      } else campo.value = valor;
    }
    parametrosCatalogoActivos = leerParametrosCatalogo();
    actualizarFiltrosAvanzados(true);
  }

  function actualizarFiltrosAvanzados(abrirSiActivos = false) {
    const activos = nombresFiltrosAvanzados.filter((nombre) => {
      const valor = parametrosCatalogoActivos.get(nombre);
      return valor !== null && valor.trim() !== "";
    });
    if (indicadorFiltrosAvanzados) {
      indicadorFiltrosAvanzados.hidden = activos.length === 0;
      indicadorFiltrosAvanzados.textContent = activos.length === 1
        ? "1 filtro avanzado aplicado"
        : `${activos.length} filtros avanzados aplicados`;
    }
    if (detallesFiltros) {
      if (activos.length === 0) detallesFiltros.open = false;
      else if (abrirSiActivos) detallesFiltros.open = true;
    }
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
    actualizarFiltrosAvanzados();
    const query = parametrosCatalogoActivos.toString();
    if (actualizarHistorial) {
      history.pushState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
    }
    ocupado = true;
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
    return centavos % 100 === 0 ? `$${enteroPrecio}` : `$${enteroPrecio}.${centavosPrecio}`;
  }

  function inicializarGaleriaFicha(vehiculo) {
    const imagen = porId("ficha-imagen");
    const navegacion = porId("ficha-navegacion");
    const contador = porId("ficha-contador");
    const miniaturas = porId("ficha-miniaturas");
    miniaturas.replaceChildren();
    const fotos = [...(vehiculo.fotografias || [])]
      .filter((foto) => urlFotoSegura(foto.url))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const respaldo = "/static/img/vehiculo.svg";
    if (!fotos.length) {
      generacionesFoto.set(imagen, (generacionesFoto.get(imagen) || 0) + 1);
      animacionesFoto.get(imagen)?.cancel();
      animacionesFoto.delete(imagen);
      imagen.src = respaldo;
      imagen.alt = `Ilustración de ${vehiculo.marca} ${vehiculo.modelo}; no hay fotografías publicadas.`;
      navegacion.hidden = true;
      return;
    }
    let posicion = 0;
    const botones = fotos.map((foto, indice) => {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "detail-thumbnail";
      boton.setAttribute("aria-label", `Ver fotografía ${indice + 1} de ${fotos.length}`);
      const miniatura = document.createElement("img");
      miniatura.src = urlFotoSegura(foto.url);
      miniatura.alt = "";
      boton.append(miniatura);
      boton.addEventListener("click", () => { posicion = indice; mostrar(); });
      miniaturas.append(boton);
      return boton;
    });
    miniaturas.hidden = fotos.length < 2;
    const galeria = imagen.closest(".detail-gallery");
    function mostrar() {
      botones.forEach((boton, indice) => boton.setAttribute("aria-pressed", String(indice === posicion)));
      galeria.setAttribute("aria-busy", "true");
      mostrarFotoPreparada(
        imagen,
        fotos[posicion].url,
        `Fotografía ${posicion + 1} de ${fotos.length}: ${vehiculo.marca} ${vehiculo.modelo}`,
        () => {
        imagen.src = respaldo;
        imagen.alt = `Fotografía no disponible. Ilustración de ${vehiculo.marca} ${vehiculo.modelo}.`;
        contador.textContent = `${posicion + 1} / ${fotos.length} · No disponible`;
        galeria.setAttribute("aria-busy", "false");
      },
        () => galeria.setAttribute("aria-busy", "false"),
      );
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
    porId("ficha-ubicacion-valor").textContent = vehiculo.ubicacion || "Ubicación no especificada";
    porId("ficha-anio-valor").textContent = `Año ${vehiculo.anio}`;
    porId("ficha-precio").textContent = precioLegible(vehiculo.precio_centavos);
    porId("ficha-kilometraje").textContent = `${entero.format(vehiculo.kilometraje)} km recorridos`;
    const estadoCompra = porId("ficha-estado-compra");
    estadoCompra.textContent = disponible ? "Disponible" : "Vendido";
    estadoCompra.classList.toggle("sold", !disponible);
    [["transmision", vehiculo.transmision], ["combustible", vehiculo.combustible], ["tipo", vehiculo.tipo_vehiculo_etiqueta || vehiculo.tipo_vehiculo]].forEach(([clave, valor]) => {
      const fila = document.querySelector(`[data-spec="${clave}"]`);
      const contenido = porId(`ficha-${clave}`);
      contenido.textContent = valor || "";
      fila.hidden = !valor;
    });
    porId("ficha-descripcion").textContent = vehiculo.descripcion || "Sin descripción publicada.";
    const lista = porId("ficha-caracteristicas");
    lista.replaceChildren();
    const caracteristicas = [];
    if (vehiculo.tipo_vehiculo_etiqueta || vehiculo.tipo_vehiculo) caracteristicas.push(["Tipo", vehiculo.tipo_vehiculo_etiqueta || vehiculo.tipo_vehiculo]);
    if (vehiculo.version) caracteristicas.push(["Versión", vehiculo.version]);
    if (vehiculo.motor) caracteristicas.push(["Motor", vehiculo.motor]);
    if (vehiculo.numero_puertas !== null && vehiculo.numero_puertas !== undefined) caracteristicas.push(["Puertas", String(vehiculo.numero_puertas)]);
    if (vehiculo.capacidad_pasajeros !== null && vehiculo.capacidad_pasajeros !== undefined) caracteristicas.push(["Pasajeros", String(vehiculo.capacidad_pasajeros)]);
    if (vehiculo.color) caracteristicas.push(["Color", vehiculo.color]);
    if (vehiculo.transmision) caracteristicas.push(["Transmisión", vehiculo.transmision]);
    if (vehiculo.combustible) caracteristicas.push(["Combustible", vehiculo.combustible]);
    [
      ["aire_acondicionado", "Aire acondicionado"],
      ["ventanas_electricas", "Ventanas eléctricas"],
      ["pantalla_multimedia", "Pantalla multimedia"],
      ["camara_reversa", "Cámara de reversa"],
      ["bluetooth", "Bluetooth"]
    ].forEach(([campo, etiqueta]) => {
      if (vehiculo[campo] !== null && vehiculo[campo] !== undefined) {
        caracteristicas.push([etiqueta, vehiculo[campo] ? "Sí" : "No"]);
      }
    });
    caracteristicas.forEach(([etiqueta, valor]) => {
      const item = document.createElement("li");
      item.className = "feature-item";
      const nombre = document.createElement("span");
      nombre.className = "feature-label";
      nombre.textContent = `${etiqueta}: `;
      const dato = document.createElement("strong");
      dato.className = "feature-value";
      dato.textContent = valor;
      item.append(nombre, dato);
      lista.append(item);
    });
    porId("ficha-caracteristicas-seccion").hidden = caracteristicas.length === 0;
    inicializarGaleriaFicha(vehiculo);
    document.title = `${vehiculo.marca} ${vehiculo.modelo} · Vehículos usados`;
    porId("ficha-vehiculo").setAttribute("aria-busy", "false");
    porId("ficha-cargando").hidden = true;
    porId("ficha-error").hidden = true;
    porId("ficha-contenido").hidden = false;
    if ((document.body.dataset.chatEnabled === "true" || document.body.dataset.userAuthEnabled === "true") && new URLSearchParams(location.search).get("contactar") === "1") {
      requestAnimationFrame(() => porId("mostrar-chat")?.click());
    }
  }

  async function inicializarFicha() {
    porId("inventario").hidden = true;
    porId("ficha-vehiculo").hidden = false;
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
      renderizarFicha(datosPublicos(resultado.vehiculo));
    } catch (error) {
      mostrarFichaError(error);
    }
  }

  async function actualizarAccesoAdministrativo() {
    const enlace = porId("admin-panel-link");
    try {
      const sesion = await solicitar("/api/admin/session");
      enlace.hidden = sesion.solo_lectura === true;
    } catch (error) {
      // La ruta administrativa valida la autorización; un fallo de lectura no debe bloquear el catálogo.
      enlace.hidden = false;
    }
  }

  async function inicializar() {
    if (ocupado) return;
    ocupado = true;
    mensaje("");
    porId("cargando").hidden = false;
    porId("estado-bloqueado").hidden = true;
    porId("estado-vacio").hidden = true;
    actualizarControles();
    try {
      await cargarCatalogo();
    } catch (error) {
      bloquear("No pudimos abrir el catálogo", error.message);
    } finally {
      ocupado = false;
      actualizarControles();
    }
  }

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
  if (idFicha) inicializarFicha();
  else {
    copiarFiltrosDesdeUrl();
    actualizarAccesoAdministrativo();
    inicializar();
  }
})();
