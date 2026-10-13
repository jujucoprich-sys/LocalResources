import fs from "node:fs";
import { BOROUGHS } from "./listings.js";
import { openStatus, parseHours } from "./hours.js";

// Hospital case management partners for the SOS sheet (beta). Once a
// hospital agrees to take referrals, add it to data/partners.json (see
// data/partners.example.json). Until then the SOS sheet says the feature is
// coming. The app only shows a phone number or intake link; it never sends
// or stores anything about the person.

const FIELDS = ["name", "department", "phone", "hours", "hours_notes", "borough", "address", "intake_url", "eligibility", "languages"];

export function loadPartners(file) {
  if (!fs.existsSync(file)) return { partners: [], errors: [] };
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { partners: [], errors: [`${file}: not valid JSON (${err.message})`] };
  }
  const partners = [];
  const errors = [];
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const p = Object.fromEntries(FIELDS.map((f) => [f, String(row?.[f] ?? "").trim()]));
    const problems = [];
    if (!p.name) problems.push("needs a name");
    if (!p.phone && !p.intake_url) problems.push("needs a phone or intake_url");
    if (p.borough && !BOROUGHS.includes(p.borough)) problems.push(`unknown borough "${p.borough}"`);
    if (p.hours && parseHours(p.hours).error) problems.push(`can't read hours "${p.hours}"`);
    if (p.intake_url && !/^https:\/\//.test(p.intake_url)) problems.push("intake_url must start with https://");
    if (problems.length) errors.push(`partner ${i + 1} (${p.name || "no name"}): ${problems.join("; ")}`);
    else partners.push(p);
  });
  return { partners, errors };
}

// What the page gets: each partner with whether it's open right now.
export function partnersForPage(partners, now = new Date()) {
  return partners.map((p) => ({ ...p, open: p.hours ? openStatus(p.hours, now) : { state: "unknown", label: "Call for hours" } }));
}
