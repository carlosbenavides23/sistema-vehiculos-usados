"""Contrato HTTP con cliente local Flask, sin arrancar procesos externos."""

import unittest

from app import app
from test_vehiculos import estado, formulario, vehiculo


class ApiTest(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.cliente = app.test_client()

    def test_validar_estado_vacio(self):
        respuesta = self.cliente.post("/api/validar", json={"estado": estado()})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json, {"ok": True, "estado": estado()})

    def test_ciclo_registrar_editar_y_disponibilidad(self):
        registro = self.cliente.post("/api/vehiculos", json={"estado": estado(), "vehiculo": formulario()})
        self.assertEqual(registro.status_code, 201)
        edicion = self.cliente.put("/api/vehiculos/1", json={"estado": registro.json["estado"], "vehiculo": formulario(modelo="Yaris")})
        self.assertEqual(edicion.status_code, 200)
        self.assertEqual(edicion.json["estado"]["vehiculos"][0]["modelo"], "Yaris")
        disponibilidad = self.cliente.patch("/api/vehiculos/1/disponibilidad", json={"estado": edicion.json["estado"], "disponibilidad": "vendido"})
        self.assertEqual(disponibilidad.status_code, 200)
        self.assertEqual(disponibilidad.json["estado"]["vehiculos"][0]["id"], 1)
        self.assertEqual(disponibilidad.json["estado"]["vehiculos"][0]["disponibilidad"], "vendido")

    def test_solicitudes_independientes_no_comparten_coleccion(self):
        cuerpo = {"estado": estado(), "vehiculo": formulario()}
        primero = self.cliente.post("/api/vehiculos", json=cuerpo)
        otro_navegador = app.test_client().post("/api/vehiculos", json=cuerpo)
        self.assertEqual(primero.json, otro_navegador.json)
        self.assertEqual(len(otro_navegador.json["estado"]["vehiculos"]), 1)
        self.assertEqual(self.cliente.post("/api/validar", json={"estado": estado()}).json["estado"], estado())

    def test_campo_invalido_422_errores_asociados(self):
        respuesta = self.cliente.post("/api/vehiculos", json={"estado": estado(), "vehiculo": formulario(marca=" ")})
        self.assertEqual(respuesta.status_code, 422)
        self.assertFalse(respuesta.json["ok"])
        self.assertIn("marca", respuesta.json["errores"])
        self.assertIn("mensaje", respuesta.json)
        self.assertNotIn("estado", respuesta.json)

    def test_estado_corrupto_400(self):
        respuesta = self.cliente.post("/api/validar", json={"estado": estado(vehiculo(), vehiculo())})
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("estado", respuesta.json["errores"])

    def test_json_invalido_y_tipo_contenido_incorrecto(self):
        for contenido, tipo in (("{", "application/json"), ("{}", "text/plain"), ("null", "application/json"), ("[]", "application/json")):
            with self.subTest(contenido=contenido, tipo=tipo):
                respuesta = self.cliente.post("/api/validar", data=contenido, content_type=tipo)
                self.assertEqual(respuesta.status_code, 400)
                self.assertFalse(respuesta.json["ok"])
                self.assertIn("estado", respuesta.json["errores"])

    def test_numeros_no_finitos_son_rechazados(self):
        for valor in (float("inf"), float("nan"), float("-inf")):
            with self.subTest(valor=valor):
                respuesta = self.cliente.post("/api/validar", json={"estado": estado(vehiculo(precio_centavos=valor))})
                self.assertEqual(respuesta.status_code, 400)

    def test_editar_inexistente_404(self):
        respuesta = self.cliente.put("/api/vehiculos/100", json={"estado": estado(), "vehiculo": formulario()})
        self.assertEqual(respuesta.status_code, 404)
        self.assertIn("id", respuesta.json["errores"])

    def test_disponibilidad_invalida_422(self):
        respuesta = self.cliente.patch("/api/vehiculos/1/disponibilidad", json={"estado": estado(vehiculo()), "disponibilidad": "pendiente"})
        self.assertEqual(respuesta.status_code, 422)
        self.assertIn("disponibilidad", respuesta.json["errores"])

    def test_ruta_y_metodo_api_desconocidos_responden_json(self):
        for ruta, codigo in (("/api/inexistente", 404), ("/api/validar", 405)):
            respuesta = self.cliente.get(ruta)
            self.assertEqual(respuesta.status_code, codigo)
            self.assertFalse(respuesta.json["ok"])

    def test_solicitud_demasiado_grande_413_json(self):
        respuesta = self.cliente.post("/api/validar", data=" " * (4 * 1024 * 1024 + 1), content_type="application/json")
        self.assertEqual(respuesta.status_code, 413)
        self.assertFalse(respuesta.json["ok"])
        self.assertIn("estado", respuesta.json["errores"])


if __name__ == "__main__":
    unittest.main()
