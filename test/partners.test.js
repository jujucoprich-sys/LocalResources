import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPartners, partnersForPage } from "../src/partners.js";

test("partners: missing file means no partners yet", () => {
  assert.deepEqual(loadPartners("/nonexistent/partners.json"), { partners: [], errors: [] });
});

test("partners: valid rows load, bad rows are skipped with a reason", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nextstep-")), "partners.json");
  fs.writeFileSync(file, JSON.stringify([
    { name: "Good Hospital Case Management", phone: "212-555-0100", hours: "Mon-Fri 09:00-17:00", borough: "Bronx" },
    { name: "No Contact" },
    { name: "Bad Link", intake_url: "http://insecure.example" },
    { name: "Bad Hours", phone: "212-555-0101", hours: "mornings" },
  ]));
  const { partners, errors } = loadPartners(file);
  assert.deepEqual(partners.map((p) => p.name), ["Good Hospital Case Management"]);
  assert.equal(errors.length, 3);
  const [p] = partnersForPage(partners, new Date("2026-10-07T18:30:00Z")); // Wed 2:30pm NYC
  assert.equal(p.open.state, "open");
});

test("partners: the example file is valid", () => {
  const { partners, errors } = loadPartners("data/partners.example.json");
  assert.equal(partners.length, 1);
  assert.deepEqual(errors, []);
});
