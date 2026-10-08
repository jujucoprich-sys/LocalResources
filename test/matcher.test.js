import test from "node:test";
import assert from "node:assert/strict";
import { loadListings } from "../src/listings.js";
import { buildResponse, detectNeeds, matchWithClaude, matchWithKeywords } from "../src/matcher.js";

const WED_230PM = new Date("2026-10-07T18:30:00Z");
const { listings } = loadListings("data/sample-listings.csv", WED_230PM);

test("detectNeeds", () => {
  assert.deepEqual(detectNeeds("evicted yesterday, no food at home"), ["food", "housing"]);
  assert.deepEqual(detectNeeds("needs a job"), []);
});

test("keyword matcher covers each need and favors zip/language", () => {
  const m = matchWithKeywords(
    { situation: "Mom with 2 kids, evicted yesterday, no food at home, speaks Spanish", zip: "11212", urgency: "today" },
    listings,
    { now: WED_230PM }
  );
  const cats = m.results.map((r) => listings.find((l) => l.id === r.id).category);
  assert.ok(cats.includes("food") && cats.includes("housing"));
  assert.ok(m.results.length <= 3);
  assert.ok(m.results.some((r) => r.id === "SF01" || r.id === "SH01")); // 11212 listings
});

test("buildResponse drops ids not in the verified list and caps at 3", () => {
  const out = buildResponse(
    { results: [{ id: "FAKE", why: "x" }, { id: "SF01", why: "Close by." }, { id: "SF01", why: "dup" }, { id: "SF02", why: "a" }, { id: "SH01", why: "b" }, { id: "SH02", why: "c" }], nothing_fits: false, message: "" },
    listings,
    WED_230PM
  );
  assert.deepEqual(out.results.map((r) => r.id), ["SF01", "SF02", "SH01"]);
  assert.equal(out.results[0].address, listings.find((l) => l.id === "SF01").address);
  assert.equal(out.results[0].open.state, "open");
  assert.equal(out.results[0].internal_notes, undefined);
});

test("buildResponse replaces a 'why' that states phone numbers or times", () => {
  const out = buildResponse({ results: [{ id: "SF02", why: "Open till 3pm, call 718-555-9999." }] }, listings, WED_230PM);
  assert.equal(out.results[0].why, listings.find((l) => l.id === "SF02").offers);
});

test("buildResponse with no valid picks means nothing fits", () => {
  const out = buildResponse({ results: [{ id: "NOPE", why: "x" }], nothing_fits: false }, listings, WED_230PM);
  assert.equal(out.nothing_fits, true);
});

test("matchWithClaude sends listings in a cached system block and parses JSON", async () => {
  let sent;
  const fakeClient = {
    beta: {
      messages: {
        create: async (params) => {
          sent = params;
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify({ results: [{ id: "SH04", why: "Family with kids." }], nothing_fits: false, message: "", looks_like_personal_info: false }) }],
          };
        },
      },
    },
  };
  const out = await matchWithClaude({ situation: "family evicted", zip: "", urgency: "today" }, listings, { client: fakeClient, now: WED_230PM });
  assert.equal(out.results[0].id, "SH04");
  assert.equal(sent.system[0].cache_control.type, "ephemeral");
  assert.match(sent.system[0].text, /SH04/);
  assert.doesNotMatch(sent.system[0].text, /Demo data only/); // internal_notes never sent
  assert.match(sent.messages[0].content, /Wednesday 14:30/);
  assert.match(sent.messages[0].content, /open right now: .*SF01/);
  assert.equal(sent.output_config.format.type, "json_schema");
});

test("matchWithClaude throws on refusal so the server can fall back", async () => {
  const fakeClient = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
  await assert.rejects(matchWithClaude({ situation: "x", zip: "", urgency: "today" }, listings, { client: fakeClient }));
});
