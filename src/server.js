import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadListings } from "./listings.js";
import { redact } from "./privacy.js";
import { createPhotos } from "./photos.js";
import { parseCsv } from "./csv.js";
import { createGapLog, describeGap, gapKey, gapSummary } from "./gaps.js";
import { researchGap } from "./research.js";
import { createReviewQueue } from "./review.js";
import { browseListings, buildResponse, categoryCounts, matchWithClaude, matchWithKeywords } from "./matcher.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const MAX_SITUATION_CHARS = 1000;

// data/listings.csv is your list. Until it exists, the app runs on made-up
// sample data and says so on every page.
const realPath = path.join(ROOT, "data", "listings.csv");
const LISTINGS_PATH = process.env.LISTINGS_CSV || (fs.existsSync(realPath) ? realPath : path.join(ROOT, "data", "sample-listings.csv"));
const IS_SAMPLE = path.basename(LISTINGS_PATH).startsWith("sample");
const FALLBACK = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "fallback-resources.json"), "utf8"));

const ONLY_VERIFIED = process.env.ONLY_VERIFIED === "1";
let listings, allListings, UNVERIFIED, byId;
// Reloaded after a reviewer approves a new resource.
function reloadListings() {
  const loaded = loadListings(LISTINGS_PATH);
  allListings = loaded.listings;
  listings = ONLY_VERIFIED ? loaded.listings.filter((l) => l.verified) : loaded.listings;
  UNVERIFIED = listings.filter((l) => !l.verified).length;
  byId = new Map(listings.map((l) => [l.id, l]));
  return loaded;
}
const { errors, warnings } = reloadListings();
console.log(`Loaded ${listings.length} listings (${UNVERIFIED} not yet verified) from ${path.relative(ROOT, LISTINGS_PATH)}${IS_SAMPLE ? " (SAMPLE DATA, not real places)" : ""}`);
for (const e of errors) console.warn(`  skipped ${e}`);
if (warnings.length) console.warn(`  ${warnings.length} warnings, run "npm run check-data" for details`);

const AI_ENABLED = process.env.USE_AI !== "0" && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
console.log(AI_ENABLED ? "AI matching on" : "AI matching off (no ANTHROPIC_API_KEY), using keyword matching");

const photos = createPhotos();
console.log(`Photos: Wikimedia Commons on; Google Street View ${photos.providers.google ? "on" : "off (no GOOGLE_MAPS_API_KEY)"}; Mapillary ${photos.providers.mapillary ? "on" : "off (no MAPILLARY_TOKEN)"}`);

// Gaps: searches that came back thin. Only tags are kept (see src/gaps.js).
// GAP_LOG=0 turns this off.
const GAP_LOG = process.env.GAP_LOG !== "0" && !IS_SAMPLE;
const gapLog = createGapLog(path.join(ROOT, "data", "gaps.csv"));
const reviewQueue = createReviewQueue(path.join(ROOT, "data", "candidates.json"));

// The review page (/admin.html) needs ADMIN_TOKEN; without it, it's off.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
// LIVE_WEB_RESULTS=1 lets workers ask for "found online, not checked"
// results when the list has no good fit. Off by default.
const LIVE_WEB = process.env.LIVE_WEB_RESULTS === "1" && AI_ENABLED;
console.log(`Gap log ${GAP_LOG ? "on" : "off"}; review page ${ADMIN_TOKEN ? "on" : "off (no ADMIN_TOKEN)"}; live web results ${LIVE_WEB ? "on" : "off"}`);

// Workers flag wrong or outdated details from a listing. Reports go to
// data/reports.csv (kept out of git) for whoever does the phone checks.
const REPORT_ISSUES = ["wrong phone", "wrong address", "wrong hours", "closed for good", "eligibility changed", "other"];
const REPORTS_PATH = path.join(ROOT, "data", "reports.csv");

async function handleReport(req, res) {
  if (rateLimited(req.socket.remoteAddress)) return sendJson(res, 429, { error: "Too many reports in a minute. Try again shortly." });
  let body;
  try {
    body = JSON.parse(await readBody(req, 4000));
  } catch {
    return sendJson(res, 400, { error: "Couldn't read the report." });
  }
  const listing = byId.get(String(body.id || ""));
  const issue = String(body.issue || "");
  if (!listing || !REPORT_ISSUES.includes(issue)) return sendJson(res, 400, { error: "Pick what's wrong first." });
  const note = redact(String(body.note || "").replace(/\s+/g, " ").trim().slice(0, 300)).text;
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  if (!fs.existsSync(REPORTS_PATH)) fs.writeFileSync(REPORTS_PATH, "reported_at,id,name,issue,note\n");
  fs.appendFileSync(REPORTS_PATH, [new Date().toISOString(), listing.id, listing.name, issue, note].map(q).join(",") + "\n");
  sendJson(res, 200, { ok: true });
}

// /api/photo/<id>/info says whether there's a photo and whose it is (for the
// credit line); /api/photo/<id> is the image itself. 404 means "no photo",
// and the page keeps its drawn thumbnail.
async function handlePhoto(req, res, id, wantInfo) {
  const listing = byId.get(id);
  let photo = null;
  let image = null;
  try {
    photo = listing ? await photos.find(listing) : null;
    if (photo && !wantInfo) image = await photo.image();
  } catch (err) {
    console.error(`Photo failed for ${id}: ${err.message}`);
  }
  const cache = { "Cache-Control": "public, max-age=86400" };
  if (!photo || (!wantInfo && !image)) {
    res.writeHead(404, { ...SECURITY_HEADERS, ...cache });
    return res.end();
  }
  if (wantInfo) {
    res.writeHead(200, { ...SECURITY_HEADERS, ...cache, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ src: `/api/photo/${id}`, provider: photo.provider, credit: photo.credit, link: photo.link }));
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...cache, "Content-Type": image.contentType });
  res.end(image.body);
}

// Simple per-IP limit so a shared link can't run up the API bill.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) {
    for (const [key, times] of hits) if (now - times[times.length - 1] > 60_000) hits.delete(key);
  }
  return recent.length > RATE_LIMIT;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'",
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SECURITY_HEADERS);
    return res.end("Not found");
  }
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Behind a hosting proxy every request comes from the proxy's address, so
// use the client address the proxy forwards instead.
function clientIp(req) {
  return process.env.TRUST_PROXY === "1"
    ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress
    : req.socket.remoteAddress;
}

async function handleSearch(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: "Too many searches in a minute. Wait a moment and try again." });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Couldn't read the request." });
  }
  const raw = String(body.situation || "").trim().slice(0, MAX_SITUATION_CHARS);
  if (raw.length < 5) return sendJson(res, 400, { error: "Describe the situation in a few words first." });
  const zip = /^\d{5}$/.test(String(body.zip || "").trim()) ? String(body.zip).trim() : "";
  const urgency = body.urgency === "week" ? "week" : "today";

  // Personal details are stripped before matching. The situation text is
  // never logged or stored.
  const { text: situation, changed: redacted } = redact(raw);
  const query = { situation, zip, urgency };

  let match;
  let mode = "keyword";
  if (AI_ENABLED) {
    try {
      match = await matchWithClaude(query, listings);
      mode = "ai";
    } catch (err) {
      console.error(`AI match failed, falling back to keywords: ${err.name}: ${err.status ?? ""} ${err.message.slice(0, 200)}`);
    }
  }
  match ??= matchWithKeywords(query, listings);

  const out = buildResponse(match, listings);
  const gap = describeGap(query, out);
  if (gap && GAP_LOG) {
    try {
      gapLog.record(gap);
    } catch (err) {
      console.error(`Couldn't log gap: ${err.message}`);
    }
  }
  sendJson(res, 200, {
    ...out,
    mode,
    redacted,
    gap: Boolean(gap),
    fallback: out.nothing_fits || out.results.length < 2 ? FALLBACK : [],
  });
}

// "Search online": live web research for one worker's search. Results are
// labeled as unchecked, and also go to the review queue.
const webHits = new Map();
async function handleSearchOnline(req, res) {
  if (!LIVE_WEB) return sendJson(res, 404, { error: "Online search is off." });
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (webHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 3) return sendJson(res, 429, { error: "Online search is limited to 3 a minute. Try again shortly." });
  webHits.set(ip, [...recent, now]);
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Couldn't read the request." });
  }
  const raw = String(body.situation || "").trim().slice(0, MAX_SITUATION_CHARS);
  if (raw.length < 5) return sendJson(res, 400, { error: "Describe the situation in a few words first." });
  const zip = /^\d{5}$/.test(String(body.zip || "").trim()) ? String(body.zip).trim() : "";
  // Only the gap's tags go to the web research, never the worker's words.
  const situation = redact(raw).text;
  const gap = describeGap({ situation, zip }, { results: [], nothing_fits: true });
  try {
    const found = await researchGap(gap, allListings, { maxSearches: 3 });
    reviewQueue.add(gapKey(gap), found.accepted);
    sendJson(res, 200, { looked_for: gapSummary(gap), results: found.accepted });
  } catch (err) {
    console.error(`Online search failed: ${err.name}: ${err.status ?? ""} ${String(err.message).slice(0, 200)}`);
    sendJson(res, 502, { error: "Online search didn't work this time. Try again, or call 311." });
  }
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const given = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(ADMIN_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

async function handleAdmin(req, res, route) {
  if (!ADMIN_TOKEN) return sendJson(res, 404, { error: "The review page is off. Set ADMIN_TOKEN to turn it on." });
  if (!isAdmin(req)) return sendJson(res, 401, { error: "Wrong or missing admin token." });
  const body = req.method === "POST" ? JSON.parse((await readBody(req, 20_000)) || "{}") : {};
  if (req.method === "GET" && route === "gaps") {
    const researched = reviewQueue.researched();
    return sendJson(res, 200, { gaps: gapLog.summary(parseCsv).map((g) => ({ ...g, researched: researched[g.key] || "" })), ai: AI_ENABLED });
  }
  if (req.method === "GET" && route === "candidates") return sendJson(res, 200, { candidates: reviewQueue.pending() });
  if (req.method === "POST" && route === "research") {
    if (!AI_ENABLED) return sendJson(res, 400, { error: "Research needs ANTHROPIC_API_KEY." });
    const g = gapLog.summary(parseCsv).find((x) => x.key === body.key);
    if (!g) return sendJson(res, 404, { error: "That gap isn't in the log." });
    try {
      const found = await researchGap(g.gap, allListings);
      const added = reviewQueue.add(g.key, found.accepted);
      return sendJson(res, 200, { added: added.length, searches: found.searches, skipped: found.rejected.map((r) => ({ name: r.listing.name, problems: r.problems })) });
    } catch (err) {
      console.error(`Research failed: ${err.name}: ${err.status ?? ""} ${String(err.message).slice(0, 200)}`);
      return sendJson(res, 502, { error: "Research failed. Try again in a minute." });
    }
  }
  const m = /^candidates\/([\w-]+)\/(approve|reject)$/.exec(route);
  if (req.method === "POST" && m) {
    if (m[2] === "reject") return sendJson(res, reviewQueue.reject(m[1], body.reason) ? 200 : 404, { ok: true });
    const id = reviewQueue.approve(m[1], LISTINGS_PATH, {
      edits: body.edits || {},
      phoneChecked: Boolean(body.phone_checked),
      reviewer: String(body.reviewer || "").slice(0, 40),
    });
    if (!id) return sendJson(res, 404, { error: "Already handled." });
    reloadListings();
    return sendJson(res, 200, { ok: true, id });
  }
  sendJson(res, 404, { error: "Not found." });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/search") return await handleSearch(req, res);
    if (req.method === "POST" && req.url === "/api/report") return await handleReport(req, res);
    if (req.method === "POST" && req.url === "/api/search-online") return await handleSearchOnline(req, res);
    if (req.url.startsWith("/api/admin/")) return await handleAdmin(req, res, req.url.slice("/api/admin/".length).split("?")[0]);
    if (req.method === "GET" && req.url === "/api/info") {
      return sendJson(res, 200, { sample: IS_SAMPLE, count: listings.length, unverified: UNVERIFIED, categories: categoryCounts(listings), photos: true, ai: AI_ENABLED, live_web: LIVE_WEB, emergency: FALLBACK });
    }
    const photoMatch = req.method === "GET" && /^\/api\/photo\/([\w-]+)(\/info)?$/.exec(req.url);
    if (photoMatch) return await handlePhoto(req, res, photoMatch[1], Boolean(photoMatch[2]));
    if (req.method === "GET" && req.url.startsWith("/api/browse")) {
      const q = new URL(req.url, "http://x").searchParams;
      const results = browseListings(listings, {
        category: q.get("category") || "",
        borough: q.get("borough") || "",
        openNow: q.get("open") === "1",
      });
      return sendJson(res, 200, { results });
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405, SECURITY_HEADERS);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong. Try again, or call 311." });
  }
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
