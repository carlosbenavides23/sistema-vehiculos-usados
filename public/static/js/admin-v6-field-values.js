"use strict";

(function (root, createApi) {
  const api = createApi();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AdminV6FieldValues = api;
})(globalThis, function () {
  const originalValues = new WeakMap();

  function clearHistoricalValue(select) {
    Array.from(select.options).forEach((option) => {
      if (option.dataset?.adminV6Historical === "true") option.remove();
    });
    originalValues.delete(select);
  }

  function setPreservingCurrentValue(select, value) {
    clearHistoricalValue(select);
    const original = value === null || value === undefined || value === "" ? null : String(value);
    originalValues.set(select, original);

    if (original === null) {
      select.value = "";
      return;
    }

    let option = Array.from(select.options).find((candidate) => candidate.value === original);
    if (!option) {
      option = select.ownerDocument.createElement("option");
      option.value = original;
      option.textContent = `${original} (valor actual)`;
      option.dataset.adminV6Historical = "true";
      select.insertBefore(option, select.options[1] || null);
    }
    select.value = original;
  }

  function serializedValue(select) {
    if (originalValues.has(select)) {
      const original = originalValues.get(select);
      if (select.value === (original ?? "")) return original;
    }
    return select.value.trim() || null;
  }

  return Object.freeze({ clearHistoricalValue, setPreservingCurrentValue, serializedValue });
});
