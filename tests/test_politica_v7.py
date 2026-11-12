import os
import unittest
from unittest.mock import Mock, patch

from app import create_app
import politica_v7


class PoliticaV7Test(unittest.TestCase):
    def setUp(self):
        self.base = {
            "TESTING": True,
            "SECRET_KEY": "test-secret-only-for-isolated-v7-tests",
            "USER_AUTH_ENABLED": True,
            "SESSION_COOKIE_SECURE": False,
            "CUENTA_AUTH": Mock(),
            "CUENTA_REPO": {"leer_sesion": Mock(return_value=None)},
        }

    def test_production_requiere_dos_autorizaciones(self):
        config = {**self.base, "V7_PRODUCTION_ENABLED": False}
        with patch.dict(os.environ, {"VERCEL_ENV": "production", "USER_AUTH_ENABLED": "true",
                                     "V7_PRODUCTION_ENABLED": "false"}, clear=False):
            self.assertFalse(politica_v7.habilitada(config))
            self.assertFalse(politica_v7.habilitada({**config, "V7_PRODUCTION_ENABLED": True,
                                                      "USER_AUTH_ENABLED": False}))
            with patch.dict(os.environ, {"USER_AUTH_ENABLED": "false", "V7_PRODUCTION_ENABLED": "true"}):
                self.assertFalse(politica_v7.habilitada({**config, "TESTING": False,
                                                          "USER_AUTH_ENABLED": True, "V7_PRODUCTION_ENABLED": True}))

    def test_production_habilita_solo_con_dos_flags_y_dependencias_validas(self):
        config = {
            "USER_AUTH_ENABLED": True,
            "V7_PRODUCTION_ENABLED": True,
            "SECRET_KEY": "a" * 48,
            "SESSION_COOKIE_SECURE": True,
        }
        env = {
            "VERCEL_ENV": "production",
            "USER_AUTH_ENABLED": "true",
            "V7_PRODUCTION_ENABLED": "true",
            "DATABASE_URL": "postgresql://rol:clave@db.example.test/app",
            "SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_fixture_no_secret",
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertTrue(politica_v7.habilitada(config))
            for variable in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"):
                with patch.dict(os.environ, {variable: ""}):
                    self.assertFalse(politica_v7.habilitada(config), variable)
            self.assertFalse(politica_v7.habilitada({**config, "SECRET_KEY": "short"}))
            self.assertFalse(politica_v7.habilitada({**config, "SESSION_COOKIE_SECURE": False}))
            with patch.dict(os.environ, {"SUPABASE_PUBLISHABLE_KEY": "", "SUPABASE_ANON_KEY": "not-a-jwt"}):
                self.assertFalse(politica_v7.habilitada(config))

    def test_preview_fuerza_solo_lectura_y_bloquea_registro_y_escrituras_privadas(self):
        auth = Mock()
        app_config = {
            **self.base,
            "CUENTA_AUTH": auth,
            "APP_READ_ONLY": False,
            "CHAT_CUENTAS_REPOSITORY": Mock(),
        }
        with patch.dict(os.environ, {"VERCEL_ENV": "preview"}, clear=False):
            app = create_app(app_config)
            self.assertTrue(app.config["APP_READ_ONLY"])
            self.assertTrue(app.config["SESSION_COOKIE_SECURE"])
            self.assertTrue(politica_v7.habilitada(app.config))

            client = app.test_client()
            client.get("/cuenta")
            with client.session_transaction() as flask_session:
                csrf = flask_session["csrf_token"]
            registro = client.post("/api/cuenta/registro", json={
                "email": "v7-preview@example.test", "password": "correct-horse-fixture", "rol": "comprador",
                "nombre_visible": "Comprador Demo",
            }, headers={"X-CSRF-Token": csrf})
            self.assertEqual(registro.status_code, 503)
            auth.registrar.assert_not_called()
            auth.login.assert_not_called()

            chat = client.post("/api/cuenta/chat/comprador/vehiculos/1/mensajes", json={})
            vendedor = client.post("/api/vendedor/vehiculos", json={})
            self.assertEqual(chat.status_code, 503)
            self.assertEqual(vendedor.status_code, 503)
            app.config["CHAT_CUENTAS_REPOSITORY"].assert_not_called()

    def test_preview_sin_opt_in_v7_permanece_desactivado(self):
        config = {**self.base, "USER_AUTH_ENABLED": False, "APP_READ_ONLY": False}
        with patch.dict(os.environ, {"VERCEL_ENV": "preview"}, clear=False):
            self.assertFalse(politica_v7.habilitada(config))
            app = create_app(config)
            self.assertTrue(app.config["APP_READ_ONLY"])
            self.assertEqual(app.test_client().get("/cuenta").status_code, 404)

    def test_solo_lectura_falla_cerrado_con_valor_invalido(self):
        self.assertTrue(politica_v7.solo_lectura({"APP_READ_ONLY": "perhaps"}))
        self.assertFalse(politica_v7.solo_lectura({"APP_READ_ONLY": False}))
        with patch.dict(os.environ, {"APP_READ_ONLY": "true"}):
            self.assertTrue(politica_v7.solo_lectura({"APP_READ_ONLY": False}))

    def test_cuentas_panel_y_chat_comparten_la_desactivacion(self):
        app = create_app({"TESTING": True, "SECRET_KEY": "disabled-v7", "USER_AUTH_ENABLED": False})
        client = app.test_client()
        self.assertEqual(client.get("/cuenta").status_code, 404)
        self.assertEqual(client.get("/api/cuenta/chat/comprador/conversaciones").status_code, 404)
        self.assertEqual(client.get("/api/vendedor/vehiculos").status_code, 404)

    def test_segunda_autorizacion_production_se_aplica_a_cada_superficie_v7(self):
        config = {**self.base, "V7_PRODUCTION_ENABLED": False}
        with patch.dict(os.environ, {"VERCEL_ENV": "production", "USER_AUTH_ENABLED": "true",
                                     "V7_PRODUCTION_ENABLED": "false"}, clear=False):
            app = create_app(config)
            client = app.test_client()
            self.assertEqual(client.get("/cuenta").status_code, 404)
            self.assertEqual(client.get("/api/cuenta/chat/comprador/conversaciones").status_code, 404)
            self.assertEqual(client.get("/api/vendedor/vehiculos").status_code, 404)


if __name__ == "__main__":
    unittest.main()
