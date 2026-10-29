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
    def test_rutas_de_flask_responden_con_mime_de_recurso_y_no_html(self):
        aplicacion = create_app({"TESTING": True, "SECRET_KEY": "clave-solo-para-pruebas"})
        recursos = {
            "/static/css/estilos.css": "text/css",
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
