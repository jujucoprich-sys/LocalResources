import fs from "node:fs";
import { parseCsvObjects } from "./csv.js";
import { parseHours } from "./hours.js";

export const CATEGORIES = ["food", "housing", "health", "mental_health", "education", "jobs", "legal", "safety", "community"];
export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Citywide"];

// Columns in the listings spreadsheet. Order here is the order in the template.
export const COLUMNS = [
  "id", // short unique code you choose, e.g. F01, H07. Never reuse one.
  "name",
  "category", // one of CATEGORIES
  "offers", // what they do, in plain words
  "address",
  "neighborhood",
  "borough", // one of BOROUGHS; Citywide for phone and online help
  "zip",
  "lat", // exact map position, filled by "npm run geocode"
  "lng",
  "transit", // nearest subway/bus, e.g. "3 train to Saratoga Av; B47 bus"
  "hours", // machine-readable, see src/hours.js
  "hours_notes", // anything irregular: "2nd Sat only", "arrive by 10am"
  "eligibility",
  "what_to_bring",
  "phone",
  "languages",
  "website",
  "photo_commons", // optional: a Wikimedia Commons file name for this place's photo
  "last_verified", // YYYY-MM-DD of your last phone call
  "verified_by",
  "internal_notes", // never shown to users or sent to the AI
];

const REQUIRED = ["id", "name", "category", "offers"];
export const STALE_AFTER_DAYS = 90;

function daysSince(isoDate, now = new Date()) {
  return Math.floor((now - new Date(isoDate + "T12:00:00")) / 86_400_000);
}

// Checks every row. Rows with errors are excluded from search, so a typo can
// never turn into a wrong address or hour shown to a worker. Rows without a
// last_verified date are kept but marked unverified; the page labels them
// "call first", and ONLY_VERIFIED=1 on the server hides them entirely.
export function validateListings(rows, now = new Date()) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const valid = [];

  for (const r of rows) {
    const where = `row ${r._row}${r.id ? ` (${r.id})` : ""}`;
    const rowErrors = [];

    for (const col of REQUIRED) {
      if (!r[col]) rowErrors.push(`missing ${col}`);
    }
    if (!r.address && !r.phone && !r.website) rowErrors.push("needs at least an address, phone or website");
    if (r.id && seen.has(r.id)) rowErrors.push(`duplicate id ${r.id}`);
    if (r.category && !CATEGORIES.includes(r.category.toLowerCase())) {
      rowErrors.push(`category must be one of: ${CATEGORIES.join(", ")}`);
    }
    if (r.borough && !BOROUGHS.includes(r.borough)) rowErrors.push(`borough must be one of: ${BOROUGHS.join(", ")}`);
    if ((r.lat || r.lng) && !(Number(r.lat) > 40.4 && Number(r.lat) < 41 && Number(r.lng) > -74.3 && Number(r.lng) < -73.6)) {
      rowErrors.push(`lat/lng ${r.lat},${r.lng} isn't in New York City`);
    }
    if (r.zip && !/^\d{5}$/.test(r.zip)) rowErrors.push(`zip "${r.zip}" should be 5 digits`);
    if (r.last_verified) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.last_verified) || isNaN(new Date(r.last_verified))) {
        rowErrors.push(`last_verified "${r.last_verified}" should be YYYY-MM-DD`);
      } else if (daysSince(r.last_verified, now) < 0) {
        rowErrors.push(`last_verified ${r.last_verified} is in the future`);
      } else if (daysSince(r.last_verified, now) > STALE_AFTER_DAYS) {
        warnings.push(`${where}: last verified ${daysSince(r.last_verified, now)} days ago, call again`);
      }
    }
    if (!r.last_verified) warnings.push(`${where}: not verified yet, shown with a "call first" label`);
    const hours = parseHours(r.hours);
    if (hours.error) rowErrors.push(`hours: ${hours.error}`);
    if (hours.empty) warnings.push(`${where}: no hours, will show "Hours unknown, call first"`);

    if (rowErrors.length) {
      errors.push(`${where}: ${rowErrors.join("; ")}`);
    } else {
      seen.add(r.id);
      const listing = {};
      for (const col of COLUMNS) listing[col] = r[col] ?? "";
      listing.category = listing.category.toLowerCase();
      listing.verified = Boolean(listing.last_verified);
      valid.push(listing);
    }
  }
  return { listings: valid, errors, warnings };
}

export function loadListings(path, now = new Date()) {
  const text = fs.readFileSync(path, "utf8");
  return validateListings(parseCsvObjects(text), now);
}

// The subset of fields the AI sees. Leaves out internal notes and the
// verifier's name; keeps everything needed to judge fit.
export function listingForModel(l) {
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    offers: l.offers,
    address: l.address,
    neighborhood: l.neighborhood,
    borough: l.borough,
    zip: l.zip,
    hours: l.hours,
    hours_notes: l.hours_notes,
    eligibility: l.eligibility,
    what_to_bring: l.what_to_bring,
    languages: l.languages,
    verified: l.verified,
  };
}
