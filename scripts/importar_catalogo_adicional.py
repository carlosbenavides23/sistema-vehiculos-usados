"""Valida y carga un catálogo JSON; sin --apply solo consulta y previsualiza."""

import argparse
import json
from pathlib import Path
import sys

from dotenv import load_dotenv


RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
load_dotenv(RAIZ / ".env")

from persistencia import importar_catalogo_si_nuevo  # noqa: E402
from vehiculos import validar_vehiculo  # noqa: E402


def leer_y_validar(ruta):
    """Carga los campos del formulario y normaliza precio al formato de DB."""
    try:
        propuestas = json.loads(Path(ruta).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("No se pudo leer el archivo JSON del catálogo.") from error
    if not isinstance(propuestas, list):
        raise ValueError("El catálogo debe ser una lista JSON de vehículos.")

    normalizados = []
    for indice, propuesta in enumerate(propuestas, start=1):
        vehiculo, errores = validar_vehiculo(propuesta)
        if errores:
            detalle = "; ".join(f"{campo}: {mensaje}" for campo, mensaje in errores.items())
            raise ValueError(f"Vehículo {indice} inválido: {detalle}")
        normalizados.append(vehiculo)
    return normalizados


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "archivo", nargs="?", type=Path,
        default=RAIZ / "data" / "catalogo_adicional_10.json",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Inserta los candidatos; úsalo únicamente tras aprobación explícita y revisar la vista previa.",
    )
    argumentos = parser.parse_args(argv)
    try:
        vehiculos = leer_y_validar(argumentos.archivo)
        resultado = importar_catalogo_si_nuevo(vehiculos, aplicar=argumentos.apply)
    except ValueError as error:
        print(f"Importación cancelada ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(
            f"Importación cancelada ({type(error).__name__}); se omitieron los detalles de conexión.",
            file=sys.stderr,
        )
        return 1

    print(
        f"Modo: {resultado['modo']}; candidatos nuevos: {resultado['candidatos']}; "
        f"insertados: {resultado['insertados']}; existentes omitidos: {resultado['omitidos']}."
    )
    if not argumentos.apply:
        print("No se escribió ningún registro. Revisa los candidatos antes de autorizar --apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
