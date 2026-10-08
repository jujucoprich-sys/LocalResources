// Checks the listings spreadsheet before launch and after every edit.
// Usage: npm run check-data [path/to/listings.csv]
import fs from "node:fs";
import { loadListings } from "../src/listings.js";

const file = process.argv[2] || (fs.existsSync("data/listings.csv") ? "data/listings.csv" : "data/sample-listings.csv");
const { listings, errors, warnings } = loadListings(file);

console.log(`${file}: ${listings.length} usable listings`);
const byCategory = Object.groupBy(listings, (l) => l.category);
for (const [cat, rows] of Object.entries(byCategory)) console.log(`  ${cat}: ${rows.length}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} row(s) with errors. These are left out of search until fixed:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("\nNo errors.");
