"""Pruebas de integración del chat contra PostgreSQL temporal aislado."""

from datetime import datetime, timedelta, timezone
import hashlib
import os
import unittest
import uuid
from unittest import skipUnless

import psycopg

import persistencia_chat as chat
from test_postgres_integracion import base_aislada


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

    def test_sesion_hash_recuperacion_expiracion_y_revocacion(self):
        token_hash, ids = self.identidad()
        recuperada = chat.resolver_visitante(token_hash)
        self.assertEqual(recuperada["visitante_id"], ids["visitante_id"])
        self.assertEqual(recuperada["sesion_id"], ids["sesion_id"])
        hash_desconocido = hashlib.sha256(b"desconocido").hexdigest()
        self.assertIsNone(chat.resolver_visitante(hash_desconocido))
        self.assertTrue(chat.revocar_sesion_visitante(token_hash))
        self.assertIsNone(chat.resolver_visitante(token_hash))

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

    def test_rls_y_roles_publicos_sin_privilegios_directos(self):
        tablas = (
            "visitantes_anonimos", "sesiones_visitante", "conversaciones", "mensajes_chat",
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
