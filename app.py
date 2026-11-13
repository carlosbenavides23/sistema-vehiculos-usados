"""Rutas Flask del catálogo; PostgreSQL es la fuente de verdad."""

import hashlib
import hmac
import os
import secrets
from datetime import datetime
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, current_app, jsonify, render_template, request, session, g, redirect, abort
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType

import almacenamiento
import auth_proveedor
import imagenes
import persistencia
import persistencia_fotos
import archivo_chat
import persistencia_chat_cuentas
from cuentas import bp as cuentas_bp
import cuentas
import propiedad
import politica_v7
from vehiculos import filtrar_vehiculos, respuesta_error, validar_filtros_busqueda, validar_vehiculo
from tipos_vehiculo import MAPA_ALIAS_TIPOS_VEHICULO, TIPOS_VEHICULO, etiqueta_tipo_vehiculo


MAX_SOLICITUD = 1_100_000
MAX_LONGITUD_MENSAJE_CHAT = 2000


def _cargar_dotenv():
    load_dotenv()


def _solo_lectura_desde_entorno():
    return politica_v7.solo_lectura({"APP_READ_ONLY": os.environ.get("APP_READ_ONLY")})


def create_app(configuracion=None):
    _cargar_dotenv()
    aplicacion = Flask(__name__)
    aplicacion.json.ensure_ascii = False
    aplicacion.config.update(
        SECRET_KEY=os.environ.get("FLASK_SECRET_KEY"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=(
            bool(os.environ.get("VERCEL"))
            or os.environ.get("VERCEL_ENV", "").lower() in ("preview", "production")
            or os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
        ),
        MAX_CONTENT_LENGTH=MAX_SOLICITUD,
        MAX_FORM_MEMORY_SIZE=MAX_SOLICITUD,
        MAX_FORM_PARTS=3,
        APP_READ_ONLY=_solo_lectura_desde_entorno(),
        REPOSITORY=None,
        PHOTO_REPOSITORY=None,
        CHAT_CUENTAS_REPOSITORY=None,
        STORAGE=None,
        USER_AUTH_ENABLED=os.environ.get("USER_AUTH_ENABLED", "false").lower() == "true",
        V7_PRODUCTION_ENABLED=os.environ.get("V7_PRODUCTION_ENABLED", "false").lower() == "true",
        SHOW_ARCHIVE_NAV=os.environ.get("VERCEL_ENV", "").lower() != "production",
    )
    if configuracion:
        aplicacion.config.update(configuracion)
    # La protección de Preview no puede ser desactivada mediante valores de
    # configuración inyectados o por APP_READ_ONLY=false.
    aplicacion.config["APP_READ_ONLY"] = politica_v7.solo_lectura(aplicacion.config)
    if os.environ.get("VERCEL_ENV", "").lower() in ("preview", "production") or os.environ.get("VERCEL"):
        aplicacion.config["SESSION_COOKIE_SECURE"] = True
    aplicacion.register_blueprint(cuentas_bp)
    if not aplicacion.config.get("SECRET_KEY"):
        raise RuntimeError("Configura FLASK_SECRET_KEY antes de iniciar Flask.")

    @aplicacion.after_request
    def evitar_cache_api(respuesta):
        if request.path.startswith(("/api/", "/vendedor")) or request.path in ("/", "/administracion") or request.path.startswith("/vehiculo/"):
            respuesta.headers["Cache-Control"] = "no-store"
        for cookie in ('chat_session', '__Host-chat_session'):
            if cookie in request.cookies:
                respuesta.delete_cookie(cookie, secure=cookie.startswith('__Host-'), httponly=True, samesite='Lax')
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

    def exigir_vendedor_y_csrf():
        if current_app.config["APP_READ_ONLY"]:
            return jsonify(respuesta_error("Este ambiente permite únicamente consultar el catálogo.")), 503
        if not getattr(g, 'cuenta_vendedor', None):
            return jsonify(respuesta_error("Inicia sesión con tu cuenta vendedora para continuar.")), 401
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        return None

    def chat_cuentas_repositorio(nombre, *argumentos):
        personalizado = current_app.config.get("CHAT_CUENTAS_REPOSITORY")
        if personalizado is not None:
            return personalizado[nombre](*argumentos)
        return getattr(persistencia_chat_cuentas, nombre)(*argumentos)

    def exigir_cuenta_chat(rol):
        usuario = getattr(g, "cuenta_chat", None)
        if usuario is None:
            return None, (jsonify(respuesta_error("Inicia sesión para continuar.")), 401)
        if usuario.get("rol") != rol:
            mensaje = "Se requiere una cuenta compradora." if rol == "comprador" else "Se requiere una cuenta vendedora."
            return None, (jsonify(respuesta_error(mensaje)), 403)
        return usuario, None

    def cursor_conversaciones_cuenta():
        cursor_id = request.args.get("cursor_id")
        if cursor_id == "":
            return None, (jsonify(respuesta_error("El cursor de conversaciones no es válido.")), 400)
        texto_limite = request.args.get("limite", "50")
        if not texto_limite.isdecimal() or len(texto_limite) > 3:
            return None, (jsonify(respuesta_error("El límite de conversaciones no es válido.")), 400)
        limite = int(texto_limite)
        if not 1 <= limite <= 100:
            return None, (jsonify(respuesta_error("El límite debe estar entre 1 y 100.")), 400)
        return (cursor_id, limite), None

    def respuesta_conversacion_cuenta(conversacion, rol):
        if conversacion is None:
            return None
        nombre_contacto = conversacion.get("nombre_vendedor" if rol == "comprador" else "nombre_comprador")
        return {
            "id": str(conversacion["id"]),
            "vehiculo_id": conversacion["vehiculo_id"],
            "vehiculo": {
                "id": conversacion["vehiculo_id"],
                "marca": conversacion.get("marca"),
                "modelo": conversacion.get("modelo"),
                "anio": conversacion.get("anio"),
            },
            "estado": conversacion["estado"],
            "created_at": conversacion.get("created_at"),
            "updated_at": conversacion.get("updated_at"),
            "ultimo_mensaje": conversacion.get("ultimo_mensaje"),
            "ultimo_remitente": conversacion.get("ultimo_remitente"),
            "ultimo_mensaje_en": conversacion.get("ultimo_mensaje_en"),
            "vehiculo_retirado": bool(conversacion.get("vehiculo_retirado", False)),
            "nombre_contacto": nombre_contacto or ("Vendedor" if rol == "comprador" else "Comprador"),
        }

    def respuesta_mensaje_cuenta(mensaje):
        return {
            "id": mensaje["id"],
            "conversacion_id": str(mensaje["conversacion_id"]),
            "remitente": mensaje["remitente"],
            "contenido": mensaje["contenido"],
            "created_at": mensaje.get("created_at"),
        }

    def mensaje_chat_desde_solicitud():
        cuerpo, fallo = leer_json({"contenido"})
        if fallo:
            return None, fallo
        contenido = cuerpo["contenido"]
        if not isinstance(contenido, str) or not contenido.strip():
            return None, (jsonify(respuesta_error("Escribe un mensaje antes de enviarlo.", {"contenido": "El mensaje no puede estar vacío."})), 422)
        contenido = contenido.strip()
        if len(contenido) > MAX_LONGITUD_MENSAJE_CHAT:
            return None, (jsonify(respuesta_error("El mensaje supera el límite permitido.", {"contenido": f"El máximo es {MAX_LONGITUD_MENSAJE_CHAT} caracteres."})), 422)
        return contenido, None

    def cursor_mensajes():
        valor = request.args.get("despues_de_id", "0")
        if not valor.isdecimal() or len(valor) > 18:
            return None, (jsonify(respuesta_error("El cursor de mensajes no es válido.")), 400)
        return int(valor), None

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

    def storage():
        return current_app.config.get("STORAGE") or almacenamiento

    def respuesta_fotografia(fotografia):
        return {**fotografia, "url": storage().url_publica(fotografia["storage_path"])}

    def respuesta_vehiculo(vehiculo, fotografias=None):
        salida = dict(vehiculo)
        owner = salida.pop('vendedor_id', None)
        vendedor = getattr(g, 'cuenta_vendedor', None)
        privado = vendedor and str(owner) == vendedor['id']
        if not privado:
            salida.pop("placa", None)
        salida["tipo_vehiculo_etiqueta"] = etiqueta_tipo_vehiculo(salida.get("tipo_vehiculo")) if salida.get("tipo_vehiculo") else None
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

    def leer_json(campos, opcionales=()):
        try:
            cuerpo = request.get_json()
        except (BadRequest, UnsupportedMediaType):
            return None, (jsonify(respuesta_error(
                "No se pudo leer la solicitud.",
                {"solicitud": "Envía un objeto JSON válido con Content-Type application/json."},
            )), 400)
        if not isinstance(cuerpo, dict) or not set(campos) <= set(cuerpo) or set(cuerpo) - set(campos) - set(opcionales):
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
        return render_template("index.html", csrf_token=token_csrf(), vehiculo_id=None, chat_habilitado=False, tipos_vehiculo=TIPOS_VEHICULO, mapa_alias_tipos_vehiculo=MAPA_ALIAS_TIPOS_VEHICULO)

    @aplicacion.get("/vehiculo/<int:identificador>")
    def pagina_vehiculo(identificador):
        # La existencia y privacidad del vehículo se resuelven desde el endpoint API.
        return render_template(
            "index.html", csrf_token=token_csrf(), vehiculo_id=identificador,
            chat_habilitado=False, tipos_vehiculo=TIPOS_VEHICULO,
            mapa_alias_tipos_vehiculo=MAPA_ALIAS_TIPOS_VEHICULO,
        )

    @aplicacion.get("/administracion")
    def pagina_administracion():
        return redirect("/cuenta", code=302)

    @aplicacion.get("/api/cuenta/chat/comprador/conversaciones")
    def listar_conversaciones_comprador_cuenta():
        usuario, fallo = exigir_cuenta_chat("comprador")
        if fallo:
            return fallo
        paginacion, fallo = cursor_conversaciones_cuenta()
        if fallo:
            return fallo
        cursor_id, limite = paginacion
        try:
            filas = chat_cuentas_repositorio(
                "listar_conversaciones_comprador", usuario["id"], cursor_id, limite,
            )
        except ValueError:
            return jsonify(respuesta_error("El cursor de conversaciones no es válido.")), 400
        except Exception as error:
            return error_persistencia(error)
        return jsonify({
            "ok": True,
            "conversaciones": [respuesta_conversacion_cuenta(fila, "comprador") for fila in filas],
            "hay_mas": len(filas) == limite,
            "siguiente_cursor": str(filas[-1]["id"]) if len(filas) == limite else None,
        })

    @aplicacion.get("/api/cuenta/chat/comprador/vehiculos/<int:identificador>/conversacion")
    def obtener_conversacion_comprador_vehiculo(identificador):
        usuario, fallo = exigir_cuenta_chat("comprador")
        if fallo:
            return fallo
        try:
            conversacion = chat_cuentas_repositorio(
                "obtener_conversacion_vehiculo_comprador", usuario["id"], identificador,
            )
        except ValueError:
            return jsonify(respuesta_error("El identificador del vehículo no es válido.")), 400
        except Exception as error:
            return error_persistencia(error)
        return jsonify({"ok": True, "conversacion": respuesta_conversacion_cuenta(conversacion, "comprador")})

    @aplicacion.get("/api/cuenta/chat/comprador/conversaciones/<uuid:conversacion_id>/mensajes")
    def listar_mensajes_comprador_cuenta(conversacion_id):
        usuario, fallo = exigir_cuenta_chat("comprador")
        if fallo:
            return fallo
        despues_de_id, fallo = cursor_mensajes()
        if fallo:
            return fallo
        try:
            mensajes = chat_cuentas_repositorio(
                "listar_mensajes_comprador", str(conversacion_id), usuario["id"], despues_de_id,
            )
        except ValueError:
            return jsonify(respuesta_error("El cursor de mensajes no es válido.")), 400
        except Exception as error:
            return error_persistencia(error)
        if mensajes is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "mensajes": [respuesta_mensaje_cuenta(m) for m in mensajes]})

    @aplicacion.post("/api/cuenta/chat/comprador/vehiculos/<int:identificador>/mensajes")
    def enviar_mensaje_comprador_cuenta(identificador):
        usuario, fallo = exigir_cuenta_chat("comprador")
        if fallo:
            return fallo
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        contenido, fallo = mensaje_chat_desde_solicitud()
        if fallo:
            return fallo
        huella = hashlib.sha256(contenido.encode("utf-8")).hexdigest()
        try:
            resultado = chat_cuentas_repositorio(
                "enviar_mensaje_comprador", usuario["id"], identificador,
                clave, huella, contenido,
            )
        except ValueError:
            return jsonify(respuesta_error("La solicitud ya fue enviada con otro contenido.")), 409
        except Exception as error:
            if isinstance(error, persistencia_chat_cuentas.LimiteMensajesChat):
                respuesta = jsonify(respuesta_error("Enviaste mensajes demasiado rápido. Espera un momento."))
                respuesta.headers["Retry-After"] = str(max(1, int(getattr(error, "retry_after", 30))))
                return respuesta, 429
            return error_persistencia(error)
        if resultado is None:
            return jsonify(respuesta_error("La publicación no está disponible para iniciar o continuar la conversación.")), 404
        return jsonify({
            "ok": True,
            "conversacion": respuesta_conversacion_cuenta(resultado["conversacion"], "comprador"),
            "mensaje": respuesta_mensaje_cuenta(resultado["mensaje"]),
            "duplicado": resultado["duplicado"],
        }), 200 if resultado["duplicado"] else 201

    @aplicacion.get("/api/cuenta/chat/vendedor/conversaciones")
    def listar_conversaciones_vendedor_cuenta():
        usuario, fallo = exigir_cuenta_chat("vendedor")
        if fallo:
            return fallo
        paginacion, fallo = cursor_conversaciones_cuenta()
        if fallo:
            return fallo
        cursor_id, limite = paginacion
        try:
            filas = chat_cuentas_repositorio(
                "listar_conversaciones_vendedor", usuario["id"], cursor_id, limite,
            )
        except ValueError:
            return jsonify(respuesta_error("El cursor de conversaciones no es válido.")), 400
        except Exception as error:
            return error_persistencia(error)
        return jsonify({
            "ok": True,
            "conversaciones": [respuesta_conversacion_cuenta(fila, "vendedor") for fila in filas],
            "hay_mas": len(filas) == limite,
            "siguiente_cursor": str(filas[-1]["id"]) if len(filas) == limite else None,
        })

    @aplicacion.get("/api/cuenta/chat/vendedor/conversaciones/<uuid:conversacion_id>/mensajes")
    def listar_mensajes_vendedor_cuenta(conversacion_id):
        usuario, fallo = exigir_cuenta_chat("vendedor")
        if fallo:
            return fallo
        despues_de_id, fallo = cursor_mensajes()
        if fallo:
            return fallo
        try:
            mensajes = chat_cuentas_repositorio(
                "listar_mensajes_vendedor", str(conversacion_id), usuario["id"], despues_de_id,
            )
        except ValueError:
            return jsonify(respuesta_error("El cursor de mensajes no es válido.")), 400
        except Exception as error:
            return error_persistencia(error)
        if mensajes is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "mensajes": [respuesta_mensaje_cuenta(m) for m in mensajes]})

    @aplicacion.post("/api/cuenta/chat/vendedor/conversaciones/<uuid:conversacion_id>/mensajes")
    def responder_mensaje_vendedor_cuenta(conversacion_id):
        usuario, fallo = exigir_cuenta_chat("vendedor")
        if fallo:
            return fallo
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        contenido, fallo = mensaje_chat_desde_solicitud()
        if fallo:
            return fallo
        try:
            conversacion = chat_cuentas_repositorio(
                "obtener_conversacion_vendedor", str(conversacion_id), usuario["id"],
            )
        except Exception as error:
            return error_persistencia(error)
        if conversacion is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        huella = hashlib.sha256(contenido.encode("utf-8")).hexdigest()
        try:
            resultado = chat_cuentas_repositorio(
                "responder_vendedor", usuario["id"], str(conversacion_id),
                clave, huella, contenido,
            )
        except ValueError:
            return jsonify(respuesta_error("La solicitud ya fue enviada con otro contenido.")), 409
        except Exception as error:
            return error_persistencia(error)
        if resultado is None:
            return jsonify(respuesta_error("La conversación o publicación ya no está disponible para responder.")), 409
        return jsonify({
            "ok": True,
            "mensaje": respuesta_mensaje_cuenta(resultado["mensaje"]),
            "duplicado": resultado["duplicado"],
        }), 200 if resultado["duplicado"] else 201

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

    def registrar_vehiculo():
        rechazo = exigir_vendedor_y_csrf()
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

    def editar_vehiculo(identificador):
        rechazo = exigir_vendedor_y_csrf()
        if rechazo:
            return rechazo
        cuerpo, fallo = leer_json({"vehiculo"})
        if fallo:
            return fallo
        try:
            anterior = repositorio("obtener_vehiculo", identificador)
        except Exception as error:
            return error_persistencia(error)
        if anterior is None:
            return jsonify(respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."})), 404
        vehiculo, errores = validar_vehiculo(cuerpo["vehiculo"], valores_anteriores=anterior)
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

    def cambiar_disponibilidad(identificador):
        rechazo = exigir_vendedor_y_csrf()
        if rechazo:
            return rechazo
        cuerpo, fallo = leer_json({"disponibilidad"}, {"version_esperada"})
        if fallo:
            return fallo
        disponibilidad = cuerpo["disponibilidad"]
        if disponibilidad not in ("disponible", "vendido"):
            return jsonify(respuesta_error(
                "Revisa la disponibilidad.",
                {"disponibilidad": "Selecciona disponible o vendido."},
            )), 422
        version = cuerpo.get("version_esperada")
        if "version_esperada" in cuerpo:
            try:
                if not isinstance(version, str) or len(version) > 40:
                    raise ValueError()
                fecha = datetime.fromisoformat(version)
                if fecha.tzinfo is None or fecha.utcoffset() is None:
                    raise ValueError()
            except ValueError:
                return jsonify(respuesta_error("La versión del vehículo no es válida.")), 400
        try:
            if "version_esperada" in cuerpo:
                guardado = repositorio("cambiar_disponibilidad_condicional", identificador, disponibilidad, version)
            else:
                guardado = repositorio("cambiar_disponibilidad", identificador, disponibilidad)
            salida = respuesta_vehiculo(guardado) if guardado is not None else None
        except Exception as error:
            return error_persistencia(error)
        if guardado is None and "version_esperada" in cuerpo:
            return jsonify(respuesta_error("El vehículo cambió o ya no está disponible. Actualiza el inventario.")), 409
        if guardado is None:
            return jsonify(respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."})), 404
        return jsonify({"ok": True, "vehiculo": salida})

    def retirar_publicacion(identificador):
        rechazo = exigir_vendedor_y_csrf()
        if rechazo:
            return rechazo
        if not 1 <= identificador <= 9007199254740991:
            return jsonify(respuesta_error("Identificador de vehículo no válido.")), 400
        cuerpo, fallo = leer_json({"version_esperada"})
        if fallo:
            return fallo
        version = cuerpo["version_esperada"]
        try:
            if not isinstance(version, str) or len(version) > 40:
                raise ValueError()
            fecha = datetime.fromisoformat(version)
            if fecha.tzinfo is None or fecha.utcoffset() is None:
                raise ValueError()
        except ValueError:
            return jsonify(respuesta_error("La versión del vehículo no es válida.")), 400
        try:
            resultado = repositorio("retirar_vehiculo", identificador, version)
        except Exception as error:
            return error_persistencia(error)
        if resultado == "no_encontrado":
            return jsonify(respuesta_error("No se encontró el vehículo.")), 404
        if resultado == "conflicto":
            return jsonify(respuesta_error("El vehículo cambió. Actualizá el inventario antes de retirarlo.")), 409
        if resultado == "fotografia_pendiente":
            return jsonify(respuesta_error("Hay una fotografía en proceso. Esperá a que termine antes de retirar la publicación.")), 409
        if resultado != "retirado":
            return jsonify(respuesta_error("No se pudo retirar la publicación.")), 503
        return jsonify({"ok": True, "mensaje": "Publicación retirada."})

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
        rechazo = exigir_vendedor_y_csrf()
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

    def agregar_fotografia(identificador):
        return guardar_fotografia(identificador)

    def sustituir_fotografia(identificador, fotografia_id):
        return guardar_fotografia(identificador, fotografia_id)

    def eliminar_fotografia(identificador, fotografia_id):
        rechazo = exigir_vendedor_y_csrf()
        if rechazo:
            return rechazo
        try:
            eliminada = fotos_repositorio("eliminar_fotografia", identificador, fotografia_id)
            if not eliminada:
                return jsonify(respuesta_error("No se encontró la fotografía.")), 404
            limpieza_pendiente = limpiar_despues_del_commit()
            resultado = resultado_fotos(identificador, limpieza_pendiente=limpieza_pendiente)
        except LookupError:
            return jsonify(respuesta_error("No se encontró la fotografía.")), 404
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
            respuesta = jsonify(respuesta_error(
                "La solicitud no pudo completarse.",
                {"solicitud": "Revisa la ruta y el método de la solicitud."},
            ))
            if error.code == 405:
                allow = error.get_response().headers.get("Allow")
                if allow:
                    respuesta.headers["Allow"] = allow
            return respuesta, error.code
        return error

    @aplicacion.errorhandler(Exception)
    def error_inesperado(error):
        current_app.logger.error("Falló una solicitud (%s).", type(error).__name__)
        if request.path.startswith("/api/"):
            return jsonify(respuesta_error("La solicitud no pudo completarse. Intenta de nuevo.")), 503
        return "La página no está disponible temporalmente.", 503

    @aplicacion.before_request
    def contexto_vendedor():
        session.pop('admin_authenticated', None)  # Una cookie V6 ya no otorga privilegios.
        es_vendedor = request.path == '/vendedor' or request.path.startswith('/vendedor/') or request.path.startswith('/api/vendedor/')
        es_chat_cuenta = request.path.startswith('/api/cuenta/chat/')
        solo_lectura_actual = politica_v7.solo_lectura(current_app.config)
        if es_chat_cuenta:
            if not politica_v7.habilitada(current_app.config):
                return jsonify(respuesta_error('Mensajería de cuentas no habilitada.')), 404
            if solo_lectura_actual and request.method not in ('GET', 'HEAD', 'OPTIONS'):
                return jsonify(respuesta_error('Este ambiente permite únicamente consultas; no se pueden modificar conversaciones.')), 503
            try:
                usuario = cuentas.identidad()
            except auth_proveedor.ErrorAuth as error:
                if error.status == 401:
                    g.cuenta_clear = True
                    return jsonify(respuesta_error("Tu sesión venció. Inicia sesión de nuevo.")), 401
                return jsonify(respuesta_error("No se pudo verificar tu sesión. Intenta de nuevo.")), 503
            if not usuario:
                return jsonify(respuesta_error('Inicia sesión para continuar.')), 401
            g.cuenta_chat = usuario
            return None
        if not es_vendedor:
            return None
        owner = None
        if es_vendedor:
            if not politica_v7.habilitada(current_app.config):
                return jsonify(respuesta_error('Panel no habilitado.')), 404
            if solo_lectura_actual and request.method not in ('GET', 'HEAD', 'OPTIONS'):
                return jsonify(respuesta_error('Este ambiente permite únicamente consultas; no se pueden modificar publicaciones.')), 503
            try:
                user = cuentas.identidad()
            except auth_proveedor.ErrorAuth as error:
                if error.status == 401:
                    g.cuenta_clear = True
                    return jsonify(respuesta_error('Tu sesión venció. Inicia sesión de nuevo.')), 401
                return jsonify(respuesta_error('No se pudo verificar tu sesión.')), 503
            if not user: return jsonify(respuesta_error('Iniciá sesión para continuar.')), 401
            if user['rol'] != 'vendedor': return jsonify(respuesta_error('Se requiere una cuenta vendedora.')), 403
            g.cuenta_vendedor = user
            owner = user['id']
        g.propiedad_tokens = (propiedad.vendedor.set(owner), propiedad.privado.set(True))

    @aplicacion.teardown_request
    def limpiar_propiedad(error):
        tokens = getattr(g, 'propiedad_tokens', None)
        if tokens:
            propiedad.vendedor.reset(tokens[0]); propiedad.privado.reset(tokens[1])
            g.propiedad_tokens = None

    @aplicacion.after_request
    def cookies_vendedor(response):
        if (request.path == '/vendedor' or request.path.startswith('/vendedor/') or request.path.startswith('/api/vendedor/')
                or request.path.startswith('/api/cuenta/chat/')):
            return cuentas.cookies(response)
        return response

    @aplicacion.get('/vendedor')
    def panel_vendedor():
        return render_template('admin_v6.html', csrf_token=token_csrf(), solo_lectura=current_app.config['APP_READ_ONLY'], chat_habilitado=False, max_year=datetime.now().year+1, vendedor_panel=True, tipos_vehiculo=TIPOS_VEHICULO, mapa_alias_tipos_vehiculo=MAPA_ALIAS_TIPOS_VEHICULO)

    @aplicacion.get('/api/vendedor/session')
    def sesion_vendedor():
        return jsonify(ok=True, autenticado=True, solo_lectura=current_app.config['APP_READ_ONLY'])

    @aplicacion.get('/vendedor/archivo')
    @aplicacion.get('/vendedor/archivo/<uuid:conversacion_id>')
    def archivo_historico(conversacion_id=None):
        try:
            if conversacion_id:
                despues = request.args.get('despues', '0')
                if not despues.isdecimal() or len(despues) > 18:
                    abort(400)
                conversacion, mensajes, siguiente = archivo_chat.detalle(g.cuenta_vendedor['id'], conversacion_id, int(despues))
                if conversacion is None:
                    abort(404)
                filas = []
            else:
                filas, siguiente = archivo_chat.listar(g.cuenta_vendedor['id'], request.args.get('cursor'))
                conversacion, mensajes = None, []
        except ValueError:
            abort(400)
        respuesta = aplicacion.make_response(render_template('archivo_chat.html',
            conversaciones=filas, conversacion=conversacion, mensajes=mensajes, siguiente=siguiente))
        respuesta.headers['Cache-Control'] = 'no-store'
        return respuesta

    for ruta, funcion, metodos in (
        ('', listar_vehiculos, ['GET']), ('', registrar_vehiculo, ['POST']),
        ('/<int:identificador>', consultar_vehiculo, ['GET']), ('/<int:identificador>', editar_vehiculo, ['PUT']),
        ('/<int:identificador>/disponibilidad', cambiar_disponibilidad, ['PATCH']),
        ('/<int:identificador>/retirar', retirar_publicacion, ['POST']),
        ('/<int:identificador>/fotografias', agregar_fotografia, ['POST']),
        ('/<int:identificador>/fotografias/<int:fotografia_id>', sustituir_fotografia, ['PUT']),
        ('/<int:identificador>/fotografias/<int:fotografia_id>', eliminar_fotografia, ['DELETE']),
    ):
        aplicacion.add_url_rule('/api/vendedor/vehiculos'+ruta, 'vendedor_'+funcion.__name__, funcion, methods=metodos)
    return aplicacion


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
