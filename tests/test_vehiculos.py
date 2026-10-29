"""Comportamientos del dominio, incluidos estados manipulados del navegador."""

from copy import deepcopy
from datetime import date
import unittest

from vehiculos import MAX_ENTERO_SEGURO, procesar_operacion, validar_estado, validar_vehiculo


def formulario(**cambios):
    datos = {
        "marca": "Toyota", "modelo": "Corolla", "anio": "2020",
        "kilometraje": "45000", "precio_venta": "12500.25",
        "ubicacion": "Managua", "descripcion": "Vehículo ficticio para demostración.",
        "disponibilidad": "disponible",
    }
    datos.update(cambios)
    return datos


def vehiculo(identificador=1, **cambios):
    datos = formulario()
    datos.pop("precio_venta")
    datos.update(id=identificador, anio=2020, kilometraje=45000,
                 precio_centavos=1250025, imagen=None)
    datos.update(cambios)
    return datos


def estado(*vehiculos):
    return {"version": 1, "vehiculos": list(vehiculos)}


class ReglasVehiculosTest(unittest.TestCase):
    def test_registro_convierte_centavos_y_normaliza_textos(self):
        entrada = {"estado": estado(), "vehiculo": formulario(marca=" Toyota ", precio_venta=" 0.29 ")}
        resultado, codigo = procesar_operacion("registrar", entrada)
        self.assertEqual(codigo, 201)
        self.assertEqual(resultado["estado"]["vehiculos"][0], vehiculo(precio_centavos=29))

    def test_precio_admite_cero_uno_y_dos_decimales(self):
        for precio, esperado in (("15", 1500), ("15.5", 1550), ("15.55", 1555), ("00015.55", 1555)):
            with self.subTest(precio=precio):
                resultado, errores = validar_vehiculo(formulario(precio_venta=precio))
                self.assertEqual(errores, {})
                self.assertEqual(resultado["precio_centavos"], esperado)

    def test_precios_invalidos_no_se_redondean_ni_aceptan_floats(self):
        for precio in (0, 3.25, True, None, [], {}, "", "0", "0.00", "-1", "1.001", "1e3", "NaN", "Infinity", "1,25", ".25", "90071992547409.92"):
            with self.subTest(precio=precio):
                resultado, errores = validar_vehiculo(formulario(precio_venta=precio))
                self.assertIsNone(resultado)
                self.assertIn("precio_venta", errores)

    def test_precio_limite_seguro_se_conserva_exacto(self):
        resultado, errores = validar_vehiculo(formulario(precio_venta="90071992547409.91"))
        self.assertEqual(errores, {})
        self.assertEqual(resultado["precio_centavos"], MAX_ENTERO_SEGURO)

    def test_anos_limites_y_kilometraje_cero(self):
        for anio in (1900, date.today().year + 1):
            with self.subTest(anio=anio):
                resultado, errores = validar_vehiculo(formulario(anio=str(anio), kilometraje="0"))
                self.assertEqual(errores, {})
                self.assertEqual(resultado["anio"], anio)
                self.assertEqual(resultado["kilometraje"], 0)

    def test_numeros_invalidos_y_fuera_de_rango(self):
        casos = {
            "anio": ("1899", str(date.today().year + 2), "2020.0", True, "dos mil", 2020.0),
            "kilometraje": ("-1", "1.5", True, float("nan"), float("inf"), "1e3", MAX_ENTERO_SEGURO + 1),
        }
        for campo, valores in casos.items():
            for valor in valores:
                with self.subTest(campo=campo, valor=valor):
                    resultado, errores = validar_vehiculo(formulario(**{campo: valor}))
                    self.assertIsNone(resultado)
                    self.assertIn(campo, errores)

    def test_textos_requeridos_y_limites(self):
        for campo, limite in (("marca", 60), ("modelo", 60), ("ubicacion", 100), ("descripcion", 1000)):
            for valor in (None, "   ", "a" * (limite + 1), [], 123):
                with self.subTest(campo=campo, valor=valor):
                    self.assertIn(campo, validar_vehiculo(formulario(**{campo: valor}))[1])
        self.assertIn("descripcion", validar_vehiculo(formulario(descripcion="nueve1234"))[1])

    def test_imagen_opcional_pero_solo_local_conocida(self):
        for imagen in (None, "/static/img/vehiculo.svg"):
            self.assertEqual(validar_vehiculo(formulario(imagen=imagen))[1], {})
        for imagen in ("https://example.com/foto.jpg", "/etc/passwd", "", [], False):
            self.assertIn("imagen", validar_vehiculo(formulario(imagen=imagen))[1])

    def test_disponibilidad_restringida(self):
        for valor in ("pendiente", "Disponible", None, [], True):
            self.assertIn("disponibilidad", validar_vehiculo(formulario(disponibilidad=valor))[1])

    def test_campos_extra_o_faltantes_se_rechazan(self):
        datos = formulario(id=10)
        self.assertIn("vehiculo", validar_vehiculo(datos)[1])
        datos = formulario()
        del datos["marca"]
        self.assertIn("vehiculo", validar_vehiculo(datos)[1])

    def test_estado_vacio_y_normalizacion_en_copia(self):
        self.assertEqual(validar_estado(estado()), (estado(), {}))
        original = estado(vehiculo(marca=" Toyota "))
        normalizado, errores = validar_estado(original)
        self.assertEqual(errores, {})
        self.assertEqual(normalizado["vehiculos"][0]["marca"], "Toyota")
        self.assertEqual(original["vehiculos"][0]["marca"], " Toyota ")

    def test_estructura_estado_y_version_estrictas(self):
        for entrada in (None, [], {}, {"version": 1}, {"version": True, "vehiculos": []},
                        {"version": 1.0, "vehiculos": []}, {"version": 2, "vehiculos": []},
                        {"version": 1, "vehiculos": {}}, {"version": 1, "vehiculos": [], "extra": 0}):
            with self.subTest(entrada=entrada):
                resultado, errores = validar_estado(entrada)
                self.assertIsNone(resultado)
                self.assertIn("estado", errores)

    def test_canonico_rechaza_tipos_y_campos_no_exactos(self):
        casos = (("id", True), ("id", 0), ("id", MAX_ENTERO_SEGURO + 1),
                 ("anio", "2020"), ("anio", 2020.0), ("kilometraje", True),
                 ("kilometraje", float("nan")), ("kilometraje", float("inf")),
                 ("precio_centavos", "100"), ("precio_centavos", 1.5),
                 ("precio_centavos", False), ("precio_centavos", 0),
                 ("precio_centavos", MAX_ENTERO_SEGURO + 1))
        for campo, valor in casos:
            with self.subTest(campo=campo, valor=valor):
                self.assertIn("estado", validar_estado(estado(vehiculo(**{campo: valor})))[1])
        for datos in (dict(vehiculo(), otro=1), {k: v for k, v in vehiculo().items() if k != "imagen"}):
            self.assertIn("estado", validar_estado(estado(datos))[1])

    def test_identificadores_duplicados_se_rechazan(self):
        self.assertIn("estado", validar_estado(estado(vehiculo(3), vehiculo(3)))[1])

    def test_registro_asigna_maximo_mas_uno_sin_reutilizar_huecos(self):
        resultado, codigo = procesar_operacion("registrar", {"estado": estado(vehiculo(9), vehiculo(2)), "vehiculo": formulario()})
        self.assertEqual(codigo, 201)
        self.assertEqual([v["id"] for v in resultado["estado"]["vehiculos"]], [9, 2, 10])

    def test_edicion_conserva_id_y_otro_registro(self):
        previo = estado(vehiculo(4), vehiculo(8))
        resultado, codigo = procesar_operacion("editar", {"estado": previo, "vehiculo": formulario(modelo="Yaris")}, 4)
        self.assertEqual(codigo, 200)
        self.assertEqual(resultado["estado"]["vehiculos"][0]["id"], 4)
        self.assertEqual(resultado["estado"]["vehiculos"][0]["modelo"], "Yaris")
        self.assertEqual(resultado["estado"]["vehiculos"][1], previo["vehiculos"][1])

    def test_cambio_disponibilidad(self):
        resultado, codigo = procesar_operacion("disponibilidad", {"estado": estado(vehiculo()), "disponibilidad": "vendido"}, 1)
        self.assertEqual(codigo, 200)
        self.assertEqual(resultado["estado"], estado(vehiculo(disponibilidad="vendido")))

    def test_edicion_y_disponibilidad_inexistentes(self):
        for operacion, extra in (("editar", {"vehiculo": formulario()}), ("disponibilidad", {"disponibilidad": "vendido"})):
            resultado, codigo = procesar_operacion(operacion, {"estado": estado(vehiculo()), **extra}, 99)
            self.assertEqual(codigo, 404)
            self.assertIn("id", resultado["errores"])

    def test_operaciones_no_modifican_su_entrada_ante_exito_o_error(self):
        for operacion, extra, identificador in (
            ("registrar", {"vehiculo": formulario()}, None),
            ("registrar", {"vehiculo": formulario(precio_venta="0")}, None),
            ("editar", {"vehiculo": formulario(modelo="Yaris")}, 1),
            ("editar", {"vehiculo": formulario(modelo="")}, 1),
            ("disponibilidad", {"disponibilidad": "vendido"}, 1),
            ("disponibilidad", {"disponibilidad": "otro"}, 1),
        ):
            with self.subTest(operacion=operacion, extra=extra):
                entrada = {"estado": estado(vehiculo()), **extra}
                copia = deepcopy(entrada)
                procesar_operacion(operacion, entrada, identificador)
                self.assertEqual(entrada, copia)

    def test_estado_invalido_impide_cualquier_operacion(self):
        previo = estado(vehiculo(), vehiculo())
        copia = deepcopy(previo)
        resultado, codigo = procesar_operacion("registrar", {"estado": previo, "vehiculo": formulario()})
        self.assertEqual(codigo, 400)
        self.assertIn("estado", resultado["errores"])
        self.assertEqual(previo, copia)

    def test_limite_coleccion_valida_500_rechaza_501_y_nuevo_registro(self):
        previo = estado(*(vehiculo(i) for i in range(1, 501)))
        self.assertEqual(validar_estado(previo)[1], {})
        resultado, codigo = procesar_operacion("registrar", {"estado": previo, "vehiculo": formulario()})
        self.assertEqual(codigo, 422)
        self.assertFalse(resultado["ok"])
        self.assertIn("estado", validar_estado(estado(*previo["vehiculos"], vehiculo(501)))[1])

    def test_no_desborda_identificador_seguro(self):
        previo = estado(vehiculo(MAX_ENTERO_SEGURO))
        resultado, codigo = procesar_operacion("registrar", {"estado": previo, "vehiculo": formulario()})
        self.assertEqual(codigo, 422)
        self.assertIn("id", resultado["errores"])

    def test_formato_solicitud_estricto(self):
        for entrada in (None, [], {}, {"estado": estado()}, {"estado": estado(), "vehiculo": formulario(), "otro": True}):
            self.assertEqual(procesar_operacion("registrar", entrada)[1], 400)


if __name__ == "__main__":
    unittest.main()
