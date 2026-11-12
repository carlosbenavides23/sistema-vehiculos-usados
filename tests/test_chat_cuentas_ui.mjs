import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../static/js/vendedor-chat-cuentas.js", import.meta.url), "utf8");

test("el polling busca el panel del vendedor como selector y tolera que aún no exista", () => {
  assert.match(script, /const panel = document\.querySelector\('\[data-admin-panel="account-conversations"\]'\)/);
  assert.match(script, /panel && !panel\.hidden/);
  assert.doesNotMatch(script, /one\('\[data-admin-panel="account-conversations"\]'\)\.hidden/);
});
