import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadListings } from "./listings.js";
import { redact } from "./privacy.js";
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
const loaded = loadListings(LISTINGS_PATH);
const { errors, warnings } = loaded;
const listings = ONLY_VERIFIED ? loaded.listings.filter((l) => l.verified) : loaded.listings;
const UNVERIFIED = listings.filter((l) => !l.verified).length;
console.log(`Loaded ${listings.length} listings (${UNVERIFIED} not yet verified) from ${path.relative(ROOT, LISTINGS_PATH)}${IS_SAMPLE ? " (SAMPLE DATA, not real places)" : ""}`);
for (const e of errors) console.warn(`  skipped ${e}`);
if (warnings.length) console.warn(`  ${warnings.length} warnings, run "npm run check-data" for details`);

const AI_ENABLED = process.env.USE_AI !== "0" && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
console.log(AI_ENABLED ? "AI matching on" : "AI matching off (no ANTHROPIC_API_KEY), using keyword matching");

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

async function handleSearch(req, res) {
  // Behind a hosting proxy every request comes from the proxy's address, so
  // use the client address the proxy forwards instead.
  const ip = process.env.TRUST_PROXY === "1"
    ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress
    : req.socket.remoteAddress;
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
  sendJson(res, 200, {
    ...out,
    mode,
    redacted,
    fallback: out.nothing_fits || out.results.length < 2 ? FALLBACK : [],
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/search") return await handleSearch(req, res);
    if (req.method === "GET" && req.url === "/api/info") {
      return sendJson(res, 200, { sample: IS_SAMPLE, count: listings.length, unverified: UNVERIFIED, categories: categoryCounts(listings), ai: AI_ENABLED, emergency: FALLBACK });
    }
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
