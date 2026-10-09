// Researches the most common gaps that haven't been researched yet and puts
// what it finds in the review queue (open /admin.html to approve or reject).
// Good for a daily scheduled job. Needs ANTHROPIC_API_KEY.
//
//   npm run research-gaps            # top 3 gaps
//   npm run research-gaps -- 5       # top 5
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/csv.js";
import { loadListings } from "../src/listings.js";
import { createGapLog } from "../src/gaps.js";
import { researchGap } from "../src/research.js";
import { createReviewQueue } from "../src/review.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limit = Number(process.argv[2] || 3);
const listings = loadListings(process.env.LISTINGS_CSV || path.join(ROOT, "data", "listings.csv")).listings;
const queue = createReviewQueue(path.join(ROOT, "data", "candidates.json"));
const researched = queue.researched();
const todo = createGapLog(path.join(ROOT, "data", "gaps.csv"))
  .summary(parseCsv)
  .filter((g) => !researched[g.key] || researched[g.key] < g.last_seen)
  .slice(0, limit);

if (!todo.length) console.log("No new gaps to research.");
for (const g of todo) {
  process.stdout.write(`Researching: ${g.summary} (${g.count} searches)... `);
  try {
    const found = await researchGap(g.gap, listings);
    const added = queue.add(g.key, found.accepted);
    console.log(`${added.length} to review, ${found.rejected.length} skipped.`);
    for (const r of found.rejected) console.log(`  skipped ${r.listing.name}: ${r.problems.join(", ")}`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }
}
