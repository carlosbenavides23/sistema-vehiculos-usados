"""Proyección pública mínima; nunca se usa para autorizar escrituras."""
from uuid import UUID
from persistencia import _conectar, SELECCION, _normalizar_fila


def vendedores(identificadores):
    ids = list({str(UUID(str(valor))) for valor in identificadores if valor})
    if not ids:
        return {}
    with _conectar() as db:
        rows = db.execute("""SELECT p.usuario_id, p.nombre_visible
            FROM public.perfiles_usuarios p JOIN public.roles_usuarios r USING(usuario_id)
            WHERE r.rol = 'vendedor' AND p.usuario_id = ANY(%s::uuid[])""", (ids,)).fetchall()
    return {str(row['usuario_id']): dict(nombre=row['nombre_visible'],
            url='/vendedores/' + str(row['usuario_id'])) for row in rows}


def obtener(identificador):
    return vendedores([identificador]).get(str(identificador))


def publicaciones(identificador):
    with _conectar() as db:
        rows = db.execute(f"SELECT {SELECCION} FROM public.vehiculos WHERE vendedor_id = %s AND retirado_en IS NULL ORDER BY id ASC", (str(identificador),)).fetchall()
    return [_normalizar_fila(row) for row in rows]
