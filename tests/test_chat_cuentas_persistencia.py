"""Regresiones PostgreSQL para la persistencia privada del chat V7.3.1."""

import hashlib
import os
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless

import psycopg

import persistencia
import persistencia_chat_cuentas as chat
import propiedad
import roles_usuarios
from test_postgres_integracion import base_aislada, datos


class ChatCuentasValidacionTest(unittest.TestCase):
    def test_rechaza_identificadores_y_contenido_invalidos_sin_conectar(self):
        with self.assertRaises(ValueError):
            chat.crear_o_recuperar_conversacion_comprador("no-uuid", 1)
        with self.assertRaises(ValueError):
            chat.enviar_mensaje_comprador(str(uuid.uuid4()), 1, uuid.uuid4(), "x" * 64, " ")


@skipUnless(os.environ.get("TEST_DATABASE_URL"), "Requiere PostgreSQL 17 local aislado en TEST_DATABASE_URL")
class ChatCuentasPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aislamiento = base_aislada()
        cls.dsn = cls.aislamiento.__enter__()
        cls.addClassCleanup(cls.aislamiento.__exit__, None, None, None)

    def setUp(self):
        self.comprador_a = str(uuid.uuid4())
        self.comprador_b = str(uuid.uuid4())
        self.vendedor_a = str(uuid.uuid4())
        self.vendedor_b = str(uuid.uuid4())
        for uid, rol in (
            (self.comprador_a, "comprador"), (self.comprador_b, "comprador"),
            (self.vendedor_a, "vendedor"), (self.vendedor_b, "vendedor"),
        ):
            roles_usuarios.asignar_rol_inicial(uid, rol)
        self.vehiculo_a = self._vehiculo(self.vendedor_a, 731)
        self.vehiculo_b = self._vehiculo(self.vendedor_b, 732)
        self.vehiculo_retirado = self._vehiculo(self.vendedor_b, 734)
        self.vehiculo_legacy = persistencia.crear_vehiculo(datos(733))
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute(
                "UPDATE public.vehiculos SET retirado_en = now() WHERE id = %s",
                (self.vehiculo_retirado["id"],),
            )

    def _vehiculo(self, vendedor_id, numero):
        token = propiedad.vendedor.set(vendedor_id)
        try:
            return persistencia.crear_vehiculo(datos(numero))
        finally:
            propiedad.vendedor.reset(token)

    @staticmethod
    def _huella(texto):
        return hashlib.sha256(texto.encode("utf-8")).hexdigest()

    def _enviar(self, comprador_id=None, vehiculo=None, texto="Consulta de prueba", clave=None):
        return chat.enviar_mensaje_comprador(
            comprador_id or self.comprador_a,
            (vehiculo or self.vehiculo_a)["id"],
            clave or uuid.uuid4(),
            self._huella(texto),
            texto,
        )

    def test_participantes_listas_y_mensajes_tienen_ambito_privado(self):
        envio_a = self._enviar(self.comprador_a, self.vehiculo_a, "Comprador A")
        envio_b = self._enviar(self.comprador_b, self.vehiculo_a, "Comprador B")
        envio_vb = self._enviar(self.comprador_b, self.vehiculo_b, "Vehículo del B")

        self.assertEqual([x["id"] for x in chat.listar_conversaciones_comprador(self.comprador_a)],
                         [envio_a["conversacion"]["id"]])
        lista_b = chat.listar_conversaciones_comprador(self.comprador_b)
        self.assertEqual({x["id"] for x in lista_b},
                         {envio_b["conversacion"]["id"], envio_vb["conversacion"]["id"]})
        self.assertEqual({x["id"] for x in chat.listar_conversaciones_vendedor(self.vendedor_a)},
                         {envio_a["conversacion"]["id"], envio_b["conversacion"]["id"]})
        self.assertEqual([x["id"] for x in chat.listar_conversaciones_vendedor(self.vendedor_b)],
                         [envio_vb["conversacion"]["id"]])

        conv_a = envio_a["conversacion"]["id"]
        self.assertIsNone(chat.obtener_conversacion_comprador(conv_a, self.comprador_b))
        self.assertIsNone(chat.obtener_conversacion_vendedor(conv_a, self.vendedor_b))
        self.assertIsNone(chat.listar_mensajes_comprador(conv_a, self.comprador_b))
        self.assertIsNone(chat.listar_mensajes_vendedor(conv_a, self.vendedor_b))
        self.assertEqual(chat.listar_mensajes_comprador(conv_a, self.comprador_a)[0]["contenido"], "Comprador A")
        self.assertEqual(chat.listar_mensajes_vendedor(conv_a, self.vendedor_a)[0]["contenido"], "Comprador A")
        self.assertEqual(
            chat.obtener_conversacion_vehiculo_comprador(self.comprador_a, self.vehiculo_a["id"])["id"],
            conv_a,
        )
        self.assertEqual(
            chat.obtener_conversacion_vehiculo_comprador(self.comprador_b, self.vehiculo_a["id"])["id"],
            envio_b["conversacion"]["id"],
        )
        self.assertIsNone(
            chat.obtener_conversacion_vehiculo_comprador(self.comprador_a, self.vehiculo_b["id"]),
        )
        self.assertEqual(chat.listar_conversaciones_comprador(self.vendedor_a), [])
        self.assertEqual(chat.listar_conversaciones_vendedor(self.comprador_a), [])

    def test_no_crea_chat_para_vehiculo_heredado_retirado_o_rol_incorrecto(self):
        self.assertIsNone(chat.crear_o_recuperar_conversacion_comprador(
            self.comprador_a, self.vehiculo_legacy["id"],
        ))
        self.assertIsNone(chat.crear_o_recuperar_conversacion_comprador(
            self.comprador_a, self.vehiculo_retirado["id"],
        ))
        self.assertIsNone(chat.enviar_mensaje_comprador(
            self.comprador_a, self.vehiculo_legacy["id"], uuid.uuid4(), self._huella("x"), "x",
        ))
        self.assertIsNone(chat.enviar_mensaje_comprador(
            self.vendedor_a, self.vehiculo_a["id"], uuid.uuid4(), self._huella("x"), "x",
        ))
        self.assertIsNone(chat.crear_o_recuperar_conversacion_comprador(
            self.vendedor_a, self.vehiculo_a["id"],
        ))

        with psycopg.connect(self.dsn, autocommit=True) as conexion:
            with self.assertRaises(psycopg.errors.CheckViolation):
                conexion.execute(
                    "INSERT INTO public.conversaciones_cuentas (comprador_id, vehiculo_id) VALUES (%s, %s)",
                    (self.vendedor_a, self.vehiculo_a["id"]),
                )
            with self.assertRaises(psycopg.errors.CheckViolation):
                conexion.execute(
                    "INSERT INTO public.conversaciones_cuentas (comprador_id, vehiculo_id) VALUES (%s, %s)",
                    (self.comprador_a, self.vehiculo_legacy["id"]),
                )

    def test_creacion_reutilizacion_mensajes_idempotencia_y_respuesta_del_dueno(self):
        creada = chat.crear_o_recuperar_conversacion_comprador(self.comprador_a, self.vehiculo_a["id"])
        recuperada = chat.crear_o_recuperar_conversacion_comprador(self.comprador_a, self.vehiculo_a["id"])
        self.assertEqual(creada["id"], recuperada["id"])
        with psycopg.connect(self.dsn, autocommit=True) as conexion:
            self.assertEqual(conexion.execute(
                "SELECT count(*) FROM public.conversaciones_cuentas WHERE comprador_id=%s AND vehiculo_id=%s",
                (self.comprador_a, self.vehiculo_a["id"]),
            ).fetchone()[0], 1)
            with self.assertRaises(psycopg.errors.ForeignKeyViolation):
                conexion.execute(
                    "DELETE FROM public.roles_usuarios WHERE usuario_id=%s",
                    (self.comprador_a,),
                )
            with self.assertRaises(psycopg.errors.ForeignKeyViolation):
                conexion.execute(
                    "DELETE FROM public.vehiculos WHERE id=%s",
                    (self.vehiculo_a["id"],),
                )

        clave = uuid.uuid4()
        primero = self._enviar(texto="Primer mensaje", clave=clave)
        repetido = self._enviar(texto="Primer mensaje", clave=clave)
        self.assertFalse(primero["duplicado"])
        self.assertTrue(repetido["duplicado"])
        self.assertEqual(primero["mensaje"]["id"], repetido["mensaje"]["id"])
        with self.assertRaises(ValueError):
            self._enviar(texto="Cuerpo distinto", clave=clave)
        with self.assertRaises(ValueError):
            self._enviar(self.comprador_a, self.vehiculo_b, "Reuso cruzado", clave)

        respuesta = chat.responder_vendedor(
            self.vendedor_a, primero["conversacion"]["id"], uuid.uuid4(),
            self._huella("Respuesta del vendedor A"), "Respuesta del vendedor A",
        )
        self.assertFalse(respuesta["duplicado"])
        self.assertIsNone(chat.responder_vendedor(
            self.vendedor_b, primero["conversacion"]["id"], uuid.uuid4(),
            self._huella("Cruzado"), "Cruzado",
        ))
        self.assertIsNone(chat.responder_vendedor(
            self.comprador_a, primero["conversacion"]["id"], uuid.uuid4(),
            self._huella("Rol incorrecto"), "Rol incorrecto",
        ))
        self.assertEqual(chat.marcar_atendida(self.vendedor_a, primero["conversacion"]["id"])["estado"], "atendida")
        self.assertIsNone(chat.marcar_atendida(self.vendedor_b, primero["conversacion"]["id"]))
        mensajes = chat.listar_mensajes_comprador(primero["conversacion"]["id"], self.comprador_a)
        self.assertEqual([m["remitente"] for m in mensajes], ["comprador", "vendedor"])

        with psycopg.connect(self.dsn, autocommit=True) as conexion:
            with self.assertRaises(psycopg.errors.CheckViolation):
                conexion.execute(
                    "UPDATE public.conversaciones_cuentas SET comprador_id=%s WHERE id=%s",
                    (self.comprador_b, primero["conversacion"]["id"]),
                )
            with self.assertRaises(psycopg.errors.CheckViolation):
                conexion.execute(
                    """INSERT INTO public.mensajes_chat_cuentas
                       (conversacion_id, autor_id, remitente, contenido, clave_idempotencia, huella_solicitud)
                       VALUES (%s, %s, 'vendedor', 'spoof', %s, %s)""",
                    (primero["conversacion"]["id"], self.vendedor_b, uuid.uuid4(), self._huella("spoof")),
                )

    def test_limite_por_comprador_y_reintento_no_consume_cupo(self):
        claves = [uuid.uuid4() for _ in range(chat.MAX_MENSAJES_POR_MINUTO)]
        for n, clave in enumerate(claves):
            self._enviar(texto=f"Mensaje {n}", clave=clave)
        self.assertTrue(self._enviar(texto="Mensaje 7", clave=claves[-1])["duplicado"])
        with self.assertRaises(chat.LimiteMensajesChat):
            self._enviar(texto="Noveno mensaje")

    def test_concurrencia_de_creacion_y_reintento_de_mensaje_es_idempotente(self):
        barrera = threading.Barrier(2)
        clave = uuid.uuid4()

        def enviar():
            barrera.wait(timeout=5)
            return self._enviar(texto="Reintento concurrente", clave=clave)

        with ThreadPoolExecutor(max_workers=2) as pool:
            resultados = list(pool.map(lambda _: enviar(), range(2)))
        self.assertEqual(sorted(r["duplicado"] for r in resultados), [False, True])
        self.assertEqual(resultados[0]["conversacion"]["id"], resultados[1]["conversacion"]["id"])
        with psycopg.connect(self.dsn) as conexion:
            cuenta = conexion.execute(
                "SELECT count(*) FROM public.mensajes_chat_cuentas WHERE clave_idempotencia=%s",
                (clave,),
            ).fetchone()[0]
            self.assertEqual(cuenta, 1)

    def test_respuesta_de_vendedor_con_reintentos_concurrentes_no_duplica(self):
        conversacion = self._enviar(texto="Consulta para respuesta").get("conversacion")
        barrera = threading.Barrier(2)
        clave = uuid.uuid4()

        def responder():
            barrera.wait(timeout=5)
            return chat.responder_vendedor(
                self.vendedor_a, conversacion["id"], clave,
                self._huella("Respuesta concurrente"), "Respuesta concurrente",
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            resultados = list(pool.map(lambda _: responder(), range(2)))
        self.assertEqual(sorted(r["duplicado"] for r in resultados), [False, True])
        self.assertEqual(resultados[0]["mensaje"]["id"], resultados[1]["mensaje"]["id"])
        with psycopg.connect(self.dsn) as conexion:
            cantidad = conexion.execute(
                """SELECT count(*) FROM public.mensajes_chat_cuentas
                   WHERE conversacion_id=%s AND remitente='vendedor'""",
                (conversacion["id"],),
            ).fetchone()[0]
        self.assertEqual(cantidad, 1)

    def test_retiro_concurrente_impide_conversacion_nueva_pero_retorna_conflicto_seguro(self):
        barrera = threading.Barrier(2)

        def crear():
            barrera.wait(timeout=5)
            return chat.crear_o_recuperar_conversacion_comprador(self.comprador_a, self.vehiculo_a["id"])

        def retirar():
            barrera.wait(timeout=5)
            token = propiedad.vendedor.set(self.vendedor_a)
            try:
                return persistencia.retirar_vehiculo(self.vehiculo_a["id"], self.vehiculo_a["updated_at"])
            finally:
                propiedad.vendedor.reset(token)

        with ThreadPoolExecutor(max_workers=2) as pool:
            p_crear = pool.submit(crear)
            p_retirar = pool.submit(retirar)
            conversacion, estado = p_crear.result(), p_retirar.result()
        self.assertEqual(estado, "retirado")
        if conversacion is not None:
            # Si la creación tomó primero el bloqueo, solo queda el historial
            # y nunca se crea otra conversación después del retiro.
            self.assertIsNone(chat.crear_o_recuperar_conversacion_comprador(
                self.comprador_b, self.vehiculo_a["id"],
            ))
            self.assertIsNotNone(chat.obtener_conversacion_comprador(
                conversacion["id"], self.comprador_a,
            ))

    def test_retiro_preserva_historial_pero_bloquea_nuevos_mensajes(self):
        envio = self._enviar(texto="Historial antes del retiro")
        clave_respuesta = uuid.uuid4()
        contenido_respuesta = "Respuesta anterior al retiro"
        respuesta = chat.responder_vendedor(
            self.vendedor_a, envio["conversacion"]["id"], clave_respuesta,
            self._huella(contenido_respuesta), contenido_respuesta,
        )
        self.assertFalse(respuesta["duplicado"])
        token = propiedad.vendedor.set(self.vendedor_a)
        try:
            estado = persistencia.retirar_vehiculo(
                self.vehiculo_a["id"], self.vehiculo_a["updated_at"],
            )
        finally:
            propiedad.vendedor.reset(token)
        self.assertEqual(estado, "retirado")
        recuperada = chat.crear_o_recuperar_conversacion_comprador(
            self.comprador_a, self.vehiculo_a["id"],
        )
        self.assertEqual(recuperada["id"], envio["conversacion"]["id"])
        self.assertIsNone(self._enviar(texto="No debe persistirse después del retiro"))
        self.assertTrue(chat.responder_vendedor(
            self.vendedor_a, envio["conversacion"]["id"], clave_respuesta,
            self._huella(contenido_respuesta), contenido_respuesta,
        )["duplicado"])
        self.assertIsNone(chat.responder_vendedor(
            self.vendedor_a, envio["conversacion"]["id"], uuid.uuid4(),
            self._huella("Respuesta no permitida"), "Respuesta no permitida",
        ))
        historial = chat.listar_mensajes_comprador(
            envio["conversacion"]["id"], self.comprador_a,
        )
        self.assertEqual(
            [m["contenido"] for m in historial],
            ["Historial antes del retiro", contenido_respuesta],
        )

    def test_paginacion_vendedor_no_revela_otras_cuentas(self):
        self._enviar(self.comprador_a, self.vehiculo_a, "Uno")
        self._enviar(self.comprador_b, self.vehiculo_a, "Dos")
        pagina = chat.listar_conversaciones_vendedor(self.vendedor_a, limite=1)
        self.assertEqual(len(pagina), 1)
        siguiente = chat.listar_conversaciones_vendedor(
            self.vendedor_a, cursor_id=pagina[0]["id"], limite=1,
        )
        self.assertEqual(len(siguiente), 1)
        self.assertNotEqual(pagina[0]["id"], siguiente[0]["id"])
        self.assertEqual(chat.listar_conversaciones_vendedor(
            self.vendedor_b, cursor_id=pagina[0]["id"], limite=1,
        ), [])

    def test_rls_y_privilegios_publicos_restringidos(self):
        with psycopg.connect(self.dsn) as conexion:
            for tabla in ("conversaciones_cuentas", "mensajes_chat_cuentas"):
                estado = conexion.execute(
                    """SELECT c.relrowsecurity,
                              has_table_privilege('anon', c.oid, 'SELECT'),
                              has_table_privilege('authenticated', c.oid, 'SELECT'),
                              EXISTS (SELECT 1 FROM aclexplode(
                                  coalesce(c.relacl, acldefault('r', c.relowner))) a
                                  WHERE a.grantee = 0)
                       FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relname = %s""",
                    (tabla,),
                ).fetchone()
                self.assertIsNotNone(estado)
                self.assertTrue(estado[0])
                self.assertFalse(any(estado[1:]))
            self.assertFalse(conexion.execute(
                """SELECT has_sequence_privilege('anon', 'public.mensajes_chat_cuentas_id_seq', 'USAGE')
                          OR has_sequence_privilege('authenticated', 'public.mensajes_chat_cuentas_id_seq', 'USAGE')"""
            ).fetchone()[0])
