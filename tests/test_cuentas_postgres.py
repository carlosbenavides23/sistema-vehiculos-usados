import os
from pathlib import Path
import unittest
from uuid import uuid4
import psycopg
from test_postgres_integracion import base_aislada
import cuentas
import roles_usuarios


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'),'Requiere PostgreSQL local aislado')
class CuentasPostgresTest(unittest.TestCase):
    def test_alta_atomica_rol_inmutable_y_sesion(self):
        with base_aislada() as dsn, psycopg.connect(dsn,autocommit=True) as db:
            db.execute('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb NOT NULL)')
            sql=(Path(__file__).parents[1]/'supabase/migrations/20261112002005_v71_roles_usuarios.sql').read_text()
            db.execute(sql)
            uid=str(uuid4())
            db.execute('INSERT INTO auth.users VALUES (%s,%s)',(uid,'{"v71_rol":"comprador"}'))
            self.assertEqual(roles_usuarios.obtener_rol(uid),'comprador')
            db.execute('UPDATE auth.users SET raw_user_meta_data=%s WHERE id=%s',('{"v71_rol":"vendedor"}',uid))
            self.assertEqual(roles_usuarios.obtener_rol(uid),'comprador')
            with self.assertRaises(psycopg.errors.RaiseException):
                db.execute("UPDATE public.roles_usuarios SET rol='vendedor' WHERE usuario_id=%s",(uid,))
            malo=str(uuid4())
            with self.assertRaises(psycopg.errors.RaiseException):
                db.execute('INSERT INTO auth.users VALUES (%s,%s)',(malo,'{"v71_rol":"admin"}'))
            self.assertIsNone(db.execute('SELECT id FROM auth.users WHERE id=%s',(malo,)).fetchone())
            cuentas.guardar_sesion(uid,'a'*64)
            self.assertEqual(cuentas.leer_sesion('a'*64),uid)
            db.execute("UPDATE public.sesiones_cuenta SET expires_at=now()-interval '1 second'")
            self.assertIsNone(cuentas.leer_sesion('a'*64))
            cuentas.borrar_sesion('a'*64)
            self.assertIsNone(cuentas.leer_sesion('a'*64))
            for tabla in ('roles_usuarios','sesiones_cuenta'):
                self.assertFalse(db.execute("SELECT has_table_privilege('anon',%s,'SELECT')",('public.'+tabla,)).fetchone()[0])
