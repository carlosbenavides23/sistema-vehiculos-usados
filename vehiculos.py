"""Validación pura de los campos del formulario y de exports antiguos."""

from datetime import date
from decimal import Decimal
import re


MAX_ENTERO_SEGURO = 9_007_199_254_740_991
MAX_VEHICULOS = 500
CAMPOS_REQUERIDOS = {
    "marca", "modelo", "anio", "kilometraje", "precio_venta",
    "ubicacion", "descripcion", "disponibilidad",
}
CAMPOS_TEXTO_OPCIONALES = {
    "color": 40,
    "placa": 20,
    "tipo_vehiculo": 40,
    "transmision": 30,
    "combustible": 30,
}
CAMPOS_BOOLEANOS_OPCIONALES = (
    "aire_acondicionado", "ventanas_electricas", "pantalla_multimedia",
)
CAMPOS_FORMULARIO = CAMPOS_REQUERIDOS | set(CAMPOS_TEXTO_OPCIONALES) | set(CAMPOS_BOOLEANOS_OPCIONALES)
CAMPOS_VEHICULO = {
    "id", "marca", "modelo", "anio", "kilometraje", "precio_centavos",
    "ubicacion", "descripcion", "disponibilidad", *CAMPOS_TEXTO_OPCIONALES,
    *CAMPOS_BOOLEANOS_OPCIONALES, "created_at", "updated_at",
}
CAMPOS_LEGACY = {
    "id", "marca", "modelo", "anio", "kilometraje", "precio_centavos",
    "ubicacion", "descripcion", "disponibilidad", "imagen",
}


def _entero_seguro(valor, minimo=0):
    return type(valor) is int and minimo <= valor <= MAX_ENTERO_SEGURO


def _entero_formulario(valor):
    if type(valor) is int:
        return valor if _entero_seguro(valor) else None
    if not isinstance(valor, str):
        return None
    texto = valor.strip()
    if not re.fullmatch(r"[0-9]+", texto):
        return None
    significativo = texto.lstrip("0") or "0"
    if len(significativo) > 16:
        return None
    numero = int(significativo)
    return numero if _entero_seguro(numero) else None


def _precio_centavos(valor):
    if not isinstance(valor, str):
        return None
    texto = valor.strip()
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", texto):
        return None
    significativo = texto.lstrip("0") or "0"
    if len(significativo.split(".")[0]) > 14:
        return None
    centavos = int(Decimal(significativo) * 100)
    return centavos if _entero_seguro(centavos, 1) else None


def validar_vehiculo(datos):
    """Normaliza un envío del formulario y devuelve errores por campo."""
    if not isinstance(datos, dict):
        return None, {"vehiculo": "El vehículo debe ser un objeto."}
    if set(datos) - CAMPOS_FORMULARIO or CAMPOS_REQUERIDOS - set(datos):
        return None, {"vehiculo": "El vehículo contiene campos faltantes o no permitidos."}

    errores = {}
    resultado = {}
    for campo, minimo, maximo, etiqueta in (
        ("marca", 1, 60, "La marca"),
        ("modelo", 1, 60, "El modelo"),
        ("ubicacion", 1, 100, "La ubicación"),
        ("descripcion", 10, 1000, "La descripción"),
    ):
        valor = datos[campo]
        limpio = valor.strip() if isinstance(valor, str) else None
        if limpio is None or not minimo <= len(limpio) <= maximo:
            errores[campo] = f"{etiqueta} debe tener entre {minimo} y {maximo} caracteres."
        else:
            resultado[campo] = limpio

    for campo in ("anio", "kilometraje"):
        valor = _entero_formulario(datos[campo])
        if valor is None or (campo == "anio" and not 1900 <= valor <= date.today().year + 1):
            if campo == "anio":
                errores[campo] = f"El año debe ser un entero entre 1900 y {date.today().year + 1}."
            else:
                errores[campo] = "Ingresa un kilometraje entero no negativo dentro del rango permitido."
        else:
            resultado[campo] = valor

    precio = _precio_centavos(datos["precio_venta"])
    if precio is None:
        errores["precio_venta"] = "Ingresa un precio positivo con hasta dos decimales y dentro del rango permitido."
    else:
        resultado["precio_centavos"] = precio

    disponibilidad = datos["disponibilidad"]
    if disponibilidad not in ("disponible", "vendido"):
        errores["disponibilidad"] = "Selecciona disponible o vendido."
    else:
        resultado["disponibilidad"] = disponibilidad

    for campo, maximo in CAMPOS_TEXTO_OPCIONALES.items():
        valor = datos.get(campo)
        if valor is None or valor == "":
            resultado[campo] = None
        elif not isinstance(valor, str) or not 1 <= len(valor.strip()) <= maximo:
            errores[campo] = f"{campo.replace('_', ' ').capitalize()} debe tener como máximo {maximo} caracteres."
        else:
            resultado[campo] = valor.strip()

    for campo in CAMPOS_BOOLEANOS_OPCIONALES:
        valor = datos.get(campo)
        if valor in (None, "") and not isinstance(valor, (list, dict)):
            resultado[campo] = None
        elif type(valor) is bool:
            resultado[campo] = valor
        elif valor in ("true", "false"):
            resultado[campo] = valor == "true"
        else:
            errores[campo] = "Selecciona Sí, No o No especificado."

    if errores:
        return None, errores
    return resultado, {}


def validar_vehiculo_legacy(datos):
    """Valida el formato versionado usado antes de PostgreSQL."""
    if not isinstance(datos, dict) or set(datos) != CAMPOS_LEGACY:
        return None, {"vehiculo": "El vehículo antiguo contiene campos faltantes o no permitidos."}
    if not _entero_seguro(datos["id"], 1):
        return None, {"id": "El identificador antiguo debe ser entero positivo."}
    if datos["imagen"] not in (None, "/static/img/vehiculo.svg"):
        return None, {"imagen": "El export contiene una imagen no reconocida."}
    centavos = datos["precio_centavos"]
    if not _entero_seguro(centavos, 1):
        return None, {"precio_centavos": "El precio antiguo no es válido."}
    texto_precio = f"{centavos // 100}.{centavos % 100:02d}"
    formulario = {
        "marca": datos["marca"], "modelo": datos["modelo"], "anio": datos["anio"],
        "kilometraje": datos["kilometraje"], "precio_venta": texto_precio,
        "ubicacion": datos["ubicacion"], "descripcion": datos["descripcion"],
        "disponibilidad": datos["disponibilidad"],
    }
    normalizado, errores = validar_vehiculo(formulario)
    if errores:
        return None, errores
    return {"id": datos["id"], **normalizado, "imagen": datos["imagen"]}, {}


def validar_estado_legacy(estado):
    """Valida un export `vehiculos_demo_v1` sin modificarlo ni guardarlo."""
    if not isinstance(estado, dict) or set(estado) != {"version", "vehiculos"}:
        return None, {"estado": "El export debe incluir únicamente version y vehiculos."}
    if type(estado["version"]) is not int or estado["version"] != 1:
        return None, {"estado": "La versión del export no es compatible."}
    lista = estado["vehiculos"]
    if not isinstance(lista, list) or len(lista) > MAX_VEHICULOS:
        return None, {"estado": f"El export debe contener hasta {MAX_VEHICULOS} vehículos."}
    resultado = []
    ids = set()
    for indice, datos in enumerate(lista):
        vehiculo, errores = validar_vehiculo_legacy(datos)
        if errores:
            detalle = "; ".join(f"{campo}: {mensaje}" for campo, mensaje in errores.items())
            return None, {"estado": f"Vehículo {indice + 1} inválido. {detalle}"}
        if vehiculo["id"] in ids:
            return None, {"estado": "El export contiene identificadores duplicados."}
        ids.add(vehiculo["id"])
        resultado.append(vehiculo)
    return {"version": 1, "vehiculos": resultado}, {}


def respuesta_error(mensaje, errores=None):
    respuesta = {"ok": False, "mensaje": mensaje}
    if errores:
        respuesta["errores"] = errores
    return respuesta
