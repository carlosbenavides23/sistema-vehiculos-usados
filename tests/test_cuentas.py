import os
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
from uuid import uuid4
os.environ.setdefault('FLASK_SECRET_KEY','fixture')
from app import create_app
from auth_proveedor import ErrorAuth


class CuentasTest(unittest.TestCase):
    def setUp(self):
        self.uid=str(uuid4()); self.roles={}; self.sesiones={}; self.revocado=False
        def signup(email,password,rol):
            if self.uid in self.roles: raise ErrorAuth()
            self.roles[self.uid]=rol  # Simula el trigger de alta de Auth.
            return {'access_token':'access','refresh_token':'refresh'}
        def login(email,password):
            if password!='password-fixture': raise ErrorAuth()
            return {'access_token':'access','refresh_token':'refresh'}
        self.auth=SimpleNamespace(registrar=signup,login=login,usuario=lambda t: {'id':self.uid,'email':'ficticio@example.test'} if t=='access' else self.invalid(),renovar=lambda t: {'access_token':'access','refresh_token':'refresh2'} if t=='refresh' else self.invalid(),salir=lambda t:setattr(self,'revocado',True))
        self.app=create_app({'TESTING':True,'SECRET_KEY':'fixture','USER_AUTH_ENABLED':True,'SESSION_COOKIE_SECURE':False,'CUENTA_AUTH':self.auth,'CUENTA_REPO':{'guardar_sesion':lambda u,s:self.sesiones.update({s:u}),'leer_sesion':self.sesiones.get,'borrar_sesion':lambda s:self.sesiones.pop(s,None),'obtener_rol':self.roles.get}})
        self.client=self.app.test_client();self.client.get('/cuenta')
        with self.client.session_transaction() as s:self.csrf=s['csrf_token']
    def invalid(self): raise ErrorAuth()
    def post(self,action,body):return self.client.post('/api/cuenta/'+action,json=body,headers={'X-CSRF-Token':self.csrf})
    def registro(self,rol='comprador'):return self.post('registro',{'email':'ficticio@example.test','password':'password-fixture','rol':rol})
    def test_registro_ambos_roles_y_rutas(self):
        for rol in ('comprador','vendedor'):
            self.uid=str(uuid4())
            r=self.registro(rol);self.assertEqual(r.status_code,200)
            self.assertEqual(self.client.get('/api/cuenta').json['usuario']['rol'],rol)
            self.assertEqual(self.client.get('/cuenta/'+rol).status_code,200)
            otro='vendedor' if rol=='comprador' else 'comprador'
            self.assertEqual(self.client.get('/cuenta/'+otro).status_code,403)
            self.assertNotIn('access',r.json)
    def test_registro_repetido_no_cambia_rol(self):
        self.registro();self.assertEqual(self.registro('vendedor').status_code,401)
        self.assertEqual(self.roles[self.uid],'comprador')
    def test_login_y_logout_no_concede_admin_v6(self):
        self.registro('vendedor');self.post('logout',{})
        self.assertTrue(self.revocado);self.assertEqual(self.client.get('/api/cuenta').status_code,401)
        self.assertEqual(self.post('login',{'email':'ficticio@example.test','password':'incorrecta'}).status_code,401)
        self.assertEqual(self.post('login',{'email':'ficticio@example.test','password':'password-fixture'}).status_code,200)
        self.assertFalse(self.client.get('/api/admin/session').json['autenticado'])
    def test_csrf_e_entradas(self):
        self.assertEqual(self.client.post('/api/cuenta/login',json={}).status_code,403)
        self.assertEqual(self.post('registro',{'email':'x','password':'short','rol':'admin'}).status_code,422)
        self.assertEqual(self.registro('admin').status_code,422)
    def test_sesion_manipulada_o_expirada(self):
        self.registro();self.client.set_cookie('cuenta_sid','manipulada')
        self.assertEqual(self.client.get('/api/cuenta').status_code,401)
        self.assertEqual(self.client.get('/cuenta/vendedor').status_code,401)
    def test_refresh_y_revocacion_local(self):
        self.registro();self.client.set_cookie('cuenta_access','expirado')
        respuesta=self.client.get('/api/cuenta');self.assertEqual(respuesta.status_code,200)
        self.assertTrue(any('cuenta_refresh=' in c for c in respuesta.headers.getlist('Set-Cookie')))
        self.sesiones.clear();self.assertEqual(self.client.get('/api/cuenta').status_code,401)
    def test_cookies_protegidas(self):
        r=self.registro()
        cookies=[c for c in r.headers.getlist('Set-Cookie') if c.startswith('cuenta_')]
        self.assertEqual(len(cookies),3)
        self.assertTrue(all('HttpOnly' in c and 'SameSite=Lax' in c for c in cookies))
    def test_identidad_distinta_no_sustituye_al_propietario(self):
        self.registro();self.uid=str(uuid4());self.roles[self.uid]='vendedor'
        self.assertEqual(self.client.get('/api/cuenta').status_code,401)
    def test_production_no_expone_cuentas(self):
        with patch.dict(os.environ,{'VERCEL_ENV':'production'}):
            self.assertEqual(self.client.get('/cuenta').status_code,404)

    def test_solo_lectura_rechaza_registro_y_login_antes_de_escrituras(self):
        for entorno, readonly in [('local', True), ('preview', True), ('preview', False)]:
            with self.subTest(entorno=entorno), patch.dict(os.environ, {'VERCEL_ENV': entorno}):
                self.app.config['APP_READ_ONLY'] = readonly
                with patch.object(self.auth, 'registrar', Mock()) as registro, patch.object(self.auth, 'login', Mock()) as login, patch.dict(self.app.config['CUENTA_REPO'], {'guardar_sesion': Mock()}) :
                    for accion, body in [('registro', {'email':'ficticio@example.test','password':'password-fixture','rol':'comprador'}), ('login', {'email':'ficticio@example.test','password':'password-fixture'})]:
                        self.assertEqual(self.post(accion,body).status_code,503)
                    registro.assert_not_called()
                    login.assert_not_called()
                    self.app.config['CUENTA_REPO']['guardar_sesion'].assert_not_called()
                self.assertEqual(self.roles,{})
                self.assertEqual(self.sesiones,{})

    def test_solo_lectura_permite_revocar_sesion_existente(self):
        self.registro()
        self.app.config['APP_READ_ONLY'] = True
        self.assertEqual(self.post('logout',{}).status_code,200)
        self.assertEqual(self.sesiones,{})
        self.assertTrue(self.revocado)

    def test_solo_lectura_no_renueva_tokens(self):
        self.registro()
        self.app.config['APP_READ_ONLY'] = True
        self.client.set_cookie('cuenta_access','expirado')
        with patch.object(self.auth,'renovar',Mock()) as renovar:
            self.assertEqual(self.client.get('/api/cuenta').status_code,401)
            renovar.assert_not_called()
