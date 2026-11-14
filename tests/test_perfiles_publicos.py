import os
import unittest
from unittest.mock import patch
from uuid import uuid4
from types import SimpleNamespace
os.environ.setdefault('FLASK_SECRET_KEY', 'fixture')
from app import create_app
import persistencia
import perfiles_publicos
import propiedad
import roles_usuarios
from tests.test_postgres_integracion import base_aislada, datos


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requiere PostgreSQL aislado')
class PerfilesPublicosTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = base_aislada(); cls.db.__enter__(); cls.addClassCleanup(cls.db.__exit__,None,None,None)
        cls.a,cls.b,cls.empty,cls.buyer = [str(uuid4()) for _ in range(4)]
        for uid,name,role in [(cls.a,'Carla <script>no ejecutar</script>','vendedor'),(cls.b,'Roberto','vendedor'),(cls.empty,'Sin anuncios','vendedor'),(cls.buyer,'Comprador','comprador')]:
            roles_usuarios.asignar_rol_inicial(uid,role)
            with persistencia._conectar() as db:
                db.execute('INSERT INTO perfiles_usuarios(usuario_id,nombre_visible) VALUES (%s,%s)',(uid,name))
        cls.rows=[]
        for n in range(75):
            token=propiedad.vendedor.set(cls.a if n<70 else cls.b)
            try:
                row=datos(n);row['disponibilidad']='vendido' if n==1 else 'disponible'
                cls.rows.append(persistencia.crear_vehiculo(row))
            finally:propiedad.vendedor.reset(token)
        token=propiedad.vendedor.set(cls.a)
        try:persistencia.retirar_vehiculo(cls.rows[2]['id'],cls.rows[2]['updated_at'])
        finally:propiedad.vendedor.reset(token)
        cls.app=create_app(dict(TESTING=True,SECRET_KEY='fixture',USER_AUTH_ENABLED=False))

    def test_perfil_publico_contrato_y_visibilidad(self):
        r=self.app.test_client().get('/api/vendedores/'+self.a)
        self.assertEqual(r.status_code,200);data=r.json
        self.assertEqual(set(data['vendedor']),{'nombre','url'})
        self.assertEqual(len(data['vehiculos']),69)
        self.assertNotIn(self.rows[2]['id'],[v['id'] for v in data['vehiculos']])
        self.assertIn('vendido',[v['disponibilidad'] for v in data['vehiculos']])
        for v in data['vehiculos']:
            self.assertNotIn('placa',v);self.assertNotIn('vendedor_id',v)
        for private in ('email','password','access_token','refresh_token','verificador'):
            self.assertNotIn(private,r.text)

    def test_catalogo_carga_vendedores_en_lote(self):
        with patch.object(perfiles_publicos,'vendedores',wraps=perfiles_publicos.vendedores) as batch:
            response=self.app.test_client().get('/api/vehiculos')
            self.assertEqual(response.status_code,200)
            self.assertEqual(batch.call_count,1)
            self.assertGreaterEqual(len(batch.call_args.args[0]),70)

    def test_ficha_nombre_y_legado(self):
        client=self.app.test_client()
        self.assertEqual(client.get('/api/vehiculos/'+str(self.rows[0]['id'])).json['vehiculo']['vendedor']['url'],'/vendedores/'+self.a)
        self.assertIsNone(client.get('/api/vehiculos/1').json['vehiculo']['vendedor'])

    def test_vendedor_vacio_comprador_inexistente_y_uuid_invalido(self):
        client=self.app.test_client()
        self.assertEqual(client.get('/api/vendedores/'+self.empty).json['vehiculos'],[])
        for uid in (self.buyer,str(uuid4()),'no-uuid'):
            self.assertEqual(client.get('/api/vendedores/'+uid).status_code,404)
            self.assertEqual(client.get('/vendedores/'+uid).status_code,404)

    def test_html_escapado_y_perfil_propio_verificado(self):
        client=self.app.test_client();html=client.get('/vendedores/'+self.a).text
        self.assertIn('&lt;script&gt;',html);self.assertNotIn('<script>no ejecutar',html)
        self.assertNotIn('>Mis publicaciones<',html)
        app=create_app(dict(TESTING=True,SECRET_KEY='fixture',USER_AUTH_ENABLED=True,CUENTA_AUTH=object()))
        with patch('cuentas.identidad',return_value=dict(id=self.a,rol='vendedor')):
            r=app.test_client().get('/vendedores/'+self.a)
            self.assertIn('>Mis publicaciones<',r.text)
            self.assertIn('no-store',r.headers['Cache-Control'])
            self.assertNotIn('>Mis publicaciones<',app.test_client().get('/vendedores/'+self.b).text)

    def test_rutas_publicas_no_autorizan_escrituras(self):
        client=self.app.test_client()
        self.assertEqual(client.post('/api/vendedores/'+self.a,json={}).status_code,405)
        self.assertIn(client.put('/api/vendedor/vehiculos/'+str(self.rows[0]['id']),json={}).status_code,(401,404))
        self.assertEqual(client.get('/api/vendedores/'+self.b).status_code,200)
