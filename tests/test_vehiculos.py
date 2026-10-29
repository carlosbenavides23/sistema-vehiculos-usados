"""Validaciones puras del nuevo modelo y del formato exportado antiguo."""

from datetime import date
import unittest

from vehiculos import (
    MAX_ENTERO_SEGURO,
    validar_estado_legacy,
    validar_vehiculo,
)


def formulario(**cambios):
    datos = {
        "marca": "Toyota", "modelo": "Corolla", "anio": "2020",
        "kilometraje": "45000", "precio_venta": "12500.25",
        "ubicacion": "Managua", "descripcion": "Vehículo ficticio para demostración.",
        "disponibilidad": "disponible", "color": "", "placa": "",
        "tipo_vehiculo": "", "transmision": "", "combustible": "",
        "aire_acondicionado": "", "ventanas_electricas": "",
        "pantalla_multimedia": "",
    }
    datos.update(cambios)
    return datos


def legacy(identificador=1, **cambios):
    datos = {
        "id": identificador, "marca": "Toyota", "modelo": "Corolla",
        "anio": 2020, "kilometraje": 45000, "precio_centavos": 1250025,
        "ubicacion": "Managua", "descripcion": "Vehículo ficticio para demostración.",
        "disponibilidad": "disponible", "imagen": "/static/img/vehiculo.svg",
    }
    datos.update(cambios)
    return datos


class ValidacionVehiculosTest(unittest.TestCase):
    def test_precio_se_convierte_a_centavos_exactos(self):
        for precio, esperado in (("15", 1500), ("15.5", 1550), ("15.55", 1555), ("00015.55", 1555)):
            with self.subTest(precio=precio):
                resultado, errores = validar_vehiculo(formulario(precio_venta=precio))
                self.assertEqual(errores, {})
                self.assertEqual(resultado["precio_centavos"], esperado)

    def test_rechaza_precios_invalidos_sin_redondear(self):
        valores = (0, 3.25, True, None, [], {}, "", "0", "0.00", "-1", "1.001", "1e3", "NaN", "Infinity", "1,25", ".25")
        for precio in valores:
            with self.subTest(precio=precio):
                resultado, errores = validar_vehiculo(formulario(precio_venta=precio))
                self.assertIsNone(resultado)
                self.assertIn("precio_venta", errores)

    def test_precio_maximo_seguro(self):
        resultado, errores = validar_vehiculo(formulario(precio_venta="90071992547409.91"))
        self.assertEqual(errores, {})
        self.assertEqual(resultado["precio_centavos"], MAX_ENTERO_SEGURO)

    def test_ano_y_kilometraje(self):
        for anio in (1900, date.today().year + 1):
            resultado, errores = validar_vehiculo(formulario(anio=str(anio), kilometraje="0"))
            self.assertEqual(errores, {})
            self.assertEqual(resultado["anio"], anio)
            self.assertEqual(resultado["kilometraje"], 0)
        for campo, valor in (("anio", "1899"), ("anio", str(date.today().year + 2)), ("anio", True), ("kilometraje", "-1"), ("kilometraje", "1.5"), ("kilometraje", MAX_ENTERO_SEGURO + 1)):
            with self.subTest(campo=campo, valor=valor):
                self.assertIn(campo, validar_vehiculo(formulario(**{campo: valor}))[1])

    def test_textos_requeridos_y_largos(self):
        for campo, limite in (("marca", 60), ("modelo", 60), ("ubicacion", 100), ("descripcion", 1000)):
            self.assertIn(campo, validar_vehiculo(formulario(**{campo: " "}))[1])
            self.assertIn(campo, validar_vehiculo(formulario(**{campo: "x" * (limite + 1)}))[1])
        self.assertEqual(validar_vehiculo(formulario(marca=" Toyota "))[0]["marca"], "Toyota")

    def test_campos_opcionales_por_defecto_null_y_se_normalizan(self):
        resultado, errores = validar_vehiculo(formulario())
        self.assertEqual(errores, {})
        for campo in ("color", "placa", "tipo_vehiculo", "transmision", "combustible", "aire_acondicionado", "ventanas_electricas", "pantalla_multimedia"):
            self.assertIsNone(resultado[campo])
        resultado, errores = validar_vehiculo(formulario(color=" gris ", placa="M 123-456", aire_acondicionado=True, ventanas_electricas=False))
        self.assertEqual(errores, {})
        self.assertEqual(resultado["color"], "gris")
        self.assertEqual(resultado["placa"], "M 123-456")
        self.assertIs(resultado["aire_acondicionado"], True)
        self.assertIs(resultado["ventanas_electricas"], False)
        self.assertIsNone(resultado["pantalla_multimedia"])

    def test_rechaza_booleanos_no_triestado_y_extras(self):
        for valor in ("yes", "no", 0, 1, [], {}):
            with self.subTest(valor=valor):
                self.assertIn("aire_acondicionado", validar_vehiculo(formulario(aire_acondicionado=valor))[1])
        self.assertIn("vehiculo", validar_vehiculo(formulario(id=7))[1])
        datos = formulario()
        del datos["modelo"]
        self.assertIn("vehiculo", validar_vehiculo(datos)[1])

    def test_disponibilidad_se_limita_a_dos_valores(self):
        for valor in ("pendiente", "Disponible", None, [], True):
            self.assertIn("disponibilidad", validar_vehiculo(formulario(disponibilidad=valor))[1])

    def test_export_legacy_valido_se_normaliza_sin_perder_id(self):
        estado = {"version": 1, "vehiculos": [legacy(9)]}
        normalizado, errores = validar_estado_legacy(estado)
        self.assertEqual(errores, {})
        self.assertEqual(normalizado["vehiculos"][0]["id"], 9)
        self.assertEqual(normalizado["vehiculos"][0]["precio_centavos"], 1250025)
        self.assertIsNone(normalizado["vehiculos"][0]["placa"])

    def test_export_legacy_incompatible_o_corrupto_se_rechaza(self):
        for estado in (
            None, {"version": 2, "vehiculos": []}, {"version": True, "vehiculos": []},
            {"version": 1, "vehiculos": [legacy(1), legacy(1)]},
            {"version": 1, "vehiculos": [legacy(1, imagen="https://example.test/a.jpg")]},
        ):
            with self.subTest(estado=estado):
                self.assertIn("estado", validar_estado_legacy(estado)[1])


if __name__ == "__main__":
    unittest.main()
