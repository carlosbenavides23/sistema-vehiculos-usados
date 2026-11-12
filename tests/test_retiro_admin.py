"""Seguridad V7.9 con PostgreSQL real local y proveedor Auth simulado."""
import os
import unittest
from uuid import uuid4
from types import SimpleNamespace

from app import create_app
import cuentas
import persistencia
import persistencia_fotos as fotos
import archivo_chat
from scripts.transferir_inventario import preparar, ejecutar
from test_postgres_integracion import base_aislada, datos, metadatos
from test_vehiculos import formulario


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requiere PostgreSQL aislado')
class RetiroAdminTest(unittest.TestCase):
    def setUp(self):
        fixture = base_aislada(preparar_auth=True)
        fixture.__enter__()
        self.addCleanup(fixture.__exit__, None, None, None)
        self.ids = [str(uuid4()) for _ in range(3)]
        with persistencia._conectar() as db:
            for uid, rol in zip(self.ids, ('vendedor', 'vendedor', 'comprador')):
                db.execute("INSERT INTO auth.users VALUES (%s,jsonb_build_object('v71_rol',%s::text,'v76_nombre_visible','Persona ficticia'))", (uid, rol))
        for n in range(12):
            persistencia.crear_vehiculo(datos(n))
        clave = str(uuid4())
        reserva = fotos.preparar_subida(1, clave, 'a'*64)
        fotos.guardar_fotografia(1, metadatos(reserva), clave)
        self.conversaciones = []
        with persistencia._conectar() as db:
            self.visitante = db.execute('INSERT INTO public.visitantes_anonimos DEFAULT VALUES RETURNING id').fetchone()['id']
            for vehiculo_id in range(1, 5):
                cid = db.execute('INSERT INTO public.conversaciones(visitante_id,vehiculo_id) VALUES (%s,%s) RETURNING id', (self.visitante, vehiculo_id)).fetchone()['id']
                self.conversaciones.append(cid)
                db.execute("INSERT INTO public.mensajes_chat(conversacion_id,remitente,contenido,clave_idempotencia,huella_solicitud) VALUES (%s,'comprador','<script>privado</script>',%s,%s)", (cid,str(uuid4()),'b'*64))
        with persistencia._conectar() as db:
            plan = preparar(db, self.ids[0])
        with persistencia._conectar() as db:
            ejecutar(db, plan)  # Solo datos ficticios de esta base UUID.
        self.app = create_app({'TESTING': True, 'SECRET_KEY': 'fixture-v79', 'USER_AUTH_ENABLED': True,
            'SESSION_COOKIE_SECURE': False, 'CHAT_ENABLED': True, 'APP_READ_ONLY': False,
            'CUENTA_AUTH': SimpleNamespace(usuario=lambda token: {'id': token, 'email': 'fixture@example.test'}),
            'STORAGE': SimpleNamespace(url_publica=lambda ruta: 'https://example.test/'+ruta)})
        self.clientes = []
        for uid in self.ids:
            client = self.app.test_client()
            client.get('/')
            sid = str(uuid4())
            cuentas.guardar_sesion(uid, cuentas.digest(sid))
            client.set_cookie('cuenta_sid', sid)
            client.set_cookie('cuenta_access', uid)
            self.clientes.append(client)

    def test_cookie_antigua_y_rutas_retiradas_no_conceden_privilegios(self):
        client = self.app.test_client()
        client.get('/')
        with client.session_transaction() as session:
            session['admin_authenticated'] = True
        rutas = [('/api/admin/login','POST'),('/api/admin/logout','POST'),('/api/admin/session','GET'),
                 ('/api/admin/vehiculos','GET'),('/api/admin/chat/conversaciones','GET'),
                 ('/api/chat/sesion','POST'),('/api/chat/conversaciones','GET'),
                 ('/api/chat/vehiculos/1/mensajes','POST'),('/api/vehiculos','POST'),
                 ('/api/vehiculos/1','PUT'),('/api/vehiculos/1/disponibilidad','PATCH'),
                 ('/api/vehiculos/1/retirar','POST'),('/api/vehiculos/1/fotografias','POST')]
        for ruta, method in rutas:
            with self.subTest(ruta=ruta):
                self.assertIn(client.open(ruta, method=method, json={}).status_code, (404,405))
        self.assertEqual(client.get('/api/vendedor/vehiculos').status_code, 401)
        self.assertNotIn('placa', client.get('/api/vehiculos/1').json['vehiculo'])
        self.assertEqual(client.get('/administracion').location, '/cuenta')
        with client.session_transaction() as session:
            self.assertNotIn('admin_authenticated', session)
        html = client.get('/').get_data(as_text=True)
        self.assertNotIn('/administracion', html)
        self.assertNotIn('js/chat.js', html)
        with persistencia._conectar() as db:
            self.assertEqual(db.execute('SELECT count(*) AS n FROM public.conversaciones').fetchone()['n'],4)
            self.assertEqual(db.execute('SELECT count(*) AS n FROM public.vehiculos').fetchone()['n'],18)

    def test_propietario_inventario_18_fotos_csrf_y_archivo_privado(self):
        a,b,c = self.clientes
        self.assertEqual(len(a.get('/api/vendedor/vehiculos').json['vehiculos']),18)
        self.assertEqual(b.get('/api/vendedor/vehiculos').json['vehiculos'],[])
        self.assertEqual(c.get('/vendedor').status_code,403)
        self.assertEqual(c.get('/vendedor/archivo').status_code,403)
        self.assertEqual(b.put('/api/vendedor/vehiculos/1',json={'vehiculo':formulario()}).status_code,403)
        self.assertEqual(a.put('/api/vendedor/vehiculos/1',json={'vehiculo':formulario()}).status_code,403)
        self.assertEqual(len(a.get('/api/vendedor/vehiculos/1').json['vehiculo']['fotografias']),1)
        lista = a.get('/vendedor/archivo')
        self.assertEqual(lista.status_code,200)
        self.assertEqual(lista.headers['Cache-Control'],'no-store')
        for cid in self.conversaciones:
            pagina = a.get(f'/vendedor/archivo/{cid}')
            self.assertEqual(pagina.status_code,200,pagina.get_data(as_text=True))
            html = pagina.get_data(as_text=True)
            self.assertIn('&lt;script&gt;privado&lt;/script&gt;',html)
            self.assertNotIn(str(self.visitante),html)
            self.assertNotIn('huella_solicitud',html)
            self.assertNotIn('<form',html)
            self.assertEqual(b.get(f'/vendedor/archivo/{cid}').status_code,404)
            self.assertEqual(a.post(f'/vendedor/archivo/{cid}',json={}).status_code,405)
        self.assertIn('No hay conversaciones',b.get('/vendedor/archivo').get_data(as_text=True))
        self.assertEqual(a.get('/vendedor/archivo?cursor=incorrecto').status_code,400)
        cuentas.borrar_sesion(cuentas.digest(a.get_cookie('cuenta_sid').value))
        self.assertEqual(a.get('/vendedor/archivo').status_code,401)

    def test_metadatos_archivo_seguros_sin_modificar_historial(self):
        texto = '<script>ejemplo</script> ' + 'x' * 200
        with persistencia._conectar() as db:
            db.execute('UPDATE public.mensajes_chat SET contenido=%s WHERE conversacion_id=%s', (texto, self.conversaciones[0]))
            antes = db.execute('SELECT count(*) AS n FROM public.mensajes_chat').fetchone()['n']
        filas, _ = archivo_chat.listar(self.ids[0])
        fila = next(f for f in filas if f['id'] == self.conversaciones[0])
        self.assertEqual(fila['extracto'], texto[:160])
        self.assertIsNotNone(fila['created_at'])
        self.assertIsNotNone(fila['ultimo_mensaje_en'])
        self.assertNotIn('visitante_id', fila)
        self.assertEqual(archivo_chat.listar(self.ids[1])[0], [])
        pagina = self.clientes[0].get('/vendedor/archivo').get_data(as_text=True)
        self.assertIn('&lt;script&gt;ejemplo&lt;/script&gt;', pagina)
        self.assertIn('Último mensaje:', pagina)
        self.assertNotIn(str(self.visitante), pagina)
        with persistencia._conectar() as db:
            self.assertEqual(db.execute('SELECT count(*) AS n FROM public.mensajes_chat').fetchone()['n'], antes)

    def test_paginacion_archivo_no_trunca_mensajes(self):
        cid = self.conversaciones[0]
        with persistencia._conectar() as db:
            db.execute("INSERT INTO public.mensajes_chat(conversacion_id,remitente,contenido,clave_idempotencia,huella_solicitud) SELECT %s,'comprador','Historial',gen_random_uuid(),%s FROM generate_series(1,101)", (cid,'c'*64))
        _, mensajes, cursor = archivo_chat.detalle(self.ids[0], cid)
        self.assertEqual(len(mensajes),100)
        _, restantes, siguiente = archivo_chat.detalle(self.ids[0], cid, cursor)
        self.assertEqual(len(restantes),2)
        self.assertIsNone(siguiente)
