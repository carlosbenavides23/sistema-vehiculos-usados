import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");
const start = source.indexOf("  function mostrarFotoPreparada(");
const end = source.indexOf("\n  function galeriaTarjeta(", start);
assert.ok(start >= 0 && end > start, "Debe encontrarse la función de galería que se prueba.");
const functionSource = source.slice(start, end).trim();
const fallback = "/static/img/vehiculo.svg";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((aceptar, rechazar) => { resolve = aceptar; reject = rechazar; });
  return { promise, resolve, reject };
}

class PreloadImage {
  constructor(owner) {
    this.owner = owner;
    this.complete = false;
    this.naturalWidth = 0;
    this.currentSrc = "";
    this.onload = null;
    this.onerror = null;
    owner.preloads.push(this);
  }

  set src(value) {
    this._src = value;
    if (this.owner.cachedUrls.has(value)) {
      this.complete = true;
      this.naturalWidth = 640;
      this.currentSrc = value;
    }
  }

  get src() { return this._src; }

  load() {
    this.complete = true;
    this.naturalWidth = 640;
    this.currentSrc = this.src;
    this.onload?.();
  }

  fail() {
    this.complete = true;
    this.naturalWidth = 0;
    this.currentSrc = this.src;
    this.onerror?.();
  }
}

function crearArnes({ reducedMotion = false, animateMode = "normal" } = {}) {
  const owner = {
    image: null,
    preloads: [],
    animations: [],
    frames: [],
    cachedUrls: new Set(),
    targetFails: new Set(),
    animateMode,
    generations: new WeakMap(),
    activeAnimations: new WeakMap(),
  };
  owner.image = {
    _src: fallback,
    src: fallback,
    currentSrc: fallback,
    alt: "Ilustración de respaldo",
    complete: true,
    naturalWidth: 560,
    isConnected: true,
    onload: null,
    onerror: null,
    set src(value) {
      this._src = value;
      this.currentSrc = value;
      if (owner.targetFails.has(value)) {
        this.complete = false;
        this.naturalWidth = 0;
      } else {
        this.complete = true;
        this.naturalWidth = value === fallback ? 560 : 1280;
      }
    },
    get src() { return this._src; },
    animate(keyframes, options) {
      if (owner.animateMode === "throw") throw new Error("animate() no disponible");
      const finished = deferred();
      const animation = {
        keyframes,
        options,
        finished: finished.promise,
        cancelled: false,
        cancel() { this.cancelled = true; finished.reject(new Error("cancelled")); },
        finish() { finished.resolve(); },
      };
      owner.animations.push(animation);
      if (owner.animateMode === "reject") finished.reject(new Error("animation rejected"));
      return animation;
    },
  };
  const context = vm.createContext({
    generacionesFoto: owner.generations,
    animacionesFoto: owner.activeAnimations,
    urlFotoSegura: (url) => url,
    duracionMovimiento: () => 180,
    curvaMovimiento: (_name, fallbackValue) => fallbackValue,
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    Image: class extends PreloadImage { constructor() { super(owner); } },
    requestAnimationFrame: (callback) => owner.frames.push(callback),
  });
  const show = vm.runInContext(`(${functionSource})`, context);
  return { ...owner, show };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function mostrar(arnes, url, state) {
  state.busy = true;
  state.counter = `Esperando ${url}`;
  arnes.show(
    arnes.image,
    url,
    `Fotografía ${url}`,
    () => {
      state.failures += 1;
      arnes.image.src = fallback;
      arnes.image.alt = "Ilustración de respaldo";
      state.counter = `No disponible ${url}`;
      state.busy = false;
    },
    () => {
      state.completions += 1;
      state.counter = `Cargada ${url}`;
      state.busy = false;
    },
  );
}

function resolverCargaActual(arnes) {
  const load = arnes.image.onload;
  load?.();
  for (const frame of arnes.frames.splice(0)) frame();
}

test("una precarga desde caché cambia la foto antes del fundido y completa una sola vez", async () => {
  const arnes = crearArnes();
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/cached.svg");
  mostrar(arnes, "/photo/cached.svg", state);

  assert.equal(arnes.image.src, "/photo/cached.svg", "La fotografía no espera a que termine WAAPI.");
  assert.equal(state.busy, true, "El estado ocupado espera al evento de carga de la imagen presentada.");
  resolverCargaActual(arnes);
  await flushMicrotasks();

  assert.equal(arnes.image.alt, "Fotografía /photo/cached.svg");
  assert.equal(arnes.animations.length, 1, "Se inicia un único fundido de entrada.");
  assert.equal(state.completions, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.busy, false);
  assert.equal(arnes.animations[0].keyframes[0].opacity, 0.84);

  resolverCargaActual(arnes);
  await flushMicrotasks();
  assert.equal(state.completions, 1, "load/RAF repetidos no duplican la finalización.");
  assert.equal(arnes.animations.length, 1);
});

test("una imagen lenta conserva la anterior hasta completar la precarga", () => {
  const arnes = crearArnes();
  const state = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/slow.svg", state);
  const precarga = arnes.preloads[0];
  assert.equal(arnes.image.src, fallback);
  assert.equal(state.busy, true);

  precarga.load();
  assert.equal(arnes.image.src, "/photo/slow.svg");
  resolverCargaActual(arnes);
  assert.equal(state.completions, 1);
  assert.equal(state.busy, false);
});

test("una navegación rápida cancela la animación anterior e ignora una precarga obsoleta", async () => {
  const arnes = crearArnes();
  const oldState = { busy: false, completions: 0, failures: 0 };
  const currentState = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/old.svg");
  mostrar(arnes, "/photo/old.svg", oldState);
  resolverCargaActual(arnes);
  const oldAnimation = arnes.animations[0];

  mostrar(arnes, "/photo/current.svg", currentState);
  assert.equal(oldAnimation.cancelled, true);
  const currentPreload = arnes.preloads[1];
  arnes.preloads[0].fail();
  assert.equal(arnes.image.src, "/photo/old.svg", "La imagen anterior se conserva hasta preparar la siguiente.");
  assert.equal(currentState.busy, true);
  currentPreload.load();
  const currentLoad = arnes.image.onload;
  currentLoad?.();
  for (const frame of arnes.frames.splice(0)) frame();
  await flushMicrotasks();

  assert.equal(arnes.image.src, "/photo/current.svg");
  assert.equal(arnes.image.alt, "Fotografía /photo/current.svg");
  assert.equal(oldState.failures, 0);
  assert.equal(currentState.completions, 1);
  assert.equal(currentState.failures, 0);
  assert.equal(currentState.busy, false);
});

test("un fallo de precarga obsoleto no cambia la fotografía vigente que sigue cargando", async () => {
  const arnes = crearArnes();
  const oldState = { busy: false, completions: 0, failures: 0 };
  const currentState = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/old-slow.svg", oldState);
  const oldPreload = arnes.preloads[0];
  mostrar(arnes, "/photo/current-slow.svg", currentState);
  const currentPreload = arnes.preloads[1];
  oldPreload.fail();
  await flushMicrotasks();

  assert.equal(currentState.busy, true);
  assert.equal(currentState.failures, 0);
  assert.equal(arnes.image.src, fallback);
  currentPreload.load();
  resolverCargaActual(arnes);
  assert.equal(arnes.image.src, "/photo/current-slow.svg");
  assert.equal(oldState.failures, 0);
  assert.equal(currentState.completions, 1);
  assert.equal(currentState.failures, 0);
  assert.equal(currentState.busy, false);
});

test("un error en una carga vigente restablece la ilustración de respaldo", async () => {
  const arnes = crearArnes();
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/broken-target.svg");
  arnes.targetFails.add("/photo/broken-target.svg");
  mostrar(arnes, "/photo/broken-target.svg", state);
  arnes.image.onerror?.();
  await flushMicrotasks();

  assert.equal(arnes.image.src, fallback);
  assert.equal(arnes.image.alt, "Ilustración de respaldo");
  assert.equal(state.failures, 1);
  assert.equal(state.completions, 0);
  assert.equal(state.busy, false);
});

test("movimiento reducido muestra la fotografía sin crear animaciones", () => {
  const arnes = crearArnes({ reducedMotion: true });
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/no-motion.svg");
  mostrar(arnes, "/photo/no-motion.svg", state);
  resolverCargaActual(arnes);

  assert.equal(arnes.image.src, "/photo/no-motion.svg");
  assert.equal(arnes.animations.length, 0);
  assert.equal(state.completions, 1);
  assert.equal(state.busy, false);
});

test("una imagen desconectada muestra contenido y omite WAAPI", () => {
  const arnes = crearArnes({ animateMode: "throw" });
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.image.isConnected = false;
  arnes.cachedUrls.add("/photo/detached.svg");
  mostrar(arnes, "/photo/detached.svg", state);
  resolverCargaActual(arnes);

  assert.equal(arnes.image.src, "/photo/detached.svg");
  assert.equal(arnes.animations.length, 0);
  assert.equal(state.completions, 1);
  assert.equal(state.busy, false);
});

test("una excepción síncrona de animate() no bloquea una foto conectada", () => {
  const arnes = crearArnes({ animateMode: "throw" });
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/no-animation.svg");
  mostrar(arnes, "/photo/no-animation.svg", state);
  resolverCargaActual(arnes);

  assert.equal(arnes.image.src, "/photo/no-animation.svg");
  assert.equal(arnes.image.alt, "Fotografía /photo/no-animation.svg");
  assert.equal(arnes.animations.length, 0);
  assert.equal(state.completions, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.busy, false);
});

test("el rechazo de WAAPI no deshace ni bloquea una fotografía ya presentada", async () => {
  const arnes = crearArnes({ animateMode: "reject" });
  const state = { busy: false, completions: 0, failures: 0 };
  arnes.cachedUrls.add("/photo/rejected-animation.svg");
  mostrar(arnes, "/photo/rejected-animation.svg", state);
  resolverCargaActual(arnes);
  await flushMicrotasks();

  assert.equal(arnes.image.src, "/photo/rejected-animation.svg");
  assert.equal(state.completions, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.busy, false);
  assert.equal(arnes.activeAnimations.has(arnes.image), false);
});
