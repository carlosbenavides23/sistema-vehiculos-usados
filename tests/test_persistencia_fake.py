"""Pruebas de unidad de persistencia con un cursor falso; no son PostgreSQL real."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import re
import threading
import unittest
from unittest.mock import patch

import persistencia
from vehiculos import MAX_VEHICULOS


class FakeDatabase:
    """Doble aislado para ejercitar las consultas de persistencia sin red/driver."""

    def __init__(self, filas=()):
        self.filas = [dict(fila) for fila in filas]
        self.siguiente_id = max((fila.get("id", 0) for fila in self.filas), default=0) + 1
        self.lock = threading.Lock()
        self.queries = []

    def conectar(self):
        return FakeConnection(self)


class FakeConnection:
    def __init__(self, db):
        self.db = db
        self.cursor_falso = FakeCursor(db, self)
        self.lock_adquirido = False

    def __enter__(self):
        return self

    def __exit__(self, tipo, valor, traza):
        if self.lock_adquirido:
            self.db.lock.release()
        return False

    def cursor(self):
        return self.cursor_falso


class FakeCursor:
    def __init__(self, db, conexion):
        self.db = db
        self.conexion = conexion
        self.resultados = []

    def __enter__(self):
        return self

    def __exit__(self, tipo, valor, traza):
        return False

    def execute(self, sql, parametros=None):
        parametros = tuple(parametros or ())
        consulta = " ".join(sql.split())
        self.db.queries.append((consulta, parametros))
        self.resultados = []

        if consulta.startswith("LOCK TABLE public.vehiculos"):
            self.db.lock.acquire()
            self.conexion.lock_adquirido = True
            return self

        if consulta == "SELECT COUNT(*) AS total FROM public.vehiculos":
            self.resultados = [{"total": len(self.db.filas)}]
            return self

        if consulta.startswith("SELECT ") and "FROM public.vehiculos WHERE id = %s" in consulta:
            identificador = parametros[0]
            fila = next((fila for fila in self.db.filas if fila["id"] == identificador), None)
            self.resultados = [deepcopy(fila)] if fila is not None else []
            return self

        if consulta.startswith("SELECT ") and "FROM public.vehiculos ORDER BY id" in consulta:
            self.resultados = [deepcopy(fila) for fila in sorted(self.db.filas, key=lambda fila: fila["id"])]
            return self

        if consulta.startswith("INSERT INTO public.vehiculos ("):
            coincidir = re.search(r"INSERT INTO public\.vehiculos \((.*?)\) VALUES", consulta)
            if not coincidir:
                raise AssertionError(f"INSERT inesperado: {consulta}")
            columnas = [campo.strip() for campo in coincidir.group(1).split(",")]
            if len(columnas) != len(parametros):
                raise AssertionError("El número de valores no coincide con las columnas insertadas.")
            fila = dict(zip(columnas, parametros))
            # El fake asigna una secuencia para comprobar que el SQL no envía un ID.
            fila["id"] = self.db.siguiente_id
            self.db.siguiente_id += 1
            fila.setdefault("created_at", "fake-created-at")
            fila.setdefault("updated_at", "fake-updated-at")
            self.db.filas.append(fila)
            if "RETURNING" in consulta:
                self.resultados = [deepcopy(fila)]
            return self

        if consulta.startswith("UPDATE public.vehiculos SET "):
            coincidir = re.search(r"UPDATE public\.vehiculos SET (.*?), updated_at = now\(\) WHERE id = %s RETURNING", consulta)
            if not coincidir:
                raise AssertionError(f"UPDATE inesperado: {consulta}")
            asignaciones = [asignacion.strip() for asignacion in coincidir.group(1).split(",")]
            columnas = [asignacion.split(" = ", 1)[0] for asignacion in asignaciones]
            valores = parametros[:-1]
            identificador = parametros[-1]
            fila = next((fila for fila in self.db.filas if fila["id"] == identificador), None)
            if fila is not None:
                fila.update(dict(zip(columnas, valores)))
                fila["updated_at"] = "fake-updated-at"
                self.resultados = [deepcopy(fila)]
            return self

        raise AssertionError(f"Consulta no modelada por el fake: {consulta}")

    def fetchone(self):
        return self.resultados.pop(0) if self.resultados else None

    def fetchall(self):
        resultados = self.resultados
        self.resultados = []
        return resultados


def vehiculo(numero):
    return {
        "marca": f"Marca {numero}",
        "modelo": f"Modelo {numero}",
        "anio": 2020,
        "kilometraje": numero * 100,
        "precio_centavos": 100000 + numero,
        "ubicacion": "Managua",
        "descripcion": f"Vehículo ficticio de demostración número {numero}.",
        "disponibilidad": "disponible",
        "color": None,
        "placa": None,
        "tipo_vehiculo": None,
        "transmision": None,
        "combustible": None,
        "aire_acondicionado": None,
        "ventanas_electricas": None,
        "pantalla_multimedia": None,
    }


class PersistenciaFakeTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.conectar = patch.object(persistencia, "_conectar", self.db.conectar)
        self.conectar.start()
        self.addCleanup(self.conectar.stop)

    def test_crear_listar_editar_y_cambiar_disponibilidad(self):
        creado = persistencia.crear_vehiculo(vehiculo(1))
        self.assertEqual(creado["id"], 1)
        self.assertEqual(persistencia.listar_vehiculos()[0]["id"], 1)
        self.assertIsNone(persistencia.obtener_vehiculo(99))

        editado = persistencia.editar_vehiculo(1, {**vehiculo(1), "modelo": "Yaris"})
        self.assertEqual(editado["modelo"], "Yaris")
        self.assertEqual(editado["updated_at"], "fake-updated-at")
        cambiado = persistencia.cambiar_disponibilidad(1, "vendido")
        self.assertEqual(cambiado["disponibilidad"], "vendido")
        self.assertIsNone(persistencia.editar_vehiculo(99, vehiculo(9)))

    def test_insert_no_envia_id_y_recibe_el_id_asignado_por_el_driver(self):
        guardado = persistencia.crear_vehiculo(vehiculo(3))
        inserts = [sql for sql, _ in self.db.queries if sql.startswith("INSERT INTO public.vehiculos")]
        self.assertEqual(len(inserts), 1)
        self.assertNotIn("id,", inserts[0].split(" VALUES", 1)[0])
        self.assertIn("RETURNING id", inserts[0])
        self.assertEqual(guardado["id"], 1)

    def test_cargar_demo_en_tabla_vacia_y_repetir_sin_duplicados(self):
        demo = [vehiculo(i) for i in range(1, 7)]
        self.assertTrue(persistencia.cargar_demo_si_vacio(demo))
        self.assertEqual(len(self.db.filas), 6)
        self.assertFalse(persistencia.cargar_demo_si_vacio(demo))
        self.assertEqual(len(self.db.filas), 6)

    def test_seed_con_datos_no_coincidentes_aborta_sin_escritura(self):
        persistencia.crear_vehiculo(vehiculo(99))
        antes = deepcopy(self.db.filas)
        cantidad_inserts = sum(sql.startswith("INSERT INTO public.vehiculos") for sql, _ in self.db.queries)
        with self.assertRaisesRegex(ValueError, "no coincide exactamente"):
            persistencia.cargar_demo_si_vacio([vehiculo(i) for i in range(1, 7)])
        despues_inserts = sum(sql.startswith("INSERT INTO public.vehiculos") for sql, _ in self.db.queries)
        self.assertEqual(self.db.filas, antes)
        self.assertEqual(despues_inserts, cantidad_inserts)

    def test_importacion_previsualiza_aplica_y_es_idempotente(self):
        existente = vehiculo(1)
        nuevo = vehiculo(2)
        persistencia.crear_vehiculo(existente)
        filas_antes = deepcopy(self.db.filas)

        preview = persistencia.importar_legacy_si_nuevo([existente, nuevo], aplicar=False)
        self.assertEqual(preview, {
            "candidatos": 1, "insertados": 0, "omitidos": 1,
            "modo": "previsualización",
        })
        self.assertEqual(self.db.filas, filas_antes)

        aplicada = persistencia.importar_legacy_si_nuevo([existente, nuevo], aplicar=True)
        self.assertEqual(aplicada["insertados"], 1)
        self.assertEqual(aplicada["omitidos"], 1)
        self.assertEqual(len(self.db.filas), 2)
        repetida = persistencia.importar_legacy_si_nuevo([existente, nuevo], aplicar=True)
        self.assertEqual(repetida["insertados"], 0)
        self.assertEqual(repetida["omitidos"], 2)
        self.assertEqual(len(self.db.filas), 2)

    def test_importacion_rechaza_duplicados_y_limite_sin_escrituras(self):
        datos = vehiculo(1)
        with self.assertRaisesRegex(ValueError, "idénticos"):
            persistencia.importar_legacy_si_nuevo([datos, dict(datos)], aplicar=True)
        self.assertEqual(self.db.filas, [])

        self.db.filas = [{"id": i, **vehiculo(i)} for i in range(1, MAX_VEHICULOS + 1)]
        self.db.siguiente_id = MAX_VEHICULOS + 1
        antes = deepcopy(self.db.filas)
        with self.assertRaisesRegex(ValueError, "superaría el límite"):
            persistencia.importar_legacy_si_nuevo([vehiculo(MAX_VEHICULOS + 1)], aplicar=True)
        self.assertEqual(self.db.filas, antes)

    def test_concurrencia_fake_devuelve_ids_distintos_sin_enviarlos_en_insert(self):
        # Solo comprueba el contrato del repositorio y el bloqueo en el fake; no es
        # una prueba de concurrencia PostgreSQL ni de una integración real.
        with ThreadPoolExecutor(max_workers=8) as executor:
            filas = list(executor.map(persistencia.crear_vehiculo, [vehiculo(i) for i in range(1, 21)]))
        ids = [fila["id"] for fila in filas]
        self.assertEqual(len(set(ids)), 20)
        self.assertEqual(sorted(ids), list(range(1, 21)))
        insert_sql = [sql for sql, _ in self.db.queries if sql.startswith("INSERT INTO public.vehiculos")]
        self.assertEqual(len(insert_sql), 20)
        self.assertTrue(all("RETURNING id" in sql for sql in insert_sql))
        self.assertTrue(all("(id," not in sql.split(" VALUES", 1)[0] for sql in insert_sql))


if __name__ == "__main__":
    unittest.main()
