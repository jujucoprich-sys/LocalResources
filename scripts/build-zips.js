// Builds public/nyc-zips.json: the center point of every NYC zip code, used
// for approximate distances when a listing has no exact coordinates yet and
// when someone types a zip instead of sharing their location.
// Usage: npm run build-zips   (data from the BSD-licensed "zipcodes" package)
import fs from "node:fs";
import { createRequire } from "node:module";

const zipcodes = createRequire(import.meta.url)("zipcodes");
const NYC = /^(10[0-4]\d\d|11[0-6]\d\d)$/;
const out = {};
for (const code of Object.keys(zipcodes.codes).sort()) {
  const z = zipcodes.codes[code];
  if (!NYC.test(code) || z.state !== "NY" || !z.latitude) continue;
  out[code] = [Number(z.latitude.toFixed ? z.latitude.toFixed(4) : z.latitude), Number(z.longitude.toFixed ? z.longitude.toFixed(4) : z.longitude)];
}
fs.writeFileSync("public/nyc-zips.json", JSON.stringify(out) + "\n");
console.log(`${Object.keys(out).length} NYC zip codes written to public/nyc-zips.json`);
