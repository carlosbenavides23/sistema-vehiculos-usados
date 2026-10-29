"""Previsualiza o importa una exportación versionada de localStorage."""

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv


RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
load_dotenv(RAIZ / ".env")

from persistencia import importar_legacy_si_nuevo  # noqa: E402
from vehiculos import validar_estado_legacy  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archivo", type=Path, help="JSON exportado desde vehiculos_demo_v1")
    parser.add_argument(
        "--apply", action="store_true",
        help="confirma la importación; sin esta opción solo se previsualiza",
    )
    argumentos = parser.parse_args()

    try:
        contenido = argumentos.archivo.read_text(encoding="utf-8")
        export = json.loads(contenido)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"No se pudo leer el export ({type(error).__name__}).", file=sys.stderr)
        return 2

    normalizado, errores = validar_estado_legacy(export)
    if errores:
        print(f"Export rechazado: {errores['estado']}", file=sys.stderr)
        return 2

    vehiculos = normalizado["vehiculos"]
    try:
        resultado = importar_legacy_si_nuevo(vehiculos, aplicar=argumentos.apply)
    except Exception as error:
        print(f"Importación detenida ({type(error).__name__}); no se borraron registros.", file=sys.stderr)
        return 1

    modo = "Importación aplicada" if argumentos.apply else "Previsualización (sin escrituras)"
    print(
        f"{modo}: {len(vehiculos)} exportados; "
        f"{resultado['candidatos']} candidatos nuevos; "
        f"{resultado['omitidos']} coincidencias exactas omitidas."
    )
    if not argumentos.apply and resultado["candidatos"]:
        print("Revisa el respaldo y ejecuta de nuevo con --apply para confirmar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
