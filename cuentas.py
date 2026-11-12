"""Sesiones de cuentas V7: Auth verifica identidad; PostgreSQL determina rol."""
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, g, jsonify, request, session, render_template
import auth_proveedor
from persistencia import _conectar
from roles_usuarios import obtener_rol

bp = Blueprint('cuentas', __name__)
COOKIES = ('cuenta_sid', 'cuenta_access', 'cuenta_refresh')


def guardar_sesion(usuario, verificador):
    with _conectar() as db, db.cursor() as cursor:
        cursor.execute('INSERT INTO public.sesiones_cuenta(verificador,usuario_id,expires_at) VALUES (%s,%s,%s)', (verificador, usuario, datetime.now(timezone.utc)+timedelta(days=7)))


def leer_sesion(verificador):
    with _conectar() as db, db.cursor() as cursor:
        cursor.execute('SELECT usuario_id FROM public.sesiones_cuenta WHERE verificador=%s AND expires_at > now()', (verificador,))
        row=cursor.fetchone()
        return str(row['usuario_id']) if row else None


def borrar_sesion(verificador):
    with _conectar() as db, db.cursor() as cursor:
        cursor.execute('DELETE FROM public.sesiones_cuenta WHERE verificador=%s', (verificador,))


def digest(valor):
    return hashlib.sha256(valor.encode()).hexdigest()


def proveedor():
    return current_app.config.get('CUENTA_AUTH') or auth_proveedor


def repo(nombre, *args):
    custom=current_app.config.get('CUENTA_REPO')
    return custom[nombre](*args) if custom else globals()[nombre](*args)


@bp.before_request
def proteger():
    if not current_app.config.get('USER_AUTH_ENABLED') or os.environ.get('VERCEL_ENV') == 'production':
        return jsonify(ok=False, mensaje='Cuentas no habilitadas en este entorno.'), 404
    if request.method == 'POST':
        token=request.headers.get('X-CSRF-Token', '')
        esperado=session.get('csrf_token', '')
        if not esperado or not hmac.compare_digest(token, esperado):
            return jsonify(ok=False, mensaje='Recargá la página para continuar.'), 403


@bp.after_request
def cookies(respuesta):
    respuesta.headers['Cache-Control']='no-store'
    secure=current_app.config['SESSION_COOKIE_SECURE'] or request.is_secure
    if getattr(g,'cuenta_clear',False):
        for name in COOKIES: respuesta.delete_cookie(name, path='/', secure=secure, httponly=True, samesite='Lax')
    for name,value in getattr(g,'cuenta_cookies',{}).items():
        respuesta.set_cookie(name,value,max_age=604800,secure=secure,httponly=True,samesite='Lax',path='/')
    return respuesta


def identidad():
    sid=request.cookies.get('cuenta_sid','')
    if not sid or len(sid)>128: return None
    usuario=repo('leer_sesion',digest(sid))
    if not usuario: return None
    access=request.cookies.get('cuenta_access','')
    try:
        user=proveedor().usuario(access)
    except auth_proveedor.ErrorAuth:
        refresh=request.cookies.get('cuenta_refresh','')
        if not refresh: return None
        tokens=proveedor().renovar(refresh)
        access=tokens['access_token']
        user=proveedor().usuario(access)
        g.cuenta_cookies={'cuenta_access':access,'cuenta_refresh':tokens['refresh_token']}
    if str(user.get('id'))!=usuario:
        g.cuenta_cookies={}
        return None
    rol=repo('obtener_rol',usuario)
    if rol not in ('comprador','vendedor'): return None
    return {'id':usuario,'email':user.get('email'),'rol':rol}


@bp.errorhandler(Exception)
def fallo(error):
    # Nunca devolver mensajes del proveedor, tokens ni argumentos del driver.
    return jsonify(ok=False,mensaje='No pudimos completar el acceso. Revisá los datos o intentá más tarde.'), error.status if isinstance(error,auth_proveedor.ErrorAuth) else 503


def establecer(tokens):
    access=tokens.get('access_token')
    if not access or not tokens.get('refresh_token'):
        return jsonify(ok=True,mensaje='Revisá tu correo si el proyecto requiere confirmación.'), 202
    user=proveedor().usuario(access)
    rol=repo('obtener_rol',user['id'])
    if rol not in ('comprador','vendedor'): raise auth_proveedor.ErrorAuth()
    sid=secrets.token_urlsafe(32)
    repo('guardar_sesion',user['id'],digest(sid))
    g.cuenta_cookies=dict(zip(COOKIES,(sid,access,tokens['refresh_token'])))
    return jsonify(ok=True,usuario={'id':user['id'],'email':user.get('email'),'rol':rol})


@bp.post('/api/cuenta/<accion>')
def acceso(accion):
    if accion not in ('registro','login','logout'): return jsonify(ok=False),404
    if accion=='logout':
        sid=request.cookies.get('cuenta_sid','')
        if sid: repo('borrar_sesion',digest(sid))
        g.cuenta_clear=True
        try: proveedor().salir(request.cookies.get('cuenta_access',''))
        except auth_proveedor.ErrorAuth:
            return jsonify(ok=True,mensaje='Sesión local cerrada; no se pudo confirmar la revocación remota.'),200
        return jsonify(ok=True,mensaje='Sesión cerrada.')
    body=request.get_json(silent=True)
    keys={'email','password','rol'} if accion=='registro' else {'email','password'}
    if not isinstance(body,dict) or set(body)!=keys: return jsonify(ok=False,mensaje='Revisá los campos.'),400
    email=body['email']; password=body['password']
    if not isinstance(email,str) or len(email)>254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or not isinstance(password,str) or not 8<=len(password)<=128:
        return jsonify(ok=False,mensaje='Ingresá un correo válido y una contraseña de 8 a 128 caracteres.'),422
    if accion=='registro':
        if body['rol'] not in ('comprador','vendedor'): return jsonify(ok=False,mensaje='Elegí comprador o vendedor.'),422
        return establecer(proveedor().registrar(email,password,body['rol']))
    return establecer(proveedor().login(email,password))


@bp.get('/api/cuenta')
def estado():
    user=identidad()
    return (jsonify(ok=True,usuario=user),200) if user else (jsonify(ok=False,mensaje='Iniciá sesión para continuar.'),401)


@bp.get('/cuenta')
@bp.get('/cuenta/<rol>')
def pagina(rol=None):
    if rol:
        user=identidad()
        if not user: return jsonify(ok=False,mensaje='Iniciá sesión para continuar.'),401
        if rol not in ('comprador','vendedor') or user['rol']!=rol: return jsonify(ok=False,mensaje='Acceso no permitido.'),403
    session.setdefault('csrf_token',secrets.token_urlsafe(32))
    return render_template('cuenta.html',csrf_token=session['csrf_token'])
