import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../sdk/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("valida el manifiesto, las firmas y el código de TDBN Play", async () => {
  const r = await validate(root, { repo: "stanpx/tdbn-play" });
  assert.equal(r.ok, true, "La validación debe ser exitosa");
  assert.deepEqual(r.problems, [], "No debe tener problemas de validación");
  assert.ok(r.consent.some(c => c.text.includes("Firmado por su autor")), "El plugin debe estar firmado");
});
