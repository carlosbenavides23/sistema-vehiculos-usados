"""Validación del catálogo propuesto y su comportamiento idempotente en fake DB."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import persistencia
from scripts.importar_catalogo_adicional import leer_y_validar
from tests.test_persistencia_fake import FakeDatabase


RAIZ = Path(__file__).resolve().parents[1]
ARCHIVO = RAIZ / "data" / "catalogo_adicional_10.json"


class ImportacionCatalogoAdicionalTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.conectar = patch.object(persistencia, "_conectar", self.db.conectar)
        self.conectar.start()
        self.addCleanup(self.conectar.stop)

    def test_catalogo_local_contiene_diez_datos_validos_sin_placas_ni_fotos(self):
        brutos = json.loads(ARCHIVO.read_text(encoding="utf-8"))
        vehiculos = leer_y_validar(ARCHIVO)
        self.assertEqual(len(vehiculos), 10)
        self.assertEqual(len({(v["marca"].casefold(), v["modelo"].casefold(), v["anio"]) for v in vehiculos}), 10)
        self.assertTrue(all(v["placa"] is None for v in vehiculos))
        self.assertTrue(all("imagen" not in v and "fotografia" not in v for v in brutos))
        self.assertTrue(all(v["disponibilidad"] == "disponible" for v in vehiculos))

    def test_rechaza_propuestas_invalidas_antes_de_consultar_db(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "invalido.json"
            ruta.write_text(json.dumps([{"marca": "", "modelo": "x"}]), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Vehículo 1 inválido"):
                leer_y_validar(ruta)

    def test_importacion_previsualiza_y_repetir_omite_por_identidad(self):
        catalogo = leer_y_validar(ARCHIVO)
        previa = persistencia.importar_catalogo_si_nuevo(catalogo)
        self.assertEqual(previa, {
            "candidatos": 10, "insertados": 0, "omitidos": 0,
            "modo": "previsualización",
        })
        self.assertEqual(self.db.filas, [])

        aplicada = persistencia.importar_catalogo_si_nuevo(catalogo, aplicar=True)
        self.assertEqual(aplicada["insertados"], 10)
        self.assertEqual(len(self.db.filas), 10)

        variacion = [dict(catalogo[0], precio_centavos=1234567)]
        repetida = persistencia.importar_catalogo_si_nuevo(variacion, aplicar=True)
        self.assertEqual(repetida["insertados"], 0)
        self.assertEqual(repetida["omitidos"], 1)
        self.assertEqual(len(self.db.filas), 10)

    def test_no_inserta_identidad_ya_registrada_y_rechaza_duplicado_en_lote(self):
        catalogo = leer_y_validar(ARCHIVO)
        existente = dict(catalogo[0], id=1)
        self.db.filas = [existente]
        resultado = persistencia.importar_catalogo_si_nuevo(catalogo, aplicar=True)
        self.assertEqual(resultado["insertados"], 9)
        self.assertEqual(resultado["omitidos"], 1)

        with self.assertRaisesRegex(ValueError, "misma marca, modelo y año"):
            persistencia.importar_catalogo_si_nuevo([catalogo[1], dict(catalogo[1])], aplicar=True)


if __name__ == "__main__":
    unittest.main()
