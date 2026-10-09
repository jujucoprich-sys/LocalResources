import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCsv } from "../src/csv.js";
import { loadListings } from "../src/listings.js";
import { createGapLog, describeGap, gapKey, gapSummary } from "../src/gaps.js";
import { checkCandidate, researchGap } from "../src/research.js";
import { appendListing, createReviewQueue } from "../src/review.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nextstep-"));
const card = (o) => ({ name: "", offers: "", eligibility: "", languages: "", address: "", borough: "Citywide", category: "food", ...o });

test("describeGap: a good fit is not a gap", () => {
  const out = { results: [card({ category: "food", borough: "Queens", address: "1 Main St" })], nothing_fits: false };
  assert.equal(describeGap({ situation: "hungry family needs groceries", zip: "11432" }, out), null);
});

test("describeGap: notes what was missing, with tags only", () => {
  const situation = "I'm 16, pregnant, my name is Maria, need a place to live in Queens, I speak Spanish";
  const out = { results: [card({ category: "housing", borough: "Manhattan", address: "1 A St", eligibility: "Adults 18+" })], nothing_fits: false };
  const gap = describeGap({ situation }, out);
  assert.deepEqual(gap.categories, ["housing"]);
  assert.equal(gap.borough, "Queens");
  assert.equal(gap.age_group, "under 18");
  assert.ok(gap.flags.includes("pregnant") && gap.flags.includes("spanish"));
  assert.ok(gap.reasons.includes("no housing place in Queens"));
  assert.ok(gap.reasons.includes("nothing just for under-18s"));
  assert.ok(gap.reasons.includes("nothing for pregnancy"));
  assert.ok(gap.reasons.includes("nothing in Spanish"));
  // Nothing the person typed survives, only fixed tags.
  assert.doesNotMatch(JSON.stringify(gap) + gapKey(gap) + gapSummary(gap), /maria|16\b/i);
});

test("gap log stores only date and tags, and groups repeats", () => {
  const dir = tmp();
  const log = createGapLog(path.join(dir, "gaps.csv"));
  const gap = { categories: ["housing"], borough: "Queens", age_group: "under 18", flags: ["pregnant"], reasons: ["no housing place in Queens"] };
  log.record(gap, new Date("2026-10-01T15:04:05Z"));
  log.record({ ...gap, reasons: ["nothing for pregnancy"] }, new Date("2026-10-03T09:00:00Z"));
  log.record({ categories: ["food"], borough: "", age_group: "", flags: [], reasons: ["no good match"] });
  const text = fs.readFileSync(path.join(dir, "gaps.csv"), "utf8");
  assert.doesNotMatch(text, /15:04|T\d\d:/); // no times
  const [top] = log.summary(parseCsv);
  assert.equal(top.count, 2);
  assert.equal(top.last_seen, "2026-10-03");
  assert.deepEqual(top.reasons.sort(), ["no housing place in Queens", "nothing for pregnancy"]);
  assert.equal(top.summary, "housing help in Queens for someone under 18, who is pregnant");
});

const LISTINGS = [{ id: "A1", name: "Existing Pantry", phone: "718-555-0100", category: "food" }];
const raw = (o) => ({ name: "Teen Moms Housing Program", category: "housing", offers: "Housing for young mothers.", address: "10 Elm St, Jamaica, NY 11432", neighborhood: "Jamaica", borough: "Queens", zip: "", hours: "Mon-Fri 09:00-17:00", hours_notes: "", eligibility: "Pregnant or parenting youth 16-21.", what_to_bring: "", phone: "718-555-0199 (Spanish: 718-555-0198)", languages: "Spanish", website: "teenmoms.example.org", to_confirm_on_call: "Intake hours.", sources: ["https://teenmoms.example.org/about"], ...o });

test("checkCandidate: keeps facts only when the web search returned the source", () => {
  const searchUrls = new Set(["https://www.teenmoms.example.org/about/"]);
  const ok = checkCandidate(raw(), { searchUrls, listings: LISTINGS });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.listing.address, "10 Elm St");
  assert.equal(ok.listing.zip, "11432");
  assert.equal(ok.listing.phone, "718-555-0199");
  assert.match(ok.listing.hours_notes, /Spanish: 718-555-0198/);
  assert.equal(ok.listing.website, "teenmoms.example.org");

  const madeUp = checkCandidate(raw({ sources: ["https://somewhere-else.example.com"] }), { searchUrls, listings: LISTINGS });
  assert.ok(madeUp.problems.includes("no source from the web search"));

  const dup = checkCandidate(raw({ name: "Existing Pantry!" }), { searchUrls, listings: LISTINGS });
  assert.ok(dup.problems.some((p) => p.startsWith("already listed")));

  const badHours = checkCandidate(raw({ hours: "weekdays, mornings", website: "unrelated.example.net" }), { searchUrls, listings: LISTINGS });
  assert.equal(badHours.listing.hours, "");
  assert.match(badHours.listing.hours_notes, /weekdays, mornings/);
  assert.equal(badHours.listing.website, ""); // not backed by a found page
});

test("researchGap: runs web search, resumes paused turns, checks every candidate", async () => {
  const calls = [];
  const client = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          if (calls.length === 1) {
            return { stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", content: [{ url: "https://teenmoms.example.org/about" }] }] };
          }
          return {
            stop_reason: "tool_use",
            content: [
              { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
              { type: "tool_use", id: "t1", name: "submit_candidates", input: { candidates: [raw(), raw({ name: "Invented Place", sources: ["https://nowhere.example"] })] } },
            ],
          };
        },
      },
    },
  };
  const gap = { categories: ["housing"], borough: "Queens", age_group: "under 18", flags: ["pregnant"], reasons: ["nothing for pregnancy"] };
  const out = await researchGap(gap, LISTINGS, { client });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].tools.some((t) => t.type === "web_search_20260209"));
  assert.match(calls[0].messages[0].content, /housing help in Queens/);
  assert.equal(calls[1].messages.at(-1).role, "assistant"); // paused turn sent back
  assert.deepEqual(out.accepted.map((c) => c.name), ["Teen Moms Housing Program"]);
  assert.equal(out.rejected[0].listing.name, "Invented Place");
  assert.equal(out.searches, 2);
});

test("review queue: approve appends a W-numbered row; reject removes it from pending", () => {
  const dir = tmp();
  const csv = path.join(dir, "listings.csv");
  fs.copyFileSync("data/listings.csv", csv);
  const before = loadListings(csv).listings.length;
  const queue = createReviewQueue(path.join(dir, "candidates.json"));
  const listing = checkCandidate(raw(), { searchUrls: new Set(["https://teenmoms.example.org/about"]), listings: LISTINGS }).listing;
  const [a] = queue.add("housing | Queens", [listing, listing]); // duplicate names are skipped
  const [b] = queue.add("housing | Queens", [{ ...listing, name: "Second Place" }]);
  assert.equal(queue.pending().length, 2);
  assert.ok(queue.researched()["housing | Queens"]);

  const id = queue.approve(a.cid, csv, { edits: { phone: "718-555-0111" }, phoneChecked: true, reviewer: "JD" }, new Date("2026-10-09T12:00:00Z"));
  assert.equal(id, "W001");
  assert.equal(queue.approve(a.cid, csv), null); // can't approve twice
  const added = loadListings(csv).listings.find((l) => l.id === "W001");
  assert.equal(loadListings(csv).listings.length, before + 1);
  assert.equal(added.phone, "718-555-0111");
  assert.equal(added.last_verified, "2026-10-09");
  assert.equal(added.verified, true);
  assert.equal(appendListing(csv, { ...listing, name: "Third" }), "W002");

  assert.ok(queue.reject(b.cid, "closed"));
  assert.equal(queue.pending().length, 0);
});
