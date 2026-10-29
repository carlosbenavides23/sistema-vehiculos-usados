"""Reglas del prototipo: funciones puras, sin almacenamiento en el servidor."""

from datetime import date
from decimal import Decimal
import re


MAX_ENTERO_SEGURO = 9_007_199_254_740_991
MAX_VEHICULOS = 500
IMAGEN_DEMO = "/static/img/vehiculo.svg"
CAMPOS_CANONICOS = {
    "id", "marca", "modelo", "anio", "kilometraje", "precio_centavos",
    "ubicacion", "descripcion", "disponibilidad", "imagen",
}
CAMPOS_FORMULARIO = (CAMPOS_CANONICOS - {"id", "precio_centavos"}) | {"precio_venta"}


def _entero_seguro(valor, minimo=0):
    # bool hereda de int en Python, pero no representa un número del formulario.
    return type(valor) is int and minimo <= valor <= MAX_ENTERO_SEGURO


def _texto(valor, minimo, maximo):
    if not isinstance(valor, str):
        return None
    limpio = valor.strip()
    return limpio if minimo <= len(limpio) <= maximo else None


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
    # El contrato exige texto decimal: no se convierte desde float ni exponentes.
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


def validar_vehiculo(datos, canonico=False):
    """Devuelve (vehículo normalizado, errores); nunca cambia la entrada."""
    if not isinstance(datos, dict):
        return None, {"vehiculo": "El vehículo debe ser un objeto."}
    esperados = CAMPOS_CANONICOS if canonico else CAMPOS_FORMULARIO
    requeridos = esperados if canonico else esperados - {"imagen"}
    if set(datos) - esperados or requeridos - set(datos):
        return None, {"vehiculo": "El vehículo contiene campos faltantes o no permitidos."}

    errores = {}
    resultado = {}
    for campo, minimo, maximo, etiqueta in (
        ("marca", 1, 60, "La marca"),
        ("modelo", 1, 60, "El modelo"),
        ("ubicacion", 1, 100, "La ubicación"),
        ("descripcion", 10, 1000, "La descripción"),
    ):
        limpio = _texto(datos[campo], minimo, maximo)
        if limpio is None:
            errores[campo] = f"{etiqueta} debe tener entre {minimo} y {maximo} caracteres."
        else:
            resultado[campo] = limpio

    for campo in ("anio", "kilometraje"):
        valor = datos[campo] if canonico else _entero_formulario(datos[campo])
        if not _entero_seguro(valor):
            errores[campo] = "Ingresa un número entero no negativo dentro del rango permitido."
        elif campo == "anio" and not 1900 <= valor <= date.today().year + 1:
            errores[campo] = f"El año debe estar entre 1900 y {date.today().year + 1}."
        else:
            resultado[campo] = valor

    campo_precio = "precio_centavos" if canonico else "precio_venta"
    precio = datos[campo_precio] if canonico else _precio_centavos(datos[campo_precio])
    if not _entero_seguro(precio, 1):
        errores[campo_precio] = "Ingresa un precio positivo con hasta dos decimales y dentro del rango permitido."
    else:
        resultado["precio_centavos"] = precio

    if datos["disponibilidad"] not in ("disponible", "vendido"):
        errores["disponibilidad"] = "Selecciona disponible o vendido."
    else:
        resultado["disponibilidad"] = datos["disponibilidad"]

    imagen = datos.get("imagen")
    if imagen is not None and imagen != IMAGEN_DEMO:
        errores["imagen"] = "Usa la ilustración local de demostración o ninguna imagen."
    else:
        resultado["imagen"] = imagen

    if canonico:
        if not _entero_seguro(datos["id"], 1):
            errores["id"] = "El identificador debe ser un entero positivo seguro para JavaScript."
        else:
            resultado["id"] = datos["id"]
    return (None, errores) if errores else (resultado, {})


def validar_estado(estado):
    """Acepta exclusivamente la versión 1 y devuelve una copia normalizada."""
    if not isinstance(estado, dict) or set(estado) != {"version", "vehiculos"}:
        return None, {"estado": "El estado debe incluir únicamente version y vehiculos."}
    if type(estado["version"]) is not int or estado["version"] != 1:
        return None, {"estado": "La versión de los datos no es compatible."}
    coleccion = estado["vehiculos"]
    if not isinstance(coleccion, list) or len(coleccion) > MAX_VEHICULOS:
        return None, {"estado": f"La colección debe ser una lista de hasta {MAX_VEHICULOS} vehículos."}
    vehiculos = []
    identificadores = set()
    for indice, datos in enumerate(coleccion):
        vehiculo, errores = validar_vehiculo(datos, canonico=True)
        if errores:
            detalle = "; ".join(f"{campo}: {mensaje}" for campo, mensaje in errores.items())
            return None, {"estado": f"Vehículo {indice + 1} inválido. {detalle}"}
        if vehiculo["id"] in identificadores:
            return None, {"estado": "La colección contiene identificadores duplicados."}
        identificadores.add(vehiculo["id"])
        vehiculos.append(vehiculo)
    return {"version": 1, "vehiculos": vehiculos}, {}


def respuesta_error(mensaje, errores, codigo):
    return {"ok": False, "mensaje": mensaje, "errores": errores}, codigo


def procesar_operacion(operacion, cuerpo, identificador=None):
    """Valida primero todo el estado; aplica una operación sobre la copia válida."""
    campos = {"estado"}
    if operacion in ("registrar", "editar"):
        campos.add("vehiculo")
    elif operacion == "disponibilidad":
        campos.add("disponibilidad")
    elif operacion != "validar":
        return respuesta_error("Operación desconocida.", {"solicitud": "Operación no admitida."}, 400)
    if not isinstance(cuerpo, dict) or set(cuerpo) != campos:
        return respuesta_error("La solicitud no tiene el formato esperado.", {"estado": "Revisa los campos de la solicitud."}, 400)
    estado, errores = validar_estado(cuerpo["estado"])
    if errores:
        return respuesta_error("Los datos guardados no son válidos.", errores, 400)
    if operacion == "validar":
        return {"ok": True, "estado": estado}, 200

    posicion = None
    if operacion != "registrar":
        for indice, vehiculo in enumerate(estado["vehiculos"]):
            if vehiculo["id"] == identificador:
                posicion = indice
                break
        if posicion is None:
            return respuesta_error("No se encontró el vehículo.", {"id": "El identificador solicitado no existe."}, 404)

    if operacion == "disponibilidad":
        valor = cuerpo["disponibilidad"]
        if valor not in ("disponible", "vendido"):
            return respuesta_error("Revisa la disponibilidad.", {"disponibilidad": "Selecciona disponible o vendido."}, 422)
        estado["vehiculos"][posicion]["disponibilidad"] = valor
    else:
        vehiculo, errores = validar_vehiculo(cuerpo["vehiculo"])
        if errores:
            return respuesta_error("Revisa los campos indicados.", errores, 422)
        if operacion == "registrar":
            if len(estado["vehiculos"]) >= MAX_VEHICULOS:
                return respuesta_error("Se alcanzó el límite de la demostración.", {"vehiculo": f"Se permiten hasta {MAX_VEHICULOS} vehículos."}, 422)
            nuevo_id = max((item["id"] for item in estado["vehiculos"]), default=0) + 1
            if not _entero_seguro(nuevo_id, 1):
                return respuesta_error("No se puede asignar otro identificador.", {"id": "Se alcanzó el límite seguro de identificadores."}, 422)
            vehiculo["id"] = nuevo_id
            estado["vehiculos"].append(vehiculo)
        else:
            vehiculo["id"] = identificador
            estado["vehiculos"][posicion] = vehiculo
    return {"ok": True, "estado": estado}, 201 if operacion == "registrar" else 200
