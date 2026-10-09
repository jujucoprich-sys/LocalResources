// Fills in exact map positions (lat, lng) for every listing with an address,
// using NYC's free GeoSearch service (no key needed). Run it from a computer
// with normal internet access after adding or changing addresses:
//
//   npm run geocode            # fill in missing positions
//   npm run geocode -- --all   # look everything up again
//
// Until a listing has a position, the app estimates distance from its zip code.
import fs from "node:fs";
import { parseCsv } from "../src/csv.js";
import { streetViewLocation } from "../src/streetview.js";

const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2/search";

export async function geocode(listing, fetchImpl = fetch) {
  const text = streetViewLocation(listing).replace(/, NY$/, "");
  if (!text) return null;
  const res = await fetchImpl(`${GEOSEARCH}?${new URLSearchParams({ text, size: "1" })}`);
  if (!res.ok) throw new Error(`GeoSearch ${res.status}`);
  const feature = (await res.json()).features?.[0];
  if (!feature || (feature.properties?.confidence ?? 1) < 0.6) return null;
  const [lng, lat] = feature.geometry.coordinates;
  return { lat: lat.toFixed(5), lng: lng.toFixed(5), label: feature.properties?.label || "" };
}

async function main() {
  const file = "data/listings.csv";
  const all = process.argv.includes("--all");
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  for (const name of ["lat", "lng"]) {
    if (col(name) < 0) {
      header.splice(col("transit"), 0, name);
      for (const r of rows.slice(1)) r.splice(col("transit") - 1, 0, "");
    }
  }
  let found = 0;
  let missed = [];
  for (const r of rows.slice(1)) {
    const listing = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    if (!listing.address || (!all && listing.lat)) continue;
    try {
      const hit = await geocode(listing);
      if (hit) {
        r[col("lat")] = hit.lat;
        r[col("lng")] = hit.lng;
        found++;
        console.log(`${listing.id}  ${listing.address}  ->  ${hit.label}`);
      } else {
        missed.push(listing.id);
      }
    } catch (err) {
      console.error(`${listing.id}: ${err.message}`);
      missed.push(listing.id);
    }
    await new Promise((r) => setTimeout(r, 200)); // be polite to the free service
  }
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  fs.writeFileSync(file, rows.map((r) => r.map((v) => q(v ?? "")).join(",")).join("\n") + "\n");
  console.log(`\n${found} positions filled in.${missed.length ? ` Not found (check the address): ${missed.join(", ")}` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
