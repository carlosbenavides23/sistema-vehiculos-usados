"""Carga explícita e idempotente de los seis vehículos ficticios."""

import sys
from pathlib import Path

from dotenv import load_dotenv


RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
load_dotenv(RAIZ / ".env")

from persistencia import cargar_demo_si_vacio  # noqa: E402


DEMO = [
    {
        "marca": "Toyota", "modelo": "Corolla", "anio": 2021,
        "kilometraje": 42000, "precio_centavos": 1680000,
        "ubicacion": "Managua, Nicaragua",
        "descripcion": "Sedán automático, aire acondicionado y cámara de retroceso. Un vehículo cómodo para el día a día.",
        "disponibilidad": "disponible",
    },
    {
        "marca": "Hyundai", "modelo": "Tucson", "anio": 2020,
        "kilometraje": 58000, "precio_centavos": 2150000,
        "ubicacion": "Masaya, Nicaragua",
        "descripcion": "SUV automática con amplio espacio interior, pantalla central y asientos de tela. Ideal para viajes en familia.",
        "disponibilidad": "disponible",
    },
    {
        "marca": "Suzuki", "modelo": "Swift", "anio": 2022,
        "kilometraje": 28000, "precio_centavos": 1390000,
        "ubicacion": "León, Nicaragua",
        "descripcion": "Compacto de transmisión manual, cinco puertas y aire acondicionado. Práctico para recorrer la ciudad.",
        "disponibilidad": "disponible",
    },
    {
        "marca": "Nissan", "modelo": "Frontier", "anio": 2019,
        "kilometraje": 86000, "precio_centavos": 2475000,
        "ubicacion": "Estelí, Nicaragua",
        "descripcion": "Pickup de doble cabina con transmisión manual y amplio espacio de carga. Interior cómodo y funcional.",
        "disponibilidad": "disponible",
    },
    {
        "marca": "Kia", "modelo": "Rio", "anio": 2021,
        "kilometraje": 39000, "precio_centavos": 1420000,
        "ubicacion": "Granada, Nicaragua",
        "descripcion": "Sedán automático con conectividad Bluetooth, dirección asistida y aire acondicionado. Color gris plata.",
        "disponibilidad": "vendido",
    },
    {
        "marca": "Honda", "modelo": "CR-V", "anio": 2020,
        "kilometraje": 64000, "precio_centavos": 2290000,
        "ubicacion": "Managua, Nicaragua",
        "descripcion": "SUV automática de cinco plazas con cámara de retroceso y maletero amplio. Una opción versátil y espaciosa.",
        "disponibilidad": "disponible",
    },
]


def main():
    try:
        nuevos = cargar_demo_si_vacio(DEMO)
    except Exception as error:
        print(f"No se pudo cargar la demostración ({type(error).__name__}); no se sobrescribieron registros.", file=sys.stderr)
        return 1
    if nuevos:
        print("Se cargaron los seis vehículos ficticios.")
    else:
        print("La misma demostración ya estaba cargada; no se insertaron duplicados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
