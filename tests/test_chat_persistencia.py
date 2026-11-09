"""Pruebas de integración del chat contra PostgreSQL temporal aislado."""

from datetime import datetime, timedelta, timezone
import hashlib
import os
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless

import psycopg

import persistencia_chat as chat
import persistencia
from test_postgres_integracion import base_aislada, datos


class ChatPersistenciaValidacionTest(unittest.TestCase):
    def test_hashes_y_claves_deben_tener_formato_estricto(self):
        with self.assertRaises(ValueError):
            chat._hash_valido("no-es-hash", "verificador_hash")
        with self.assertRaises(ValueError):
            chat._uuid("no-es-uuid", "visitante_id")

    def test_mensaje_rechaza_vacio_y_limite_excedido(self):
        clave = uuid.uuid4()
        hash_valido = "a" * 64
        with self.assertRaises(ValueError):
            chat._validar_mensaje(clave, hash_valido, "  \n")
        with self.assertRaises(ValueError):
            chat._validar_mensaje(clave, hash_valido, "x" * (chat.MAX_CONTENIDO + 1))
        resultado = chat._validar_mensaje(clave, hash_valido, "  mensaje  ")
        self.assertEqual(resultado[2], "mensaje")

    def test_digest_de_origen_exige_hmac_sha256_hexadecimal(self):
        with self.assertRaises(ValueError):
            chat.reservar_inicio_sesion_chat("172.16.0.4")


@skipUnless(os.environ.get("TEST_DATABASE_URL"), "Requiere PostgreSQL local aislado en TEST_DATABASE_URL")
class ChatPersistenciaPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aislamiento = base_aislada()
        cls.dsn = cls.aislamiento.__enter__()
        cls.addClassCleanup(cls.aislamiento.__exit__, None, None, None)

    def identidad(self):
        token_hash = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        creado = chat.crear_visitante_y_sesion(
            token_hash, datetime.now(timezone.utc) + timedelta(days=30),
        )
        return token_hash, creado

    @staticmethod
    def huella(contenido):
        return hashlib.sha256(contenido.encode("utf-8")).hexdigest()

    def enviar(self, visitante_id, contenido="Hola, ¿sigue disponible?", clave=None):
        clave = clave or uuid.uuid4()
        return chat.enviar_mensaje_comprador(
            visitante_id, 1, clave, self.huella(contenido), contenido,
        )

    def test_retiro_conserva_conversacion_y_bloquea_nuevo_mensaje(self):
        vehiculo = persistencia.crear_vehiculo(datos(777))
        _, ids = self.identidad()
        texto = "Consulta ficticia"
        primero = chat.enviar_mensaje_comprador(ids["visitante_id"], vehiculo["id"], uuid.uuid4(), self.huella(texto), texto)
        self.assertEqual(persistencia.retirar_vehiculo(vehiculo["id"], vehiculo["updated_at"]), "retirado")
        self.assertIsNone(chat.enviar_mensaje_comprador(ids["visitante_id"], vehiculo["id"], uuid.uuid4(), self.huella(texto), texto))
        historial = chat.listar_mensajes(primero["conversacion"]["id"], visitante_id=ids["visitante_id"])
        self.assertEqual(len(historial), 1)
        self.assertEqual(historial[0]["contenido"], texto)

    def test_retiro_concurrente_con_mensaje_no_permite_envio_posterior(self):
        vehiculo = persistencia.crear_vehiculo(datos(778))
        _, ids = self.identidad()
        texto = "Consulta concurrente"
        barrera = threading.Barrier(2)
        def enviar():
            barrera.wait()
            return chat.enviar_mensaje_comprador(ids["visitante_id"], vehiculo["id"], uuid.uuid4(), self.huella(texto), texto)
        def retirar():
            barrera.wait()
            return persistencia.retirar_vehiculo(vehiculo["id"], vehiculo["updated_at"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            mensaje = pool.submit(enviar)
            retiro = pool.submit(retirar)
            anterior, resultado = mensaje.result(), retiro.result()
        self.assertEqual(resultado, "retirado")
        self.assertIsNone(chat.enviar_mensaje_comprador(ids["visitante_id"], vehiculo["id"], uuid.uuid4(), self.huella(texto), texto))
        if anterior is not None:
            self.assertEqual(len(chat.listar_mensajes(anterior["conversacion"]["id"], visitante_id=ids["visitante_id"])), 1)

    def test_sesion_hash_recuperacion_expiracion_y_revocacion(self):
        token_hash, ids = self.identidad()
        recuperada = chat.resolver_visitante(token_hash)
        self.assertEqual(recuperada["visitante_id"], ids["visitante_id"])
        self.assertEqual(recuperada["sesion_id"], ids["sesion_id"])
        hash_desconocido = hashlib.sha256(b"desconocido").hexdigest()
        self.assertIsNone(chat.resolver_visitante(hash_desconocido))
        self.assertTrue(chat.revocar_sesion_visitante(token_hash))
        self.assertIsNone(chat.resolver_visitante(token_hash))

    def test_limite_de_inicio_de_sesion_ventana_fija_y_reinicio(self):
        clave = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        for _ in range(chat.MAX_INICIOS_SESION_POR_HORA):
            self.assertEqual(chat.reservar_inicio_sesion_chat(clave), 0)
        with self.assertRaises(chat.LimiteInicioSesionChat) as contexto:
            chat.reservar_inicio_sesion_chat(clave)
        self.assertGreaterEqual(contexto.exception.retry_after, 1)
        self.assertLessEqual(contexto.exception.retry_after, chat.VENTANA_INICIO_SESION_SEGUNDOS)
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute(
                "UPDATE public.chat_inicio_sesion_limites SET ventana_desde = now() - interval '2 hours' WHERE clave_hash = %s",
                (clave,),
            )
        self.assertEqual(chat.reservar_inicio_sesion_chat(clave), 0)

    def test_verificador_de_sesion_es_unico_y_no_reemite_credencial(self):
        token_hash, _ = self.identidad()
        with self.assertRaises(psycopg.errors.UniqueViolation):
            chat.crear_visitante_y_sesion(
                token_hash, datetime.now(timezone.utc) + timedelta(days=30),
            )

    def test_visitante_reserva_relacion_futura_con_auth_sin_exigir_cuenta(self):
        with psycopg.connect(self.dsn) as conexion:
            columna = conexion.execute(
                """SELECT is_nullable FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'visitantes_anonimos'
                     AND column_name = 'auth_user_id'""",
            ).fetchone()
        self.assertEqual(columna[0], "YES")

    def test_envio_crea_conversacion_y_reintento_idempotente_no_duplica(self):
        _, ids = self.identidad()
        clave = uuid.uuid4()
        primero = self.enviar(ids["visitante_id"], clave=clave)
        repetido = self.enviar(ids["visitante_id"], clave=clave)
        self.assertFalse(primero["duplicado"])
        self.assertTrue(repetido["duplicado"])
        self.assertEqual(primero["mensaje"]["id"], repetido["mensaje"]["id"])
        self.assertEqual(len(chat.listar_mensajes(
            primero["conversacion"]["id"], visitante_id=ids["visitante_id"],
        )), 1)
        with self.assertRaises(ValueError):
            self.enviar(ids["visitante_id"], "Otro cuerpo", clave)

    def test_conversacion_y_mensajes_solo_visibles_al_visitante_propietario(self):
        _, propietario = self.identidad()
        _, otro = self.identidad()
        envio = self.enviar(propietario["visitante_id"])
        conversacion_id = envio["conversacion"]["id"]
        self.assertIsNone(chat.obtener_conversacion(
            conversacion_id, visitante_id=otro["visitante_id"],
        ))
        self.assertIsNone(chat.listar_mensajes(
            conversacion_id, visitante_id=otro["visitante_id"],
        ))

    def test_limite_persistente_y_reintento_idempotente_bajo_limite(self):
        _, ids = self.identidad()
        claves = [uuid.uuid4() for _ in range(chat.MAX_MENSAJES_POR_MINUTO)]
        envios = [self.enviar(ids["visitante_id"], f"Mensaje {n}", claves[n])
                  for n in range(chat.MAX_MENSAJES_POR_MINUTO)]
        with self.assertRaises(chat.LimiteMensajesChat):
            self.enviar(ids["visitante_id"], "Exceso")
        repetido = self.enviar(ids["visitante_id"], f"Mensaje {len(claves)-1}", claves[-1])
        self.assertTrue(repetido["duplicado"])
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute(
                """UPDATE public.mensajes_chat SET created_at = now() - interval '61 seconds'
                   WHERE conversacion_id = %s""",
                (envios[0]["conversacion"]["id"],),
            )
        siguiente = self.enviar(ids["visitante_id"], "Ventana renovada")
        self.assertFalse(siguiente["duplicado"])

    def test_respuesta_admin_y_estado_atendida(self):
        _, ids = self.identidad()
        envio = self.enviar(ids["visitante_id"])
        conversacion_id = envio["conversacion"]["id"]
        clave = uuid.uuid4()
        huella = self.huella("Sí, está disponible")
        respuesta = chat.responder_admin(conversacion_id, clave, huella, "Sí, está disponible")
        repetida = chat.responder_admin(conversacion_id, clave, huella, "Sí, está disponible")
        self.assertFalse(respuesta["duplicado"])
        self.assertTrue(repetida["duplicado"])
        self.assertEqual(respuesta["mensaje"]["id"], repetida["mensaje"]["id"])
        atendida = chat.marcar_atendida(conversacion_id)
        self.assertEqual(atendida["estado"], "atendida")

    def test_reintento_administrativo_concurrente_inserta_un_solo_mensaje(self):
        _, ids = self.identidad()
        envio = self.enviar(ids["visitante_id"])
        conversacion_id = envio["conversacion"]["id"]
        clave = uuid.uuid4()
        contenido = "Confirmación enviada en dos solicitudes simultáneas"
        huella = self.huella(contenido)
        barrera = threading.Barrier(2)

        def responder():
            barrera.wait(timeout=5)
            return chat.responder_admin(conversacion_id, clave, huella, contenido)

        with ThreadPoolExecutor(max_workers=2) as ejecutor:
            resultados = list(ejecutor.map(lambda _: responder(), range(2)))
        self.assertEqual(sorted(resultado["duplicado"] for resultado in resultados), [False, True])
        self.assertEqual(resultados[0]["mensaje"]["id"], resultados[1]["mensaje"]["id"])
        mensajes = chat.listar_mensajes(conversacion_id, admin=True)
        self.assertEqual(sum(m["remitente"] == "administrador" for m in mensajes), 1)

    def test_listado_admin_paginado_por_cursor_no_repite_conversaciones(self):
        identificadores = []
        with psycopg.connect(self.dsn) as conexion:
            total_anterior = conexion.execute("SELECT count(*) FROM public.conversaciones").fetchone()[0]
        for _ in range(51):
            _, ids = self.identidad()
            with psycopg.connect(self.dsn) as conexion:
                fila = conexion.execute(
                    "INSERT INTO public.conversaciones (vehiculo_id, visitante_id) VALUES (1, %s) RETURNING id",
                    (ids["visitante_id"],),
                ).fetchone()
            identificadores.append(str(fila[0]))
        acumuladas = []
        cursor_id = None
        while True:
            pagina = chat.listar_conversaciones_admin(cursor_id=cursor_id, limite=10)
            acumuladas.extend(pagina)
            if len(pagina) < 10:
                break
            cursor_id = pagina[-1]["id"]
        ids_paginados = [fila["id"] for fila in acumuladas]
        self.assertEqual(len(acumuladas), total_anterior + 51)
        self.assertEqual(len(set(ids_paginados)), len(ids_paginados))
        self.assertEqual(len(acumuladas), len(identificadores) + total_anterior)

    def test_rls_y_roles_publicos_sin_privilegios_directos(self):
        tablas = (
            "visitantes_anonimos", "sesiones_visitante", "conversaciones", "mensajes_chat",
            "chat_inicio_sesion_limites",
        )
        with psycopg.connect(self.dsn) as conexion:
            for tabla in tablas:
                estado = conexion.execute(
                    """SELECT c.relrowsecurity,
                              has_table_privilege('anon', c.oid, 'SELECT'),
                              has_table_privilege('anon', c.oid, 'INSERT'),
                              has_table_privilege('authenticated', c.oid, 'SELECT'),
                              has_table_privilege('authenticated', c.oid, 'INSERT'),
                              EXISTS (SELECT 1 FROM aclexplode(
                                  coalesce(c.relacl, acldefault('r', c.relowner))) a
                                  WHERE a.grantee = 0)
                       FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relname = %s""",
                    (tabla,),
                ).fetchone()
                self.assertIsNotNone(estado, tabla)
                self.assertTrue(estado[0], tabla)
                self.assertFalse(any(estado[1:]), tabla)
                self.assertFalse(estado[5], f"PUBLIC conserva ACL para {tabla}")
            for rol in ("anon", "authenticated"):
                privilegio = conexion.execute(
                    """SELECT has_sequence_privilege(%s, 'public.mensajes_chat_id_seq', 'USAGE')
                              OR has_sequence_privilege(%s, 'public.mensajes_chat_id_seq', 'UPDATE')""",
                    (rol, rol),
                ).fetchone()[0]
                self.assertFalse(privilegio, rol)
            publico_secuencia = conexion.execute(
                """SELECT EXISTS (
                       SELECT 1 FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace,
                       LATERAL aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
                       WHERE n.nspname = 'public' AND c.relname = 'mensajes_chat_id_seq'
                         AND a.grantee = 0)"""
            ).fetchone()[0]
            self.assertFalse(publico_secuencia, "PUBLIC conserva ACL en secuencia de mensajes")
