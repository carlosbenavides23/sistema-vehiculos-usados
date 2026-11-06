import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const helperSource = await readFile(new URL("../static/js/iconos.js", import.meta.url), "utf8");

class FakeSvgElement {
  constructor(namespace, name) {
    this.namespace = namespace;
    this.localName = name;
    this.attributes = new Map();
    this.children = [];
    this.classNames = [];
    this.classList = { add: (value) => this.classNames.push(value) };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(child) { this.children.push(child); }
}

function loadIcons() {
  const window = {};
  const document = {
    body: { dataset: { iconSprite: "/static/img/icons/lucide-sprite.svg" } },
    createElementNS: (namespace, name) => new FakeSvgElement(namespace, name),
  };
  runInNewContext(helperSource, { window, document });
  return window.AppIcons;
}

test("creates a decorative inline icon from the local sprite", () => {
  const svg = loadIcons().create("search", { size: 20 });
  assert.equal(svg.namespace, "http://www.w3.org/2000/svg");
  assert.equal(svg.localName, "svg");
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(svg.getAttribute("width"), "20");
  assert.equal(svg.getAttribute("height"), "20");
  assert.equal(svg.getAttribute("stroke"), "currentColor");
  assert.equal(svg.getAttribute("stroke-width"), "2");
  assert.equal(svg.getAttribute("stroke-linecap"), "round");
  assert.equal(svg.getAttribute("stroke-linejoin"), "round");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(svg.children[0].getAttribute("href"), "/static/img/icons/lucide-sprite.svg#search");
});

test("gives meaningful icons a text alternative without exposing SVG focus", () => {
  const svg = loadIcons().create("message-circle", { size: 24, label: "Mensajes nuevos" });
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Mensajes nuevos");
  assert.equal(svg.getAttribute("aria-hidden"), null);
  assert.equal(svg.getAttribute("focusable"), "false");
});

test("rejects unlisted icon names, sizes, and class tokens", () => {
  const create = loadIcons().create;
  assert.throws(() => create("../../external"), { name: "TypeError" });
  assert.throws(() => create("search", { size: 18 }), { name: "TypeError" });
  assert.throws(() => create("search", { className: "icon bad<script>" }), { name: "TypeError" });
  assert.doesNotMatch(helperSource, /innerHTML|insertAdjacentHTML/);
});
