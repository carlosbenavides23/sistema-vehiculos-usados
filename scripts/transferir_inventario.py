"""Operación de mantenimiento explícita; no se importa desde Flask ni carga .env."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from persistencia import _conectar
from psycopg import sql


TABLAS = (
    'vehiculos', 'vehiculo_fotografias', 'solicitudes_idempotentes',
    'fotografia_operaciones', 'conversaciones', 'mensajes_chat',
    'conversaciones_cuentas', 'mensajes_chat_cuentas', 'storage_limpieza',
)


def huella(valor):
    return hashlib.sha256(json.dumps(valor, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def _destino(db, vendedor, bloquear=False):
    UUID(vendedor)
    fila = db.execute(
        "SELECT r.usuario_id FROM public.roles_usuarios r JOIN auth.users u "
        "ON u.id=r.usuario_id WHERE r.usuario_id=%s AND r.rol='vendedor'"
        + (' FOR SHARE OF r,u' if bloquear else ''), (vendedor,),
    ).fetchone()
    if not fila:
        raise ValueError('UUID destinatario ausente de Auth o sin rol vendedor.')


def _conexion(db):
    # Vincula el plan al destino sin guardar host, usuario, DSN ni secretos.
    return huella([db.info.host, db.info.port, db.info.user, db.info.dbname])


def _filas(db, ids=None):
    return [r['fila'] for r in db.execute(
        'SELECT to_jsonb(v) AS fila FROM public.vehiculos v WHERE '
        + ('vendedor_id IS NULL' if ids is None else 'id=ANY(%s)') + ' ORDER BY id',
        None if ids is None else (ids,),
    ).fetchall()]


def _relaciones(db, ids):
    dependencias = db.execute("""SELECT DISTINCT c.conrelid::regclass::text AS tabla
        FROM pg_constraint c WHERE c.contype='f' AND c.confrelid IN
        ('public.vehiculos'::regclass,'public.conversaciones'::regclass,
         'public.conversaciones_cuentas'::regclass)""").fetchall()
    conocidas = set(TABLAS) | {'public.' + tabla for tabla in TABLAS}
    if any(fila['tabla'] not in conocidas for fila in dependencias):
        raise ValueError('Existe una relación nueva no cubierta por esta herramienta.')
    resultado = {}
    for tabla in TABLAS[1:]:
        if tabla in ('mensajes_chat', 'mensajes_chat_cuentas'):
            conversacion = 'conversaciones' if tabla == 'mensajes_chat' else 'conversaciones_cuentas'
            condicion = sql.SQL('conversacion_id IN (SELECT id FROM public.{} WHERE vehiculo_id=ANY(%s))').format(sql.Identifier(conversacion))
        elif tabla == 'storage_limpieza':
            # Conservador: cualquier actividad de limpieza obliga a renovar el plan.
            condicion = sql.SQL('TRUE')
        else:
            condicion = sql.SQL('vehiculo_id=ANY(%s)')
        consulta = sql.SQL('SELECT to_jsonb(t) AS fila FROM public.{} t WHERE {} ORDER BY to_jsonb(t)::text').format(sql.Identifier(tabla), condicion)
        filas = [r['fila'] for r in db.execute(consulta, None if tabla == 'storage_limpieza' else (ids,)).fetchall()]
        resultado[tabla] = {'cantidad': len(filas), 'sha256': huella(filas)}
    return resultado


def _sin_pendientes(db, ids):
    if db.execute("SELECT 1 FROM public.fotografia_operaciones WHERE vehiculo_id=ANY(%s) AND estado='pendiente' LIMIT 1", (ids,)).fetchone():
        raise ValueError('Hay reservas fotográficas pendientes; resolverlas antes de transferir.')


def preparar(db, vendedor, esperados=18):
    """Solo lectura; guardar el resultado fuera de Git antes de cualquier UPDATE."""
    db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    _destino(db, vendedor)
    filas = _filas(db)
    if len(filas) != esperados or esperados < 1:
        raise ValueError(f'Se esperaban {esperados} vehículos heredados; hay {len(filas)}.')
    ids = [v['id'] for v in filas]
    _sin_pendientes(db, ids)
    plan = {'version': 1, 'operacion': str(uuid4()), 'creado_en': datetime.now(timezone.utc).isoformat(),
            'vendedor': vendedor, 'conexion': _conexion(db), 'cantidad': esperados,
            'operador': dict(db.execute('SELECT current_user, session_user').fetchone()),
            'vehiculos': filas, 'relaciones': _relaciones(db, ids)}
    plan['sha256'] = huella(plan)
    return plan


def ejecutar(db, plan, revertir=False):
    """Una transacción: valida snapshot, bloquea escritores y solo cambia vendedor_id."""
    original = {k: v for k, v in plan.items() if k != 'sha256'}
    if plan.get('version') != 1 or huella(original) != plan.get('sha256'):
        raise ValueError('Plan alterado o versión incompatible.')
    if plan['conexion'] != _conexion(db):
        raise ValueError('El plan pertenece a otra conexión de mantenimiento.')
    ids = [v['id'] for v in plan['vehiculos']]
    if len(set(ids)) != plan['cantidad'] or any(v['vendedor_id'] is not None for v in plan['vehiculos']):
        raise ValueError('El plan debe contener exclusivamente vehículos heredados únicos.')
    db.execute("SET LOCAL lock_timeout='5s'")
    db.execute("SET LOCAL statement_timeout='30s'")
    for tabla in sorted(TABLAS):
        modo = 'ACCESS EXCLUSIVE' if tabla == 'vehiculos' and revertir else 'SHARE ROW EXCLUSIVE'
        db.execute(sql.SQL('LOCK TABLE public.{} IN {} MODE').format(sql.Identifier(tabla), sql.SQL(modo)))
    _destino(db, plan['vendedor'], bloquear=True)
    _sin_pendientes(db, ids)
    actual = _filas(db, ids)
    esperado = [{**v, 'vendedor_id': plan['vendedor']} for v in plan['vehiculos']]
    if _relaciones(db, ids) != plan['relaciones']:
        raise ValueError('Fotografías, conversaciones o relaciones cambiaron; operación detenida.')
    if actual == (plan['vehiculos'] if revertir else esperado):
        return {'estado': 'ya_revertido' if revertir else 'ya_aplicado', 'actualizados': 0, 'ids': ids}
    if actual != (esperado if revertir else plan['vehiculos']):
        raise ValueError('Vehículos modificados desde el respaldo; operación detenida.')
    if not revertir and [v['id'] for v in _filas(db)] != ids:
        raise ValueError('Cambió el conjunto de vehículos sin propietario; renovar plan.')
    if revertir:
        # Solo mantenimiento con propiedad de la tabla. DDL transaccional: ante
        # cualquier error se revierte también la desactivación de este trigger.
        trigger = db.execute("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.vehiculos'::regclass AND tgname='v72_propietario'").fetchone()
        if not trigger or trigger['tgenabled'] != 'O':
            raise ValueError('La protección de propiedad no está en el estado esperado.')
        db.execute('ALTER TABLE public.vehiculos DISABLE TRIGGER v72_propietario')
    destino = None if revertir else plan['vendedor']
    resultado = db.execute('UPDATE public.vehiculos SET vendedor_id=%s WHERE id=ANY(%s) AND vendedor_id IS NOT DISTINCT FROM %s RETURNING id',
                           (destino, ids, plan['vendedor'] if revertir else None)).fetchall()
    if revertir:
        db.execute('ALTER TABLE public.vehiculos ENABLE TRIGGER v72_propietario')
    if len(resultado) != plan['cantidad'] or _filas(db, ids) != (plan['vehiculos'] if revertir else esperado) or _relaciones(db, ids) != plan['relaciones']:
        raise ValueError('La comprobación posterior falló; rollback obligatorio.')
    return {'estado': 'revertido' if revertir else 'aplicado', 'actualizados': len(resultado), 'ids': ids}


def guardar_nuevo(ruta, contenido):
    # O_EXCL: un reintento nunca sobrescribe el respaldo original.
    fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as archivo:
        json.dump(contenido, archivo, ensure_ascii=False, indent=2)
        archivo.flush()
        os.fsync(archivo.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--seller')
    parser.add_argument('--expected-count', type=int, default=18)
    modo = parser.add_mutually_exclusive_group()
    modo.add_argument('--apply', action='store_true')
    modo.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    if args.plan.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError('El respaldo debe estar fuera del repositorio.')
    if args.apply or args.rollback:
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        # Se reserva un recibo durable ANTES del commit. Si el proceso cae,
        # repetir el mismo plan resuelve la incertidumbre por idempotencia.
        recibo = args.plan.with_name(args.plan.name + '.' + str(uuid4()) + '.recibo.json')
        guardar_nuevo(recibo, {'operacion': plan['operacion'], 'plan_sha256': plan['sha256'],
                               'modo': 'rollback' if args.rollback else 'apply', 'estado': 'iniciado'})
        with _conectar() as db:
            resultado = ejecutar(db, plan, args.rollback)
        print(json.dumps(resultado, ensure_ascii=False))
        guardar_nuevo(str(recibo) + '.confirmado', resultado)
    else:
        if not args.seller:
            parser.error('--seller UUID es obligatorio al preparar el plan')
        with _conectar() as db:
            plan = preparar(db, str(UUID(args.seller)), args.expected_count)
        guardar_nuevo(args.plan, plan)
        print(json.dumps({'estado': 'vista_previa', 'cantidad': plan['cantidad'],
                          'ids': [v['id'] for v in plan['vehiculos']], 'vendedor': plan['vendedor']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Los errores del driver pueden incluir información privada de conexión.
        print(str(error) if isinstance(error, ValueError) else
              'Operación no confirmada. Revisar permisos/conectividad y repetir el plan para comprobar el estado.', file=sys.stderr)
        sys.exit(1)
