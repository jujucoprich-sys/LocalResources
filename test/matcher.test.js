import test from "node:test";
import assert from "node:assert/strict";
import { loadListings } from "../src/listings.js";
import { ageLimits, browseListings, buildResponse, categoryCounts, detectNeeds, matchWithClaude, matchWithKeywords, personAge } from "../src/matcher.js";

const WED_230PM = new Date("2026-10-07T18:30:00Z");
const { listings } = loadListings("data/sample-listings.csv", WED_230PM);

test("detectNeeds", () => {
  assert.deepEqual(detectNeeds("evicted yesterday, no food at home"), ["food", "housing"]);
  assert.deepEqual(detectNeeds("likes the guitar"), []);
  assert.deepEqual(detectNeeds("just laid off, needs a job"), ["jobs"]);
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

test("keyword matcher: new categories and crisis lines", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  const pick = (situation) => matchWithKeywords({ situation, zip: "", urgency: "today" }, real, { now: WED_230PM }).results.map((r) => r.id);
  assert.equal(pick("Teen feeling hopeless and thinking about suicide")[0], "P01"); // 988, not the LGBTQ-only line
  assert.equal(pick("Gay teen feeling suicidal")[0], "P03");
  assert.ok(pick("Uninsured undocumented dad needs a doctor").includes("C01"));
  assert.equal(pick("Wants to get a GED")[0], "E01");
  assert.equal(pick("Wants to volunteer")[0], "K04");
});

test("online listings show as online, not 'hours unknown'", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  const out = buildResponse({ results: [{ id: "K02", why: "x" }, { id: "F31", why: "y" }] }, real, WED_230PM);
  assert.equal(out.results[0].open.label, "Open 24 hours"); // findhelp.org, hours 24/7
  assert.equal(out.results[1].open.label, "By phone"); // WIC hotline, no hours listed
});

test("keyword matcher: stays in the person's borough", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  const pick = (situation, zip = "") => matchWithKeywords({ situation, zip, urgency: "today" }, real, { now: WED_230PM }).results.map((r) => real.find((l) => l.id === r.id));
  assert.ok(pick("Single man, nowhere to sleep tonight, in Harlem").every((l) => ["Manhattan", "Citywide"].includes(l.borough)));
  assert.ok(pick("Hungry, needs a hot meal", "10458").every((l) => l.borough === "Bronx"));
  assert.equal(pick("Partner hurts her, afraid to go home, Queens")[0].category, "safety");
  assert.ok(!pick("Single man, nowhere to sleep, Manhattan").some((l) => /young people/i.test(l.eligibility)));
});

test("keyword matcher: citywide intake sites aren't penalized by borough", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  const ids = matchWithKeywords({ situation: "Mom with 2 kids, evicted yesterday, near Brownsville", zip: "", urgency: "today" }, real, { now: WED_230PM }).results.map((r) => r.id);
  assert.ok(ids.includes("H02")); // PATH, in the Bronx, is where every family with children applies
});

test("browseListings: filters by category and borough, keeps citywide, open first", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  const bronxFood = browseListings(real, { category: "food", borough: "Bronx" }, WED_230PM);
  assert.ok(bronxFood.length > 3);
  assert.ok(bronxFood.every((c) => c.category === "food" && ["Bronx", "Citywide"].includes(c.borough)));
  const order = { open: 0, online: 1, unknown: 2, closed: 3 };
  for (let i = 1; i < bronxFood.length; i++) assert.ok(order[bronxFood[i - 1].open.state] <= order[bronxFood[i].open.state]);
  assert.ok(browseListings(real, { category: "food", openNow: true }, WED_230PM).every((c) => c.open.state === "open"));
  assert.equal(Object.values(categoryCounts(real)).reduce((a, b) => a + b, 0), real.length);
});

test("personAge and ageLimits", () => {
  assert.equal(personAge("Im 16 and need housing"), 16);
  assert.equal(personAge("i'm 17, kicked out"), 17);
  assert.equal(personAge("16 yo needs shelter"), 16);
  assert.equal(personAge("22 year old, homeless"), 22);
  assert.equal(personAge("My 16 year old son and I were evicted"), null);
  assert.equal(personAge("I'm 3 kids short of a bus"), null);
  assert.deepEqual(ageLimits("Young people 14-24."), { min: 14, max: 24 });
  assert.deepEqual(ageLimits("Single adults 18+."), { min: 18, max: 200 });
  assert.deepEqual(ageLimits("LGBTQ+ young people up to 24."), { min: 0, max: 24 });
  assert.deepEqual(ageLimits("Anyone, regardless of income. Teens 14-17 can talk to peers."), { min: 0, max: 200 });
});

test("keyword matcher: a 16-year-old never gets adult-only shelters", () => {
  const real = loadListings("data/listings.csv", WED_230PM).listings;
  for (const situation of ["Im 16 and need housing", "i'm 16, nowhere to sleep in the Bronx", "16 yo needs shelter tonight in Queens"]) {
    const picks = matchWithKeywords({ situation, zip: "", urgency: "today" }, real, { now: WED_230PM }).results.map((r) => real.find((l) => l.id === r.id));
    assert.ok(picks.length > 0, situation);
    for (const l of picks) {
      const { min, max } = ageLimits(l.eligibility);
      assert.ok(16 >= min && 16 <= max && !/single adult/i.test(l.eligibility), `${situation} -> ${l.name}`);
    }
  }
  const adult = matchWithKeywords({ situation: "I am 30 and need shelter in Manhattan", zip: "", urgency: "today" }, real, { now: WED_230PM }).results.map((r) => real.find((l) => l.id === r.id));
  assert.ok(!adult.some((l) => /young people/i.test(l.eligibility)));
  const family = matchWithKeywords({ situation: "My 16 year old son and I were evicted", zip: "", urgency: "today" }, real, { now: WED_230PM }).results.map((r) => r.id);
  assert.ok(family.includes("H02"));
});
