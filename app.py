"""Servidor local del segundo avance; no conserva vehículos entre solicitudes."""

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType

from vehiculos import procesar_operacion, respuesta_error


app = Flask(__name__)
app.json.ensure_ascii = False
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024


@app.get("/")
def inicio():
    return render_template("index.html")


def _operar(operacion, identificador=None):
    try:
        cuerpo = request.get_json()
    except (BadRequest, UnsupportedMediaType):
        respuesta, codigo = respuesta_error(
            "No se pudo leer la solicitud.",
            {"estado": "Envía un objeto JSON válido con Content-Type application/json."},
            400,
        )
    else:
        respuesta, codigo = procesar_operacion(operacion, cuerpo, identificador)
    return jsonify(respuesta), codigo


@app.post("/api/validar")
def validar():
    return _operar("validar")


@app.post("/api/vehiculos")
def registrar():
    return _operar("registrar")


@app.put("/api/vehiculos/<int:identificador>")
def editar(identificador):
    return _operar("editar", identificador)


@app.patch("/api/vehiculos/<int:identificador>/disponibilidad")
def cambiar_disponibilidad(identificador):
    return _operar("disponibilidad", identificador)


@app.errorhandler(HTTPException)
def error_http(error):
    if request.path.startswith("/api/"):
        if error.code == 413:
            respuesta, codigo = respuesta_error(
                "La solicitud supera el tamaño permitido.",
                {"estado": "La solicitud debe ocupar como máximo 4 MiB."},
                413,
            )
            return jsonify(respuesta), codigo
        respuesta, codigo = respuesta_error(
            "La solicitud no pudo completarse.",
            {"solicitud": "Revisa la ruta y el método de la solicitud."},
            error.code,
        )
        return jsonify(respuesta), codigo
    return error


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
