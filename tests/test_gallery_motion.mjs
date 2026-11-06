import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../static/js/interfaz.js", import.meta.url), "utf8");
const start = source.indexOf("  function mostrarFotoPreparada(");
const end = source.indexOf("\n  function galeriaTarjeta(", start);
assert.ok(start >= 0 && end > start, "Debe encontrarse la función de galería que se prueba.");
const functionSource = source.slice(start, end).trim();

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
    this.onload = null;
    this.onerror = null;
    owner.preloads.push(this);
  }

  set src(value) { this._src = value; }
  get src() { return this._src; }
  load() {
    this.complete = true;
    this.naturalWidth = 640;
    this.onload?.();
  }
  fail() {
    this.complete = true;
    this.naturalWidth = 0;
    this.onerror?.();
  }
}

function crearArnes({ reducedMotion = false } = {}) {
  const owner = {
    image: null,
    preloads: [],
    animations: [],
    frames: [],
    generations: new WeakMap(),
    activeAnimations: new WeakMap(),
  };
  owner.image = {
    src: "/static/img/vehiculo.svg",
    alt: "Ilustración de respaldo",
    complete: false,
    naturalWidth: 0,
    onload: null,
    onerror: null,
    animate(keyframes, options) {
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
      return animation;
    },
  };
  owner.image._src = "/static/img/vehiculo.svg";
  Object.defineProperty(owner.image, "src", {
    get() { return this._src; },
    set(value) {
      this._src = value;
      this.complete = true;
      this.naturalWidth = value === "/static/img/vehiculo.svg" ? 640 : 1280;
    },
  });
  const context = vm.createContext({
    generacionesFoto: owner.generations,
    animacionesFoto: owner.activeAnimations,
    urlFotoSegura: (url) => url,
    duracionMovimiento: () => 180,
    curvaMovimiento: (_name, fallback) => fallback,
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
      arnes.image.src = "/static/img/vehiculo.svg";
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

test("una carga desde caché y el evento load del mismo RAF finalizan solo una vez", async () => {
  const arnes = crearArnes();
  const state = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/cached.svg", state);
  arnes.preloads[0].load();
  await flushMicrotasks();
  assert.equal(arnes.animations.length, 1, "La precarga inicia el fundido de salida.");

  arnes.animations[0].finish();
  await flushMicrotasks();
  assert.equal(arnes.image.complete, true, "La respuesta cacheada ya está disponible al asignar src.");
  assert.equal(arnes.frames.length, 1, "complete programa una comprobación de respaldo mediante RAF.");
  const loadEvent = arnes.image.onload;
  assert.equal(typeof loadEvent, "function");

  // El evento load llega antes del RAF, pero el navegador ya conservó la referencia del callback.
  loadEvent();
  arnes.frames[0]();
  await flushMicrotasks();
  assert.equal(arnes.animations.length, 2, "El evento y el RAF deben iniciar una sola entrada.");
  arnes.animations[1].finish();
  await flushMicrotasks();
  assert.equal(state.completions, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.busy, false);

  loadEvent();
  arnes.frames[0]();
  await flushMicrotasks();
  assert.equal(arnes.animations.length, 2);
  assert.equal(state.completions, 1, "La finalización de la generación es idempotente.");
});

test("navegación rápida cancela la animación anterior e ignora sus callbacks obsoletos", async () => {
  const arnes = crearArnes();
  const oldState = { busy: false, completions: 0, failures: 0 };
  const currentState = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/old.svg", oldState);
  arnes.preloads[0].load();
  await flushMicrotasks();
  const oldExit = arnes.animations[0];

  mostrar(arnes, "/photo/current.svg", currentState);
  assert.equal(oldExit.cancelled, true, "La nueva generación cancela la animación anterior.");
  oldExit.finish();
  await flushMicrotasks();
  assert.equal(arnes.image.src, "/static/img/vehiculo.svg");
  assert.equal(arnes.image.alt, "Ilustración de respaldo");
  assert.equal(arnes.animations.length, 1, "La generación antigua no debe actualizar la imagen.");

  arnes.preloads[1].load();
  await flushMicrotasks();
  const currentExit = arnes.animations[1];
  currentExit.finish();
  await flushMicrotasks();
  const currentLoad = arnes.image.onload;
  currentLoad();
  arnes.frames.at(-1)();
  await flushMicrotasks();
  assert.equal(arnes.animations.length, 3);
  arnes.animations[2].finish();
  await flushMicrotasks();
  assert.equal(arnes.image.src, "/photo/current.svg");
  assert.equal(arnes.image.alt, "Fotografía /photo/current.svg");
  assert.equal(oldState.completions, 0);
  assert.equal(oldState.failures, 0);
  assert.equal(currentState.completions, 1);
  assert.equal(currentState.failures, 0);
  assert.equal(currentState.busy, false);
});

test("el fallo de una precarga obsoleta no pone la galería vigente en error", async () => {
  const arnes = crearArnes();
  const oldState = { busy: false, completions: 0, failures: 0 };
  const currentState = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/slow.svg", oldState);
  const stalePreload = arnes.preloads[0];
  mostrar(arnes, "/photo/current-broken.svg", currentState);
  stalePreload.fail();
  await flushMicrotasks();
  assert.equal(oldState.failures, 0);
  assert.equal(currentState.failures, 0);
  assert.equal(currentState.busy, true, "El fallo antiguo no debe liberar el estado ocupado de la foto actual.");
  assert.equal(arnes.image.src, "/static/img/vehiculo.svg");
  assert.equal(arnes.image.alt, "Ilustración de respaldo");
  assert.equal(currentState.counter, "Esperando /photo/current-broken.svg");

  arnes.preloads[1].load();
  await flushMicrotasks();
  arnes.animations.at(-1).finish();
  await flushMicrotasks();
  const targetError = arnes.image.onerror;
  targetError();
  await flushMicrotasks();
  assert.equal(arnes.image.src, "/static/img/vehiculo.svg");
  assert.equal(arnes.image.alt, "Ilustración de respaldo");
  assert.equal(currentState.failures, 1);
  assert.equal(currentState.completions, 0);
  assert.equal(currentState.busy, false);
  assert.equal(currentState.counter, "No disponible /photo/current-broken.svg");
});

test("movimiento reducido cambia la foto directamente y finaliza una sola vez", async () => {
  const arnes = crearArnes({ reducedMotion: true });
  const state = { busy: false, completions: 0, failures: 0 };
  mostrar(arnes, "/photo/no-motion.svg", state);
  const preload = arnes.preloads[0];
  preload.load();
  preload.load();
  await flushMicrotasks();
  assert.equal(arnes.image.src, "/photo/no-motion.svg");
  assert.equal(arnes.image.alt, "Fotografía /photo/no-motion.svg");
  assert.equal(arnes.animations.length, 0);
  assert.equal(state.completions, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.busy, false);
});
