import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.js";
import { openStatus, parseHours } from "../src/hours.js";
import { BOROUGHS, CATEGORIES, loadListings, validateListings } from "../src/listings.js";
import { redact } from "../src/privacy.js";

// Wednesday 2026-10-07, 14:30 in New York (EDT, UTC-4).
const WED_230PM = new Date("2026-10-07T18:30:00Z");

test("csv: quoted fields, commas, escaped quotes, CRLF", () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"']]);
});

test("hours: parses ranges, lists and 24/7", () => {
  assert.equal(parseHours("Mon-Fri 09:00-17:00").schedule[3].length, 1);
  assert.deepEqual(parseHours("Tue,Thu 12:00-14:00 16:00-18:00").schedule[2], [[720, 840], [960, 1080]]);
  assert.equal(parseHours("24/7").schedule.every((d) => d.length === 1), true);
  assert.deepEqual(parseHours("Fri-Mon 10:00-11:00").schedule.map((d) => d.length), [1, 1, 0, 0, 0, 1, 1]);
});

test("hours: rejects unreadable input", () => {
  assert.ok(parseHours("weekdays 9-5").error);
  assert.ok(parseHours("Mon 9am-5pm").error);
  assert.ok(parseHours("Mon 17:00-09:00").error);
  assert.ok(parseHours("Mon").error);
});

test("hours: open/closed in New York time", () => {
  assert.equal(openStatus("Mon-Fri 09:00-17:00", WED_230PM).label, "Open now, until 5pm");
  assert.equal(openStatus("Wed 15:00-19:00", WED_230PM).label, "Closed now, opens today 3pm");
  assert.equal(openStatus("Thu 09:00-12:00", WED_230PM).label, "Closed now, opens tomorrow 9am");
  assert.equal(openStatus("Mon 09:00-12:00", WED_230PM).label, "Closed now, opens Mon 9am");
  assert.equal(openStatus("24/7", WED_230PM).label, "Open 24 hours");
  assert.equal(openStatus("", WED_230PM).state, "unknown");
});

test("listings: sample file is valid", () => {
  const { listings, errors } = loadListings("data/sample-listings.csv", WED_230PM);
  assert.deepEqual(errors, []);
  assert.equal(listings.length, 10);
});

test("listings: bad rows are excluded with a reason", () => {
  const base = { _row: 2, id: "F1", name: "X", category: "food", offers: "o", address: "a", zip: "11212", phone: "p", last_verified: "2026-10-01", hours: "Mon 09:00-10:00" };
  const { listings, errors, warnings } = validateListings(
    [
      base,
      { ...base, _row: 3 }, // duplicate id
      { ...base, _row: 4, id: "F2", category: "pets" },
      { ...base, _row: 5, id: "F3", hours: "9 to 5" },
      { ...base, _row: 6, id: "F4", address: "", phone: "", website: "" },
      { ...base, _row: 7, id: "F5", last_verified: "2026-01-01" }, // stale but usable
      { ...base, _row: 8, id: "F6", last_verified: "", address: "" }, // unverified, phone only
    ],
    WED_230PM
  );
  assert.deepEqual(listings.map((l) => l.id), ["F1", "F5", "F6"]);
  assert.equal(listings[0].verified, true);
  assert.equal(listings[2].verified, false);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /duplicate/);
  assert.match(warnings.join(), /F5.*call again/);
});

test("listings: the real call sheet loads", () => {
  const { listings, errors } = loadListings("data/listings.csv", WED_230PM);
  assert.ok(listings.length >= 60);
  assert.ok(errors.length <= 1); // H09 has no address or phone yet
  assert.ok(listings.every((l) => CATEGORIES.includes(l.category) && BOROUGHS.includes(l.borough)));
  assert.ok(listings.length >= 140);
});

test("privacy: strips phone numbers, emails, IDs, dates", () => {
  const { text, changed } = redact("call 718-555-1234 or a@b.com, DOB 3/4/1990, CIN AB12345C, MRN 1234567890");
  assert.equal(changed, true);
  assert.doesNotMatch(text, /555|a@b|1990|AB12345C|1234567890/);
  assert.equal(redact("mom with 2 kids in 11212").changed, false);
});

test("geocode script reads NYC GeoSearch results", async () => {
  const { geocode } = await import("../scripts/geocode.js");
  let asked = "";
  const fake = async (url) => {
    asked = url;
    return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: [-73.8895, 40.8633] }, properties: { confidence: 0.9, label: "2759 Webster Ave, Bronx" } }] }) };
  };
  const hit = await geocode({ address: "2759 Webster Ave", borough: "Bronx", zip: "10458" }, fake);
  assert.deepEqual(hit, { lat: "40.86330", lng: "-73.88950", label: "2759 Webster Ave, Bronx" });
  assert.match(asked, /geosearch\.planninglabs\.nyc\/v2\/search\?text=2759\+Webster\+Ave%2C\+Bronx\+10458/);
  const low = async () => ({ ok: true, json: async () => ({ features: [{ geometry: { coordinates: [0, 0] }, properties: { confidence: 0.2 } }] }) });
  assert.equal(await geocode({ address: "1 Nowhere", borough: "Bronx" }, low), null);
});

test("listings: lat/lng must be inside NYC", () => {
  const base = { _row: 2, id: "G1", name: "X", category: "food", offers: "o", phone: "p" };
  const { listings, errors } = validateListings([{ ...base }, { ...base, _row: 3, id: "G2", lat: "40.7", lng: "-73.9" }, { ...base, _row: 4, id: "G3", lat: "34.05", lng: "-118.2" }]);
  assert.deepEqual(listings.map((l) => l.id), ["G1", "G2"]);
  assert.match(errors[0], /isn't in New York City/);
});
