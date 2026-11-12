"""Servidor Flask local para verificar la interfaz V7.1 sin llamar a Supabase."""
import json
import os
import sys
import threading
from types import SimpleNamespace
from werkzeug.serving import make_server

os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ.pop("VERCEL_ENV", None)
os.environ.pop("VERCEL", None)
os.environ.setdefault("FLASK_SECRET_KEY", "v75-ui-fixture-secret-only-not-for-production")
sys.path.insert(0, os.getcwd())

from app import create_app


def main():
    app = create_app({
        "TESTING": True,
        "SECRET_KEY": os.environ["FLASK_SECRET_KEY"],
        "USER_AUTH_ENABLED": True,
        "SESSION_COOKIE_SECURE": False,
        "CUENTA_AUTH": SimpleNamespace(),
        "CUENTA_REPO": {
            "leer_sesion": lambda _sid: None,
            "obtener_rol": lambda _uid: None,
            "obtener_nombre_visible": lambda _uid: None,
            "establecer_nombre_visible": lambda *_args: None,
            "guardar_sesion": lambda *_args: None,
            "borrar_sesion": lambda *_args: None,
        },
    })
    server = make_server("127.0.0.1", 0, app, threaded=True)
    print("AUTH_UI_SERVER " + json.dumps({"url": f"http://127.0.0.1:{server.server_port}"}), flush=True)
    threading.Thread(target=lambda: (sys.stdin.readline(), server.shutdown()), daemon=True).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
