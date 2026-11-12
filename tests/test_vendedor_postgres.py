import os
import io
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from types import SimpleNamespace
from PIL import Image
import psycopg
from app import create_app
import cuentas
import roles_usuarios
import propiedad
import persistencia
import persistencia_fotos
from test_postgres_integracion import base_aislada
from test_vehiculos import formulario


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'),'Requiere PostgreSQL aislado')
class VendedorPostgresTest(unittest.TestCase):
    def test_retiro_y_edicion_del_propietario_no_resucitan_publicacion(self):
        from test_postgres_integracion import datos
        with base_aislada():
            uid=str(uuid4());roles_usuarios.asignar_rol_inicial(uid,'vendedor')
            token=propiedad.vendedor.set(uid)
            try: car=persistencia.crear_vehiculo(datos())
            finally: propiedad.vendedor.reset(token)
            barrier=threading.Barrier(2)
            def operar(retirar):
                scope=propiedad.vendedor.set(uid)
                try:
                    barrier.wait()
                    return persistencia.retirar_vehiculo(car['id'],car['updated_at']) if retirar else persistencia.editar_vehiculo(car['id'],datos())
                finally: propiedad.vendedor.reset(scope)
            with ThreadPoolExecutor(max_workers=2) as pool:
                r=pool.submit(operar,True);e=pool.submit(operar,False)
                retiro,edicion=r.result(),e.result()
            if retiro=='retirado':
                self.assertIsNone(edicion)
                self.assertIsNone(persistencia.obtener_vehiculo(car['id']))
            else:
                self.assertEqual(retiro,'conflicto');self.assertIsNotNone(edicion)

    def test_propiedad_entre_dos_vendedores_comprador_y_legacy(self):
        with base_aislada() as dsn:
            ids=[str(uuid4()) for _ in range(3)]
            for uid,rol in zip(ids,['vendedor','vendedor','comprador']):roles_usuarios.asignar_rol_inicial(uid,rol)
            auth=SimpleNamespace(usuario=lambda token:{'id':token,'email':'fixture@example.test'})
            storage=SimpleNamespace(url_publica=lambda ruta:'https://example.test/'+ruta,subir=lambda *args:None,eliminar=lambda *args:None)
            app=create_app({'TESTING':True,'SECRET_KEY':'fixture','USER_AUTH_ENABLED':True,'APP_READ_ONLY':False,'SESSION_COOKIE_SECURE':False,'CUENTA_AUTH':auth,'STORAGE':storage})
            clientes=[]; headers=[]
            for uid in ids:
                client=app.test_client();client.get('/cuenta')
                with client.session_transaction() as s: token=s['csrf_token']
                sid=str(uuid4());cuentas.guardar_sesion(uid,cuentas.digest(sid))
                client.set_cookie('cuenta_sid',sid);client.set_cookie('cuenta_access',uid)
                clientes.append(client);headers.append({'X-CSRF-Token':token,'Idempotency-Key':str(uuid4())})
            a,b,c=clientes;ha,hb,hc=headers
            ruta='/api/vendedor/vehiculos'
            ra=a.post(ruta,json={'vehiculo':formulario(tipo_vehiculo='SUV', version='Limited', motor='2.0 L', numero_puertas='5', capacidad_pasajeros='6', camara_reversa='true', bluetooth='false')},headers=ha);self.assertEqual(ra.status_code,201,ra.json)
            self.assertEqual(b.post(ruta,json={'vehiculo':formulario()},headers={**hb,'Idempotency-Key':ha['Idempotency-Key']}).status_code,409)
            rb=b.post(ruta,json={'vehiculo':formulario(modelo='Otro')},headers=hb);self.assertEqual(rb.status_code,201,rb.json)
            va,vb=ra.json['vehiculo'],rb.json['vehiculo'];ia,ib=va['id'],vb['id']
            self.assertEqual((va['tipo_vehiculo'],va['version'],va['motor'],va['numero_puertas'],va['capacidad_pasajeros'],va['camara_reversa'],va['bluetooth']),('suv','Limited','2.0 L',5,6,True,False))
            with psycopg.connect(dsn,autocommit=True) as db:
                self.assertEqual(str(db.execute('SELECT vendedor_id FROM public.vehiculos WHERE id=%s',(ia,)).fetchone()[0]),ids[0])
                with self.assertRaises(psycopg.errors.RaiseException):db.execute('UPDATE public.vehiculos SET vendedor_id=%s WHERE id=%s',(ids[1],ia))
                with self.assertRaises(psycopg.errors.RaiseException):db.execute('UPDATE public.vehiculos SET vendedor_id=%s WHERE id=1',(ids[2],))
            self.assertEqual([v['id'] for v in a.get(ruta).json['vehiculos']],[ia])
            self.assertEqual([v['id'] for v in b.get(ruta).json['vehiculos']],[ib])
            self.assertEqual(b.get(f'{ruta}/{ia}').status_code,404)
            self.assertEqual(b.put(f'{ruta}/{ia}',json={'vehiculo':formulario()},headers=hb).status_code,404)
            self.assertEqual(b.post(f'{ruta}/{ia}/retirar',json={'version_esperada':va['updated_at']},headers=hb).status_code,404)
            self.assertEqual(c.post(ruta,json={'vehiculo':formulario()},headers=hc).status_code,403)
            self.assertEqual(app.test_client().get(ruta).status_code,401)
            manipulado=formulario();manipulado['vendedor_id']=ids[1]
            self.assertEqual(a.post(ruta,json={'vehiculo':manipulado},headers=ha).status_code,422)
            img=io.BytesIO();Image.new('RGB',(20,20),'blue').save(img,format='PNG')
            propia=b.post(f'{ruta}/{ib}/fotografias',data={'fotografia':(io.BytesIO(img.getvalue()),'fixture.png')},headers={**hb,'Idempotency-Key':str(uuid4())})
            self.assertEqual(propia.status_code,201,propia.json)
            foto_id=propia.json['fotografia']['id']
            foto=a.post(f'{ruta}/{ib}/fotografias',data={'fotografia':(io.BytesIO(img.getvalue()),'fixture.png')},headers={**ha,'Idempotency-Key':str(uuid4())})
            self.assertEqual(foto.status_code,404,foto.json)
            self.assertEqual(a.put(f'{ruta}/{ib}/fotografias/{foto_id}',data={'fotografia':(io.BytesIO(img.getvalue()),'fixture.png')},headers={**ha,'Idempotency-Key':str(uuid4())}).status_code,404)
            self.assertEqual(a.delete(f'{ruta}/{ib}/fotografias/{foto_id}',headers=ha).status_code,404)
            self.assertEqual(a.patch(f'{ruta}/{ib}/disponibilidad',json={'disponibilidad':'vendido'},headers=ha).status_code,404)
            self.assertEqual(b.patch(f'{ruta}/{ib}/disponibilidad',json={'disponibilidad':'vendido','version_esperada':vb['updated_at']},headers=hb).status_code,200)
            self.assertEqual(b.put(f'{ruta}/{ib}',json={'vehiculo':formulario(modelo='Edición propia')},headers=hb).status_code,200)
            propia=b.put(f'{ruta}/{ib}',json={'vehiculo':formulario(modelo='Actualización técnica',motor='1.6 L',numero_puertas='4')},headers=hb)
            self.assertEqual(propia.status_code,200,propia.json)
            self.assertEqual(propia.json['vehiculo']['motor'],'1.6 L')
            clave=str(uuid4());contexto=propiedad.vendedor.set(ids[1])
            try: reserva=persistencia_fotos.preparar_subida(ib,clave,'b'*64)
            finally: propiedad.vendedor.reset(contexto)
            contexto=propiedad.vendedor.set(ids[0])
            try:
                with self.assertRaises(LookupError):persistencia_fotos.buscar_solicitud(clave,ib)
            finally: propiedad.vendedor.reset(contexto)
            publico=app.test_client().get('/api/vehiculos').json['vehiculos']
            self.assertTrue({ia,ib}<={v['id'] for v in publico});self.assertTrue(all('placa' not in v and 'vendedor_id' not in v for v in publico))
            legacy=app.test_client();legacy.get('/')
            with legacy.session_transaction() as s:s['admin_authenticated']=True;csrf=s['csrf_token']
            lh={'X-CSRF-Token':csrf}
            self.assertEqual(legacy.put(f'/api/vehiculos/{ia}',json={'vehiculo':formulario()},headers=lh).status_code,404)
            self.assertEqual(legacy.patch(f'/api/vehiculos/{ia}/disponibilidad',json={'disponibilidad':'vendido'},headers=lh).status_code,404)
            self.assertEqual(legacy.post(f'/api/vehiculos/{ia}/retirar',json={'version_esperada':va['updated_at']},headers=lh).status_code,404)
            self.assertEqual(legacy.post(f'/api/vehiculos/{ib}/fotografias',data={'fotografia':(io.BytesIO(img.getvalue()),'fixture.png')},headers={**lh,'Idempotency-Key':str(uuid4())}).status_code,404)
            self.assertNotIn(ia,[v['id'] for v in legacy.get('/api/admin/vehiculos').json['vehiculos']])
            self.assertTrue(legacy.get('/api/admin/vehiculos').json['vehiculos'])
            self.assertEqual(a.post(f'{ruta}/{ia}/retirar',json={'version_esperada':va['updated_at']},headers=ha).status_code,200)
            self.assertEqual(a.get(ruta).json['vehiculos'],[])
            self.assertEqual(propiedad.vendedor.get(),None)
