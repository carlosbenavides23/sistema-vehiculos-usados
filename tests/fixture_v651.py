"""Shell visual aislado para tests de V6.5.1; no conecta a servicios externos."""
from pathlib import Path

from flask import Flask, render_template

root = Path(__file__).resolve().parent.parent
app = Flask(__name__, template_folder=str(root / "templates"), static_folder=str(root / "static"))


@app.get("/administracion")
def administration():
    return render_template("admin_v6.html", csrf_token="fixture", solo_lectura=False,
                           chat_habilitado=True, max_year=2100)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5198, use_reloader=False)
