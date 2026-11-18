import os
import hashlib
import unittest
from unittest.mock import patch
from uuid import uuid4
os.environ.setdefault('FLASK_SECRET_KEY', 'fixture')
from app import create_app
from auth_proveedor import ErrorAuth


class RetornoContextualTest(unittest.TestCase):
    def test_parametro_no_concede_propiedad(self):
        uid = str(uuid4())
        app = create_app(dict(TESTING=True, SECRET_KEY='fixture', USER_AUTH_ENABLED=True,
                             CUENTA_AUTH=object(), CUENTA_REPO={}))
        for user, owner, expected in [(None, uid, False),
                                     (dict(id=uid, rol='comprador'), uid, False),
                                     (dict(id=uid, rol='vendedor'), str(uuid4()), False),
                                     (dict(id=uid, rol='vendedor'), uid, True)]:
            with self.subTest(user=user, owner=owner), patch('cuentas.identidad', return_value=user), patch('persistencia.obtener_vehiculo', return_value=dict(vendedor_id=owner)):
                result = app.test_client().get('/vehiculo/7?desde=inventario&retorno=https://evil.invalid')
                self.assertEqual(result.status_code, 200)
                self.assertEqual('Volver a mis publicaciones' in result.text, expected)
                self.assertIn('no-store', result.headers['Cache-Control'])
                self.assertNotIn(uid, result.text)
                marker = hashlib.sha256(uid.encode()).hexdigest()
                self.assertEqual(f'data-owner-navigation="{marker}"' in result.text, expected)

    def test_auth_vencido_no_impide_consulta_publica(self):
        app = create_app(dict(TESTING=True, SECRET_KEY='fixture', USER_AUTH_ENABLED=True,
                             CUENTA_AUTH=object(), CUENTA_REPO={}))
        with patch('cuentas.identidad', side_effect=ErrorAuth()):
            response = app.test_client().get('/vehiculo/7?desde=inventario')
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('Volver a mis publicaciones', response.text)
