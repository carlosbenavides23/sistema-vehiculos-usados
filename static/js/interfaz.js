"use strict";

(() => {
  const CLAVE = "vehiculos_demo_v1";
  const porId = (id) => document.getElementById(id);
  const formulario = porId("formulario-vehiculo");
  const dialogo = porId("formulario-dialogo");
  const dialogoRestablecer = porId("restablecer-dialogo");
  const dolaresEnteros = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const entero = new Intl.NumberFormat("es-NI");
  let estado = null;
  let textoGuardado = null;
  let ocupado = false;
  let habilitado = false;
  let idEnEdicion = null;
  let origenFormulario = null;

  function mensaje(texto, tipo = "error") {
    const elemento = porId("mensaje");
    elemento.textContent = texto;
    elemento.className = `message${tipo === "error" ? " message-error" : tipo === "info" ? " message-info" : ""}`;
    elemento.hidden = !texto;
  }

  function controles() {
    const deshabilitar = ocupado || !habilitado;
    porId("nuevo-vehiculo").disabled = deshabilitar;
    porId("nuevo-desde-vacio").disabled = deshabilitar;
    porId("restablecer").disabled = ocupado || dialogoRestablecer.open;
    porId("cancelar-restablecer").disabled = ocupado;
    porId("confirmar-restablecer").disabled = ocupado;
    porId("confirmar-restablecer").textContent = ocupado ? "Restableciendo…" : "Restablecer demostración";
    porId("reintentar").disabled = ocupado;
    document.querySelectorAll(".vehicle-actions button").forEach((boton) => { boton.disabled = deshabilitar; });
    formulario.querySelectorAll("input, select, textarea, button").forEach((campo) => { campo.disabled = ocupado; });
    porId("guardar-vehiculo").disabled = deshabilitar;
    porId("cerrar-formulario").disabled = ocupado;
    porId("inventario").setAttribute("aria-busy", String(ocupado));
    porId("guardar-vehiculo").textContent = ocupado ? "Guardando…" : idEnEdicion === null ? "Registrar vehículo" : "Guardar cambios";
  }

  function bloquear(titulo, detalle) {
    habilitado = false;
    porId("cargando").hidden = true;
    porId("estado-vacio").hidden = true;
    porId("estado-bloqueado").hidden = false;
    porId("titulo-bloqueado").textContent = titulo;
    porId("detalle-bloqueado").textContent = detalle;
    porId("lista-vehiculos").replaceChildren();
    ["total-vehiculos", "total-disponibles", "total-vendidos"].forEach((id) => { porId(id).textContent = "—"; });
    porId("resumen-listado").textContent = "El inventario está temporalmente bloqueado.";
    controles();
  }

  // Flask recibe y valida todo el estado; el navegador no reproduce sus reglas.
  async function solicitar(ruta, metodo, cuerpo) {
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), 15000);
    try {
      let respuesta;
      try {
        respuesta = await fetch(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: control.signal });
      } catch (error) {
        throw new Error("No pudimos comunicarnos con el servidor. Comprueba que la aplicación esté abierta e inténtalo de nuevo. Tus datos se conservan.");
      }
      let resultado;
      try { resultado = await respuesta.json(); }
      catch (error) { throw new Error("El servidor no devolvió una respuesta válida. Inténtalo de nuevo; tus datos se conservan."); }
      if (!respuesta.ok || resultado.ok !== true) {
        const error = new Error(resultado.mensaje || "No pudimos completar la operación. Revisa los datos e inténtalo de nuevo.");
        error.errores = resultado.errores || {};
        throw error;
      }
      return resultado.estado;
    } finally { clearTimeout(limite); }
  }

  function leerAlmacenamiento() {
    try { return localStorage.getItem(CLAVE); }
    catch (error) { throw new Error("Este navegador no permite leer tus datos. Revisa sus permisos de almacenamiento y vuelve a intentar."); }
  }

  function comprobarVersionGuardada(esperada = textoGuardado) {
    if (leerAlmacenamiento() !== esperada) {
      bloquear("El inventario cambió en otra pestaña", "Vuelve a cargar el inventario para trabajar con los últimos datos. El contenido que escribiste sigue en el formulario.");
      throw new Error("El inventario cambió en otra pestaña. Cierra el formulario y pulsa Volver a intentar antes de continuar.");
    }
  }

  function persistir(nuevoEstado, textoEsperado = textoGuardado) {
    comprobarVersionGuardada(textoEsperado);
    const texto = JSON.stringify(nuevoEstado);
    try { localStorage.setItem(CLAVE, texto); }
    catch (error) { throw new Error("No pudimos guardar los cambios en este navegador. Revisa el espacio o los permisos de almacenamiento e inténtalo de nuevo. El inventario anterior se conserva."); }
    // Solo después de guardar se reemplaza el estado visible y se comunica éxito.
    textoGuardado = texto;
    estado = nuevoEstado;
    habilitado = true;
  }

  function renderizar() {
    const lista = porId("lista-vehiculos");
    lista.replaceChildren();
    const fragmento = document.createDocumentFragment();
    estado.vehiculos.forEach((vehiculo) => {
      const tarjeta = porId("plantilla-vehiculo").content.cloneNode(true);
      const disponible = vehiculo.disponibilidad === "disponible";
      const nombre = `${vehiculo.marca} ${vehiculo.modelo}`;
      tarjeta.querySelector("h3").textContent = nombre;
      tarjeta.querySelector(".vehicle-year").textContent = vehiculo.anio;
      tarjeta.querySelector(".vehicle-code").textContent = `N.º ${String(vehiculo.id).padStart(3, "0")}`;
      tarjeta.querySelector(".vehicle-location").textContent = vehiculo.ubicacion;
      tarjeta.querySelector(".vehicle-description").textContent = vehiculo.descripcion;
      tarjeta.querySelector(".vehicle-mileage").textContent = `${entero.format(vehiculo.kilometraje)} km`;
      const parteEntera = dolaresEnteros.format(Math.floor(vehiculo.precio_centavos / 100));
      const parteDecimal = String(vehiculo.precio_centavos % 100).padStart(2, "0");
      tarjeta.querySelector(".vehicle-price").textContent = `$${parteEntera}.${parteDecimal}`;
      const insignia = tarjeta.querySelector(".vehicle-badge");
      insignia.textContent = disponible ? "Disponible" : "Vendido";
      insignia.classList.toggle("sold", !disponible);
      const editar = tarjeta.querySelector(".edit-button");
      editar.setAttribute("aria-label", `Editar ${nombre}, registro ${vehiculo.id}`);
      editar.addEventListener("click", () => abrirFormulario(vehiculo, editar));
      const disponibilidad = tarjeta.querySelector(".availability-button");
      disponibilidad.dataset.disponibilidadId = vehiculo.id;
      disponibilidad.textContent = disponible ? "Marcar vendido" : "Marcar disponible";
      disponibilidad.setAttribute("aria-label", `${disponible ? "Marcar vendido" : "Marcar disponible"}: ${nombre}, registro ${vehiculo.id}`);
      disponibilidad.addEventListener("click", () => cambiarDisponibilidad(vehiculo));
      fragmento.append(tarjeta);
    });
    lista.append(fragmento);
    const total = estado.vehiculos.length;
    const disponibles = estado.vehiculos.filter((vehiculo) => vehiculo.disponibilidad === "disponible").length;
    porId("total-vehiculos").textContent = total;
    porId("total-disponibles").textContent = disponibles;
    porId("total-vendidos").textContent = total - disponibles;
    porId("resumen-listado").textContent = total === 0 ? "Todo listo para tu primer registro." : `${total} ${total === 1 ? "vehículo en tu inventario" : "vehículos en tu inventario"} · Información de demostración`;
    porId("cargando").hidden = true;
    porId("estado-bloqueado").hidden = true;
    porId("estado-vacio").hidden = total !== 0;
    controles();
  }

  async function inicializar() {
    if (ocupado) return;
    ocupado = true;
    habilitado = false;
    mensaje("");
    porId("cargando").hidden = false;
    porId("estado-bloqueado").hidden = true;
    porId("estado-vacio").hidden = true;
    controles();
    try {
      const previo = leerAlmacenamiento();
      let candidato;
      if (previo === null) candidato = window.DATOS_DEMO;
      else {
        try { candidato = JSON.parse(previo); }
        catch (error) {
          bloquear("Tus datos necesitan atención", "No pudimos abrir los datos guardados. Se conservaron sin cambios. Puedes restablecer la demostración si deseas reemplazarlos.");
          return;
        }
      }
      let validado;
      try { validado = await solicitar("/api/validar", "POST", { estado: candidato }); }
      catch (error) {
        bloquear("No pudimos abrir el inventario", error.errores?.estado ? "Los datos guardados no son compatibles. Se conservaron sin cambios. Puedes restablecer la demostración para comenzar de nuevo." : error.message);
        return;
      }
      comprobarVersionGuardada(previo);
      if (previo === null) persistir(validado, null);
      else {
        textoGuardado = previo;
        estado = validado;
        habilitado = true;
      }
      renderizar();
    } catch (error) { bloquear("No pudimos abrir el inventario", error.message); }
    finally { ocupado = false; controles(); }
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
    if (ocupado || !habilitado) return;
    idEnEdicion = vehiculo ? vehiculo.id : null;
    origenFormulario = origen;
    formulario.reset();
    limpiarErrores();
    if (vehiculo) {
      ["marca", "modelo", "anio", "kilometraje", "ubicacion", "descripcion", "disponibilidad"].forEach((nombre) => { formulario.elements.namedItem(nombre).value = vehiculo[nombre]; });
      // La conversión de centavos a texto solo prepara el formulario de edición.
      // Python convierte el texto ingresado y valida la precisión del importe.
      formulario.elements.precio_venta.value = `${Math.floor(vehiculo.precio_centavos / 100)}.${String(vehiculo.precio_centavos % 100).padStart(2, "0")}`;
    }
    porId("titulo-formulario").textContent = vehiculo ? "Editar vehículo" : "Registrar vehículo";
    controles();
    dialogo.showModal();
    document.body.classList.add("dialog-open");
    formulario.elements.marca.focus();
  }

  function cerrarFormulario() {
    if (ocupado) return;
    dialogo.close();
    document.body.classList.remove("dialog-open");
    if (origenFormulario?.isConnected) origenFormulario.focus();
    else porId("nuevo-vehiculo").focus();
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado || !habilitado) return;
    // Capturar antes de deshabilitar: FormData excluye campos deshabilitados.
    const datos = Object.fromEntries(new FormData(formulario));
    const actual = idEnEdicion === null ? null : estado.vehiculos.find((vehiculo) => vehiculo.id === idEnEdicion);
    datos.imagen = actual ? actual.imagen : "/static/img/vehiculo.svg";
    ocupado = true;
    controles();
    limpiarErrores();
    let guardado = false;
    try {
      comprobarVersionGuardada();
      const resultado = await solicitar(idEnEdicion === null ? "/api/vehiculos" : `/api/vehiculos/${idEnEdicion}`, idEnEdicion === null ? "POST" : "PUT", { estado, vehiculo: datos });
      persistir(resultado);
      renderizar();
      guardado = true;
      mensaje(idEnEdicion === null ? "Vehículo registrado. Ya puedes verlo en tu inventario." : "Cambios guardados. La información del vehículo está actualizada.", "exito");
    } catch (error) {
      // Habilitar campos antes de enfocar el primer error, sin perder sus valores.
      ocupado = false;
      controles();
      erroresFormulario(error);
      if (error.errores?.estado) bloquear("Tus datos necesitan atención", "El inventario no se pudo validar. Cierra el formulario y vuelve a intentar. Tus datos guardados se conservaron.");
    } finally {
      ocupado = false;
      controles();
      if (guardado) cerrarFormulario();
    }
  });

  async function cambiarDisponibilidad(vehiculo) {
    if (ocupado || !habilitado) return;
    ocupado = true;
    controles();
    try {
      comprobarVersionGuardada();
      const resultado = await solicitar(`/api/vehiculos/${vehiculo.id}/disponibilidad`, "PATCH", { estado, disponibilidad: vehiculo.disponibilidad === "disponible" ? "vendido" : "disponible" });
      persistir(resultado);
      renderizar();
      mensaje(`Disponibilidad actualizada para ${vehiculo.marca} ${vehiculo.modelo}.`, "exito");
    } catch (error) {
      mensaje(error.message);
      if (error.errores?.estado) bloquear("Tus datos necesitan atención", "El inventario no se pudo validar. Vuelve a intentar. Los datos guardados se conservaron.");
    } finally {
      ocupado = false;
      controles();
      document.querySelector(`[data-disponibilidad-id="${vehiculo.id}"]`)?.focus();
    }
  }

  function solicitarRestablecimiento() {
    if (ocupado || dialogoRestablecer.open || dialogo.open) return;
    porId("error-restablecer").textContent = "";
    porId("error-restablecer").hidden = true;
    dialogoRestablecer.showModal();
    document.body.classList.add("dialog-open");
    controles();
    porId("cancelar-restablecer").focus();
  }

  function cancelarRestablecimiento() {
    if (ocupado) return;
    dialogoRestablecer.close();
    document.body.classList.remove("dialog-open");
    controles();
    porId("restablecer").focus();
  }

  async function restablecer() {
    if (ocupado || !dialogoRestablecer.open) return;
    ocupado = true;
    controles();
    porId("error-restablecer").hidden = true;
    let restablecido = false;
    try {
      const previo = leerAlmacenamiento();
      const resultado = await solicitar("/api/validar", "POST", { estado: window.DATOS_DEMO });
      persistir(resultado, previo);
      renderizar();
      restablecido = true;
      mensaje("Demostración restablecida. Los seis vehículos ficticios están listos.", "exito");
    } catch (error) {
      porId("error-restablecer").textContent = error.message;
      porId("error-restablecer").hidden = false;
    } finally {
      ocupado = false;
      controles();
      if (restablecido) cancelarRestablecimiento();
      else porId("error-restablecer").focus();
    }
  }

  porId("nuevo-vehiculo").addEventListener("click", (evento) => abrirFormulario(null, evento.currentTarget));
  porId("nuevo-desde-vacio").addEventListener("click", (evento) => abrirFormulario(null, evento.currentTarget));
  porId("cerrar-formulario").addEventListener("click", cerrarFormulario);
  porId("cancelar-formulario").addEventListener("click", cerrarFormulario);
  porId("restablecer").addEventListener("click", solicitarRestablecimiento);
  porId("cancelar-restablecer").addEventListener("click", cancelarRestablecimiento);
  porId("confirmar-restablecer").addEventListener("click", restablecer);
  porId("reintentar").addEventListener("click", inicializar);
  dialogo.addEventListener("cancel", (evento) => { evento.preventDefault(); cerrarFormulario(); });
  dialogoRestablecer.addEventListener("cancel", (evento) => { evento.preventDefault(); cancelarRestablecimiento(); });
  window.addEventListener("storage", (evento) => {
    if (evento.storageArea === localStorage && (evento.key === CLAVE || evento.key === null)) {
      bloquear("El inventario cambió en otra pestaña", "Vuelve a cargar el inventario para trabajar con los datos más recientes. Si tienes un formulario abierto, su contenido se conserva.");
      mensaje("Hay cambios en otra pestaña. Pulsa Volver a intentar para actualizar el inventario.", "info");
    }
  });
  inicializar();
})();
