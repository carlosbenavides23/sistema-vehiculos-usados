"""Configuración de conexión e integración PostgreSQL local desechable.

TEST_DATABASE_URL debe indicar una base local de nombre grupo7_test*. Se crea
otra base con UUID para esta ejecución y se elimina exclusivamente esa base.
Sin la variable, la suite informa estas pruebas como omitidas, no aprobadas.
"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import os
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

import limites_login
import persistencia
import persistencia_fotos as fotos
from scripts.cargar_datos_demo import DEMO


RAIZ = Path(__file__).resolve().parents[1]
SEMILLA = next((RAIZ / "supabase/migrations").glob("*_seed_demo_vehicles.sql")).read_text(encoding="utf-8-sig")


@contextmanager
def base_aislada():
    """Fixture reutilizable por pruebas HTTP: conserva intacta la base configurada."""
    dsn_base = os.environ.get("TEST_DATABASE_URL", "")
    parametros = conninfo_to_dict(dsn_base)
    if parametros.get("host") not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("Las pruebas de escritura solo admiten PostgreSQL loopback.")
    if not parametros.get("dbname", "").startswith("grupo7_test"):
        raise RuntimeError("TEST_DATABASE_URL debe nombrar una base grupo7_test* dedicada.")
    parametros["sslmode"] = "disable"
    parametros["connect_timeout"] = 5
    nombre = "grupo7_test_" + uuid.uuid4().hex
    with psycopg.connect(**parametros, autocommit=True) as control:
        control.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(nombre)))
        try:
            # Roles de la plataforma solo en este clúster local aislado.
            for rol in ("anon", "authenticated"):
                if control.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (rol,)).fetchone() is None:
                    control.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(rol)))
            prueba = {**parametros, "dbname": nombre}
            with psycopg.connect(**prueba, autocommit=True) as conexion:
                for archivo in sorted((RAIZ / "supabase/migrations").glob("*.sql")):
                    conexion.execute(archivo.read_text(encoding="utf-8-sig"))
            dsn = make_conninfo(**prueba)
            with patch.dict(os.environ, {"DATABASE_URL": dsn, "ALLOW_LOCAL_DATABASE": "true"}):
                yield dsn
        finally:
            control.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(nombre)))


def datos(numero=1):
    registro = {campo: None for campo in persistencia.CAMPOS_DATOS}
    registro.update({
        "marca": "Marca integración", "modelo": f"Modelo {numero}", "anio": 2020,
        "kilometraje": 10000, "precio_centavos": 1234567,
        "ubicacion": "Managua", "descripcion": "Registro de integración aislada.",
        "disponibilidad": "disponible", "color": "Azul", "placa": "PRUEBA-LOCAL",
        "aire_acondicionado": True, "ventanas_electricas": False,
    })
    return registro


def metadatos(reserva, tamano=500):
    return {"storage_path": reserva["storage_path"], "mime_type": "image/webp",
            "size_bytes": tamano, "width_px": 800, "height_px": 600}


class ConfiguracionConexionTest(unittest.TestCase):
    """Pruebas unitarias de los límites de TLS; no abren conexiones."""

    def test_remote_siempre_exige_tls_aunque_se_pida_disable(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://postgres@db.example.com/test?sslmode=disable",
                                     "ALLOW_LOCAL_DATABASE": "true"}), patch("psycopg.connect") as conectar:
            persistencia._conectar()
        self.assertEqual(conectar.call_args.kwargs["sslmode"], "require")
        self.assertIsNone(conectar.call_args.kwargs["prepare_threshold"])

    def test_loopback_sin_opt_in_exige_tls(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://postgres@127.0.0.1/test",
                                     "ALLOW_LOCAL_DATABASE": "false"}), patch("psycopg.connect") as conectar:
            persistencia._conectar()
        self.assertEqual(conectar.call_args.kwargs["sslmode"], "require")

    def test_loopback_con_opt_in_fija_direccion_local(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://postgres@localhost/test",
                                     "ALLOW_LOCAL_DATABASE": "true", "PGSERVICE": "", "PGHOSTADDR": "192.0.2.1"}), patch("psycopg.connect") as conectar:
            persistencia._conectar()
        self.assertEqual(conectar.call_args.kwargs["sslmode"], "disable")
        self.assertEqual(conectar.call_args.kwargs["hostaddr"], "127.0.0.1")

    def test_hostaddr_remoto_impide_excepcion_local(self):
        with patch.dict(os.environ, {"DATABASE_URL": "host=localhost hostaddr=192.0.2.1 dbname=test user=postgres",
                                     "ALLOW_LOCAL_DATABASE": "true"}), patch("psycopg.connect") as conectar:
            persistencia._conectar()
        self.assertEqual(conectar.call_args.kwargs["sslmode"], "require")


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL no configurada: requiere PostgreSQL real local aislado")
class PostgresIntegracionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aislamiento = base_aislada()
        cls.dsn = cls.aislamiento.__enter__()
        cls.addClassCleanup(cls.aislamiento.__exit__, None, None, None)

    def setUp(self):
        # Esta base acaba de crearse para esta clase; nunca es la configurada por el usuario.
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("TRUNCATE public.storage_limpieza, public.fotografia_operaciones, "
                             "public.solicitudes_idempotentes, public.vehiculo_fotografias, "
                             "public.vehiculos, public.admin_login_intentos RESTART IDENTITY CASCADE")
            conexion.execute(SEMILLA)

    def crear_foto(self, vehiculo_id=1, fotografia_id=None):
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(vehiculo_id, clave, "a" * 64, fotografia_id)
        return fotos.guardar_fotografia(vehiculo_id, metadatos(reserva), clave, fotografia_id)

    def test_migraciones_rls_privilegios_y_seis_demos(self):
        with psycopg.connect(self.dsn) as conexion:
            filas = conexion.execute("SELECT relname, relrowsecurity FROM pg_class "
                                     "WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'").fetchall()
            self.assertEqual(len(filas), 6)
            self.assertTrue(all(rls for _, rls in filas))
            for tabla, _ in filas:
                for rol in ("anon", "authenticated"):
                    for permiso in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                        self.assertFalse(conexion.execute("SELECT has_table_privilege(%s, %s, %s)", (rol, "public." + tabla, permiso)).fetchone()[0])
            self.assertEqual(conexion.execute("SELECT count(*) FROM public.vehiculos").fetchone()[0], 6)
            self.assertEqual(conexion.execute("SELECT count(*) FROM public.vehiculo_fotografias").fetchone()[0], 0)
            self.assertEqual(conexion.execute("SELECT count(*) FROM public.vehiculos WHERE disponibilidad = 'vendido'").fetchone()[0], 1)

    def test_crud_persistencia_entre_conexiones_y_opcionales(self):
        original = persistencia.crear_vehiculo(datos())
        self.assertEqual(original["id"], 7)
        self.assertEqual(persistencia.obtener_vehiculo(7)["color"], "Azul")
        self.assertTrue(persistencia.obtener_vehiculo(7)["aire_acondicionado"])
        self.assertFalse(persistencia.obtener_vehiculo(7)["ventanas_electricas"])
        self.assertIsNone(persistencia.obtener_vehiculo(7)["pantalla_multimedia"])
        editado = persistencia.editar_vehiculo(7, {**datos(), "modelo": "Actualizado"})
        self.assertEqual(editado["id"], 7)
        self.assertEqual(persistencia.obtener_vehiculo(7)["modelo"], "Actualizado")
        persistencia.cambiar_disponibilidad(7, "vendido")
        self.assertEqual(persistencia.obtener_vehiculo(7)["disponibilidad"], "vendido")
        self.assertIsNone(persistencia.obtener_vehiculo(9999))

    def test_busqueda_sql_parametrizada_combina_filtros_y_ordenes(self):
        base = datos()
        registros = (
            {**base, "marca": "Nissan", "modelo": "Zquery bajo", "anio": 2020,
             "precio_centavos": 1_200_000, "tipo_vehiculo": "SUV", "disponibilidad": "disponible"},
            {**base, "marca": "Nissan", "modelo": "Zquery medio", "anio": 2021,
             "precio_centavos": 1_500_000, "tipo_vehiculo": "SUV", "disponibilidad": "disponible"},
            {**base, "marca": "Nissan", "modelo": "Zquery alto año", "anio": 2022,
             "precio_centavos": 1_500_000, "tipo_vehiculo": "SUV", "disponibilidad": "disponible"},
            {**base, "marca": "Nissan", "modelo": "Zquery vendido", "anio": 2021,
             "precio_centavos": 1_500_000, "tipo_vehiculo": "SUV", "disponibilidad": "vendido"},
            {**base, "marca": "Nissan", "modelo": "Zquery sedán", "anio": 2021,
             "precio_centavos": 1_500_000, "tipo_vehiculo": "Sedán", "disponibilidad": "disponible"},
        )
        creados = [persistencia.crear_vehiculo(registro) for registro in registros]

        combinados = persistencia.buscar_vehiculos({
            "q": "nissan zquery", "disponibilidad": "disponible",
            "precio_min": 1_200_000, "precio_max": 1_500_000,
            "anio_min": 2020, "anio_max": 2021, "tipo_vehiculo": "suv",
        })
        self.assertEqual([fila["id"] for fila in combinados], [creados[0]["id"], creados[1]["id"]])

        por_precio = persistencia.buscar_vehiculos({"q": "nissan zquery", "tipo_vehiculo": "SUV", "orden": "precio_desc"})
        self.assertEqual(
            [fila["id"] for fila in por_precio],
            [creados[1]["id"], creados[2]["id"], creados[3]["id"], creados[0]["id"]],
        )
        por_ano = persistencia.buscar_vehiculos({"q": "nissan zquery", "orden": "anio_desc"})
        self.assertEqual(
            [fila["id"] for fila in por_ano],
            [creados[2]["id"], creados[1]["id"], creados[3]["id"], creados[4]["id"], creados[0]["id"]],
        )

    def test_altas_concurrentes_generan_identificadores_unicos(self):
        with ThreadPoolExecutor(max_workers=8) as grupo:
            filas = list(grupo.map(persistencia.crear_vehiculo, [datos(i) for i in range(20)]))
        self.assertEqual(len({fila["id"] for fila in filas}), 20)
        self.assertEqual(len(persistencia.listar_vehiculos()), 26)

    def test_reintentos_concurrentes_del_alta_son_idempotentes(self):
        clave = str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=6) as grupo:
            filas = list(grupo.map(lambda _: persistencia.crear_vehiculo_idempotente(datos(), clave), range(12)))
        self.assertEqual(len({fila["id"] for fila in filas}), 1)
        self.assertEqual(len(persistencia.listar_vehiculos()), 7)
        with self.assertRaises(ValueError):
            persistencia.crear_vehiculo_idempotente(datos(2), clave)
        self.assertEqual(len(persistencia.listar_vehiculos()), 7)

    def test_seed_idempotente_no_sobrescribe_datos(self):
        self.assertFalse(persistencia.cargar_demo_si_vacio(DEMO))
        antes = persistencia.listar_vehiculos()
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute(SEMILLA)
        self.assertEqual(persistencia.listar_vehiculos(), antes)
        persistencia.crear_vehiculo(datos())
        antes = persistencia.listar_vehiculos()
        with self.assertRaises(ValueError):
            persistencia.cargar_demo_si_vacio(DEMO)
        self.assertEqual(persistencia.listar_vehiculos(), antes)

    def test_importacion_previsualiza_aplica_y_no_duplica(self):
        nuevo = datos()
        previa = persistencia.importar_legacy_si_nuevo([nuevo], aplicar=False)
        self.assertEqual(previa["candidatos"], 1)
        self.assertEqual(len(persistencia.listar_vehiculos()), 6)
        self.assertEqual(persistencia.importar_legacy_si_nuevo([nuevo], aplicar=True)["insertados"], 1)
        self.assertEqual(persistencia.importar_legacy_si_nuevo([nuevo], aplicar=True)["omitidos"], 1)
        self.assertEqual(len(persistencia.listar_vehiculos()), 7)

    def test_restricciones_y_rollback_real(self):
        antes = persistencia.listar_vehiculos()
        with self.assertRaises(psycopg.errors.CheckViolation):
            persistencia.crear_vehiculo({**datos(), "precio_centavos": -1})
        self.assertEqual(persistencia.listar_vehiculos(), antes)
        with self.assertRaises(psycopg.errors.CheckViolation):
            persistencia.editar_vehiculo(1, {**datos(), "disponibilidad": "borrador"})
        self.assertEqual(persistencia.listar_vehiculos(), antes)

    def test_limite_500_bajo_altas_concurrentes(self):
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("INSERT INTO public.vehiculos (marca,modelo,anio,kilometraje,precio_centavos,ubicacion,descripcion) "
                             "SELECT 'Prueba', 'Capacidad', 2020, 1, 100, 'Local', 'Solo prueba aislada' FROM generate_series(1,493)")
        with ThreadPoolExecutor(max_workers=6) as grupo:
            filas = list(grupo.map(persistencia.crear_vehiculo, [datos(i) for i in range(10)]))
        self.assertEqual(sum(fila is not None for fila in filas), 1)
        self.assertEqual(len(persistencia.listar_vehiculos()), 500)

    def test_fotografia_sustitucion_preserva_anterior_hasta_commit(self):
        foto = self.crear_foto()
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(1, clave, "b" * 64, foto["id"])
        self.assertEqual(fotos.obtener_fotografia(1, foto["id"])["storage_path"], foto["storage_path"])
        self.assertEqual(fotos.pendientes_limpieza(), [])
        nueva = fotos.guardar_fotografia(1, metadatos(reserva), clave, foto["id"])
        self.assertEqual(nueva["id"], foto["id"])
        self.assertNotEqual(nueva["storage_path"], foto["storage_path"])
        self.assertEqual([p["storage_path"] for p in fotos.pendientes_limpieza()], [foto["storage_path"]])
        fotos.cancelar_subida(nueva["storage_path"])
        self.assertEqual(fotos.obtener_fotografia(1, foto["id"])["storage_path"], nueva["storage_path"])
        repetida = fotos.preparar_subida(1, clave, "b" * 64, foto["id"])
        self.assertTrue(repetida["completada"])
        self.assertEqual(repetida["fotografia"], nueva)

    def test_fallo_sql_en_sustitucion_conserva_foto_y_cola(self):
        original = self.crear_foto()
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(1, clave, "c" * 64, original["id"])
        with self.assertRaises(psycopg.errors.CheckViolation):
            fotos.guardar_fotografia(1, metadatos(reserva, tamano=1000001), clave, original["id"])
        self.assertEqual(fotos.listar_fotografias(1), [original])
        self.assertEqual(fotos.pendientes_limpieza(), [])
        fotos.cancelar_subida(reserva["storage_path"])
        self.assertEqual([p["storage_path"] for p in fotos.pendientes_limpieza()], [reserva["storage_path"]])
        with self.assertRaises(ValueError):
            fotos.guardar_fotografia(1, metadatos(reserva), clave, original["id"])

    def test_reservas_concurrentes_limitan_cinco_fotografias(self):
        def reservar(_):
            clave = str(uuid.uuid4())
            try:
                return clave, fotos.preparar_subida(1, clave, "d" * 64)
            except ValueError:
                return None
        with ThreadPoolExecutor(max_workers=10) as grupo:
            reservas = [r for r in grupo.map(reservar, range(12)) if r is not None]
        self.assertEqual(len(reservas), 5)
        for clave, reserva in reservas:
            fotos.guardar_fotografia(1, metadatos(reserva), clave)
        self.assertEqual(len(fotos.listar_fotografias(1)), 5)
        self.assertEqual(fotos.pendientes_limpieza(), [])

    def test_editar_campos_no_borra_fotos_y_delete_encola(self):
        foto = self.crear_foto()
        persistencia.editar_vehiculo(1, datos())
        self.assertEqual(fotos.listar_fotografias(1), [foto])
        self.assertTrue(fotos.eliminar_fotografia(1, foto["id"]))
        self.assertFalse(fotos.eliminar_fotografia(1, foto["id"]))
        self.assertEqual(fotos.listar_fotografias(1), [])
        self.assertEqual(fotos.pendientes_limpieza()[0]["storage_path"], foto["storage_path"])
        fotos.confirmar_limpieza(foto["storage_path"])
        self.assertEqual(fotos.pendientes_limpieza(), [])

    def test_crash_subida_expirada_se_recupera_sin_referencias_invalidas(self):
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(1, clave, "e" * 64)
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("UPDATE public.fotografia_operaciones SET created_at = now() - interval '2 hours' WHERE clave = %s", (clave,))
            conexion.execute("UPDATE public.storage_limpieza SET disponible_desde = now() - interval '1 hour' WHERE storage_path = %s", (reserva["storage_path"],))
        self.assertEqual(len(fotos.pendientes_limpieza()), 1)
        with self.assertRaises(ValueError):
            fotos.guardar_fotografia(1, metadatos(reserva), clave)
        fotos.confirmar_limpieza(reserva["storage_path"])
        with self.assertRaises(ValueError):
            fotos.preparar_subida(1, clave, "e" * 64)
        self.assertEqual(fotos.listar_fotografias(1), [])

    def test_limpieza_no_gana_a_guardado_que_cruza_expiracion(self):
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(1, clave, "f" * 64)
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("UPDATE public.fotografia_operaciones SET created_at = clock_timestamp() - interval '59 minutes 58 seconds' WHERE clave = %s", (clave,))
            conexion.execute("UPDATE public.storage_limpieza SET disponible_desde = clock_timestamp() WHERE storage_path = %s", (reserva["storage_path"],))

        tomada = threading.Event()
        continuar = threading.Event()
        leida = {}
        leer_original = fotos._leer_operacion

        def leer_y_pausar(cursor, identificador, bloqueo=False):
            operacion = leer_original(cursor, identificador, bloqueo)
            if bloqueo:
                leida.update(operacion)
                tomada.set()
                if not continuar.wait(8):
                    raise RuntimeError("La prueba no liberó el guardado.")
            return operacion

        with ThreadPoolExecutor(max_workers=1) as grupo, patch.object(fotos, "_leer_operacion", leer_y_pausar):
            guardado = grupo.submit(fotos.guardar_fotografia, 1, metadatos(reserva), clave)
            try:
                self.assertTrue(tomada.wait(3))
                self.assertTrue(leida["vigente"])
                limite = time.monotonic() + 5
                expirada = False
                while not expirada and time.monotonic() < limite:
                    with psycopg.connect(self.dsn) as conexion:
                        expirada = conexion.execute("SELECT created_at <= clock_timestamp() - interval '1 hour' FROM public.fotografia_operaciones WHERE clave = %s", (clave,)).fetchone()[0]
                    if not expirada:
                        time.sleep(0.025)
                self.assertTrue(expirada)
                # La consulta readonly observa la expiración, pero aún no autoriza borrar.
                self.assertEqual(fotos.pendientes_limpieza()[0]["storage_path"], reserva["storage_path"])
                self.assertFalse(fotos.reclamar_limpieza(reserva["storage_path"]))
            finally:
                continuar.set()
            fotografia = guardado.result(timeout=5)
        self.assertEqual(fotografia["storage_path"], reserva["storage_path"])
        self.assertFalse(fotos.reclamar_limpieza(reserva["storage_path"]))
        self.assertEqual(fotos.pendientes_limpieza(), [])
        self.assertEqual(fotos.listar_fotografias(1), [fotografia])

    def test_limpieza_cancela_reserva_antes_de_autorizar_borrado_y_usa_lease(self):
        clave = str(uuid.uuid4())
        reserva = fotos.preparar_subida(1, clave, "a" * 64)
        ruta = reserva["storage_path"]
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("UPDATE public.fotografia_operaciones SET created_at = now() - interval '2 hours' WHERE clave = %s", (clave,))
            conexion.execute("UPDATE public.storage_limpieza SET disponible_desde = now() WHERE storage_path = %s", (ruta,))
        self.assertTrue(fotos.reclamar_limpieza(ruta))
        self.assertFalse(fotos.reclamar_limpieza(ruta))
        self.assertEqual(fotos.pendientes_limpieza(), [])
        with self.assertRaises(ValueError):
            fotos.guardar_fotografia(1, metadatos(reserva), clave)
        # Si Storage falla, expira la lease y la misma cola durable permite reintentar.
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("UPDATE public.storage_limpieza SET reclamada_hasta = now() - interval '1 second' WHERE storage_path = %s", (ruta,))
        self.assertEqual(len(fotos.pendientes_limpieza()), 1)
        self.assertTrue(fotos.reclamar_limpieza(ruta))
        fotos.confirmar_limpieza(ruta)
        self.assertEqual(fotos.pendientes_limpieza(), [])
        self.assertEqual(fotos.listar_fotografias(1), [])

    def test_limitador_compartido_atomico_entre_conexiones(self):
        with ThreadPoolExecutor(max_workers=12) as grupo:
            resultados = list(grupo.map(lambda _: limites_login.reservar_intento_login("a" * 64), range(16)))
        self.assertEqual(resultados.count(0), 5)
        self.assertTrue(all(0 < espera <= 600 for espera in resultados if espera))
        limites_login.reiniciar_intentos_login("a" * 64)
        self.assertEqual(limites_login.reservar_intento_login("a" * 64), 0)
        with psycopg.connect(self.dsn) as conexion:
            conexion.execute("UPDATE public.admin_login_intentos SET expira_en = now() - interval '1 second'")
        self.assertEqual(limites_login.reservar_intento_login("a" * 64), 0)


if __name__ == "__main__":
    unittest.main()
