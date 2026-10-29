"""Copia los recursos locales al directorio CDN de Vercel sin importar Flask."""

from pathlib import Path
from shutil import copyfile


def preparar_recursos(raiz=None):
    raiz = Path(raiz or Path(__file__).resolve().parents[1]).resolve()
    origen = raiz / "static"
    destino = raiz / "public" / "static"
    if not origen.is_dir():
        raise RuntimeError("No se encontró el directorio static.")
    if (raiz / "public").is_symlink() or destino.is_symlink():
        raise RuntimeError("El destino de recursos no puede ser un enlace.")
    archivos = list(origen.rglob("*"))
    if any(archivo.is_symlink() for archivo in archivos):
        raise RuntimeError("Los recursos no pueden incluir enlaces.")
    cantidad = 0
    for archivo in archivos:
        if not archivo.is_file():
            continue
        copia = destino / archivo.relative_to(origen)
        if not copia.resolve().is_relative_to(destino.resolve()):
            raise RuntimeError("Ruta de recurso fuera del destino permitido.")
        copia.parent.mkdir(parents=True, exist_ok=True)
        copyfile(archivo, copia)
        cantidad += 1
    return cantidad


if __name__ == "__main__":
    print(f"Recursos preparados para el CDN: {preparar_recursos()} archivos.")
