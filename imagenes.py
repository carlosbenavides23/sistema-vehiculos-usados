"""Decodificación y recodificación de imágenes, sin confiar en MIME o extensión."""

from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_ARCHIVO_RECIBIDO = 1_000_000
MAX_DIMENSION = 1600
MAX_PIXELES = 40_000_000
CALIDAD_WEBP = 78
FORMATOS_ADMITIDOS = {"JPEG", "PNG", "WEBP"}


def normalizar_imagen(contenido):
    """Devuelve bytes WebP limpios y metadatos de los bytes que se guardarán.

    El navegador envía cada archivo ya comprimido; el servidor aplica límites
    propios, decodifica completamente y crea una imagen nueva sin EXIF/ICC/XMP.
    """
    if not isinstance(contenido, bytes) or not contenido:
        raise ValueError("Selecciona una fotografía JPEG, PNG o WebP válida.")
    if len(contenido) > MAX_ARCHIVO_RECIBIDO:
        raise ValueError("La fotografía optimizada no puede superar 1.000.000 bytes.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(contenido)) as original:
                if original.format not in FORMATOS_ADMITIDOS:
                    raise ValueError("Solo se permiten fotografías JPEG, PNG o WebP.")
                if getattr(original, "n_frames", 1) != 1:
                    raise ValueError("Las fotografías animadas no están permitidas.")
                ancho, alto = original.size
                if ancho < 1 or alto < 1 or ancho * alto > MAX_PIXELES:
                    raise ValueError("La fotografía excede la resolución segura de procesamiento.")
                if ancho > MAX_DIMENSION or alto > MAX_DIMENSION:
                    raise ValueError("Optimiza la fotografía a un máximo de 1600 píxeles por lado.")
                original.load()
                orientada = ImageOps.exif_transpose(original)
                modo = "RGBA" if "A" in orientada.getbands() or "transparency" in orientada.info else "RGB"
                convertida = orientada.convert(modo)
                limpia = Image.new(modo, convertida.size)
                limpia.paste(convertida)
    except ValueError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ValueError("No se pudo decodificar la fotografía de forma segura.") from error

    # La calidad permanece en 78; si recodificar aumenta el tamaño, se reduce
    # ligeramente la resolución hasta cumplir el máximo del bucket.
    for _ in range(7):
        salida = BytesIO()
        limpia.save(salida, format="WEBP", quality=CALIDAD_WEBP, method=6)
        optimizada = salida.getvalue()
        if len(optimizada) <= MAX_ARCHIVO_RECIBIDO:
            return optimizada, {
                "mime_type": "image/webp",
                "size_bytes": len(optimizada),
                "width_px": limpia.width,
                "height_px": limpia.height,
            }
        limpia = limpia.resize((max(1, int(limpia.width * .85)), max(1, int(limpia.height * .85))), Image.Resampling.LANCZOS)
    raise ValueError("No se pudo reducir la fotografía al tamaño permitido.")
