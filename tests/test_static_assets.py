"""Regresión de recursos estáticos preparados para la CDN de Vercel."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("FLASK_SECRET_KEY", "clave-solo-para-pruebas")

from scripts.preparar_vercel import preparar_recursos  # noqa: E402
from app import create_app  # noqa: E402


RAIZ = Path(__file__).resolve().parents[1]


class PreparacionRecursosVercelTest(unittest.TestCase):
    def test_api_conserva_urls_de_fotografias_con_y_sin_filtros(self):
        vehiculos = [
            {
                "id": 8101, "marca": "Toyota", "modelo": "Corolla", "anio": 2022,
                "kilometraje": 30000, "precio_centavos": 1900000, "ubicacion": "Managua",
                "descripcion": "Vehículo ficticio para comprobar la respuesta pública.",
                "disponibilidad": "disponible", "transmision": "Automática",
                "combustible": "Gasolina", "tipo_vehiculo": "Sedán", "color": "Azul",
            },
            {
                "id": 8102, "marca": "Nissan", "modelo": "Sentra", "anio": 2021,
                "kilometraje": 42000, "precio_centavos": 1650000, "ubicacion": "León",
                "descripcion": "Vehículo ficticio para comprobar la respuesta pública.",
                "disponibilidad": "disponible", "transmision": "Manual",
                "combustible": "Gasolina", "tipo_vehiculo": "Sedán", "color": "Rojo",
            },
        ]
        fotos = {
            8101: [{"id": 1, "storage_path": "pruebas/toyota-a.jpg", "orden": 1}],
            8102: [{"id": 2, "storage_path": "pruebas/nissan-b.jpg", "orden": 1}],
        }

        class StorageDoble:
            def url_publica(self, ruta):
                return f"https://imagenes.example.invalid/{ruta}"

        aplicacion = create_app({
            "TESTING": True,
            "SECRET_KEY": "clave-solo-para-pruebas",
            "APP_READ_ONLY": True,
            "REPOSITORY": {"listar_vehiculos": lambda: vehiculos},
            "PHOTO_REPOSITORY": {
                "listar_por_vehiculos": lambda identificadores: {identificador: fotos[identificador] for identificador in identificadores},
                "listar_fotografias": lambda identificador: fotos[identificador],
            },
            "STORAGE": StorageDoble(),
        })

        with aplicacion.test_client() as cliente:
            for ruta, ids_esperados in (("/api/vehiculos", {8101, 8102}), ("/api/vehiculos?q=Toyota", {8101})):
                with self.subTest(ruta=ruta):
                    respuesta = cliente.get(ruta)
                    self.assertEqual(respuesta.status_code, 200)
                    registros = respuesta.json["vehiculos"]
                    self.assertEqual({registro["id"] for registro in registros}, ids_esperados)
                    for registro in registros:
                        self.assertEqual(len(registro["fotografias"]), 1)
                        self.assertEqual(
                            registro["fotografias"][0]["url"],
                            f"https://imagenes.example.invalid/{fotos[registro['id']][0]['storage_path']}",
                        )

    def test_enlace_archivo_historico_oculto_solo_en_production(self):
        from flask import render_template
        # El enlace se omite en el HTML, no se esconde únicamente mediante CSS.
        for production, expected in ((True, False), (False, True)):
            with self.subTest(production=production):
                app = create_app({"TESTING": True, "SECRET_KEY": "clave-solo-para-pruebas",
                                  "SHOW_ARCHIVE_NAV": not production})
                with app.test_request_context("/vendedor"):
                    html = render_template("admin_v6.html", csrf_token="fixture",
                        solo_lectura=False, chat_habilitado=False, max_year=2026,
                        vendedor_panel=True, tipos_vehiculo=[], mapa_alias_tipos_vehiculo={})
                self.assertEqual('data-archive-link' in html, expected)
                self.assertEqual('Archivo histórico' in html, expected)

    def test_rutas_de_flask_responden_con_mime_de_recurso_y_no_html(self):
        aplicacion = create_app({"TESTING": True, "SECRET_KEY": "clave-solo-para-pruebas"})
        recursos = {
            "/static/css/estilos.css": "text/css",
            "/static/css/iconos.css": "text/css",
            "/static/css/motion.css": "text/css",
            "/static/js/iconos.js": None,
            "/static/img/icons/lucide-sprite.svg": "image/svg+xml",
            "/static/js/fotografias.js": None,
            "/static/js/interfaz.js": None,
            "/static/img/vehiculo.svg": "image/svg+xml",
        }

        with aplicacion.test_client() as cliente:
            for ruta, mime_esperado in recursos.items():
                with self.subTest(ruta=ruta):
                    respuesta = cliente.get(ruta)
                    try:
                        self.assertEqual(respuesta.status_code, 200)
                        self.assertGreater(len(respuesta.data), 0)
                        self.assertNotEqual(respuesta.mimetype, "text/html")
                        if mime_esperado:
                            self.assertEqual(respuesta.mimetype, mime_esperado)
                    finally:
                        respuesta.close()

    def test_build_copia_los_recursos_a_las_rutas_publicas_que_usa_el_html(self):
        recursos = (
            Path("css/estilos.css"),
            Path("css/motion.css"),
            Path("js/fotografias.js"),
            Path("js/interfaz.js"),
            Path("img/vehiculo.svg"),
        )
        with tempfile.TemporaryDirectory() as directorio:
            raiz = Path(directorio)
            for relativo in recursos:
                origen = raiz / "static" / relativo
                origen.parent.mkdir(parents=True, exist_ok=True)
                origen.write_bytes(b"recurso de prueba\n")

            cantidad = preparar_recursos(raiz)

            self.assertEqual(cantidad, len(recursos))
            for relativo in recursos:
                servido = raiz / "public" / "static" / relativo
                self.assertTrue(servido.is_file())
                self.assertEqual(servido.read_bytes(), (raiz / "static" / relativo).read_bytes())
                self.assertEqual("/" + servido.relative_to(raiz / "public").as_posix(), "/static/" + relativo.as_posix())

    def test_assets_del_deployment_estan_versionados_y_coinciden_con_flask(self):
        origenes = sorted((RAIZ / "static").rglob("*"))
        archivos = [origen for origen in origenes if origen.is_file()]
        self.assertTrue(archivos)

        for origen in archivos:
            relativo = origen.relative_to(RAIZ / "static")
            destino = RAIZ / "public" / "static" / relativo
            ruta_git = destino.relative_to(RAIZ).as_posix()
            with self.subTest(recurso=ruta_git):
                self.assertTrue(destino.is_file(), f"Falta el recurso CDN versionado: {ruta_git}")
                self.assertEqual(destino.read_bytes(), origen.read_bytes())

                rastreado = subprocess.run(
                    ["git", "ls-files", "--error-unmatch", "--", ruta_git],
                    cwd=RAIZ, capture_output=True, text=True, check=False,
                )
                self.assertEqual(rastreado.returncode, 0, f"Vercel no recibirá {ruta_git}: no está versionado")

                ignorado = subprocess.run(
                    ["git", "check-ignore", "--no-index", "--quiet", "--", ruta_git],
                    cwd=RAIZ, capture_output=True, text=True, check=False,
                )
                self.assertNotEqual(ignorado.returncode, 0, f"El filtro Git todavía excluye {ruta_git}")

    def test_filtro_de_vercel_no_excluye_el_directorio_public_generado(self):
        reglas = (RAIZ / ".vercelignore").read_text(encoding="utf-8").splitlines()
        patrones = [linea.strip().lstrip("!").strip("/") for linea in reglas if linea.strip() and not linea.lstrip().startswith("#")]

        self.assertFalse(
            any(patron == "public" or patron.startswith("public/") or patron.startswith("**/public") for patron in patrones),
            "Vercel debe recibir public/static generado para servirlo en la CDN.",
        )


if __name__ == "__main__":
    unittest.main()
