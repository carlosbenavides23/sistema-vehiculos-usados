"use strict";

// Solo prepara archivos en el navegador. El servidor vuelve a validarlos y codificarlos.
(() => {
  const MAX_ORIGINAL = 10_000_000;
  const MAX_OPTIMIZADO = 1_000_000;
  const MAX_LADO = 1600;
  const MAX_PIXELES = 40_000_000;
  const TIPOS = new Set(["image/jpeg", "image/png", "image/webp"]);

  async function decodificar(archivo) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(archivo, { imageOrientation: "from-image" });
    }
    const url = URL.createObjectURL(archivo);
    try {
      const imagen = new Image();
      imagen.src = url;
      await imagen.decode();
      return imagen;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function codificar(canvas, calidad) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("Este navegador no puede preparar fotografías WebP. Prueba con una versión reciente de Chrome, Edge, Firefox o Safari."));
        } else resolve(blob);
      }, "image/webp", calidad);
    });
  }

  async function preparar(archivo) {
    if (!(archivo instanceof File) || !TIPOS.has(archivo.type)) {
      throw new Error("Selecciona un archivo JPEG, PNG o WebP.");
    }
    if (!archivo.size || archivo.size > MAX_ORIGINAL) {
      throw new Error("La fotografía original debe ocupar como máximo 10 MB.");
    }
    let imagen;
    try {
      imagen = await decodificar(archivo);
    } catch (error) {
      throw new Error("No pudimos leer la fotografía. Comprueba que el archivo sea una imagen válida.");
    }
    const ancho = imagen.width || imagen.naturalWidth;
    const alto = imagen.height || imagen.naturalHeight;
    try {
      if (!ancho || !alto || ancho * alto > MAX_PIXELES) {
        throw new Error("La fotografía tiene demasiados píxeles. Usa una imagen de hasta 40 megapíxeles.");
      }
      const canvas = document.createElement("canvas");
      const escala = Math.min(1, MAX_LADO / Math.max(ancho, alto));
      let destinoAncho = Math.max(1, Math.round(ancho * escala));
      let destinoAlto = Math.max(1, Math.round(alto * escala));
      let blob;
      // Se comienza en 78 %. Si una imagen compleja excede el límite, se reduce
      // primero la calidad y después las dimensiones, siempre conservando la proporción.
      for (let paso = 0; paso < 9; paso += 1) {
        canvas.width = destinoAncho;
        canvas.height = destinoAlto;
        const contexto = canvas.getContext("2d");
        if (!contexto) throw new Error("Este navegador no permite preparar la imagen.");
        contexto.drawImage(imagen, 0, 0, destinoAncho, destinoAlto);
        const calidad = paso < 3 ? [0.78, 0.68, 0.58][paso] : 0.78;
        blob = await codificar(canvas, calidad);
        if (blob.size <= MAX_OPTIMIZADO) break;
        if (paso >= 2) {
          destinoAncho = Math.max(1, Math.floor(destinoAncho * 0.8));
          destinoAlto = Math.max(1, Math.floor(destinoAlto * 0.8));
        }
      }
      if (!blob || blob.size > MAX_OPTIMIZADO) {
        throw new Error("No pudimos reducir la fotografía al tamaño permitido. Prueba con otra imagen.");
      }
      const nombre = (archivo.name.replace(/\.[^.]*$/, "").slice(0, 80) || "vehiculo") + ".webp";
      return {
        archivo: new File([blob], nombre, { type: "image/webp" }),
        ancho: canvas.width,
        alto: canvas.height,
        nombreOriginal: archivo.name,
      };
    } finally {
      if (typeof imagen.close === "function") imagen.close();
    }
  }

  window.Fotografias = Object.freeze({ preparar, MAX_ORIGINAL, MAX_OPTIMIZADO, MAX_LADO });
})();
