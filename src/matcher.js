import Anthropic from "@anthropic-ai/sdk";
import { listingForModel } from "./listings.js";
import { nycClock, openStatus } from "./hours.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_RESULTS = 3;

const SYSTEM_RULES = `You help frontline workers in Brooklyn (hospital social workers, food pantry and shelter staff, library and school social workers) find next steps for someone they're helping. The worker describes the person's situation in plain words. You pick the 2-3 best options from the VERIFIED LISTINGS below.

Rules:
- Only recommend listings from VERIFIED LISTINGS, by their exact id. Never invent or suggest any other place, program, address, phone number, or hours.
- Recommend at most 3. Fewer is better than a weak fit. Order them best first.
- If the situation has more than one need (e.g. food and housing), cover the most urgent need first, then the others if a listing fits.
- Respect eligibility. Don't recommend a listing the person clearly doesn't qualify for (e.g. a men's shelter for a mother with children).
- If the worker needs help today, prefer listings that are open now or later today. Respect hours_notes.
- Prefer listings with verified: true. Unverified listings may be recommended when they fit clearly better; the app labels them "call first".
- Some listings are citywide intake sites outside Brooklyn (e.g. PATH for families with children). Recommend them when the situation requires that intake.
- Prefer listings in or near the person's neighborhood or zip, and ones that speak the person's language when it's mentioned.
- "why" is one short sentence, in plain words, saying why this option fits this situation. Do not state addresses, phone numbers, or hours in "why"; those are shown to the worker from the verified data.
- If nothing in the list fits a need, set nothing_fits to true for that case and say so plainly in "message" (one or two sentences). The app will show NYC 311 and crisis hotlines. Needs outside food and urgent housing (jobs, health care, benefits other than SNAP) are not covered by this list yet.
- "message" is optional context for the worker: an important gap, an eligibility caution, or what to ask the person. Leave it empty if there's nothing useful to add.
- Set looks_like_personal_info to true if the text seems to contain a person's name, exact street address of the person, date of birth, or ID number.

VERIFIED LISTINGS (JSON):
`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          why: { type: "string" },
        },
        required: ["id", "why"],
        additionalProperties: false,
      },
    },
    nothing_fits: { type: "boolean" },
    message: { type: "string" },
    looks_like_personal_info: { type: "boolean" },
  },
  required: ["results", "nothing_fits", "message", "looks_like_personal_info"],
  additionalProperties: false,
};

export function buildSystemPrompt(listings) {
  return SYSTEM_RULES + JSON.stringify(listings.map(listingForModel), null, 1);
}

function buildUserMessage({ situation, zip, urgency }, listings, now) {
  const { day, minutes } = nycClock(now);
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const openIds = listings.filter((l) => openStatus(l.hours, now).state === "open").map((l) => l.id);
  return [
    `Right now in Brooklyn: ${dayName} ${time}.`,
    `Listings open right now: ${openIds.length ? openIds.join(", ") : "none"}.`,
    `Needs help: ${urgency === "week" ? "this week" : "today"}.`,
    zip ? `Person's zip code: ${zip}.` : null,
    "",
    "Situation, as described by the worker:",
    situation,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// Asks Claude to pick listings. Returns the parsed JSON object.
export async function matchWithClaude(query, listings, { client, now = new Date() } = {}) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    // The listings block is identical across searches, so it's cached.
    system: [{ type: "text", text: buildSystemPrompt(listings), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(query, listings, now) }],
  });

  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("model response was cut off");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("model returned no text");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Keyword matcher: used when no API key is configured, or if the AI call
// fails. Cruder, but still only ever returns verified listings.

const NEED_WORDS = {
  food: ["food", "hungry", "hunger", "eat", "meal", "pantry", "groceries", "grocery", "snap", "ebt", "food stamps", "formula", "lunch", "dinner", "breakfast", "soup kitchen", "comida", "hambre"],
  housing: ["evict", "eviction", "evicted", "homeless", "shelter", "sleep", "nowhere", "kicked out", "lost his room", "lost her room", "drop-in", "court papers", "behind on rent", "housing", "rent", "landlord", "lockout", "locked out", "sleeping", "street", "couch", "nowhere to stay", "place to stay", "housing court", "marshal", "arrears", "desalojo", "vivienda", "albergue"],
};
const LANGUAGES = ["spanish", "chinese", "mandarin", "cantonese", "haitian creole", "creole", "russian", "arabic", "bengali", "urdu", "polish", "yiddish", "french"];

// Situation words that point to a kind of help, matched against the
// listing's own text: [situation pattern, listing pattern, score, reason].
const NO_ID = /\bno id\b|without (an )?id|(doesn'?t|does not|don'?t) have (an )?id/i;
const TOPICS = [
  [/\b(court|lawyer|attorney|marshal|lockout|locked out|landlord|evict)/i, /lawyer|legal|eviction defense|court/i, 3, "free legal help"],
  [/\b(rent|arrears|behind)/i, /back rent|rent help|eviction prevention/i, 3, "help with back rent"],
  [/\b(kids?|children|child|baby|pregnant|families)\b/i, /families with children/i, 4, "for families with children"],
  [/\b(sleep|street|nowhere|tonight|homeless|shelter|lost (his|her|their) room|kicked out)/i, /intake|drop-in|shelter/i, 3, "a place to stay"],
  [/\b(meal|hungry|hot food|eat)/i, /meal|soup kitchen/i, 2, "serves meals"],
  [NO_ID, /no id needed|not turned away/i, 2, "no ID needed"],
];
const NEIGHBORHOOD_ALIASES = [
  [/\bbed[- ]?stuy\b/gi, "Bedford-Stuyvesant"],
  [/\beny\b/gi, "East New York"],
];

// Rules out listings the person clearly can't use, judged from the
// eligibility text. Keyword mode only; the AI reads eligibility itself.
function ineligible(listing, text) {
  const kids = /\b(kids?|children|child|baby|pregnant|son|daughter)\b/i.test(text);
  const woman = /\b(woman|women|female|she|her|mom|mother)\b/i.test(text);
  const man = /\b(man|men|male|he|his|dad|father)\b/i.test(text);
  const e = listing.eligibility;
  if (/single adult men/i.test(e)) return kids || (woman && !man);
  if (/single adult women/i.test(e)) return kids || (man && !woman);
  if (/families with children/i.test(e)) return !kids;
  if (/no children under 21/i.test(e)) return kids || /\bsingle\b/i.test(text) || (!/\b(couple|partner|wife|husband|family)\b/i.test(text));
  if (NO_ID.test(text) && /\bID required/i.test(listing.what_to_bring)) return true;
  if (/single adults/i.test(e)) return kids;
  return false;
}

function mentions(text, word) {
  return new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}`, "i").test(text);
}

export function detectNeeds(text) {
  return Object.entries(NEED_WORDS)
    .filter(([, words]) => words.some((w) => mentions(text, w)))
    .map(([need]) => need);
}

export function matchWithKeywords({ situation, zip, urgency }, listings, { now = new Date() } = {}) {
  for (const [re, name] of NEIGHBORHOOD_ALIASES) situation = situation.replace(re, name);
  const needs = detectNeeds(situation);
  if (needs.length === 0) {
    return {
      results: [],
      nothing_fits: true,
      message: "Couldn't tell whether this is about food or housing. Try words like \"food\", \"pantry\", \"evicted\" or \"shelter\".",
      looks_like_personal_info: false,
    };
  }
  const languages = LANGUAGES.filter((lang) => mentions(situation, lang));

  const scored = listings
    .filter((l) => needs.includes(l.category) && !ineligible(l, situation))
    .map((l) => {
      const reasons = [l.category === "food" ? "Food help" : "Housing help"];
      let score = 0;
      if (needs[0] === l.category) score += 2; // first-mentioned need
      if (zip && l.zip === zip) {
        score += 3;
        reasons.push(`same zip (${zip})`);
      } else if (l.neighborhood && mentions(situation, l.neighborhood)) {
        score += 3;
        reasons.push(`in ${l.neighborhood}`);
      }
      if (l.verified) score += 1;
      const listingText = `${l.name} ${l.offers} ${l.eligibility} ${l.what_to_bring}`;
      for (const [want, has, points, reason] of TOPICS) {
        if (want.test(situation) && has.test(listingText)) {
          score += points;
          reasons.push(reason);
        }
      }
      const status = openStatus(l.hours, now).state;
      if (status === "open") {
        score += urgency === "week" ? 1 : 2;
        reasons.push("open now");
      }
      for (const lang of languages) {
        if (mentions(l.languages, lang)) {
          score += 1;
          reasons.push(`speaks ${lang[0].toUpperCase() + lang.slice(1)}`);
        }
      }
      return { l, score, why: reasons.join(", ") + "." };
    })
    .sort((a, b) => b.score - a.score);

  // Make sure each detected need gets at least one slot.
  const picked = [];
  for (const need of needs) {
    const best = scored.find((s) => s.l.category === need);
    if (best) picked.push(best);
  }
  for (const s of scored) {
    if (picked.length >= MAX_RESULTS) break;
    if (!picked.includes(s)) picked.push(s);
  }
  picked.sort((a, b) => b.score - a.score);

  return {
    results: picked.slice(0, MAX_RESULTS).map((s) => ({ id: s.l.id, why: s.why })),
    nothing_fits: picked.length === 0,
    message: "Keyword matching only (AI is off). It doesn't check eligibility. Read each listing before you refer.",
    looks_like_personal_info: false,
  };
}

// ---------------------------------------------------------------------------
// Turns the matcher's picks into what the page shows. Every fact shown
// (address, hours, phone, eligibility) comes from the spreadsheet row, never
// from the model's text.

const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)/i;

function safeWhy(why, listing) {
  const text = String(why || "").trim().slice(0, 300);
  // The model is told not to state contact details or hours. If it does
  // anyway, fall back to the listing's own description instead of showing a
  // detail that might not match the verified data.
  if (!text || PHONE_RE.test(text) || TIME_RE.test(text)) return listing.offers;
  return text;
}

export function buildResponse(match, listings, now = new Date()) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const seen = new Set();
  const results = [];
  for (const r of Array.isArray(match.results) ? match.results : []) {
    const l = byId.get(String(r.id));
    if (!l || seen.has(l.id)) continue; // drop anything not in the verified list
    seen.add(l.id);
    results.push({
      id: l.id,
      name: l.name,
      category: l.category,
      offers: l.offers,
      why: safeWhy(r.why, l),
      address: l.address,
      neighborhood: l.neighborhood,
      transit: l.transit,
      hours: l.hours,
      hours_notes: l.hours_notes,
      open: openStatus(l.hours, now),
      eligibility: l.eligibility,
      what_to_bring: l.what_to_bring,
      phone: l.phone,
      languages: l.languages,
      website: l.website,
      last_verified: l.last_verified,
      verified: l.verified,
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return {
    results,
    nothing_fits: results.length === 0 || Boolean(match.nothing_fits),
    message: String(match.message || "").slice(0, 600),
    looks_like_personal_info: Boolean(match.looks_like_personal_info),
  };
}
