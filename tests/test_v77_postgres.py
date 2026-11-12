"""Regresiones V7.7 sobre PostgreSQL 17 local aislado."""

from pathlib import Path
import os
import unittest

import psycopg

import persistencia
from test_postgres_integracion import RAIZ, base_aislada, datos


MIGRACION = "20261112191129_v77_ficha_tecnica.sql"


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Requiere PostgreSQL aislado")
class FichaTecnicaV77PostgresTest(unittest.TestCase):
    def test_migracion_normaliza_equivalencias_y_conserva_tipos_legacy_desconocidos(self):
        with base_aislada(excluir_migracion=MIGRACION) as dsn:
            with psycopg.connect(dsn, autocommit=True) as db:
                tipos = ("Sedán", "Sport Utility Vehicle", "Station Wagon clásico")
                for indice, tipo in enumerate(tipos):
                    db.execute(
                        """INSERT INTO public.vehiculos
                           (marca, modelo, anio, kilometraje, precio_centavos, ubicacion,
                            descripcion, tipo_vehiculo)
                           VALUES ('Legado', %s, 2019, 50000, 1250000, 'Managua',
                                   'Publicación heredada de prueba.', %s)""",
                        (f"Modelo {indice}", tipo),
                    )
                # La migración se aplica una vez con los registros heredados ya presentes.
                db.execute((RAIZ / "supabase/migrations" / MIGRACION).read_text(encoding="utf-8"))
                filas = db.execute(
                    "SELECT modelo, tipo_vehiculo, version, motor, numero_puertas, capacidad_pasajeros, camara_reversa, bluetooth FROM public.vehiculos WHERE marca='Legado' ORDER BY id"
                ).fetchall()
            self.assertEqual([fila[1] for fila in filas], ["sedan", "suv", "Station Wagon clásico"])
            for fila in filas:
                self.assertEqual(fila[2:], (None, None, None, None, None, None))

    def test_campos_opcionales_se_persisten_filtran_y_se_pueden_limpiar(self):
        with base_aislada() as dsn:
            completo = datos(1)
            completo.update({
                "tipo_vehiculo": "suv", "version": "Limited", "motor": "2.0 L",
                "numero_puertas": 5, "capacidad_pasajeros": 6,
                "camara_reversa": False, "bluetooth": True,
            })
            creado = persistencia.crear_vehiculo(completo)
            consultado = persistencia.obtener_vehiculo(creado["id"])
            self.assertEqual({campo: consultado[campo] for campo in completo if campo in {
                "tipo_vehiculo", "version", "motor", "numero_puertas", "capacidad_pasajeros", "camara_reversa", "bluetooth"
            }}, {campo: completo[campo] for campo in (
                "tipo_vehiculo", "version", "motor", "numero_puertas", "capacidad_pasajeros", "camara_reversa", "bluetooth"
            )})
            self.assertEqual([fila["id"] for fila in persistencia.buscar_vehiculos({"tipo_vehiculo": "suv"})], [creado["id"]])

            limpio = {**completo}
            for campo in ("tipo_vehiculo", "version", "motor", "numero_puertas", "capacidad_pasajeros", "camara_reversa", "bluetooth"):
                limpio[campo] = None
            self.assertEqual(persistencia.editar_vehiculo(creado["id"], limpio)["version"], None)
            resultado = persistencia.obtener_vehiculo(creado["id"])
            for campo in ("tipo_vehiculo", "version", "motor", "numero_puertas", "capacidad_pasajeros", "camara_reversa", "bluetooth"):
                self.assertIsNone(resultado[campo])

            with psycopg.connect(dsn, autocommit=True) as db:
                with self.assertRaises(psycopg.errors.CheckViolation):
                    db.execute("UPDATE public.vehiculos SET numero_puertas = 11 WHERE id = %s", (creado["id"],))
