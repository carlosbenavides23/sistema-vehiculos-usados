import os
import unittest
from uuid import uuid4
import psycopg
from test_postgres_integracion import base_aislada
import cuentas
import roles_usuarios


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'),'Requiere PostgreSQL local aislado')
class CuentasPostgresTest(unittest.TestCase):
    def test_alta_atomica_rol_inmutable_y_sesion(self):
        with base_aislada(preparar_auth=True) as dsn, psycopg.connect(dsn,autocommit=True) as db:
            legado=str(uuid4())
            db.execute('ALTER TABLE auth.users DISABLE TRIGGER v71_rol_inicial')
            db.execute('INSERT INTO auth.users VALUES (%s,%s)',(legado,'{"v71_rol":"comprador"}'))
            db.execute('ALTER TABLE auth.users ENABLE TRIGGER v71_rol_inicial')
            roles_usuarios.asignar_rol_inicial(legado,'comprador')
            self.assertEqual(roles_usuarios.obtener_rol(legado),'comprador')
            self.assertIsNone(roles_usuarios.obtener_nombre_visible(legado))
            uid=str(uuid4())
            db.execute('INSERT INTO auth.users VALUES (%s,%s)',(uid,'{"v71_rol":"comprador","v76_nombre_visible":"  María   López  "}'))
            self.assertEqual(roles_usuarios.obtener_rol(uid),'comprador')
            self.assertEqual(roles_usuarios.obtener_nombre_visible(uid),'María López')
            repetida=str(uuid4())
            db.execute('INSERT INTO auth.users VALUES (%s,%s)',(repetida,'{"v71_rol":"comprador","v76_nombre_visible":"María López"}'))
            self.assertEqual(roles_usuarios.obtener_nombre_visible(repetida),'María López')
            db.execute('UPDATE auth.users SET raw_user_meta_data=%s WHERE id=%s',('{"v71_rol":"vendedor"}',uid))
            self.assertEqual(roles_usuarios.obtener_rol(uid),'comprador')
            self.assertEqual(roles_usuarios.obtener_nombre_visible(uid),'María López')
            self.assertFalse(hasattr(roles_usuarios, 'establecer_nombre_visible'))
            self.assertEqual(roles_usuarios.obtener_nombre_visible(uid),'María López')
            with self.assertRaises(psycopg.errors.RaiseException):
                db.execute("UPDATE public.roles_usuarios SET rol='vendedor' WHERE usuario_id=%s",(uid,))
            malo=str(uuid4())
            with self.assertRaises(psycopg.errors.RaiseException):
                db.execute('INSERT INTO auth.users VALUES (%s,%s)',(malo,'{"v71_rol":"admin"}'))
            self.assertIsNone(db.execute('SELECT id FROM auth.users WHERE id=%s',(malo,)).fetchone())
            sin_nombre=str(uuid4())
            with self.assertRaises(psycopg.errors.RaiseException):
                db.execute('INSERT INTO auth.users VALUES (%s,%s)',(sin_nombre,'{"v71_rol":"comprador"}'))
            self.assertEqual(db.execute('SELECT count(*) FROM public.roles_usuarios WHERE usuario_id=%s',(sin_nombre,)).fetchone()[0],0)
            cuentas.guardar_sesion(uid,'a'*64)
            self.assertEqual(cuentas.leer_sesion('a'*64),uid)
            db.execute("UPDATE public.sesiones_cuenta SET expires_at=now()-interval '1 second'")
            self.assertIsNone(cuentas.leer_sesion('a'*64))
            cuentas.borrar_sesion('a'*64)
            self.assertIsNone(cuentas.leer_sesion('a'*64))
            self.assertIsNone(roles_usuarios.obtener_nombre_visible(str(uuid4())))
            for tabla in ('roles_usuarios','sesiones_cuenta','perfiles_usuarios'):
                self.assertFalse(db.execute("SELECT has_table_privilege('anon',%s,'SELECT')",('public.'+tabla,)).fetchone()[0])
            self.assertTrue(db.execute("SELECT relrowsecurity FROM pg_class WHERE oid='public.perfiles_usuarios'::regclass").fetchone()[0])
            self.assertFalse(db.execute(
                """SELECT EXISTS (
                     SELECT 1 FROM pg_class AS c, LATERAL aclexplode(c.relacl) AS a
                     WHERE c.oid='public.perfiles_usuarios'::regclass
                       AND a.grantee=0 AND a.privilege_type='SELECT'
                   )"""
            ).fetchone()[0])
