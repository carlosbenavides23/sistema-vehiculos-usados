import os
import unittest
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from unittest.mock import patch

import propiedad
import persistencia
import persistencia_fotos
import persistencia_chat_cuentas as chat
from scripts import transferir_inventario as herramienta
from test_postgres_integracion import base_aislada, datos, metadatos


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requiere PostgreSQL local aislado')
class TransferenciaTest(unittest.TestCase):
    def setUp(self):
        self.fixture = base_aislada(preparar_auth=True)
        self.fixture.__enter__()
        self.addCleanup(self.fixture.__exit__, None, None, None)
        self.vendedor, self.otro, self.comprador = [str(uuid4()) for _ in range(3)]
        with persistencia._conectar() as db:
            for uid, rol in zip((self.vendedor, self.otro, self.comprador), ('vendedor', 'vendedor', 'comprador')):
                db.execute("INSERT INTO auth.users VALUES (%s,jsonb_build_object('v71_rol',%s::text,'v76_nombre_visible','Persona ficticia'))", (uid, rol))
        for n in range(12):
            persistencia.crear_vehiculo(datos(n))
        token = propiedad.vendedor.set(self.otro)
        try:
            self.ajeno = persistencia.crear_vehiculo(datos(99))
        finally:
            propiedad.vendedor.reset(token)

    def plan(self):
        with persistencia._conectar() as db:
            return herramienta.preparar(db, self.vendedor)

    def ejecutar(self, plan, revertir=False):
        with persistencia._conectar() as db:
            return herramienta.ejecutar(db, plan, revertir)

    def test_transferencia_18_idempotente_reversible_con_fotos_y_chat_anonimo(self):
        clave = str(uuid4())
        reserva = persistencia_fotos.preparar_subida(1, clave, 'a' * 64)
        foto = persistencia_fotos.guardar_fotografia(1, metadatos(reserva), clave)
        with persistencia._conectar() as db:
            visitante = db.execute('INSERT INTO public.visitantes_anonimos DEFAULT VALUES RETURNING id').fetchone()['id']
            db.execute('INSERT INTO public.conversaciones(visitante_id,vehiculo_id) VALUES (%s,1)', (visitante,))
        plan = self.plan()
        self.assertEqual(plan['cantidad'], 18)
        self.assertEqual(self.ejecutar(plan)['actualizados'], 18)
        self.assertEqual(self.ejecutar(plan)['estado'], 'ya_aplicado')
        with persistencia._conectar() as db:
            self.assertEqual(str(db.execute('SELECT vendedor_id FROM public.vehiculos WHERE id=%s', (self.ajeno['id'],)).fetchone()['vendedor_id']), self.otro)
            self.assertEqual(db.execute('SELECT count(*) AS n FROM public.vehiculo_fotografias WHERE id=%s', (foto['id'],)).fetchone()['n'], 1)
        self.assertEqual(self.ejecutar(plan, True)['actualizados'], 18)
        self.assertEqual(self.ejecutar(plan, True)['estado'], 'ya_revertido')
        with persistencia._conectar() as db:
            self.assertEqual(herramienta._filas(db), plan['vehiculos'])
            self.assertEqual(db.execute("SELECT tgenabled FROM pg_trigger WHERE tgname='v72_propietario'").fetchone()['tgenabled'], 'O')

    def test_autorizacion_edicion_retiro_y_chat_privado_tras_transferir(self):
        plan = self.plan()
        self.ejecutar(plan)
        for uid, permitido in ((self.vendedor, True), (self.otro, False)):
            token = propiedad.vendedor.set(uid)
            privado = propiedad.privado.set(True)
            try:
                self.assertEqual(persistencia.obtener_vehiculo(1) is not None, permitido)
                self.assertEqual(persistencia.editar_vehiculo(1, datos()) is not None, permitido)
                if not permitido:
                    self.assertNotIn(1, [v['id'] for v in persistencia.listar_vehiculos()])
            finally:
                propiedad.vendedor.reset(token)
                propiedad.privado.reset(privado)
        conversacion = chat.crear_o_recuperar_conversacion_comprador(self.comprador, 1)
        self.assertIsNotNone(chat.obtener_conversacion_vendedor(conversacion['id'], self.vendedor))
        self.assertIsNone(chat.obtener_conversacion_vendedor(conversacion['id'], self.otro))
        with self.assertRaises(ValueError):
            self.ejecutar(plan, True)  # No despojar de su vendedor a un chat nuevo.
        token = propiedad.vendedor.set(self.vendedor)
        try:
            vehiculo = persistencia.obtener_vehiculo(1)
            self.assertEqual(persistencia.retirar_vehiculo(1, vehiculo['updated_at']), 'retirado')
        finally:
            propiedad.vendedor.reset(token)
        self.assertIsNotNone(chat.obtener_conversacion_vendedor(conversacion['id'], self.vendedor))

    def test_rechaza_rol_invalido_plan_alterado_y_cambios_concurrentes(self):
        with self.assertRaises(ValueError), persistencia._conectar() as db:
            herramienta.preparar(db, self.comprador)
        with self.assertRaises(ValueError), persistencia._conectar() as db:
            herramienta.preparar(db, str(uuid4()))
        plan = self.plan()
        with self.assertRaises(ValueError):
            self.ejecutar({**plan, 'vendedor': self.otro})
        persistencia.editar_vehiculo(1, datos())
        with self.assertRaises(ValueError):
            self.ejecutar(plan)
        with persistencia._conectar() as db:
            self.assertEqual(len(herramienta._filas(db)), 18)
        clave = str(uuid4())
        plan_actual = self.plan()
        persistencia_fotos.preparar_subida(1, clave, 'b' * 64)
        with self.assertRaises(ValueError):
            self.plan()
        with self.assertRaises(ValueError):
            self.ejecutar(plan_actual)

    def test_fallo_reversion_restaura_trigger_y_propiedad_atomicamente(self):
        plan = self.plan()
        self.ejecutar(plan)
        original = herramienta._filas
        llamadas = 0

        def fallar_al_comprobar(db, ids=None):
            nonlocal llamadas
            llamadas += 1
            if llamadas == 2:
                raise ValueError('Fallo inyectado después del UPDATE')
            return original(db, ids)

        with patch.object(herramienta, '_filas', side_effect=fallar_al_comprobar):
            with self.assertRaises(ValueError):
                self.ejecutar(plan, True)
        with persistencia._conectar() as db:
            self.assertEqual(str(db.execute('SELECT vendedor_id FROM public.vehiculos WHERE id=1').fetchone()['vendedor_id']), self.vendedor)
            self.assertEqual(db.execute("SELECT tgenabled FROM pg_trigger WHERE tgname='v72_propietario'").fetchone()['tgenabled'], 'O')

    def test_reintentos_con_conexiones_independientes(self):
        plan = self.plan()
        with ThreadPoolExecutor(max_workers=2) as pool:
            resultados = list(pool.map(lambda _: self.ejecutar(plan), range(2)))
        self.assertEqual(sorted(r['actualizados'] for r in resultados), [0, 18])

    def test_cli_respaldo_y_recibos_fuera_del_repositorio(self):
        with TemporaryDirectory() as temporal:
            ruta = Path(temporal) / 'plan.json'
            def invocar(*args):
                proceso = subprocess.run([sys.executable, 'scripts/transferir_inventario.py', '--plan', str(ruta), *args],
                                         capture_output=True, text=True, encoding='utf-8')
                self.assertEqual(proceso.returncode, 0, proceso.stderr)
                return json.loads(proceso.stdout)
            self.assertEqual(invocar('--seller', self.vendedor)['cantidad'], 18)
            respaldo = ruta.read_bytes()
            self.assertEqual(invocar('--apply')['actualizados'], 18)
            self.assertEqual(invocar('--apply')['actualizados'], 0)
            self.assertEqual(invocar('--rollback')['actualizados'], 18)
            self.assertEqual(ruta.read_bytes(), respaldo)
            self.assertEqual(len(list(Path(temporal).glob('*.confirmado'))), 3)
