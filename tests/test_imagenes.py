"""Validación real con el decodificador Pillow; no requiere Storage remoto."""

from io import BytesIO
import struct
import unittest
import zlib

from PIL import Image

from imagenes import normalizar_imagen


def imagen_bytes(formato="PNG", tamano=(40, 25), exif=None):
    salida = BytesIO()
    imagen = Image.new("RGB", tamano, (24, 130, 80))
    opciones = {"exif": exif} if exif is not None else {}
    imagen.save(salida, format=formato, **opciones)
    return salida.getvalue()


class ImagenesTest(unittest.TestCase):
    def test_jpeg_png_y_webp_se_decodifican_y_recodifican(self):
        for formato in ("JPEG", "PNG", "WEBP"):
            with self.subTest(formato=formato):
                contenido, meta = normalizar_imagen(imagen_bytes(formato))
                with Image.open(BytesIO(contenido)) as leida:
                    leida.load()
                    self.assertEqual(leida.format, "WEBP")
                    self.assertEqual(leida.size, (40, 25))
                self.assertEqual(meta, {"mime_type": "image/webp", "size_bytes": len(contenido), "width_px": 40, "height_px": 25})

    def test_elimina_metadatos_y_aplica_orientacion_exif(self):
        exif = Image.Exif()
        exif[270] = "ubicacion-y-equipo-privados"
        exif[274] = 6
        contenido, meta = normalizar_imagen(imagen_bytes("JPEG", exif=exif))
        with Image.open(BytesIO(contenido)) as leida:
            self.assertFalse(leida.getexif())
            self.assertNotIn("icc_profile", leida.info)
            self.assertNotIn("xmp", leida.info)
        self.assertEqual((meta["width_px"], meta["height_px"]), (25, 40))
        self.assertNotIn(b"ubicacion-y-equipo-privados", contenido)

    def test_rechaza_entradas_corruptas_grandes_y_dimension_excesiva(self):
        entradas = (b"", b"<svg></svg>", b"x" * 1_000_001, imagen_bytes(tamano=(1601, 1)), imagen_bytes("JPEG")[:80])
        for contenido in entradas:
            with self.subTest(longitud=len(contenido)):
                with self.assertRaises(ValueError):
                    normalizar_imagen(contenido)

    def test_rechaza_imagen_animada(self):
        salida = BytesIO()
        primera = Image.new("RGB", (20, 20), "red")
        primera.save(salida, format="WEBP", save_all=True, append_images=[Image.new("RGB", (20, 20), "blue")], duration=100)
        with self.assertRaisesRegex(ValueError, "animadas"):
            normalizar_imagen(salida.getvalue())

    def test_cabecera_bomba_se_rechaza_sin_asignar_pixeles(self):
        def bloque(nombre, datos):
            return struct.pack(">I", len(datos)) + nombre + datos + struct.pack(">I", zlib.crc32(nombre + datos))
        cabecera = struct.pack(">IIBBBBB", 65000, 65000, 8, 2, 0, 0, 0)
        png = b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", cabecera) + bloque(b"IDAT", zlib.compress(b"")) + bloque(b"IEND", b"")
        with self.assertRaises(ValueError):
            normalizar_imagen(png)


if __name__ == "__main__":
    unittest.main()
