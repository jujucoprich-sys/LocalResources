import test from "node:test";
import assert from "node:assert/strict";
import { createStreetView, signUrl, streetViewLocation } from "../src/streetview.js";

test("streetViewLocation cleans addresses for the geocoder", () => {
  assert.equal(streetViewLocation({ address: "296 Ninth Ave (at 28th St)", borough: "Manhattan", zip: "10001" }), "296 Ninth Ave, Manhattan 10001, NY");
  assert.equal(streetViewLocation({ address: "1958 Fulton St, 2nd Floor", borough: "Brooklyn", zip: "" }), "1958 Fulton St, Brooklyn, NY");
  assert.equal(streetViewLocation({ address: "1665 St. Marks Ave, Room 116", borough: "Brooklyn", zip: "11233" }), "1665 St. Marks Ave, Brooklyn 11233, NY");
  assert.equal(streetViewLocation({ address: "151 East 151st St, Bronx", borough: "Citywide", zip: "" }), "151 East 151st St, Bronx, NY");
  assert.equal(streetViewLocation({ address: "", borough: "Citywide" }), "");
});

test("signUrl appends a URL-safe signature", () => {
  const url = "https://maps.googleapis.com/maps/api/streetview?location=x&key=k";
  const signed = signUrl(url, "dGVzdC1zZWNyZXQ=");
  assert.match(signed, /&signature=[A-Za-z0-9_-]+=*$/);
  assert.equal(signed, signUrl(url, "dGVzdC1zZWNyZXQ="));
  assert.equal(signUrl(url, ""), url);
});

function fakeFetch(metadataStatus) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes("/metadata?")) return { ok: true, json: async () => ({ status: metadataStatus }) };
    return { ok: true, headers: new Map([["content-type", "image/jpeg"]]), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  return { impl, calls };
}

test("photo: fetches the image only when Google has imagery, and remembers the answer", async () => {
  const listing = { id: "X1", address: "2759 Webster Ave", borough: "Bronx", zip: "10458" };
  const ok = fakeFetch("OK");
  const sv = createStreetView({ key: "k", secret: "", fetchImpl: ok.impl });
  const photo = await sv.photo(listing);
  assert.equal(photo.contentType, "image/jpeg");
  assert.deepEqual([...photo.body], [1, 2, 3]);
  await sv.photo(listing);
  assert.equal(ok.calls.filter((u) => u.includes("/metadata?")).length, 1);
  assert.ok(ok.calls.every((u) => u.startsWith("https://maps.googleapis.com/")));

  const none = fakeFetch("ZERO_RESULTS");
  const sv2 = createStreetView({ key: "k", secret: "", fetchImpl: none.impl });
  assert.equal(await sv2.photo(listing), null);
  assert.equal(none.calls.length, 1); // no paid image request
});

test("photo: off without a key, and skips listings without an address", async () => {
  const f = fakeFetch("OK");
  assert.equal(createStreetView({ key: "", fetchImpl: f.impl }).enabled, false);
  assert.equal(await createStreetView({ key: "", fetchImpl: f.impl }).photo({ address: "1 Main St" }), null);
  assert.equal(await createStreetView({ key: "k", fetchImpl: f.impl }).photo({ address: "" }), null);
  assert.equal(f.calls.length, 0);
});
