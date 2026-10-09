import fs from "node:fs";
import crypto from "node:crypto";
import { parseCsv } from "./csv.js";

// The review queue: resources found online wait here (data/candidates.json,
// kept out of git) until a person approves or rejects them. Approving adds
// the row to the listings spreadsheet; it stays "not yet verified" unless
// the reviewer says they phoned and confirmed it.

const EMPTY = { candidates: [], researched: {} };

export function createReviewQueue(file) {
  const load = () => (fs.existsSync(file) ? { ...EMPTY, ...JSON.parse(fs.readFileSync(file, "utf8")) } : structuredClone(EMPTY));
  const save = (data) => {
    fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 1));
    fs.renameSync(file + ".tmp", file);
  };

  return {
    pending: () => load().candidates.filter((c) => c.status === "pending"),
    researched: () => load().researched,

    add(gapKey, listings, now = new Date()) {
      const data = load();
      const known = new Set(data.candidates.map((c) => c.listing.name.toLowerCase()));
      const added = [];
      for (const listing of listings) {
        if (known.has(listing.name.toLowerCase())) continue;
        const c = { cid: crypto.randomUUID().slice(0, 8), gap_key: gapKey, found_at: now.toISOString().slice(0, 10), status: "pending", listing };
        data.candidates.push(c);
        known.add(listing.name.toLowerCase());
        added.push(c);
      }
      if (gapKey) data.researched[gapKey] = now.toISOString().slice(0, 10);
      save(data);
      return added;
    },

    // Edits are the reviewer's corrections (e.g. a fixed phone number).
    approve(cid, csvPath, { edits = {}, phoneChecked = false, reviewer = "" } = {}, now = new Date()) {
      const data = load();
      const c = data.candidates.find((x) => x.cid === cid && x.status === "pending");
      if (!c) return null;
      const listing = { ...c.listing, ...Object.fromEntries(Object.entries(edits).filter(([k]) => k in c.listing && k !== "sources")) };
      const id = appendListing(csvPath, listing, {
        last_verified: phoneChecked ? now.toISOString().slice(0, 10) : "",
        verified_by: phoneChecked ? reviewer : "",
        internal_notes: `Found by gap research ${c.found_at}; approved ${now.toISOString().slice(0, 10)}${reviewer ? ` by ${reviewer}` : ""}.`,
      });
      c.status = "approved";
      c.id = id;
      save(data);
      return id;
    },

    reject(cid, reason = "") {
      const data = load();
      const c = data.candidates.find((x) => x.cid === cid && x.status === "pending");
      if (!c) return false;
      c.status = "rejected";
      c.reject_reason = String(reason).slice(0, 200);
      save(data);
      return true;
    },
  };
}

// Appends one listing to the spreadsheet with a new W-number id
// ("W" for found on the web), using the file's own column order.
export function appendListing(csvPath, listing, extra = {}) {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  const header = rows[0];
  const used = rows.slice(1).map((r) => r[0]).filter((id) => /^W\d+$/.test(id)).map((id) => Number(id.slice(1)));
  const id = "W" + String(Math.max(0, ...used) + 1).padStart(3, "0");
  const row = { ...listing, ...extra, id, sources: (listing.sources || []).join(" ") };
  const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.appendFileSync(csvPath, (text.endsWith("\n") ? "" : "\n") + header.map((h) => q(row[h] ?? "")).join(",") + "\n");
  return id;
}
