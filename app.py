"""Rutas Flask del catálogo; PostgreSQL es la fuente de verdad."""

import hashlib
import hmac
import ipaddress
import os
import secrets
from datetime import datetime, timedelta, timezone
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
import persistencia_chat
from vehiculos import filtrar_vehiculos, respuesta_error, validar_filtros_busqueda, validar_vehiculo


MAX_SOLICITUD = 1_100_000
MAX_PASSWORD_LENGTH = 1024
MAX_INTENTOS_LOGIN = 5
PAUSA_LOGIN_SEGUNDOS = 10 * 60
DURACION_SESION_CHAT_DIAS = 30
MAX_LONGITUD_MENSAJE_CHAT = 2000


def _direccion_cliente_para_limites():
    """Devuelve origen confiable para cuotas: cabecera sobrescrita por Vercel o peer local."""
    if os.environ.get("VERCEL"):
        origen_vercel = request.headers.get("x-vercel-forwarded-for", "").strip()
        try:
            # Vercel documenta esta cabecera como la IP pública del cliente. No
            # se aceptan listas ni valores arbitrarios; el proxy de plataforma
            # sustituye el valor recibido antes de invocar la Function.
            return str(ipaddress.ip_address(origen_vercel))
        except ValueError:
            pass
    return request.remote_addr or "sin-direccion"


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
        CHAT_ENABLED=os.environ.get("CHAT_ENABLED", "false").lower() == "true",
        REPOSITORY=None,
        PHOTO_REPOSITORY=None,
        LOGIN_LIMITER=None,
        CHAT_REPOSITORY=None,
        STORAGE=None,
    )
    if configuracion:
        aplicacion.config.update(configuracion)
    # La función pública no se puede habilitar desde Preview ni en un entorno
    # configurado como solo lectura, aunque alguien solicite CHAT_ENABLED.
    if os.environ.get("VERCEL_ENV") == "preview" or aplicacion.config["APP_READ_ONLY"]:
        aplicacion.config["CHAT_ENABLED"] = False
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

    def exigir_admin_sin_csrf():
        if current_app.config["APP_READ_ONLY"]:
            return jsonify(respuesta_error("Este ambiente permite únicamente consultar el catálogo.")), 503
        if not session.get("admin_authenticated"):
            return jsonify(respuesta_error("Inicia sesión como administrador para continuar.")), 401
        return None

    def chat_publico_habilitado():
        return bool(
            current_app.config.get("CHAT_ENABLED")
            and not current_app.config.get("APP_READ_ONLY")
            and os.environ.get("VERCEL_ENV") != "preview"
        )

    def exigir_chat_habilitado():
        if not chat_publico_habilitado():
            return jsonify(respuesta_error("El chat no está habilitado en este ambiente.")), 503
        return None

    def chat_repositorio(nombre, *argumentos):
        personalizado = current_app.config.get("CHAT_REPOSITORY")
        if personalizado is not None:
            return personalizado[nombre](*argumentos)
        return getattr(persistencia_chat, nombre)(*argumentos)

    def nombre_cookie_chat():
        nombre = current_app.config.get("CHAT_SESSION_COOKIE_NAME")
        if nombre:
            return nombre
        return "__Host-chat_session" if current_app.config["SESSION_COOKIE_SECURE"] else "chat_session"

    def csrf_chat(token):
        secreto = current_app.secret_key
        secreto = secreto if isinstance(secreto, bytes) else secreto.encode()
        return hmac.new(secreto, b"chat-csrf-v1:" + token.encode(), hashlib.sha256).hexdigest()

    def visitante_chat():
        token = request.cookies.get(nombre_cookie_chat(), "")
        if not token or len(token) > 128:
            return None
        verificador = hashlib.sha256(token.encode()).hexdigest()
        visitante = chat_repositorio("resolver_visitante", verificador)
        if visitante is None:
            return None
        return {"token": token, "verificador": verificador, "datos": visitante}

    def csrf_chat_valido(token):
        recibido = request.headers.get("X-CSRF-Token", "")
        return bool(recibido and hmac.compare_digest(csrf_chat(token), recibido))

    def exigir_visitante_chat(csrf=False):
        visitante = visitante_chat()
        if visitante is None:
            return None, (jsonify(respuesta_error("La sesión de chat venció o no está disponible. Inicia una nueva sesión.")), 401)
        if csrf and not csrf_chat_valido(visitante["token"]):
            return None, (jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403)
        return visitante, None

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
        return render_template("index.html", csrf_token=token_csrf(), vehiculo_id=None, chat_habilitado=chat_publico_habilitado())

    @aplicacion.get("/vehiculo/<int:identificador>")
    def pagina_vehiculo(identificador):
        # La existencia y privacidad del vehículo se resuelven desde el endpoint API.
        return render_template(
            "index.html", csrf_token=token_csrf(), vehiculo_id=identificador,
            chat_habilitado=chat_publico_habilitado(),
        )

    @aplicacion.get("/administracion")
    def pagina_administracion():
        # La ruta solo entrega el shell. El cliente consulta el estado de sesión
        # y obtiene datos exclusivamente desde los endpoints existentes.
        respuesta = aplicacion.make_response(render_template(
            "admin_v6.html",
            csrf_token=token_csrf(),
            solo_lectura=current_app.config["APP_READ_ONLY"],
            chat_habilitado=chat_publico_habilitado(),
            max_year=datetime.now().year + 1,
        ))
        respuesta.headers["Cache-Control"] = "no-store"
        return respuesta

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
        # Vercel reemplaza x-vercel-forwarded-for con la IP pública de origen;
        # en cualquier otro entorno se ignoran cabeceras de proxy del cliente.
        origen_cliente = _direccion_cliente_para_limites().encode("utf-8")
        clave_cliente = hmac.new(secreto, origen_cliente, hashlib.sha256).hexdigest()
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

    @aplicacion.post("/api/chat/sesion")
    def iniciar_sesion_chat():
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        if not csrf_valido():
            return jsonify(respuesta_error("La solicitud de seguridad expiró. Recarga la página.")), 403
        nombre_cookie = nombre_cookie_chat()
        token_existente = request.cookies.get(nombre_cookie, "")
        if token_existente:
            try:
                visitante = visitante_chat()
            except Exception as error:
                return error_persistencia(error)
            if visitante is None:
                respuesta = jsonify(respuesta_error("La sesión de chat venció o no está disponible. Inicia una nueva sesión."))
                respuesta.set_cookie(
                    nombre_cookie, "", max_age=0, path="/", secure=current_app.config["SESSION_COOKIE_SECURE"],
                    httponly=True, samesite="Lax",
                )
                return respuesta, 401
            return jsonify({"ok": True, "csrf_token": csrf_chat(visitante["token"])})

        # La dirección solo aporta una clave seudónima al límite compartido;
        # no se usa como identidad, no se persiste en claro y no se confía XFF.
        secreto = current_app.secret_key
        secreto = secreto if isinstance(secreto, bytes) else secreto.encode()
        direccion = _direccion_cliente_para_limites().encode("utf-8")
        clave_limite = hmac.new(
            secreto, b"chat-session-init-rate-limit-v1\0" + direccion, hashlib.sha256,
        ).hexdigest()
        try:
            espera = chat_repositorio("reservar_inicio_sesion_chat", clave_limite)
        except Exception as error:
            if isinstance(error, persistencia_chat.LimiteInicioSesionChat):
                respuesta = jsonify(respuesta_error("Se iniciaron demasiadas sesiones de chat. Intenta más tarde."))
                respuesta.headers["Retry-After"] = str(max(1, int(error.retry_after)))
                return respuesta, 429
            return error_persistencia(error)
        if espera:
            respuesta = jsonify(respuesta_error("Se iniciaron demasiadas sesiones de chat. Intenta más tarde."))
            respuesta.headers["Retry-After"] = str(max(1, int(espera)))
            return respuesta, 429

        # La credencial solo se emite aquí, en el servidor. PostgreSQL recibe
        # únicamente su verificador hash; el valor claro viaja solo en cookie.
        token = secrets.token_urlsafe(32)
        verificador = hashlib.sha256(token.encode()).hexdigest()
        vence = datetime.now(timezone.utc) + timedelta(days=DURACION_SESION_CHAT_DIAS)
        try:
            chat_repositorio("crear_visitante_y_sesion", verificador, vence)
        except Exception as error:
            return error_persistencia(error)
        respuesta = jsonify({"ok": True, "csrf_token": csrf_chat(token)})
        respuesta.set_cookie(
            nombre_cookie, token, max_age=DURACION_SESION_CHAT_DIAS * 24 * 60 * 60,
            path="/", secure=current_app.config["SESSION_COOKIE_SECURE"],
            httponly=True, samesite="Lax",
        )
        return respuesta, 201

    @aplicacion.get("/api/chat/conversaciones")
    def listar_conversaciones_chat():
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        try:
            visitante = visitante_chat()
            if visitante is None:
                return jsonify(respuesta_error("La sesión de chat venció o no está disponible. Inicia una nueva sesión.")), 401
            conversaciones = chat_repositorio("listar_conversaciones_visitante", visitante["datos"]["visitante_id"])
        except Exception as error:
            return error_persistencia(error)
        return jsonify({
            "ok": True,
            "conversaciones": conversaciones,
            # Permite abrir la bandeja global con una sesión existente sin
            # llamar al POST de emisión, que podría crear una identidad nueva.
            "csrf_token": csrf_chat(visitante["token"]),
        })

    @aplicacion.post("/api/chat/vehiculos/<int:identificador>/mensajes")
    def enviar_primer_mensaje_chat(identificador):
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        visitante, fallo = exigir_visitante_chat(csrf=True)
        if fallo:
            return fallo
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        contenido, fallo = mensaje_chat_desde_solicitud()
        if fallo:
            return fallo
        huella = hashlib.sha256(contenido.encode("utf-8")).hexdigest()
        try:
            resultado = chat_repositorio(
                "enviar_mensaje_comprador", visitante["datos"]["visitante_id"],
                identificador, clave, huella, contenido,
            )
        except LookupError:
            return jsonify(respuesta_error("El vehículo no está disponible. Podés seguir consultando el historial.")), 404
        except ValueError:
            return jsonify(respuesta_error("La solicitud ya fue enviada con otro contenido.")), 409
        except Exception as error:
            if isinstance(error, persistencia_chat.LimiteMensajesChat):
                respuesta = jsonify(respuesta_error("Enviaste mensajes demasiado rápido. Espera un momento."))
                respuesta.headers["Retry-After"] = str(max(1, int(getattr(error, "retry_after", 30))))
                return respuesta, 429
            return error_persistencia(error)
        if resultado is None:
            return jsonify(respuesta_error("El vehículo no está disponible. Podés seguir consultando el historial.")), 404
        return jsonify({
            "ok": True, "conversacion": resultado["conversacion"],
            "mensaje": resultado["mensaje"], "duplicado": resultado["duplicado"],
        }), 200 if resultado["duplicado"] else 201

    @aplicacion.get("/api/chat/conversaciones/<uuid:conversacion_id>/mensajes")
    def listar_mensajes_chat(conversacion_id):
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        visitante, fallo = exigir_visitante_chat()
        if fallo:
            return fallo
        despues_de_id, fallo = cursor_mensajes()
        if fallo:
            return fallo
        try:
            mensajes = chat_repositorio(
                "listar_mensajes", str(conversacion_id), despues_de_id,
                visitante["datos"]["visitante_id"], False,
            )
        except Exception as error:
            return error_persistencia(error)
        # El repositorio aplica ownership en SQL: no se revela si la charla
        # existe cuando no pertenece a la sesión actual.
        if mensajes is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "mensajes": mensajes})

    @aplicacion.get("/api/admin/chat/conversaciones")
    def listar_conversaciones_admin():
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        rechazo = exigir_admin_sin_csrf()
        if rechazo:
            return rechazo
        estado = request.args.get("estado")
        if estado not in (None, "abierta", "atendida"):
            return jsonify(respuesta_error("El estado solicitado no es válido.")), 400
        cursor_id = request.args.get("cursor_id")
        if cursor_id:
            try:
                cursor_id = str(UUID(cursor_id))
            except (ValueError, TypeError, AttributeError):
                return jsonify(respuesta_error("El cursor solicitado no es válido.")), 400
        try:
            pagina = chat_repositorio("listar_conversaciones_admin", estado, cursor_id, 51)
        except Exception as error:
            return error_persistencia(error)
        hay_mas = len(pagina) > 50
        conversaciones = pagina[:50]
        siguiente_cursor = conversaciones[-1]["id"] if hay_mas and conversaciones else None
        return jsonify({
            "ok": True,
            "conversaciones": conversaciones,
            "hay_mas": hay_mas,
            "siguiente_cursor": siguiente_cursor,
        })

    @aplicacion.get("/api/admin/chat/conversaciones/<uuid:conversacion_id>/mensajes")
    def listar_mensajes_chat_admin(conversacion_id):
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        rechazo = exigir_admin_sin_csrf()
        if rechazo:
            return rechazo
        despues_de_id, fallo = cursor_mensajes()
        if fallo:
            return fallo
        try:
            mensajes = chat_repositorio("listar_mensajes", str(conversacion_id), despues_de_id, None, True)
        except Exception as error:
            return error_persistencia(error)
        if mensajes is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "mensajes": mensajes})

    @aplicacion.post("/api/admin/chat/conversaciones/<uuid:conversacion_id>/mensajes")
    def responder_conversacion_admin(conversacion_id):
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        clave, fallo = clave_idempotencia()
        if fallo:
            return fallo
        contenido, fallo = mensaje_chat_desde_solicitud()
        if fallo:
            return fallo
        huella = hashlib.sha256(contenido.encode("utf-8")).hexdigest()
        try:
            resultado = chat_repositorio("responder_admin", str(conversacion_id), clave, huella, contenido)
        except LookupError:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        except ValueError:
            return jsonify(respuesta_error("La solicitud ya fue enviada con otro contenido.")), 409
        except Exception as error:
            return error_persistencia(error)
        if resultado is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "mensaje": resultado["mensaje"], "duplicado": resultado["duplicado"]}), 200 if resultado["duplicado"] else 201

    @aplicacion.patch("/api/admin/chat/conversaciones/<uuid:conversacion_id>/atendida")
    def marcar_conversacion_atendida(conversacion_id):
        rechazo = exigir_chat_habilitado()
        if rechazo:
            return rechazo
        rechazo = exigir_admin_y_csrf()
        if rechazo:
            return rechazo
        try:
            conversacion = chat_repositorio("marcar_atendida", str(conversacion_id))
        except Exception as error:
            return error_persistencia(error)
        if conversacion is None:
            return jsonify(respuesta_error("No se encontró la conversación.")), 404
        return jsonify({"ok": True, "conversacion": conversacion})

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

    @aplicacion.post("/api/vehiculos/<int:identificador>/retirar")
    def retirar_publicacion(identificador):
        rechazo = exigir_admin_y_csrf()
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
