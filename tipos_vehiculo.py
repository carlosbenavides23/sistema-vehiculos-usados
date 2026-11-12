"""Catálogo canónico y compatibilidad de categorías de carrocería."""

import re
import unicodedata


TIPOS_VEHICULO = (
    {"codigo": "sedan", "etiqueta": "Sedán", "alias": ("sedan", "sedán")},
    {"codigo": "hatchback", "etiqueta": "Hatchback", "alias": ("hatchback", "hatch back")},
    {"codigo": "suv", "etiqueta": "SUV", "alias": ("suv", "sport utility vehicle")},
    {"codigo": "pickup", "etiqueta": "Pickup", "alias": ("pickup", "pick-up")},
    {"codigo": "coupe", "etiqueta": "Coupé", "alias": ("coupe", "coupé")},
    {"codigo": "convertible", "etiqueta": "Convertible", "alias": ("convertible", "cabriolet")},
    {"codigo": "minivan", "etiqueta": "Minivan", "alias": ("minivan", "mini van")},
    {"codigo": "van_microbus", "etiqueta": "Van / Microbús", "alias": ("van", "microbus", "microbús", "van microbus", "van / microbús")},
    {"codigo": "camioneta", "etiqueta": "Camioneta", "alias": ("camioneta",)},
    {"codigo": "todoterreno", "etiqueta": "Todoterreno", "alias": ("todoterreno", "todo terreno")},
    {"codigo": "camion", "etiqueta": "Camión", "alias": ("camion", "camión")},
    {"codigo": "otro", "etiqueta": "Otro", "alias": ("otro",)},
)


def _clave(valor):
    texto = unicodedata.normalize("NFKD", valor.casefold())
    sin_acentos = "".join(caracter for caracter in texto if not unicodedata.combining(caracter))
    return " ".join(re.findall(r"[a-z0-9]+", sin_acentos))


_CODIGO_POR_CLAVE = {
    _clave(alias): tipo["codigo"]
    for tipo in TIPOS_VEHICULO
    for alias in (tipo["codigo"], tipo["etiqueta"], *tipo["alias"])
}
_TIPO_POR_CODIGO = {tipo["codigo"]: tipo for tipo in TIPOS_VEHICULO}


def normalizar_tipo_vehiculo(valor):
    """Devuelve un código canónico o None si el texto no es una categoría conocida."""
    if not isinstance(valor, str):
        return None
    return _CODIGO_POR_CLAVE.get(_clave(valor))


def etiqueta_tipo_vehiculo(valor):
    """Presenta alias históricos con su etiqueta; conserva intactos los desconocidos."""
    codigo = normalizar_tipo_vehiculo(valor)
    return _TIPO_POR_CODIGO[codigo]["etiqueta"] if codigo else valor


def variantes_tipo_vehiculo(valor):
    """Valores anteriores equivalentes a un código para filtrar durante la transición."""
    tipo = _TIPO_POR_CODIGO.get(valor)
    if tipo is None:
        return (valor,)
    return tuple(dict.fromkeys((tipo["codigo"], tipo["etiqueta"], *tipo["alias"])))


MAPA_ALIAS_TIPOS_VEHICULO = {
    _clave(alias): tipo["codigo"]
    for tipo in TIPOS_VEHICULO
    for alias in (tipo["codigo"], tipo["etiqueta"], *tipo["alias"])
}
