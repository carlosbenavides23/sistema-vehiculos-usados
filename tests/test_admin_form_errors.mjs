import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../static/js/admin-v6.js", import.meta.url), "utf8");
const start = source.indexOf("  function clearFormErrors() {");
const end = source.indexOf("\n  function updateDescriptionCount()", start);
assert.ok(start >= 0 && end > start, "Se deben poder cargar los manejadores de error del formulario V6.");
const errorHandlers = source.slice(start, end);

class Control {
  constructor(name, id = "") {
    this.name = name;
    this.id = id;
    this.dataset = {};
    this.textContent = "";
    this.hidden = false;
    this.attributes = new Map();
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() {}
}

function makeHarness() {
  const fields = [new Control("marca"), new Control("modelo")];
  fields[0].setAttribute("aria-describedby", "ayuda-marca");
  const notes = fields.map((field) => {
    const note = new Control("");
    note.dataset.errorFor = field.name;
    return note;
  });
  const formError = new Control("");
  formError.hidden = true;
  const listeners = new Map();
  const form = {
    elements: { namedItem: (name) => fields.find((field) => field.name === name) ?? null },
    addEventListener: (name, listener) => listeners.set(name, listener),
    querySelector(selector) {
      const match = selector.match(/^\[data-error-for="([^"]+)"\]$/);
      return match ? notes.find((note) => note.dataset.errorFor === match[1]) ?? null : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-error-for]") return notes;
      if (selector === "[aria-invalid='true']") return fields.filter((field) => field.getAttribute("aria-invalid") === "true");
      return [];
    },
  };
  const fieldErrorNames = new Set();
  const handlers = new vm.Script(`${errorHandlers}\n;({ clearFormErrors, recoverFormError, showFormError })`).runInNewContext({
    CSS: { escape: (value) => value },
    all: (selector, root = form) => root.querySelectorAll(selector),
    fieldErrorNames,
    form,
    formError,
    one: (selector, root = form) => root.querySelector(selector),
  });
  return { fields, notes, formError, listeners, handlers };
}

test("corrige errores de varios campos progresivamente y conserva el resumen hasta el último", () => {
  const { fields, notes, formError, listeners, handlers } = makeHarness();
  const [marca, modelo] = fields;
  handlers.showFormError("Revisá los campos indicados.", {
    marca: "Revisá la marca.",
    modelo: "Revisá el modelo.",
  });

  assert.equal(formError.hidden, false);
  assert.equal(marca.getAttribute("aria-invalid"), "true");
  assert.equal(modelo.getAttribute("aria-invalid"), "true");
  assert.equal(marca.getAttribute("aria-describedby"), "ayuda-marca vehicle-error-marca");
  assert.equal(modelo.getAttribute("aria-describedby"), "vehicle-error-modelo");

  listeners.get("input")({ target: marca });
  assert.equal(notes[0].textContent, "");
  assert.equal(marca.getAttribute("aria-invalid"), null);
  assert.equal(marca.getAttribute("aria-describedby"), "ayuda-marca");
  assert.equal(notes[1].textContent, "Revisá el modelo.");
  assert.equal(modelo.getAttribute("aria-invalid"), "true");
  assert.equal(modelo.getAttribute("aria-describedby"), "vehicle-error-modelo");
  assert.equal(formError.hidden, false);
  assert.equal(formError.textContent, "Revisá los campos indicados.");

  listeners.get("input")({ target: modelo });
  assert.equal(notes[1].textContent, "");
  assert.equal(modelo.getAttribute("aria-invalid"), null);
  assert.equal(modelo.getAttribute("aria-describedby"), null);
  assert.equal(formError.hidden, true);
  assert.equal(formError.textContent, "");
});

test("un error general del servidor se conserva hasta que se reintenta el envío", () => {
  const { fields, formError, listeners, handlers } = makeHarness();
  handlers.showFormError("No pudimos guardar el vehículo. Intentá de nuevo.");

  listeners.get("input")({ target: fields[0] });
  listeners.get("change")({ target: fields[1] });
  assert.equal(formError.hidden, false);
  assert.equal(formError.textContent, "No pudimos guardar el vehículo. Intentá de nuevo.");

  handlers.clearFormErrors();
  assert.equal(formError.hidden, true);
  assert.equal(formError.textContent, "");
});
