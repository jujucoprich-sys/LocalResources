import Anthropic from "@anthropic-ai/sdk";
import { BOROUGHS, CATEGORIES } from "./listings.js";
import { MODEL } from "./matcher.js";
import { parseHours } from "./hours.js";
import { gapSummary } from "./gaps.js";

// Finds real resources for a gap (a kind of help the list doesn't cover
// well) using Claude with web search. Nothing found here goes into search
// results on its own: candidates wait in a review queue until a person
// approves them. Every candidate must cite pages the search actually
// returned; anything else is dropped.

const FIELDS = ["name", "category", "offers", "address", "neighborhood", "borough", "zip", "hours", "hours_notes", "eligibility", "what_to_bring", "phone", "languages", "website", "to_confirm_on_call"];

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...Object.fromEntries(FIELDS.map((f) => [f, { type: "string" }])),
          category: { type: "string", enum: CATEGORIES },
          borough: { type: "string", enum: BOROUGHS },
          sources: { type: "array", items: { type: "string" } },
        },
        required: [...FIELDS, "sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

const SUBMIT_TOOL = {
  name: "submit_candidates",
  description: "Submit the resources you found. Call this exactly once, at the end. Submit an empty list if nothing reliable turned up.",
  input_schema: CANDIDATE_SCHEMA,
  strict: true,
};

const RULES = `You research free or low-cost resources in New York City for NextStep, an app frontline workers (social workers, shelter and pantry staff) use to refer people. The app's list didn't have a good fit for a kind of need. Use web search to find up to 5 real, currently operating programs, places, hotlines or websites that fit it, then call submit_candidates.

Rules:
- Every fact (address, phone, hours, eligibility, website) must come from a search result you saw. Never guess or fill in from memory. Leave a field "" when no result states it.
- "sources" lists the exact URLs of the search results the facts came from (at least one). Prefer official pages of the organization or of NYC/NY State government.
- Skip anything that seems closed, out of date, or that charges more than a small fee. Skip anything already in the "already listed" names.
- Never give the street address of a confidential domestic violence shelter. Public offices and hotlines are fine.
- borough is Manhattan, Brooklyn, Queens, Bronx, Staten Island, or Citywide (phone, online, or citywide programs).
- hours use this format: "Mon-Fri 09:00-17:00; Sat 10:00-14:00", or "24/7", or "" if unknown. Anything else about hours goes in hours_notes.
- phone is one number like "212-555-0100" (an extension as "x123"). Put other numbers or "text" lines in hours_notes.
- offers is one or two short, calm, plain sentences on what the place does. eligibility says who it serves, including any age limits the source gives (e.g. "Ages 16-24", "18+"); age limits matter.
- to_confirm_on_call names what a worker should double-check by phone (e.g. "Hours; whether walk-ins are seen"), and says if a fact came from an older or third-party page.`;

const norm = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const nameKey = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Tidies one candidate and checks it. Returns { listing, problems }.
export function checkCandidate(raw, { searchUrls, listings }) {
  const c = Object.fromEntries(FIELDS.map((f) => [f, clean(raw[f])]));
  const problems = [];

  // "212-555-0100 (Spanish: 212-555-0101)" -> first number; rest is a note.
  c.phone = c.phone.replace(/\s*ext\.?\s*/i, " x");
  if (/[;,(]|\btext\b/i.test(c.phone)) {
    const [first, ...rest] = c.phone.replace(/\)/g, "").split(/;\s*|,\s*|\s*\(/);
    c.phone = first.trim();
    if (rest.length) c.hours_notes = [c.hours_notes, rest.join("; ") + "."].filter(Boolean).join(" ");
  }
  // "126 Stuyvesant Pl, Staten Island, NY 10301" -> street part, zip in its own column.
  const m = /^(.*?),\s*[A-Za-z .]+,\s*NY\s*(\d{5})?$/.exec(c.address);
  if (m) {
    c.address = m[1];
    if (m[2] && !c.zip) c.zip = m[2];
  }

  const seen = new Set([...searchUrls].map(norm));
  const sources = (raw.sources || []).map(clean).filter((u) => seen.has(norm(u)));
  if (!sources.length) problems.push("no source from the web search");
  if (c.website && !seen.has(norm(c.website)) && !sources.some((s) => norm(s).startsWith(norm(c.website).split("/")[0]))) {
    c.website = ""; // only keep a website one of the found pages backs up
  }
  if (!c.name) problems.push("no name");
  if (!CATEGORIES.includes(c.category)) problems.push("unknown category");
  if (!BOROUGHS.includes(c.borough)) problems.push("unknown borough");
  if (!c.address && !c.phone && !c.website) problems.push("no address, phone or website");
  if (c.zip && !/^\d{5}$/.test(c.zip)) c.zip = "";
  if (c.hours && parseHours(c.hours).error) {
    c.hours_notes = [c.hours_notes, `Hours: ${c.hours}.`].filter(Boolean).join(" ");
    c.hours = "";
  }
  const key = nameKey(c.name);
  const digits = c.phone.replace(/\D/g, "");
  const twin = listings.find((l) => nameKey(l.name) === key || (digits.length >= 10 && l.phone.replace(/\D/g, "") === digits && !/^(311|988|911)$/.test(digits)));
  if (twin) problems.push(`already listed as "${twin.name}"`);
  return { listing: { ...c, sources }, problems };
}

function buildPrompt(gap, listings) {
  const already = listings.filter((l) => gap.categories.includes(l.category)).map((l) => l.name);
  return [
    `Find resources for: ${gapSummary(gap)}.`,
    gap.reasons?.length ? `What was missing from the app's results: ${gap.reasons.join("; ")}.` : "",
    "",
    `Already listed (don't repeat): ${already.join("; ") || "none"}.`,
  ].join("\n");
}

// Returns { accepted: [listing], rejected: [{ listing, problems }], searches }.
export async function researchGap(gap, listings, { client, maxSearches = 6 } = {}) {
  client ??= new Anthropic();
  const messages = [{ role: "user", content: buildPrompt(gap, listings) }];
  const searchUrls = new Set();
  let submitted = null;
  let searches = 0;

  for (let turn = 0; turn < 6 && !submitted; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: RULES,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches, user_location: { type: "approximate", city: "New York", region: "New York", country: "US" } }, SUBMIT_TOOL],
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("model declined the request");
    for (const block of response.content) {
      if (block.type === "web_search_tool_result") {
        searches += 1;
        // A list means results; an object means a search error.
        if (Array.isArray(block.content)) for (const r of block.content) if (r.url) searchUrls.add(r.url);
      }
      if (block.type === "tool_use" && block.name === "submit_candidates") submitted = block.input?.candidates || [];
    }
    if (submitted || response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") break;
    // pause_turn: the search is still going; send the turn back to continue.
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "tool_use") {
      const asks = response.content.filter((b) => b.type === "tool_use");
      messages.push({ role: "user", content: asks.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: "Call submit_candidates with your findings.", is_error: true })) });
    }
  }

  const accepted = [];
  const rejected = [];
  for (const raw of submitted || []) {
    const { listing, problems } = checkCandidate(raw, { searchUrls, listings: [...listings, ...accepted] });
    (problems.length ? rejected : accepted).push(problems.length ? { listing, problems } : listing);
  }
  return { accepted, rejected, searches };
}
