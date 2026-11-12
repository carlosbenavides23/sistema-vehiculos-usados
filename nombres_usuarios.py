"""Validación compartida de nombres visibles de cuentas."""

import unicodedata


def normalizar_nombre_visible(valor):
    if not isinstance(valor, str):
        raise ValueError("El nombre visible debe ser texto.")
    if any(unicodedata.category(caracter) == "Cc" for caracter in valor):
        raise ValueError("El nombre visible no puede contener caracteres de control.")
    nombre = " ".join(valor.split())
    if not 2 <= len(nombre) <= 40:
        raise ValueError("El nombre visible debe tener entre 2 y 40 caracteres.")
    return nombre
