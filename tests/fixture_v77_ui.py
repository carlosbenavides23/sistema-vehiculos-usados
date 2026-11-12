"""Flask + PostgreSQL loopback con contenido ficticio para Playwright V7.7."""

import json
import os
from pathlib import Path
import socket
import sys
from threading import Thread

from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
from app import create_app
import persistencia
from test_postgres_integracion import base_aislada, datos


def _vehiculo(numero, marca, modelo, tipo, **opcionales):
    fila = datos(numero)
    fila.update({"marca": marca, "modelo": modelo, "tipo_vehiculo": tipo, **opcionales})
    return persistencia.crear_vehiculo(fila)


def main():
    with base_aislada() as _dsn:
        _vehiculo(
            1, "Toyota", "RAV4", "suv", version="Limited",
            motor="<img src=x onerror=alert(1)>", numero_puertas=5,
            capacidad_pasajeros=5, camara_reversa=True, bluetooth=False,
        )
        _vehiculo(2, "Subaru", "Legacy Wagon", "Station Wagon clásico")
        _vehiculo(3, "Honda", "Fit", "hatchback", version=None, motor=None)
        aplicacion = create_app({
            "TESTING": False,
            "SECRET_KEY": "v77-playwright-fixture-only",
            "ADMIN_PASSWORD_HASH": generate_password_hash("v77-fixture-password"),
            "APP_READ_ONLY": False,
            "CHAT_ENABLED": False,
            "USER_AUTH_ENABLED": False,
            "SESSION_COOKIE_SECURE": False,
        })
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            puerto = listener.getsockname()[1]
        servidor = make_server("127.0.0.1", puerto, aplicacion, threaded=True)
        hilo = Thread(target=servidor.serve_forever, daemon=True)
        hilo.start()
        print("V77_SERVER " + json.dumps({"url": f"http://127.0.0.1:{puerto}"}), flush=True)
        try:
            sys.stdin.readline()
        finally:
            servidor.shutdown()
            hilo.join(timeout=5)
            servidor.server_close()


if __name__ == "__main__":
    main()
