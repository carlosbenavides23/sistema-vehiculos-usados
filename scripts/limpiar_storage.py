"""Previsualiza objetos huérfanos elegibles; --apply confirma su limpieza."""

import argparse
from pathlib import Path
import sys

from dotenv import load_dotenv


RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
load_dotenv(RAIZ / ".env")

from almacenamiento import limpiar_pendientes  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="elimina solo rutas elegibles de la cola")
    parser.add_argument("--limite", type=int, default=10, choices=range(1, 101), metavar="1..100")
    argumentos = parser.parse_args()
    try:
        resultado = limpiar_pendientes(limite=argumentos.limite, aplicar=argumentos.apply)
    except Exception as error:
        print(f"No se pudo consultar o procesar la cola ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(
        f"{'Aplicación' if argumentos.apply else 'Previsualización sin borrar'}: "
        f"{resultado['pendientes']} pendientes; {resultado['eliminados']} eliminados; "
        f"{resultado['fallidos']} fallidos."
    )
    return 1 if resultado["fallidos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
