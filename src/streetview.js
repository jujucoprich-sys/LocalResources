import crypto from "node:crypto";

// Street View photos for walk-in listings, fetched through the server so the
// API key never reaches the browser. Google's terms don't allow storing
// Street View images, so nothing is written to disk; the browser caches each
// photo for a day instead.
//
// Setup: create a Google Maps Platform key with only the "Street View Static
// API" enabled, then set GOOGLE_MAPS_API_KEY (and optionally
// GOOGLE_MAPS_SIGNING_SECRET to sign requests).

const BASE = "https://maps.googleapis.com";
const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

// "296 Ninth Ave (at 28th St)" + Manhattan -> "296 Ninth Ave, Manhattan, NY".
// Floors, rooms and notes in parentheses only confuse the geocoder.
export function streetViewLocation(listing) {
  if (!listing.address) return "";
  let address = listing.address
    .replace(/\([^)]*\)/g, "")
    .replace(/,?\s*(\d+(st|nd|rd|th)\s+floor|floor\s+\d+|suite\s+\S+|room\s+\S+|basement|lobby)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,]+$/, "")
    .trim();
  if (!address) return "";
  const borough = BOROUGHS.includes(listing.borough) ? listing.borough : "";
  if (borough && !address.includes(borough)) address += `, ${borough}`;
  if (listing.zip) address += ` ${listing.zip}`;
  return `${address}, NY`;
}

// Google URL signing: HMAC-SHA1 of path + query with the URL-safe base64 secret.
export function signUrl(url, secret) {
  if (!secret) return url;
  const { pathname, search } = new URL(url);
  const key = Buffer.from(secret.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const signature = crypto
    .createHmac("sha1", key)
    .update(pathname + search)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${url}&signature=${signature}`;
}

// baseUrl is only for tests (pointing at a fake Google); leave it unset.
export function createStreetView({ key = process.env.GOOGLE_MAPS_API_KEY, secret = process.env.GOOGLE_MAPS_SIGNING_SECRET, fetchImpl = fetch, baseUrl = process.env.STREETVIEW_BASE_URL || BASE } = {}) {
  const enabled = Boolean(key);
  // Whether Google has imagery for a location. Metadata requests are free,
  // so this keeps us from paying for grey "no imagery" placeholders.
  const available = new Map();

  async function hasImagery(location) {
    if (available.has(location)) return available.get(location);
    const params = new URLSearchParams({ location, source: "outdoor", key });
    const res = await fetchImpl(signUrl(`${baseUrl}/maps/api/streetview/metadata?${params}`, secret));
    const ok = res.ok && (await res.json()).status === "OK";
    available.set(location, ok);
    return ok;
  }

  // Returns { contentType, body } or null when there's no photo to show.
  async function photo(listing) {
    if (!enabled) return null;
    const location = streetViewLocation(listing);
    if (!location || !(await hasImagery(location))) return null;
    const params = new URLSearchParams({ size: "640x320", location, fov: "80", source: "outdoor", return_error_code: "true", key });
    const res = await fetchImpl(signUrl(`${baseUrl}/maps/api/streetview?${params}`, secret));
    if (!res.ok) return null;
    return { contentType: res.headers.get("content-type") || "image/jpeg", body: Buffer.from(await res.arrayBuffer()) };
  }

  return { enabled, photo };
}
