import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { clearHistoricalValue, setPreservingCurrentValue, serializedValue } = require("../static/js/admin-v6-field-values.js");

class FakeOption {
  constructor(select) {
    this.select = select;
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.selected = false;
  }

  remove() {
    const index = this.select.options.indexOf(this);
    if (index >= 0) this.select.options.splice(index, 1);
    if (this.selected) this.select.value = "";
  }
}

class FakeSelect {
  constructor(labels) {
    this.options = labels.map(([value, label]) => {
      const option = new FakeOption(this);
      option.value = value;
      option.textContent = label;
      return option;
    });
    this.options[0].selected = true;
    this.ownerDocument = { createElement: (tag) => {
      assert.equal(tag, "option");
      return new FakeOption(this);
    } };
  }

  get value() {
    return this.options.find((option) => option.selected)?.value || "";
  }

  set value(value) {
    this.options.forEach((option) => { option.selected = false; });
    const match = this.options.find((option) => option.value === String(value));
    if (match) match.selected = true;
  }

  insertBefore(option, before) {
    const index = before ? this.options.indexOf(before) : -1;
    if (index < 0) this.options.push(option);
    else this.options.splice(index, 0, option);
  }
}

const transmissionOptions = [
  ["", "No especificada"], ["Automática", "Automática"], ["Manual", "Manual"], ["CVT", "CVT"],
];
const fuelOptions = [
  ["", "No especificado"], ["Gasolina", "Gasolina"], ["Diésel", "Diésel"], ["Híbrido", "Híbrido"], ["Eléctrico", "Eléctrico"],
];

test("preserva los textos históricos al editar únicamente el precio", () => {
  const transmission = new FakeSelect(transmissionOptions);
  const fuel = new FakeSelect(fuelOptions);
  setPreservingCurrentValue(transmission, "automatica");
  setPreservingCurrentValue(fuel, "gasolina");

  const precio = "19500.00";
  const payload = {
    precio_venta: precio,
    transmision: serializedValue(transmission),
    combustible: serializedValue(fuel),
  };

  assert.equal(payload.precio_venta, "19500.00");
  assert.equal(payload.transmision, "automatica");
  assert.equal(payload.combustible, "gasolina");
  assert.equal(transmission.options.find((option) => option.selected)?.textContent, "automatica (valor actual)");
  assert.equal(fuel.options.find((option) => option.selected)?.textContent, "gasolina (valor actual)");
});

test("preserva diferencias históricas de mayúsculas, tildes y formato desconocido", () => {
  const transmission = new FakeSelect(transmissionOptions);
  const fuel = new FakeSelect(fuelOptions);
  const values = [
    [transmission, "manual"],
    [transmission, "Automática de 6 velocidades"],
    [fuel, "DIÉSEL"],
    [fuel, "Gasolina/GLP"],
  ];

  for (const [select, original] of values) {
    setPreservingCurrentValue(select, original);
    assert.equal(select.value, original);
    assert.equal(serializedValue(select), original);
    assert.match(select.options.find((option) => option.selected)?.textContent, /\(valor actual\)$/);
  }
});

test("usa las opciones conocidas para valores exactos y admite cambios intencionales", () => {
  const transmission = new FakeSelect(transmissionOptions);
  const fuel = new FakeSelect(fuelOptions);
  setPreservingCurrentValue(transmission, "Manual");
  setPreservingCurrentValue(fuel, "Diésel");
  assert.equal(transmission.options.some((option) => option.dataset.adminV6Historical === "true"), false);
  assert.equal(serializedValue(transmission), "Manual");
  assert.equal(serializedValue(fuel), "Diésel");

  setPreservingCurrentValue(transmission, "automatica");
  transmission.value = "CVT";
  fuel.value = "Gasolina";
  assert.equal(serializedValue(transmission), "CVT");
  assert.equal(serializedValue(fuel), "Gasolina");
});

test("mantiene nulos y distingue borrar un valor desconocido de conservarlo", () => {
  const transmission = new FakeSelect(transmissionOptions);
  const fuel = new FakeSelect(fuelOptions);
  setPreservingCurrentValue(transmission, null);
  setPreservingCurrentValue(fuel, null);
  assert.equal(transmission.value, "");
  assert.equal(fuel.value, "");
  assert.equal(serializedValue(transmission), null);
  assert.equal(serializedValue(fuel), null);

  setPreservingCurrentValue(transmission, "Secuencial 5 velocidades");
  assert.equal(serializedValue(transmission), "Secuencial 5 velocidades");
  transmission.value = "";
  assert.equal(serializedValue(transmission), null);
});

test("limpia la opción histórica al cambiar de vehículo", () => {
  const transmission = new FakeSelect(transmissionOptions);
  setPreservingCurrentValue(transmission, "Caja manual especial");
  assert.equal(transmission.options.filter((option) => option.dataset.adminV6Historical === "true").length, 1);

  clearHistoricalValue(transmission);
  transmission.value = "";
  assert.equal(transmission.options.filter((option) => option.dataset.adminV6Historical === "true").length, 0);
  assert.equal(serializedValue(transmission), null);
});
