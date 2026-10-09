import fs from "node:fs";
import { ageLimits, boroughFromText, boroughFromZip, detectNeeds, personAge } from "./matcher.js";

// When a search comes back thin, we note WHAT kind of help was missing so
// someone can go find more resources for it. Only fixed tags are kept:
// categories, borough, an age group and a few yes/no needs (kids, pregnant,
// LGBTQ...). Never the person's words, names, numbers or the exact age, and
// only the date (no time), so a gap can't be traced back to a person.

const PLACE_BASED = ["food", "housing", "health", "education", "jobs", "community"];
export const FLAG_RULES = [
  ["kids", /\b(kids?|children|child|baby|babies|son|daughter|toddler|infant)\b/i],
  ["pregnant", /\bpregnan/i],
  ["lgbtq", /\b(lgbt|gay|lesbian|bisexual|trans|transgender|queer|nonbinary)\b/i],
  ["no ID", /\bno id\b|without (an )?id|(doesn'?t|does not|don'?t) have (an )?id/i],
  ["disability", /\b(disab|wheelchair|blind|deaf)/i],
  ["immigrant", /\b(immigra|undocumented|asylum|refugee|migrant|no papers)/i],
  ["veteran", /\bveteran/i],
  ["record", /\b(prison|jail|incarcerat|parole|probation|conviction|felony)/i],
  ["pet", /\b(dog|cat|pet)s?\b/i],
  ["woman", /\b(woman|women|female|mom|mother)\b/i],
  ["man", /\b(man|men|male|dad|father)\b/i],
];
export const LANGUAGE_FLAGS = ["spanish", "chinese", "mandarin", "cantonese", "haitian creole", "russian", "arabic", "bengali", "urdu", "polish", "yiddish", "french", "korean"];

function ageGroup(age) {
  if (age === null) return "";
  if (age < 18) return "under 18";
  if (age <= 24) return "18-24";
  if (age >= 62) return "62+";
  return "";
}

const textOf = (r) => `${r.name || ""} ${r.offers || ""} ${r.eligibility || ""}`;

// Returns null when the results look like a fit, or the gap's tags plus
// the reasons it looked thin.
export function describeGap({ situation, zip = "" }, response) {
  const results = response.results || [];
  const needs = detectNeeds(situation);
  const categories = needs.length ? needs : [...new Set(results.map((r) => r.category))];
  const borough = boroughFromZip(zip) || boroughFromText(situation);
  const age = personAge(situation);
  const flags = FLAG_RULES.filter(([, re]) => re.test(situation)).map(([f]) => f);
  const languages = LANGUAGE_FLAGS.filter((l) => new RegExp(`\\b${l}\\b`, "i").test(situation));

  const reasons = [];
  if (!results.length || response.nothing_fits) reasons.push("no good match");
  for (const c of categories) {
    if (!results.some((r) => r.category === c)) reasons.push(`nothing for ${c}`);
    else if (borough && PLACE_BASED.includes(c) && !results.some((r) => r.category === c && r.borough === borough && r.address)) {
      reasons.push(`no ${c} place in ${borough}`);
    }
  }
  if (age !== null && age < 18 && results.length && !results.some((r) => ageLimits(r.eligibility).max <= 24 || /\b(teens?|youth|young people|under (18|2\d))\b/i.test(r.eligibility))) {
    reasons.push("nothing just for under-18s");
  }
  if (flags.includes("pregnant") && results.length && !results.some((r) => /pregnan|prenatal/i.test(textOf(r)))) reasons.push("nothing for pregnancy");
  if (flags.includes("pet") && results.length && !results.some((r) => /\bpets?\b|dogs?\b/i.test(textOf(r)))) reasons.push("nothing that takes pets");
  for (const lang of languages) {
    if (results.length && !results.some((r) => new RegExp(lang, "i").test(r.languages || ""))) reasons.push(`nothing in ${lang[0].toUpperCase() + lang.slice(1)}`);
  }
  if (!reasons.length) return null;
  return { categories: categories.length ? categories : ["unknown"], borough, age_group: ageGroup(age), flags: [...flags, ...languages], reasons };
}

export function gapKey(gap) {
  return [gap.categories.join("+"), gap.borough || "any borough", gap.age_group || "any age", ...[...gap.flags].sort()].join(" | ");
}

const FLAG_WORDS = {
  kids: "with kids", pregnant: "who is pregnant", lgbtq: "who is LGBTQ+", "no ID": "without ID", disability: "with a disability",
  immigrant: "who is an immigrant", veteran: "who is a veteran", record: "with a criminal record", pet: "with a pet", woman: "who is a woman", man: "who is a man",
};
const CATEGORY_WORDS = { mental_health: "mental health", unknown: "other" };
const AGE_WORDS = { "under 18": "under 18", "18-24": "aged 18-24", "62+": "aged 62+" };

// Plain-language version for the research prompt and the review page,
// e.g. "housing help in Queens for someone under 18, who is pregnant".
export function gapSummary(gap) {
  const who = [
    AGE_WORDS[gap.age_group],
    ...gap.flags.map((f) => FLAG_WORDS[f] || `who speaks ${f[0].toUpperCase() + f.slice(1)}`),
  ].filter(Boolean);
  const what = gap.categories.map((c) => CATEGORY_WORDS[c] || c).join(" and ");
  return `${what} help in ${gap.borough || "New York City"}${who.length ? ` for someone ${who.join(", ")}` : ""}`;
}

const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const HEADER = "date,categories,borough,age_group,flags,reasons\n";

export function createGapLog(file) {
  return {
    record(gap, now = new Date()) {
      if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER);
      const row = [now.toISOString().slice(0, 10), gap.categories.join("+"), gap.borough, gap.age_group, gap.flags.join("+"), gap.reasons.join("; ")];
      fs.appendFileSync(file, row.map(q).join(",") + "\n");
    },
    // Gaps grouped by kind, most common first.
    summary(parseCsv) {
      if (!fs.existsSync(file)) return [];
      const groups = new Map();
      for (const [date, categories, borough, age_group, flags, reasons] of parseCsv(fs.readFileSync(file, "utf8")).slice(1)) {
        if (!categories) continue;
        const gap = { categories: categories.split("+"), borough, age_group, flags: flags ? flags.split("+") : [], reasons: reasons.split("; ") };
        const key = gapKey(gap);
        const g = groups.get(key) || { key, gap, summary: gapSummary(gap), count: 0, last_seen: "", reasons: new Set() };
        g.count += 1;
        if (date > g.last_seen) g.last_seen = date;
        gap.reasons.forEach((r) => g.reasons.add(r));
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({ ...g, reasons: [...g.reasons] })).sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen));
    },
  };
}
