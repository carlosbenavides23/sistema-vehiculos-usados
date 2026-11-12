"""Pruebas HTTP con un repositorio en memoria; no son integración PostgreSQL."""

import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from urllib.parse import urlencode
from uuid import uuid4

os.environ.setdefault("FLASK_SECRET_KEY", "clave-solo-para-pruebas")

import app as app_module  # noqa: E402
from app import create_app  # noqa: E402
from test_vehiculos import formulario
from flask import request
import propiedad


VENDEDOR_TEST = "11111111-1111-4111-8111-111111111111"


def identidad_simulada():
    return {"id": VENDEDOR_TEST, "rol": "vendedor"} if request.cookies.get('fixture_auth') else None


def repositorio_falso():
    filas = []
    siguiente_id = [1]
    solicitudes = {}

    def lista():
        return [dict(fila) for fila in filas if not fila.get("retirado")]

    def obtener(identificador):
        return next((dict(fila) for fila in filas if fila["id"] == identificador and not fila.get("retirado")), None)

    def retirar(identificador, version):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None:
            return "no_encontrado"
        if fila.get("retirado"):
            return "retirado"
        if fila["updated_at"] != version:
            return "conflicto"
        fila["retirado"] = True
        return "retirado"

    def crear(datos):
        if len(filas) >= 500:
            return None
        fila = {
            "id": siguiente_id[0], **datos, "vendedor_id": propiedad.vendedor.get(),
            "created_at": "2026-10-29T12:00:00+00:00",
            "updated_at": "2026-10-29T12:00:00+00:00",
        }
        siguiente_id[0] += 1
        filas.append(fila)
        return dict(fila)

    def editar(identificador, datos):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None:
            return None
        fila.update(datos)
        fila["updated_at"] = "2026-10-29T13:00:00+00:00"
        return dict(fila)

    def disponibilidad(identificador, valor):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None:
            return None
        fila["disponibilidad"] = valor
        return dict(fila)

    def disponibilidad_condicional(identificador, valor, version):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None or fila["updated_at"] != version:
            return None
        fila["disponibilidad"] = valor
        fila["updated_at"] = (datetime.fromisoformat(version) + timedelta(microseconds=1)).isoformat()
        return dict(fila)

    def crear_idempotente(datos, clave):
        if clave in solicitudes:
            anteriores, identificador = solicitudes[clave]
            if anteriores != datos:
                raise ValueError("Solicitud incompatible.")
            return obtener(identificador)
        fila = crear(datos)
        if fila is not None:
            solicitudes[clave] = (dict(datos), fila["id"])
        return fila

    return {
        "filas": filas,
        "listar_vehiculos": lista,
        "obtener_vehiculo": obtener,
        "crear_vehiculo": crear,
        "crear_vehiculo_idempotente": crear_idempotente,
        "editar_vehiculo": editar,
        "cambiar_disponibilidad": disponibilidad,
        "cambiar_disponibilidad_condicional": disponibilidad_condicional,
        "retirar_vehiculo": retirar,
    }


def limite_falso():
    """Doble unitario compartido por clientes; nunca se usa en producción."""
    intentos = {}

    def reservar(clave, maximo, ventana):
        cantidad = intentos.get(clave, 0)
        if cantidad >= maximo:
            return ventana
        intentos[clave] = cantidad + 1
        return 0

    return {"reservar_intento_login": reservar, "reiniciar_intentos_login": lambda clave: intentos.pop(clave, None)}


def fotos_vacias():
    return {"listar_por_vehiculos": lambda ids: {identificador: [] for identificador in ids}, "listar_fotografias": lambda identificador: []}


class ApiPostgresContractTest(unittest.TestCase):
    def setUp(self):
        self.repo = repositorio_falso()
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "clave-solo-para-pruebas",
            "USER_AUTH_ENABLED": True,
            "CUENTA_AUTH": object(), "CUENTA_REPO": {},
            "SESSION_COOKIE_SECURE": False,
            "REPOSITORY": self.repo,
            "PHOTO_REPOSITORY": fotos_vacias(),
            "APP_READ_ONLY": False,
        })
        identidad_patch = patch('cuentas.identidad', side_effect=identidad_simulada)
        identidad_patch.start()
        self.addCleanup(identidad_patch.stop)
        self.cliente = self.app.test_client()
        self.cliente.get("/")

    def token(self):
        with self.cliente.session_transaction() as sesion:
            return sesion["csrf_token"]

    def iniciar_vendedor(self):
        self.cliente.set_cookie('fixture_auth', 'seller')

    def crear_vehiculo(self, **cambios):
        respuesta = self.cliente.post(
            "/api/vendedor/vehiculos", json={"vehiculo": formulario(**cambios)},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(respuesta.status_code, 201, respuesta.get_data(as_text=True))
        return respuesta.json["vehiculo"]

    def test_catalogo_publico_y_consulta_individual(self):
        lista_vacia = self.cliente.get("/api/vehiculos")
        self.assertEqual(lista_vacia.status_code, 200)
        self.assertEqual(lista_vacia.json, {"ok": True, "vehiculos": []})
        self.iniciar_vendedor()
        creado = self.cliente.post(
            "/api/vendedor/vehiculos", json={"vehiculo": formulario(placa="M 123-456")},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(creado.status_code, 201)
        self.assertEqual(creado.json["vehiculo"]["id"], 1)
        lector_publico = self.app.test_client()
        publico = lector_publico.get("/api/vehiculos")
        self.assertNotIn("placa", publico.json["vehiculos"][0])
        self.assertEqual(publico.headers.get("Cache-Control"), "no-store")
        privado = self.cliente.get("/api/vendedor/vehiculos/1")
        self.assertEqual(privado.json["vehiculo"]["placa"], "M 123-456")
        self.assertIn("fotografias", privado.json["vehiculo"])
        self.assertEqual(privado.headers.get("Cache-Control"), "no-store")
        self.assertEqual(self.cliente.get("/api/vendedor/vehiculos/99").status_code, 404)

        pagina_compartible = lector_publico.get("/vehiculo/1")
        self.assertEqual(pagina_compartible.status_code, 200)
        self.assertIn(b'data-vehiculo-id="1"', pagina_compartible.data)

        detalle_publico = lector_publico.get("/api/vehiculos/1")
        self.assertEqual(set(detalle_publico.json), {"ok", "vehiculo"})
        self.assertIn("fotografias", detalle_publico.json["vehiculo"])
        self.assertNotIn("placa", detalle_publico.json["vehiculo"])
        detalle_inexistente = lector_publico.get("/api/vehiculos/99")
        self.assertEqual(detalle_inexistente.status_code, 404)
        self.assertFalse(detalle_inexistente.json["ok"])

    def test_catalogo_filtra_combinando_parametros_y_usa_id_ascendente_por_defecto(self):
        self.iniciar_vendedor()
        primero = self.crear_vehiculo(
            marca="Toyota", modelo="Corolla", anio="2020", precio_venta="12500.25",
            tipo_vehiculo="Sedán", disponibilidad="disponible",
        )
        self.crear_vehiculo(
            marca="Toyota", modelo="Yaris", anio="2022", precio_venta="15000",
            tipo_vehiculo="Sedán", disponibilidad="vendido",
        )
        self.crear_vehiculo(
            marca="Honda", modelo="Civic", anio="2019", precio_venta="18000",
            tipo_vehiculo="Sedán", disponibilidad="disponible",
        )
        self.crear_vehiculo(
            marca="Toyota", modelo="Hilux", anio="2021", precio_venta="25000",
            tipo_vehiculo="Pickup", disponibilidad="disponible",
        )
        self.crear_vehiculo(
            marca="Toyota", modelo="Corolla viejo", anio="2018", precio_venta="9000",
            tipo_vehiculo="Sedán", disponibilidad="disponible",
        )

        consulta = urlencode({
            "q": "toyota", "disponibilidad": "disponible", "precio_min": "10000.25",
            "precio_max": "20000.25", "anio_min": "2019", "anio_max": "2022",
            "tipo_vehiculo": "Sedán",
        })
        combinado = self.cliente.get("/api/vendedor/vehiculos?" + consulta)
        self.assertEqual(combinado.status_code, 200, combinado.get_data(as_text=True))
        self.assertEqual([v["id"] for v in combinado.json["vehiculos"]], [primero["id"]])

        por_defecto = self.cliente.get("/api/vendedor/vehiculos")
        self.assertEqual([v["id"] for v in por_defecto.json["vehiculos"]], [1, 2, 3, 4, 5])

    def test_catalogo_query_string_q_filtra_marca_sin_otros_filtros(self):
        self.iniciar_vendedor()
        toyota = self.crear_vehiculo(marca="Toyota", modelo="Corolla")
        self.crear_vehiculo(marca="Honda", modelo="Civic")

        respuesta = self.cliente.get("/api/vendedor/vehiculos?q=Toyota")

        self.assertEqual(respuesta.status_code, 200, respuesta.get_data(as_text=True))
        self.assertEqual([vehiculo["id"] for vehiculo in respuesta.json["vehiculos"]], [toyota["id"]])
        self.assertEqual(respuesta.json["vehiculos"][0]["marca"], "Toyota")

    def test_catalogo_ordenes_permitidos(self):
        self.iniciar_vendedor()
        self.crear_vehiculo(anio="2020", precio_venta="15000")
        self.crear_vehiculo(anio="2018", precio_venta="12000")
        self.crear_vehiculo(anio="2022", precio_venta="18000")

        esperados = {
            "precio_asc": [2, 1, 3],
            "precio_desc": [3, 1, 2],
            "anio_asc": [2, 1, 3],
            "anio_desc": [3, 1, 2],
        }
        for orden, ids in esperados.items():
            with self.subTest(orden=orden):
                respuesta = self.cliente.get(f"/api/vendedor/vehiculos?orden={orden}")
                self.assertEqual(respuesta.status_code, 200)
                self.assertEqual([v["id"] for v in respuesta.json["vehiculos"]], ids)

    def test_catalogo_rechaza_filtros_invalidos_con_error_estandar(self):
        casos = (
            "precio_min=1.001", "precio_max=-5", "precio_min=1e3",
            "anio_min=2020.5", "anio_min=2022&anio_max=2020",
            "precio_min=20000&precio_max=10000", "disponibilidad=reservado",
            "orden=aleatorio", "tipo_vehiculo=" + ("x" * 41),
            "q=" + ("x" * 121), "desconocido=valor",
            "orden=precio_asc&orden=precio_desc",
        )
        for consulta in casos:
            with self.subTest(consulta=consulta[:80]):
                respuesta = self.cliente.get("/api/vehiculos?" + consulta)
                self.assertEqual(respuesta.status_code, 400)
                self.assertFalse(respuesta.json["ok"])
                self.assertIn("mensaje", respuesta.json)
                self.assertIn("errores", respuesta.json)

    def test_operaciones_por_registro_edicion_y_disponibilidad(self):
        self.iniciar_vendedor()
        headers = {"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())}
        creado = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        self.assertEqual(creado.status_code, 201)
        identificador = creado.json["vehiculo"]["id"]
        editado = self.cliente.put(
            f"/api/vendedor/vehiculos/{identificador}", json={"vehiculo": formulario(modelo="Yaris")},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(editado.status_code, 200)
        self.assertEqual(editado.json["vehiculo"]["modelo"], "Yaris")
        self.assertEqual(editado.json["vehiculo"]["id"], identificador)
        cambiado = self.cliente.patch(
            f"/api/vendedor/vehiculos/{identificador}/disponibilidad", json={"disponibilidad": "vendido"},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(cambiado.json["vehiculo"]["disponibilidad"], "vendido")
        self.assertEqual(self.cliente.put("/api/vendedor/vehiculos/99", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": self.token()}).status_code, 404)

    def test_editar_precio_preserva_transmision_y_combustible_historicos(self):
        self.iniciar_vendedor()
        creado = self.crear_vehiculo(transmision="automatica", combustible="gasolina")
        actualizado = self.cliente.put(
            f"/api/vendedor/vehiculos/{creado['id']}",
            json={"vehiculo": formulario(precio_venta="19500.00", transmision="automatica", combustible="gasolina")},
            headers={"X-CSRF-Token": self.token()},
        )

        self.assertEqual(actualizado.status_code, 200, actualizado.get_data(as_text=True))
        self.assertEqual(actualizado.json["vehiculo"]["precio_centavos"], 1_950_000)
        self.assertEqual(actualizado.json["vehiculo"]["transmision"], "automatica")
        self.assertEqual(actualizado.json["vehiculo"]["combustible"], "gasolina")

    def test_crear_editar_y_limpiar_ficha_tecnica_ampliada(self):
        self.iniciar_vendedor()
        creado = self.crear_vehiculo(
            tipo_vehiculo="SUV", version="Limited", motor="2.0 L, 4 cilindros",
            numero_puertas="5", capacidad_pasajeros="6",
            camara_reversa="true", bluetooth="false",
        )
        self.assertEqual(creado["tipo_vehiculo"], "suv")
        self.assertEqual(creado["tipo_vehiculo_etiqueta"], "SUV")
        self.assertEqual(creado["version"], "Limited")
        self.assertEqual(creado["motor"], "2.0 L, 4 cilindros")
        self.assertEqual(creado["numero_puertas"], 5)
        self.assertEqual(creado["capacidad_pasajeros"], 6)
        self.assertIs(creado["camara_reversa"], True)
        self.assertIs(creado["bluetooth"], False)

        actualizado = self.cliente.put(
            f"/api/vendedor/vehiculos/{creado['id']}",
            json={"vehiculo": formulario(
                modelo="Corolla actualizado", tipo_vehiculo="sedan", version="SE",
                motor="1.8 L", numero_puertas="4", capacidad_pasajeros="5",
                camara_reversa="", bluetooth="true",
            )},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(actualizado.status_code, 200, actualizado.json)
        ficha = actualizado.json["vehiculo"]
        self.assertEqual(ficha["tipo_vehiculo"], "sedan")
        self.assertEqual(ficha["version"], "SE")
        self.assertEqual(ficha["motor"], "1.8 L")
        self.assertEqual(ficha["numero_puertas"], 4)
        self.assertEqual(ficha["capacidad_pasajeros"], 5)
        self.assertIsNone(ficha["camara_reversa"])
        self.assertIs(ficha["bluetooth"], True)

    def test_edicion_compatibilidad_cliente_antiguo_y_tipo_historico_desconocido(self):
        self.iniciar_vendedor()
        creado = self.crear_vehiculo(version="Adventure", capacidad_pasajeros="7")
        self.repo["filas"][0]["tipo_vehiculo"] = "Station Wagon clásico"
        self.repo["filas"][0]["tipo_vehiculo_etiqueta"] = "Station Wagon clásico"

        antiguo = formulario(modelo="Yaris", tipo_vehiculo="Station Wagon clásico")
        for campo in ("version", "motor", "numero_puertas", "capacidad_pasajeros", "camara_reversa", "bluetooth"):
            antiguo.pop(campo)
        antigua_respuesta = self.cliente.put(
            f"/api/vendedor/vehiculos/{creado['id']}", json={"vehiculo": antiguo},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(antigua_respuesta.status_code, 200, antigua_respuesta.json)
        self.assertEqual(antigua_respuesta.json["vehiculo"]["tipo_vehiculo"], "Station Wagon clásico")
        self.assertEqual(antigua_respuesta.json["vehiculo"]["version"], "Adventure")
        self.assertEqual(antigua_respuesta.json["vehiculo"]["capacidad_pasajeros"], 7)

        invalida = self.cliente.put(
            f"/api/vendedor/vehiculos/{creado['id']}",
            json={"vehiculo": formulario(tipo_vehiculo="Sedán deportivo artesanal")},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(invalida.status_code, 422)
        self.assertIn("tipo_vehiculo", invalida.json["errores"])

        seleccionada = self.cliente.put(
            f"/api/vendedor/vehiculos/{creado['id']}",
            json={"vehiculo": formulario(tipo_vehiculo="Hatchback")},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(seleccionada.status_code, 200)
        self.assertEqual(seleccionada.json["vehiculo"]["tipo_vehiculo"], "hatchback")

    def test_filtro_de_tipo_recibe_etiquetas_historicas_y_devuelve_categoria_estable(self):
        self.iniciar_vendedor()
        sedan = self.crear_vehiculo(tipo_vehiculo="Sedán")
        self.crear_vehiculo(tipo_vehiculo="Pickup")
        respuesta = self.cliente.get("/api/vendedor/vehiculos?tipo_vehiculo=Sed%C3%A1n")
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual([fila["id"] for fila in respuesta.json["vehiculos"]], [sedan["id"]])

    def test_disponibilidad_condicional_impide_deshacer_version_obsoleta(self):
        self.iniciar_vendedor()
        headers = {"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())}
        creado = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers=headers).json["vehiculo"]
        ruta = f"/api/vendedor/vehiculos/{creado['id']}/disponibilidad"
        vendido = self.cliente.patch(ruta, json={"disponibilidad": "vendido", "version_esperada": creado["updated_at"]}, headers=headers)
        self.assertEqual(vendido.status_code, 200)
        version_vendida = vendido.json["vehiculo"]["updated_at"]
        revertido = self.cliente.patch(ruta, json={"disponibilidad": "disponible", "version_esperada": version_vendida}, headers=headers)
        self.assertEqual(revertido.status_code, 200)
        obsoleto = self.cliente.patch(ruta, json={"disponibilidad": "vendido", "version_esperada": version_vendida}, headers=headers)
        self.assertEqual(obsoleto.status_code, 409)
        self.assertEqual(self.cliente.get(f"/api/vendedor/vehiculos/{creado['id']}").json["vehiculo"]["disponibilidad"], "disponible")
        self.assertEqual(self.cliente.patch(ruta, json={"disponibilidad": "vendido", "version_esperada": "inválida"}, headers=headers).status_code, 400)

    def test_retirar_exige_autorizacion_y_excluye_consultas(self):
        self.iniciar_vendedor()
        creado = self.crear_vehiculo()
        ruta = f"/api/vendedor/vehiculos/{creado['id']}/retirar"
        cuerpo = {"version_esperada": creado["updated_at"]}
        self.assertEqual(self.cliente.post(ruta, json=cuerpo).status_code, 403)
        headers = {"X-CSRF-Token": self.token()}
        with patch.dict(self.repo, {"retirar_vehiculo": lambda *_: "fotografia_pendiente"}):
            pendiente = self.cliente.post(ruta, json=cuerpo, headers=headers)
            self.assertEqual(pendiente.status_code, 409)
            self.assertIn("fotografía", pendiente.json["mensaje"])
        self.assertEqual(self.cliente.get(f"/api/vendedor/vehiculos/{creado['id']}").status_code, 200)
        self.assertEqual(self.cliente.post(ruta, json={"version_esperada": "2020-01-01T00:00:00+00:00"}, headers=headers).status_code, 409)
        self.assertEqual(self.cliente.post(ruta, json=cuerpo, headers=headers).status_code, 200)
        self.assertEqual(self.cliente.post(ruta, json=cuerpo, headers=headers).status_code, 200)
        self.assertEqual(self.cliente.get(f"/api/vendedor/vehiculos/{creado['id']}").status_code, 404)
        self.assertEqual(self.cliente.get("/api/vendedor/vehiculos").json["vehiculos"], [])
        self.cliente.delete_cookie('fixture_auth')
        self.assertEqual(self.cliente.post(ruta, json=cuerpo, headers={"X-CSRF-Token": self.token()}).status_code, 401)

    def test_escrituras_requieren_sesion_y_csrf(self):
        sin_sesion = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": self.token()})
        self.assertEqual(sin_sesion.status_code, 401)
        self.iniciar_vendedor()
        sin_csrf = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()})
        self.assertEqual(sin_csrf.status_code, 403)
        token_invalido = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": "no-es-el-token"})
        self.assertEqual(token_invalido.status_code, 403)

    def test_alta_repetida_es_idempotente_y_reuso_distinto_se_rechaza(self):
        self.iniciar_vendedor()
        headers = {"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())}
        primero = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        repetido = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        self.assertEqual(primero.status_code, 201)
        self.assertEqual(repetido.json["vehiculo"]["id"], primero.json["vehiculo"]["id"])
        self.assertEqual(len(self.repo["listar_vehiculos"]()), 1)
        distinto = self.cliente.post("/api/vendedor/vehiculos", json={"vehiculo": formulario(modelo="Otro")}, headers=headers)
        self.assertEqual(distinto.status_code, 409)

    def test_preview_siempre_es_solo_lectura_aunque_se_pida_desbloquear(self):
        with patch.dict(os.environ, {"VERCEL_ENV": "preview", "APP_READ_ONLY": "false", "DATABASE_URL": "postgresql://postgres.rtcygltmrtulyeezaaac:secreto@pooler.test/postgres", "SUPABASE_URL": "https://rtcygltmrtulyeezaaac.supabase.co"}):
            self.assertTrue(app_module._solo_lectura_desde_entorno())
        with patch.dict(os.environ, {"VERCEL_ENV": "preview", "APP_READ_ONLY": "false", "DATABASE_URL": "postgresql://postgres.abcdefghijklmnopqrst:secreto@pooler.test/postgres", "SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co"}):
            self.assertTrue(app_module._solo_lectura_desde_entorno())

    def test_validacion_de_campos_y_solicitud_json(self):
        self.iniciar_vendedor()
        invalido = self.cliente.post(
            "/api/vendedor/vehiculos", json={"vehiculo": formulario(marca=" ")},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(invalido.status_code, 422)
        self.assertIn("marca", invalido.json["errores"])
        campos_extra = self.cliente.post(
            "/api/vendedor/vehiculos", json={"vehiculo": {**formulario(), "id": 8}},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(campos_extra.status_code, 422)
        cuerpo_antiguo = self.cliente.post(
            "/api/vendedor/vehiculos", json={"estado": {"version": 1, "vehiculos": []}, "vehiculo": formulario()},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(cuerpo_antiguo.status_code, 400)
        json_invalido = self.cliente.post(
            "/api/vendedor/vehiculos", data="{", content_type="application/json",
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(json_invalido.status_code, 400)

    def test_error_postgres_no_expone_detalles(self):
        def falla():
            raise RuntimeError("password=secreto-interno")
        app = create_app({
            "TESTING": True, "SECRET_KEY": "test", "SESSION_COOKIE_SECURE": False,
            "REPOSITORY": {**self.repo, "listar_vehiculos": falla},
        })
        respuesta = app.test_client().get("/api/vehiculos")
        self.assertEqual(respuesta.status_code, 503)
        self.assertNotIn("secreto-interno", respuesta.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
