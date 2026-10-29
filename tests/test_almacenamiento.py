"""Contrato HTTP Storage con transporte falso; no escribe en Supabase."""

from io import BytesIO
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import almacenamiento


RUTA = "7/0123456789abcdef0123456789abcdef.webp"


class Respuesta:
    status = 200

    def __init__(self, contenido=b"{}"):
        self.contenido = contenido

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, cantidad):
        return self.contenido[:cantidad]


class AlmacenamientoTest(unittest.TestCase):
    def setUp(self):
        self.entorno = patch.dict(os.environ, {"SUPABASE_URL": almacenamiento.URL_PROYECTO, "SUPABASE_SECRET_KEY": "", "SUPABASE_SERVICE_ROLE_KEY": "secreto-solo-test"})
        self.entorno.start()
        self.addCleanup(self.entorno.stop)

    def test_subida_individual_no_sobrescribe_y_borrado_usa_prefixes(self):
        with patch.object(almacenamiento, "_transporte", return_value=Respuesta()) as transporte:
            self.assertTrue(almacenamiento.subir(RUTA, b"webp-falso-solo-transporte"))
            subida = transporte.call_args.args[0]
            self.assertEqual(subida.method, "POST")
            self.assertEqual(subida.get_header("X-upsert"), "false")
            self.assertEqual(subida.get_header("Content-type"), "image/webp")
            self.assertEqual(subida.get_header("Authorization"), "Bearer secreto-solo-test")
            almacenamiento.eliminar(RUTA)
            borrado = transporte.call_args.args[0]
            self.assertEqual(borrado.method, "DELETE")
            self.assertEqual(json.loads(borrado.data), {"prefixes": [RUTA]})
        self.assertNotIn("secreto", almacenamiento.url_publica(RUTA))

    def test_clave_secret_nueva_solo_viaja_en_apikey(self):
        with patch.dict(os.environ, {"SUPABASE_SECRET_KEY": "sb_secret_solo_test"}):
            with patch.object(almacenamiento, "_transporte", return_value=Respuesta()) as transporte:
                almacenamiento.subir(RUTA, b"x")
                solicitud = transporte.call_args.args[0]
                self.assertEqual(solicitud.get_header("Apikey"), "sb_secret_solo_test")
                self.assertIsNone(solicitud.get_header("Authorization"))

    def test_rutas_y_endpoints_no_permiten_traversal_ni_http(self):
        for ruta in ("../otra.webp", "7/../otra.webp", "https://otro/objeto", "7/foto.jpg"):
            with self.assertRaises(almacenamiento.ErrorAlmacenamiento):
                almacenamiento.url_publica(ruta)
        with patch.dict(os.environ, {"SUPABASE_URL": "http://127.0.0.1"}):
            with self.assertRaises(almacenamiento.ErrorAlmacenamiento):
                almacenamiento.subir(RUTA, b"x")

    def test_duplicado_y_borrado_ausente_son_idempotentes(self):
        error = HTTPError("https://supabase.test", 409, "Conflict", {}, BytesIO(b"{}"))
        with patch.object(almacenamiento, "_transporte", side_effect=[error, Respuesta(b"x")]) as transporte:
            self.assertFalse(almacenamiento.subir(RUTA, b"x"))
            self.assertEqual(transporte.call_args.args[0].method, "GET")
        error = HTTPError("https://supabase.test", 404, "Not Found", {}, BytesIO(b"{}"))
        with patch.object(almacenamiento, "_transporte", side_effect=error):
            almacenamiento.eliminar(RUTA)

    def test_duplicado_no_confirma_objeto_ausente_o_con_bytes_distintos(self):
        error = HTTPError("https://supabase.test", 409, "Conflict", {}, BytesIO(b"{}"))
        with patch.object(almacenamiento, "_transporte", side_effect=[error, Respuesta(b"otro contenido")]):
            with self.assertRaises(almacenamiento.ErrorAlmacenamiento):
                almacenamiento.subir(RUTA, b"esperado")
        error = HTTPError("https://supabase.test", 409, "Conflict", {}, BytesIO(b"{}"))
        ausente = HTTPError("https://supabase.test", 404, "Not Found", {}, BytesIO(b"{}"))
        with patch.object(almacenamiento, "_transporte", side_effect=[error, ausente]):
            with self.assertRaises(almacenamiento.ErrorAlmacenamiento):
                almacenamiento.subir(RUTA, b"esperado")

    def test_fallo_de_red_no_expone_url_credenciales_ni_cuerpo(self):
        with patch.object(almacenamiento, "_transporte", side_effect=URLError("secreto-interno-en-url")):
            with self.assertRaises(almacenamiento.ErrorAlmacenamiento) as fallo:
                almacenamiento.subir(RUTA, b"x")
        self.assertNotIn("secreto-interno", str(fallo.exception))

    def test_limpieza_previsualiza_y_conserva_fallos_para_reintento(self):
        confirmados = []
        def repositorio(nombre, *args):
            if nombre == "pendientes_limpieza":
                return [{"id": RUTA, "storage_path": RUTA}]
            if nombre == "reclamar_limpieza":
                return True
            confirmados.append(args[0])
        with patch.object(almacenamiento, "eliminar") as eliminar:
            vista = almacenamiento.limpiar_pendientes(repositorio=repositorio)
            self.assertEqual(vista["pendientes"], 1)
            eliminar.assert_not_called()
            eliminar.side_effect = almacenamiento.ErrorAlmacenamiento()
            fallo = almacenamiento.limpiar_pendientes(aplicar=True, repositorio=repositorio)
            self.assertEqual(fallo["fallidos"], 1)
            self.assertEqual(confirmados, [])
            eliminar.side_effect = None
            exito = almacenamiento.limpiar_pendientes(aplicar=True, repositorio=repositorio)
            self.assertEqual(exito["eliminados"], 1)
            self.assertEqual(confirmados, [RUTA])


if __name__ == "__main__":
    unittest.main()
