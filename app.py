"""Rutas Flask del catálogo; PostgreSQL es la fuente de verdad."""

import hashlib
import hmac
import os
import secrets
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, current_app, jsonify, render_template, request, session
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType
from werkzeug.security import check_password_hash

import almacenamiento
import imagenes
import limites_login
import persistencia
import persistencia_fotos
from vehiculos import filtrar_vehiculos, respuesta_error, validar_filtros_busqueda, validar_vehiculo


MAX_SOLICITUD = 1_100_000
MAX_PASSWORD_LENGTH = 1024
MAX_INTENTOS_LOGIN = 5
PAUSA_LOGIN_SEGUNDOS = 10 * 60


def _cargar_dotenv():
    load_dotenv()


def _solo_lectura_desde_entorno():
    valor = os.environ.get("APP_READ_ONLY", "").lower()
    # Esta entrega permite Preview únicamente de consulta. Ninguna cadena de
    # conexión ni APP_READ_ONLY=false habilitan escrituras en ese ambiente.
    return os.environ.get("VERCEL_ENV") == "preview" or valor not in ("", "false")


def create_app(configuracion=None):
    _cargar_dotenv()
    aplicacion = Flask(__name__)
    aplicacion.json.ensure_ascii = False
    aplicacion.config.update(
        SECRET_KEY=os.environ.get("FLASK_SECRET_KEY"),
        ADMIN_PASSWORD_HASH=os.environ.get("ADMIN_PASSWORD_HASH"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")) or os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
        MAX_CONTENT_LENGTH=MAX_SOLICITUD,
        MAX_FORM_MEMORY_SIZE=MAX_SOLICITUD,
        MAX_FORM_PARTS=3,
        APP_READ_ONLY=_solo_lectura_desde_entorno(),
        REPOSITORY=None,
        PHOTO_REPOSITORY=None,
        LOGIN_LIMITER=None,
        STORAGE=None,
    )
    if configuracion:
        aplicacion.config.update(configuracion)
    if not aplicacion.config.get("SECRET_KEY"):
        raise RuntimeError("Configura FLASK_SECRET_KEY antes de iniciar Flask.")

    @aplicacion.after_request
    def evitar_cache_api(respuesta):
        if request.path.startswith("/api/") or request.path == "/" or request.path.startswith("/vehiculo/"):
            respuesta.headers["Cache-Control"] = "no-store"
        respuesta.headers["X-Content-Type-Options"] = "nosniff"
        return respuesta

    def token_csrf():
        token = session.get("csrf_token")
        if not token:
            token = secrets.token_urlsafe(32)
            session["csrf_token"] = token
        return token

    def csrf_valido():
        esperado = session.get("csrf_token", "")
        recibido = request.headers.get("X-CSRF-Token", "")
        return bool(esperado and recibido and hmac.compare_digest(esperado, recibido))

    def exigir_admin_y_csrf():
        if current_app.config["APP_READ_ONLY"]:
            return jsonify(respuesta_error("Este ambiente permite únicamente consultar el catálogo.")), 503
        if not session.get("admin_authenticated"):
            return jsonify(respuesta_error("Inicia sesión como administrador para continuar.")), 401
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        return None

    def repositorio(nombre, *argumentos):
        personalizado = current_app.config.get("REPOSITORY")
        if personalizado is not None:
            return personalizado[nombre](*argumentos)
        return getattr(persistencia, nombre)(*argumentos)

    def fotos_repositorio(nombre, *argumentos):
        personalizado = current_app.config.get("PHOTO_REPOSITORY")
        if personalizado is not None:
            return personalizado[nombre](*argumentos)
        return getattr(persistencia_fotos, nombre)(*argumentos)

    def limitar_login(nombre, *argumentos):
        personalizado = current_app.config.get("LOGIN_LIMITER")
        if personalizado is not None:
            return personalizado[nombre](*argumentos)
        return getattr(limites_login, nombre)(*argumentos)

    def storage():
        return current_app.config.get("STORAGE") or almacenamiento

    def respuesta_fotografia(fotografia):
        return {**fotografia, "url": storage().url_publica(fotografia["storage_path"])}

    def respuesta_vehiculo(vehiculo, fotografias=None):
        salida = dict(vehiculo)
        if not session.get("admin_authenticated"):
            salida.pop("placa", None)
        if fotografias is None:
            fotografias = fotos_repositorio("listar_fotografias", vehiculo["id"])
        salida["fotografias"] = [respuesta_fotografia(f) for f in fotografias]
        return salida

    def clave_idempotencia():
        valor = request.headers.get("Idempotency-Key", "")
        try:
            if len(valor) != 36:
                raise ValueError()
            return str(UUID(valor)), None
        except (ValueError, AttributeError):
            return None, (jsonify(respuesta_error("La solicitud necesita una clave de envío UUID válida.")), 400)

    def leer_json(campos):
        try:
            cuerpo = request.get_json()
        except (BadRequest, UnsupportedMediaType):
            return None, (jsonify(respuesta_error(
                "No se pudo leer la solicitud.",
                {"solicitud": "Envía un objeto JSON válido con Content-Type application/json."},
            )), 400)
        if not isinstance(cuerpo, dict) or set(cuerpo) != set(campos):
            return None, (jsonify(respuesta_error(
                "La solicitud no tiene el formato esperado.",
                {"solicitud": "Revisa los campos de la solicitud."},
            )), 400)
        return cuerpo, None

    def error_persistencia(error):
        # No se devuelve ni registra el mensaje del driver: puede contener detalles internos.
        current_app.logger.error("Falló una operación PostgreSQL (%s).", type(error).__name__)
        return jsonify(respuesta_error("El catálogo no pudo completar la operación. Intenta de nuevo.")), 503

    @aplicacion.get("/")
    def inicio():
        return render_template("index.html", csrf_token=token_csrf(), vehiculo_id=None)

    @aplicacion.get("/vehiculo/<int:identificador>")
    def pagina_vehiculo(identificador):
        # La existencia y privacidad del vehículo se resuelven desde el endpoint API.
        return render_template(
            "index.html", csrf_token=token_csrf(), vehiculo_id=identificador,
        )

    @aplicacion.get("/api/admin/session")
    def sesion_admin():
        return jsonify({"ok": True, "autenticado": bool(session.get("admin_authenticated")), "solo_lectura": current_app.config["APP_READ_ONLY"]})

    @aplicacion.post("/api/admin/login")
    def iniciar_sesion_admin():
        if current_app.config["APP_READ_ONLY"]:
            return jsonify(respuesta_error("Este ambiente permite únicamente consultar el catálogo.")), 503
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        cuerpo, fallo = leer_json({"password"})
        if fallo:
            return fallo
        password = cuerpo["password"]
        password_hash = current_app.config.get("ADMIN_PASSWORD_HASH")
        if not password_hash:
            return jsonify(respuesta_error("El acceso administrativo no está configurado.")), 503
        if not isinstance(password, str) or not password:
            return jsonify(respuesta_error(
                "La solicitud de acceso no es válida.",
                {"password": "Ingresa una contraseña válida."},
            )), 400
        if len(password) > MAX_PASSWORD_LENGTH:
            return jsonify(respuesta_error(
                "La solicitud de acceso no es válida.",
                {"password": f"La contraseña no puede superar {MAX_PASSWORD_LENGTH} caracteres."},
            )), 400

        secreto = current_app.secret_key
        secreto = secreto if isinstance(secreto, bytes) else secreto.encode()
        # Nunca se usa X-Forwarded-For arbitrario ni una cookie para el contador.
        # Si un proxy comparte remote_addr, el límite es conservador y compartido.
        clave_cliente = hmac.new(secreto, (request.remote_addr or "sin-direccion").encode(), hashlib.sha256).hexdigest()
        try:
            restante = limitar_login("reservar_intento_login", clave_cliente, MAX_INTENTOS_LOGIN, PAUSA_LOGIN_SEGUNDOS)
        except Exception as error:
            return error_persistencia(error)
        if restante:
            respuesta = jsonify(respuesta_error("Demasiados intentos. Espera antes de volver a intentar."))
            respuesta.headers["Retry-After"] = str(restante)
            return respuesta, 429

        try:
            correcta = check_password_hash(password_hash, password)
        except (ValueError, TypeError):
            return jsonify(respuesta_error("El acceso administrativo no está configurado correctamente.")), 503
        if not correcta:
            return jsonify(respuesta_error("La contraseña no es correcta.")), 401

        try:
            limitar_login("reiniciar_intentos_login", clave_cliente)
        except Exception as error:
            return error_persistencia(error)
        # La sesión va firmada y el límite compartido queda en PostgreSQL.
        session.clear()
        session["admin_authenticated"] = True
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"ok": True, "autenticado": True, "csrf_token": session["csrf_token"]})

    @aplicacion.post("/api/admin/logout")
    def cerrar_sesion_admin():
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        session.clear()
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"ok": True, "autenticado": False, "csrf_token": session["csrf_token"]})

    @aplicacion.get("/api/vehiculos")
    def listar_vehiculos():
        filtros, errores = validar_filtros_busqueda(request.args)
        if errores:
            return jsonify(respuesta_error("Revisa los filtros indicados.", errores)), 400
        try:
            personalizado = current_app.config.get("REPOSITORY")
            if not filtros:
                vehiculos = repositorio("listar_vehiculos")
            elif personalizado is None:
                vehiculos = persistencia.buscar_vehiculos(filtros)
            elif "buscar_vehiculos" in personalizado:
                vehiculos = personalizado["buscar_vehiculos"](filtros)
            else:
                # Mantiene compatibilidad con repositorios falsos pequeños en pruebas.
                vehiculos = filtrar_vehiculos(repositorio("listar_vehiculos"), filtros)
            fotos = fotos_repositorio("listar_por_vehiculos", [v["id"] for v in vehiculos])
            salida = [respuesta_vehiculo(v, fotos.get(v["id"], [])) for v in vehiculos]
        except Exception as error:
            return error_persistencia(error)
        return jsonify({"ok": True, "vehiculos": salida})

    @aplicacion.get("/api/vehiculos/<int:identificador>")
    def consultar_vehiculo(identificador):
        try:
            vehiculo = repositorio("obtener_vehiculo", identificador)
            salida = respuesta_vehiculo(vehiculo) if vehiculo is not None else None
        except Exception as error:
            return error_persistencia(error)
        if vehiculo is None:
            return jsonify(respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."})), 404
        return jsonify({"ok": True, "vehiculo": salida})

    @aplicacion.post("/api/vehiculos")
    def registrar_vehiculo():
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        cuerpo, fallo = leer_json({"vehiculo"})
        if fallo:
            return fallo
        vehiculo, errores = validar_vehiculo(cuerpo["vehiculo"])
        if errores:
            return jsonify(respuesta_error("Revisa los campos indicados.", errores)), 422
        try:
            guardado = repositorio("crear_vehiculo_idempotente", vehiculo, clave)
            salida = respuesta_vehiculo(guardado) if guardado is not None else None
        except ValueError:
            return jsonify(respuesta_error("La clave de envío ya pertenece a una solicitud diferente.")), 409
        except Exception as error:
            return error_persistencia(error)
        if guardado is None:
            return jsonify(respuesta_error("Se alcanzó el límite de vehículos permitido.", {"vehiculo": "Se permiten hasta 500 vehículos."})), 422
        return jsonify({"ok": True, "vehiculo": salida}), 201

    @aplicacion.put("/api/vehiculos/<int:identificador>")
    def editar_vehiculo(identificador):
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        cuerpo, fallo = leer_json({"vehiculo"})
        if fallo:
            return fallo
        vehiculo, errores = validar_vehiculo(cuerpo["vehiculo"])
        if errores:
            return jsonify(respuesta_error("Revisa los campos indicados.", errores)), 422
        try:
            guardado = repositorio("editar_vehiculo", identificador, vehiculo)
            salida = respuesta_vehiculo(guardado) if guardado is not None else None
        except Exception as error:
            return error_persistencia(error)
        if guardado is None:
            return jsonify(respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."})), 404
        return jsonify({"ok": True, "vehiculo": salida})

    @aplicacion.patch("/api/vehiculos/<int:identificador>/disponibilidad")
    def cambiar_disponibilidad(identificador):
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        cuerpo, fallo = leer_json({"disponibilidad"})
        if fallo:
            return fallo
        disponibilidad = cuerpo["disponibilidad"]
        if disponibilidad not in ("disponible", "vendido"):
            return jsonify(respuesta_error(
                "Revisa la disponibilidad.",
                {"disponibilidad": "Selecciona disponible o vendido."},
            )), 422
        try:
            guardado = repositorio("cambiar_disponibilidad", identificador, disponibilidad)
            salida = respuesta_vehiculo(guardado) if guardado is not None else None
        except Exception as error:
            return error_persistencia(error)
        if guardado is None:
            return jsonify(respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."})), 404
        return jsonify({"ok": True, "vehiculo": salida})

    def limpiar_despues_del_commit():
        try:
            resultado = almacenamiento.limpiar_pendientes(1, True, fotos_repositorio, storage())
            return resultado["fallidos"] > 0
        except Exception as error:
            current_app.logger.warning("Limpieza pendiente de fotografías (%s).", type(error).__name__)
            return True

    def resultado_fotos(identificador, fotografia=None, limpieza_pendiente=False):
        resultado = {
            "ok": True,
            "fotografias": [respuesta_fotografia(f) for f in fotos_repositorio("listar_fotografias", identificador)],
        }
        if fotografia is not None:
            resultado["fotografia"] = respuesta_fotografia(fotografia)
        if limpieza_pendiente:
            resultado["advertencia"] = "El cambio se guardó; quedó una limpieza de almacenamiento pendiente de reintento."
            resultado["limpieza_pendiente"] = True
        return resultado

    def cancelar_reserva(ruta):
        try:
            fotos_repositorio("cancelar_subida", ruta)
        except Exception as error:
            # La reserva durable ya existía antes de subir: aun si PostgreSQL no
            # responde, la cola vencerá y podrá reconciliarse sin perder fotos.
            current_app.logger.warning("Reserva de fotografía pendiente (%s).", type(error).__name__)

    def guardar_fotografia(identificador, fotografia_id=None):
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        if request.mimetype != "multipart/form-data" or set(request.files) != {"fotografia"} or len(request.files.getlist("fotografia")) != 1 or request.form:
            return jsonify(respuesta_error("Envía una sola fotografía por solicitud.", {"fotografia": "Usa el campo fotografia y ningún campo adicional."})), 400
        archivo = request.files["fotografia"]
        try:
            contenido, metadatos = imagenes.normalizar_imagen(archivo.read(imagenes.MAX_ARCHIVO_RECIBIDO + 1))
        except ValueError as error:
            return jsonify(respuesta_error(str(error), {"fotografia": str(error)})), 422
        huella = hashlib.sha256(contenido).hexdigest()
        try:
            reserva = fotos_repositorio("preparar_subida", identificador, clave, huella, fotografia_id)
        except LookupError:
            return jsonify(respuesta_error("No se encontró el vehículo o la fotografía.")), 404
        except ValueError:
            return jsonify(respuesta_error("No se puede guardar la fotografía: se permiten hasta cinco y la clave de envío debe corresponder a esta operación.")), 409
        except Exception as error:
            return error_persistencia(error)

        ruta = reserva["storage_path"]
        if reserva["completada"]:
            guardada = reserva["fotografia"]
        else:
            try:
                storage().subir(ruta, contenido)
                guardada = fotos_repositorio("guardar_fotografia", identificador, {**metadatos, "storage_path": ruta}, clave, fotografia_id)
            except almacenamiento.ErrorAlmacenamiento as error:
                # Un timeout puede haber creado el objeto. Conservamos la
                # reserva para reintentar con la misma clave, no sobrescribimos.
                return jsonify(respuesta_error(str(error))), 503
            except LookupError:
                cancelar_reserva(ruta)
                return jsonify(respuesta_error("No se encontró el vehículo o la fotografía.")), 404
            except ValueError:
                cancelar_reserva(ruta)
                return jsonify(respuesta_error("La fotografía cambió o la solicitud ya no es válida. Actualiza el catálogo.")), 409
            except Exception as error:
                # La cola de la reserva recupera un objeto huérfano si el
                # resultado del commit es incierto. Nunca se borra aquí.
                return error_persistencia(error)
        limpieza_pendiente = limpiar_despues_del_commit()
        try:
            resultado = resultado_fotos(identificador, guardada, limpieza_pendiente)
        except Exception as error:
            return error_persistencia(error)
        return jsonify(resultado), 201 if fotografia_id is None else 200

    @aplicacion.post("/api/vehiculos/<int:identificador>/fotografias")
    def agregar_fotografia(identificador):
        return guardar_fotografia(identificador)

    @aplicacion.put("/api/vehiculos/<int:identificador>/fotografias/<int:fotografia_id>")
    def sustituir_fotografia(identificador, fotografia_id):
        return guardar_fotografia(identificador, fotografia_id)

    @aplicacion.delete("/api/vehiculos/<int:identificador>/fotografias/<int:fotografia_id>")
    def eliminar_fotografia(identificador, fotografia_id):
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        try:
            eliminada = fotos_repositorio("eliminar_fotografia", identificador, fotografia_id)
            if not eliminada:
                return jsonify(respuesta_error("No se encontró la fotografía.")), 404
            limpieza_pendiente = limpiar_despues_del_commit()
            resultado = resultado_fotos(identificador, limpieza_pendiente=limpieza_pendiente)
        except Exception as error:
            return error_persistencia(error)
        return jsonify(resultado)

    @aplicacion.errorhandler(HTTPException)
    def error_http(error):
        if request.path.startswith("/api/"):
            if error.code == 413:
                return jsonify(respuesta_error(
                    "La solicitud supera el tamaño permitido.",
                    {"solicitud": "Envía cada fotografía optimizada por separado, con un máximo de 1.000.000 bytes."},
                )), 413
            return jsonify(respuesta_error(
                "La solicitud no pudo completarse.",
                {"solicitud": "Revisa la ruta y el método de la solicitud."},
            )), error.code
        return error

    @aplicacion.errorhandler(Exception)
    def error_inesperado(error):
        current_app.logger.error("Falló una solicitud (%s).", type(error).__name__)
        if request.path.startswith("/api/"):
            return jsonify(respuesta_error("La solicitud no pudo completarse. Intenta de nuevo.")), 503
        return "La página no está disponible temporalmente.", 503

    return aplicacion


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
