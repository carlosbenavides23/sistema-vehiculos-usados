"""Flask/PostgreSQL loopback, Auth y Storage dobles; nunca carga .env."""
import os
os.environ['PYTHON_DOTENV_DISABLED'] = '1'
os.environ.setdefault('FLASK_SECRET_KEY', 'v711-fixture-only')
os.environ.pop('VERCEL_ENV', None)
os.environ.pop('VERCEL', None)
import sys
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parent)]
import hashlib
import json
import threading
from io import BytesIO
from uuid import uuid4
from PIL import Image
from flask import Response
from werkzeug.serving import make_server
import cuentas
import persistencia
import persistencia_chat_cuentas as chat
import persistencia_fotos as fotos
import propiedad
import roles_usuarios
from app import create_app
from fixture_chat_cuentas_ui import AuthDoble
from test_postgres_integracion import base_aislada, datos


class StorageLocal:
    def __init__(self):
        self.objetos = {}

    def subir(self, ruta, contenido):
        self.objetos[ruta] = contenido

    def eliminar(self, ruta):
        self.objetos.pop(ruta, None)

    def url_publica(self, ruta):
        return '/fixture-images/' + ruta


def main():
    with base_aislada():
        ids = {name: str(uuid4()) for name in ('seller_a', 'seller_b', 'buyer_a', 'buyer_b')}
        names = dict(seller_a='Vendedora Carla', seller_b='Vendedor B',
                     buyer_a='Ana María Rodríguez Benavides del Norte', buyer_b='Compradora Bea')
        for name, uid in ids.items():
            roles_usuarios.asignar_rol_inicial(uid, 'vendedor' if name.startswith('seller') else 'comprador')
            with persistencia._conectar() as db:
                db.execute('INSERT INTO public.perfiles_usuarios(usuario_id,nombre_visible) VALUES (%s,%s)', (uid, names[name]))
        vehicles = []
        for n in range(16):
            token = propiedad.vendedor.set(ids['seller_a' if n < 15 else 'seller_b'])
            try:
                row = datos(n)
                row.update(marca='Toyota' if n == 0 else 'Nissan', modelo='Corolla' if n == 0 else f'Sentra {n}',
                           disponibilidad='vendido' if n == 3 else 'disponible')
                vehicles.append(persistencia.crear_vehiculo(row))
            finally:
                propiedad.vendedor.reset(token)
        storage = StorageLocal()
        image = BytesIO()
        Image.new('RGB', (800, 600), '#35574f').save(image, 'WEBP')
        token = propiedad.vendedor.set(ids['seller_a'])
        try:
            for _ in range(5):
                key = str(uuid4())
                reserve = fotos.preparar_subida(vehicles[0]['id'], key, 'a'*64)
                storage.subir(reserve['storage_path'], image.getvalue())
                fotos.guardar_fotografia(vehicles[0]['id'], dict(storage_path=reserve['storage_path'],mime_type='image/webp',
                                        size_bytes=len(image.getvalue()),width_px=800,height_px=600), key)
        finally:
            propiedad.vendedor.reset(token)
        conversations = []
        for vehicle in vehicles[:2]:
            text = 'Consulta ficticia'
            result = chat.enviar_mensaje_comprador(ids['buyer_a'],vehicle['id'],str(uuid4()),hashlib.sha256(text.encode()).hexdigest(),text)
            conversations.append(str(result['conversacion']['id']))
        with persistencia._conectar() as db:
            for n in range(25):
                role = 'comprador' if n % 2 == 0 else 'vendedor'
                uid = ids['buyer_a' if n % 2 == 0 else 'seller_a']
                db.execute('''INSERT INTO public.mensajes_chat_cuentas(conversacion_id,autor_id,remitente,contenido,clave_idempotencia,huella_solicitud,created_at)
                              VALUES (%s,%s,%s,%s,%s,%s,now()-interval '2 days')''', (conversations[0],uid,role,f'Mensaje histórico {n}',str(uuid4()),'a'*64))
            for n in range(4):
                visitor = db.execute('INSERT INTO public.visitantes_anonimos DEFAULT VALUES RETURNING id').fetchone()['id']
                cid = db.execute('INSERT INTO public.conversaciones(visitante_id,vehiculo_id) VALUES (%s,%s) RETURNING id', (visitor,vehicles[0]['id'])).fetchone()['id']
                db.execute("INSERT INTO public.mensajes_chat(conversacion_id,remitente,contenido,clave_idempotencia,huella_solicitud) VALUES (%s,'comprador',%s,%s,%s)", (cid,f'Historial {n} <script>no ejecutar</script>',str(uuid4()),'b'*64))
        token = propiedad.vendedor.set(ids['seller_a'])
        try:
            persistencia.retirar_vehiculo(vehicles[1]['id'],vehicles[1]['updated_at'])
        finally:
            propiedad.vendedor.reset(token)
        tokens = {name: dict(id=uid,email=name+'@example.test') for name,uid in ids.items()}
        app = create_app(dict(TESTING=True,SECRET_KEY='v711-fixture-only',USER_AUTH_ENABLED=True,
                              SESSION_COOKIE_SECURE=False,APP_READ_ONLY=False,CUENTA_AUTH=AuthDoble(tokens),STORAGE=storage))

        @app.get('/fixture-images/<path:key>')
        def fixture_image(key):
            return Response(storage.objetos.get(key,b''),mimetype='image/webp',status=200 if key in storage.objetos else 404)

        server = make_server('127.0.0.1',0,app,threaded=True)
        print('V711_SERVER '+json.dumps(dict(url=f'http://127.0.0.1:{server.server_port}',vehicles=[v['id'] for v in vehicles],conversations=conversations)),flush=True)
        threading.Thread(target=lambda:(sys.stdin.readline(),server.shutdown()),daemon=True).start()
        try:
            server.serve_forever()
        finally:
            server.server_close()


if __name__ == '__main__':
    main()
