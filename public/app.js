// API-START
const api = {
  info: () => fetch("/api/info").then((r) => r.json()),
  browse: (params) => fetch("/api/browse?" + new URLSearchParams(params)).then((r) => r.json()),
  zips: () => fetch("/nyc-zips.json").then((r) => r.json()),
  async report(body) {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't send the report.");
    return "Thanks. It's on the list to check by phone.";
  },
  async search(body) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed.");
    return data;
  },
  async searchOnline(body) {
    const res = await fetch("/api/search-online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Online search failed.");
    return data;
  },
};
// API-END

// Line icons, 24x24, drawn with currentColor strokes.
const ICONS = {
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  housing: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  health: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  mental_health: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M15.8 9.2a2.5 2.5 0 0 0-3.5 0l-.3.4-.35-.3a2.42 2.42 0 1 0-3.2 3.6l3.6 3.5 3.6-3.5c1.2-1.2 1.1-2.7.2-3.7"/>',
  education: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  jobs: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/>',
  legal: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  safety: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  community: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pin: '<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  who: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bring: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  link: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  directions: '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
};

const CATEGORY_TILES = [
  { key: "food", name: "Food", blurb: "Pantries, meals, SNAP" },
  { key: "housing", name: "Housing & shelter", blurb: "Shelter, drop-ins, eviction help" },
  { key: "health", name: "Health care", blurb: "Clinics, hospitals, insurance" },
  { key: "mental_health", name: "Mental health", blurb: "Crisis lines, counseling" },
  { key: "safety", name: "Safety", blurb: "Domestic violence help" },
  { key: "legal", name: "Legal help", blurb: "Lawyers, immigration" },
  { key: "jobs", name: "Jobs", blurb: "Job centers, unemployment" },
  { key: "education", name: "Education", blurb: "GED, English, school" },
  { key: "community", name: "Community & fun", blurb: "Skateparks, kids' programs, volunteering" },
];
const CATEGORY_NAMES = Object.fromEntries(CATEGORY_TILES.map((c) => [c.key, c.name]));
const BOROUGH_FILTERS = ["Manhattan", "Brooklyn", "Queens", "Bronx"];

const $ = (id) => document.getElementById(id);
const form = $("search");
const button = $("go");

function icon(name, size = 20) {
  const span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${ICONS[name] || ""}</svg>`;
  return span;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function telHref(phone) {
  return "tel:" + phone.replace(/x.*$/i, "").replace(/[^\d+]/g, "");
}

function webHref(site) {
  return site.startsWith("http") ? site : `https://${site}`;
}

// "Mon-Fri 09:00-17:00; Sat 10:00-14:00" -> "Mon–Fri 9am–5pm · Sat 10am–2pm"
function prettyHours(hours) {
  if (/^24\s*\/\s*7$/.test(hours.trim())) return "Open 24 hours, every day";
  const time = (t) => {
    const [h, m] = t.split(":").map(Number);
    if (h === 24 || (h === 0 && m === 0)) return "midnight";
    if (h === 12 && m === 0) return "noon";
    return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
  };
  return hours
    .split(";")
    .map((clause) => {
      const [days, ...windows] = clause.trim().split(/\s+/);
      const ranges = windows.map((w) => w.split("-").map(time).join("–"));
      return `${days.replace(/-/g, "–").replace(/,/g, ", ")} ${ranges.join(", ")}`;
    })
    .join(" · ");
}

function mapQuery(r) {
  const borough = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"].includes(r.borough) ? r.borough : "";
  return borough && !r.address.includes(borough) ? `${r.address}, ${borough}, NY` : `${r.address}, NY`;
}

// Plain-text version a worker can paste into a text message for the person.
function asText(r) {
  return [
    r.name,
    r.address ? r.address + (r.transit ? ` (${r.transit})` : "") : "",
    r.phone ? `Phone: ${r.phone}` : "",
    r.website ? `Web: ${r.website}` : "",
    r.hours ? `Hours: ${r.hours}${r.hours_notes ? ". " + r.hours_notes : ""}` : r.hours_notes,
    r.what_to_bring ? `Bring: ${r.what_to_bring}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function metaRow(iconName, label, ...lines) {
  const row = el("div", "meta");
  row.append(icon(iconName, 18));
  const body = el("div", "meta-body");
  body.append(el("span", "meta-label", label));
  for (const line of lines.filter(Boolean)) {
    body.append(typeof line === "string" ? el("span", null, line) : line);
  }
  row.append(body);
  return row;
}

function linkButton(className, href, iconName, text, external) {
  const a = el("a", className);
  a.href = href;
  if (external) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  a.append(icon(iconName, 18), el("span", null, text));
  return a;
}

// ---------- Distance ----------
// Where the person is, from the phone's location or a typed zip code. It's
// only used here in the browser to work out distances; it's never sent to
// the server.

let ZIPS = {};
let here = null; // { lat, lng, approx, label }

function coordsOf(r) {
  if (r.lat != null && r.lng != null) return { lat: r.lat, lng: r.lng, approx: false };
  if (r.address && ZIPS[r.zip]) return { lat: ZIPS[r.zip][0], lng: ZIPS[r.zip][1], approx: true };
  return null;
}

function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

function distanceOf(r) {
  const c = here && coordsOf(r);
  return c ? { miles: milesBetween(here, c), approx: c.approx || here.approx } : null;
}

// Exact positions get exact distances. Zip-code estimates are only good to
// about a mile, so they're rounded and say so.
function distanceLabel(d) {
  const m = d.miles;
  const walk = (min) => (m <= 2.5 ? ` · ${min} min walk` : "");
  if (!d.approx) {
    const text = m < 0.1 ? "Under 0.1 mi" : `${m < 10 ? m.toFixed(1) : Math.round(m)} mi`;
    return text + walk(Math.max(1, Math.round(m * 20)));
  }
  if (m < 1) return "Within about 1 mi";
  const rounded = Math.round(m * 2) / 2;
  return `About ${rounded % 1 ? rounded.toFixed(1) : rounded} mi` + walk(`~${Math.round((m * 20) / 5) * 5}`);
}

// ---------- Handout ----------
// Places the worker collects to give the person, kept for this browser tab.

let handout = [];
try {
  handout = JSON.parse(sessionStorage.getItem("handout") || "[]");
} catch {
  handout = [];
}
const HANDOUT_MAX = 6;

function inHandout(id) {
  return handout.some((h) => h.id === id);
}

// ---------- Thumbnails ----------
// Every card gets a drawn scene: the borough's skyline (or a phone and
// laptop for phone and online help), the category's icon and colors, and
// small details seeded from the listing id so cards don't look identical.
// When the server has a Google Maps key, a Street View photo of the
// building fades in on top for walk-in places.

let photosEnabled = false;

function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function towers(rand, { from = 0, to = 320, minH, maxH, minW = 14, maxW = 28, windows = false }) {
  let out = "";
  for (let x = from; x < to; ) {
    const w = minW + rand() * (maxW - minW);
    const h = minH + rand() * (maxH - minH);
    out += `<rect x="${x.toFixed(1)}" y="${(120 - h).toFixed(1)}" width="${(w - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
    if (windows && h > 40) {
      for (let wy = 120 - h + 8; wy < 112; wy += 9) out += `<rect class="win" x="${(x + 4).toFixed(1)}" y="${wy.toFixed(1)}" width="${Math.max(3, w - 10).toFixed(1)}" height="2.2"/>`;
    }
    x += w;
  }
  return out;
}

function skyline(borough, rand) {
  switch (borough) {
    case "Manhattan": {
      const spireX = 150 + rand() * 120;
      return towers(rand, { minH: 34, maxH: 82, windows: true }) +
        `<rect x="${spireX - 9}" y="30" width="18" height="90" rx="1.5"/><rect x="${spireX - 5}" y="18" width="10" height="14"/><rect x="${spireX - 1}" y="4" width="2" height="16"/>`;
    }
    case "Brooklyn": {
      const bx = 150 + rand() * 60;
      const tower = (x) => `<path d="M${x - 9} 120V50h18v70h-5V72a4 4 0 0 0-8 0v48Z"/>`;
      return towers(rand, { minH: 18, maxH: 36, minW: 12, maxW: 20 }) + tower(bx) + tower(bx + 110) +
        `<path class="cable" d="M${bx - 60} 92Q${bx + 55} 118 ${bx} 52M${bx} 52Q${bx + 55} 104 ${bx + 110} 52M${bx + 110} 52Q${bx + 165} 118 ${bx + 230} 92"/>` +
        `<rect x="${bx - 80}" y="88" width="330" height="4"/>`;
    }
    case "Queens": {
      const ux = 40 + rand() * 230;
      return towers(rand, { minH: 16, maxH: 44, minW: 16, maxW: 30 }) +
        `<g class="cable"><circle cx="${ux}" cy="66" r="22"/><ellipse cx="${ux}" cy="66" rx="9" ry="22"/><ellipse cx="${ux}" cy="66" rx="22" ry="8"/></g><rect x="${ux - 2}" y="88" width="4" height="32"/>`;
    }
    case "Bronx": {
      let trees = "";
      for (let i = 0; i < 5; i++) {
        const tx = rand() * 320;
        const r = 8 + rand() * 7;
        trees += `<circle cx="${tx.toFixed(1)}" cy="${(112 - r).toFixed(1)}" r="${r.toFixed(1)}"/><rect x="${(tx - 1.5).toFixed(1)}" y="${(112 - r).toFixed(1)}" width="3" height="${(r + 8).toFixed(1)}"/>`;
      }
      return towers(rand, { minH: 22, maxH: 56, minW: 18, maxW: 34, windows: true }) + trees;
    }
    default:
      return "";
  }
}

// Phone and online help: a phone and a laptop with signal arcs.
function devices(rand) {
  const px = 200 + rand() * 50;
  return `<rect x="${px}" y="36" width="34" height="64" rx="6"/><rect class="win" x="${px + 4}" y="44" width="26" height="44" rx="2"/>` +
    `<path class="cable" d="M${px + 46} 50a18 18 0 0 1 0 24M${px + 54} 42a30 30 0 0 1 0 40"/>` +
    `<rect x="${px - 120}" y="56" width="86" height="54" rx="5"/><rect class="win" x="${px - 114}" y="62" width="74" height="40" rx="2"/><rect x="${px - 130}" y="108" width="106" height="6" rx="3"/>`;
}

const SCENE_BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx"];

// Which skyline to draw. Citywide walk-in places (like PATH in the Bronx)
// still get their own borough's scene, read from the address.
function sceneBorough(r) {
  if (!r.address) return "";
  if (SCENE_BOROUGHS.includes(r.borough)) return r.borough;
  return SCENE_BOROUGHS.find((b) => r.address.includes(b) || (r.neighborhood || "").includes(b)) || "Manhattan";
}

function thumbnailSvg(r) {
  const rand = seededRandom(r.id);
  const borough = sceneBorough(r);
  const inCity = Boolean(borough);
  const sunX = 30 + rand() * 260;
  const cloud = (x, y, s) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"><ellipse cx="0" cy="0" rx="20" ry="8"/><ellipse cx="12" cy="-6" rx="12" ry="9"/></g>`;
  // Kept away from the edges, which get cropped in the taller detail view.
  const iconX = inCity ? 74 + rand() * 26 : 74;
  return `<svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="320" height="120" class="sky"/>
    <circle cx="${sunX.toFixed(1)}" cy="${(22 + rand() * 16).toFixed(1)}" r="${(10 + rand() * 6).toFixed(1)}" class="sun"/>
    <g class="clouds">${cloud(rand() * 300, 18 + rand() * 20, 0.7 + rand() * 0.5)}${cloud(rand() * 300, 30 + rand() * 18, 0.6 + rand() * 0.4)}</g>
    <g class="skyline">${inCity ? skyline(borough, rand) : devices(rand)}</g>
    <rect y="112" width="320" height="8" class="ground"/>
    <g transform="translate(${iconX.toFixed(1)} 60)"><g class="thumb-icon">
      <circle r="27" class="badge-bg"/>
      <g transform="translate(-15 -15) scale(1.25)" class="badge-icon">${ICONS[r.category] || ""}</g>
    </g></g>
  </svg>`;
}

// Photo info is looked up once per place per visit.
const photoInfo = new Map();
function lookupPhoto(id) {
  if (!photoInfo.has(id)) {
    photoInfo.set(id, fetch(`/api/photo/${encodeURIComponent(id)}/info`).then((res) => (res.ok ? res.json() : null)).catch(() => null));
  }
  return photoInfo.get(id);
}

function renderThumb(r) {
  const thumb = el("div", "thumb");
  thumb.innerHTML = thumbnailSvg(r);
  if (photosEnabled && r.has_photo) {
    lookupPhoto(r.id).then((info) => {
      if (!info) return; // no photo for this place: keep the drawing
      const img = new Image();
      img.alt = `Photo of ${r.name}`;
      img.loading = "lazy";
      img.decoding = "async";
      img.onload = () => {
        img.classList.add("loaded");
        thumb.classList.add("has-photo");
      };
      img.onerror = () => {
        img.remove();
        credit.remove();
      };
      img.src = info.src;
      // Photo credits are required by the licenses, so they link to the source.
      const credit = el(info.link ? "a" : "span", "photo-credit", info.credit);
      if (info.link) {
        credit.href = info.link;
        credit.target = "_blank";
        credit.rel = "noopener";
        credit.addEventListener("click", (e) => e.stopPropagation());
      }
      thumb.append(img, credit);
    });
  }
  return thumb;
}

function statusPills(r) {
  const pills = el("div", "pills");
  pills.append(el("span", `pill ${r.open.state}`, r.open.label));
  const d = distanceOf(r);
  if (d) {
    const dist = el("span", "pill distance");
    dist.append(icon("pin", 13), el("span", null, distanceLabel(d)));
    pills.append(dist);
  }
  if (!r.verified) pills.append(el("span", "pill unverified", "Not yet verified"));
  return pills;
}

function handoutToggle(r, { large = false } = {}) {
  const b = el("button", large ? "secondary save-toggle large" : "save-toggle");
  b.type = "button";
  b.dataset.id = r.id;
  paintToggle(b);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHandout(r);
  });
  return b;
}

function paintToggle(b) {
  const on = inHandout(b.dataset.id);
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", on ? "Remove from handout" : "Add to handout");
  b.replaceChildren(icon(on ? "check" : "plus", 16), el("span", null, on ? "In handout" : "Handout"));
}

// compact: browsing lists show the essentials and fold the rest away.
function renderCard(r, { compact = false } = {}) {
  const card = el("article", `card cat-${r.category}`);
  card.append(renderThumb(r));

  const head = el("div", "card-head");
  const titles = el("div", "card-titles");
  const h3 = el("h3", "name");
  const open = el("button", "card-link");
  open.type = "button";
  open.append(el("span", null, r.name), icon("chevron", 18));
  open.addEventListener("click", () => openDetail(r));
  h3.append(open);
  titles.append(h3, statusPills(r));
  head.append(titles, handoutToggle(r));
  card.append(head);
  card.addEventListener("click", (e) => {
    if (e.target.closest("a, button, summary, details, input, label, textarea")) return;
    openDetail(r);
  });

  if (!compact && r.why && r.why !== r.offers) card.append(el("p", "why", r.why));
  card.append(el("p", "offers", r.offers));

  const where = r.address
    ? [r.address, [r.neighborhood, r.borough].filter((v, i, a) => v && v !== "Citywide" && a.indexOf(v) === i).join(", "), r.transit]
    : [r.website ? "Online or by phone" : "By phone", r.neighborhood === "Online" ? "" : r.neighborhood];
  const hours = [r.hours ? prettyHours(r.hours) : "", r.hours_notes ? el("em", "note", r.hours_notes) : "", !r.hours && !r.hours_notes ? "Not listed, call first" : ""];

  const essentials = el("div", "meta-list");
  essentials.append(metaRow("pin", "Where", ...where), metaRow("clock", "Hours", ...hours));
  card.append(essentials);

  const extra = el("div", "meta-list");
  if (r.eligibility) extra.append(metaRow("who", "Who can go", r.eligibility));
  if (r.what_to_bring) extra.append(metaRow("bring", "Bring", r.what_to_bring));
  if (r.languages) extra.append(metaRow("globe", "Languages", r.languages));
  if (extra.children.length) {
    if (compact) {
      const details = el("details", "more");
      details.append(el("summary", null, "Who can go and what to bring"), extra);
      card.append(details);
    } else {
      card.append(extra);
    }
  }

  const actions = el("div", "actions");
  if (r.phone) actions.append(linkButton("primary call", telHref(r.phone), "phone", `Call ${r.phone}`));
  else if (r.website) actions.append(linkButton("primary call", webHref(r.website), "link", `Open ${r.website.replace(/^https?:\/\//, "").split("/")[0]}`, true));
  if (r.address) {
    actions.append(linkButton("secondary", "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery(r)), "map", "Map", true));
  }
  if (r.phone && r.website) actions.append(linkButton("secondary", webHref(r.website), "link", "Website", true));
  const copy = el("button", "secondary");
  copy.type = "button";
  const copyLabel = el("span", null, "Copy");
  copy.append(icon("copy", 18), copyLabel);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(asText(r));
      copyLabel.textContent = "Copied";
      copy.classList.add("done");
    } catch {
      copyLabel.textContent = "Couldn't copy";
    }
    setTimeout(() => {
      copyLabel.textContent = "Copy";
      copy.classList.remove("done");
    }, 2000);
  });
  actions.append(copy);
  card.append(actions);

  const verified = el("p", r.verified ? "verified" : "verified pending");
  verified.textContent = r.verified
    ? `Last verified by phone on ${formatDate(r.last_verified)}`
    : "Not confirmed by phone yet. Details come from public directories and may be out of date. Call before sending anyone.";
  card.append(verified);
  return card;
}

function renderFallback(items) {
  const box = el("div", "fallback");
  box.append(el("h3", null, "Other places to call"));
  const list = el("ul");
  for (const f of items) {
    const li = el("li");
    const a = el("a", null, f.name === f.phone ? f.phone : `${f.name}: ${f.phone}`);
    a.href = telHref(f.phone);
    li.append(a, el("span", "muted", f.when));
    list.append(li);
  }
  box.append(list);
  return box;
}

function withIndex(node, i) {
  node.style.setProperty("--i", i);
  return node;
}

// Counts tick up from zero the first time they appear.
function countUp(node, target) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !target) {
    node.textContent = String(target);
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 700);
    node.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function noteBox(kind, text) {
  const p = el("p", `note-box ${kind}`);
  p.append(icon(kind === "warn" ? "alert" : "info", 18), el("span", null, text));
  return p;
}

// ---------- Search ----------

const searchBlock = $("search-results");
const statusEl = $("status");
const resultsEl = $("results");
const buttonLabel = el("span", null, "Find next steps");
button.lastChild.replaceWith(buttonLabel);

let lastSearch = null;
function renderSearch(data) {
  lastSearch = data;
  statusEl.replaceChildren();
  resultsEl.replaceChildren();
  if (data.redacted || data.looks_like_personal_info) {
    statusEl.append(noteBox("warn", data.redacted
      ? "Some personal details (phone, ID or date numbers) were removed before searching. Please leave them out."
      : "This looks like it might include a name or other personal details. Please leave them out next time."));
  }
  if (data.mode === "keyword") statusEl.append(noteBox("info", "Basic keyword search (AI matching is off). Check eligibility yourself."));
  if (data.message && data.mode !== "keyword") statusEl.append(noteBox("message", data.message));
  if (data.results.length === 0) resultsEl.append(el("p", "empty", "Nothing on the list fits this situation. Try browsing by need below."));
  data.results.forEach((r, i) => resultsEl.append(withIndex(renderCard(r), i)));
  if (data.fallback?.length) resultsEl.append(renderFallback(data.fallback));
  if (data.gap && liveWeb) resultsEl.append(renderOnlineOffer());
  searchBlock.hidden = false;
}

// When the list has no good fit, the worker can ask the server to look
// online (only if LIVE_WEB_RESULTS=1). What comes back hasn't been checked
// by anyone, so it's shown apart from the list, with a clear warning.
let liveWeb = false;
let lastQuery = null;
function renderOnlineOffer() {
  const box = el("div", "online-offer");
  box.append(el("h3", null, "Not the right fit?"));
  box.append(el("p", "muted", "Search the web for more options. Takes about 30 seconds. What it finds hasn't been checked by anyone yet."));
  const btn = el("button", "secondary", "Search online");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Searching online…";
    try {
      const data = await api.searchOnline(lastQuery);
      box.replaceWith(renderOnlineResults(data));
    } catch (err) {
      box.querySelector("p").textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Try again";
    }
  });
  box.append(btn);
  return box;
}

function renderOnlineResults(data) {
  const box = el("section", "online-results");
  box.append(el("h3", null, "Found online"));
  box.append(noteBox("warn", "Not checked by anyone. Details can be wrong or out of date: call before sending someone. These have been sent to the team to review."));
  if (!data.results.length) box.append(el("p", "empty", "Nothing reliable turned up online either. Try the numbers above, or call 311."));
  for (const r of data.results) {
    const card = el("article", "online-card");
    card.append(el("h4", null, r.name), el("p", null, r.offers));
    const facts = [r.address && `${r.address}${r.borough && r.borough !== "Citywide" ? `, ${r.borough}` : ""}`, r.hours || r.hours_notes, r.eligibility && `For: ${r.eligibility}`].filter(Boolean);
    for (const f of facts) card.append(el("p", "muted", f));
    const actions = el("div", "actions");
    if (r.phone) actions.append(linkButton("primary call", telHref(r.phone), "phone", `Call ${r.phone}`));
    if (r.website) actions.append(linkButton("secondary", /^https?:/.test(r.website) ? r.website : "https://" + r.website, "link", "Website", true));
    card.append(actions);
    const src = el("p", "online-sources");
    src.append("Source: ");
    r.sources.forEach((u, i) => {
      const a = el("a", null, new URL(u).hostname.replace(/^www\./, ""));
      a.href = u;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      src.append(i ? ", " : "", a);
    });
    card.append(src);
    box.append(card);
  }
  return box;
}

// While the box is empty and not focused, example situations type themselves
// out in it, so people see what kind of description works.
const situation = $("situation");
const hint = $("typing-hint");
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const HINTS = [
  "Mom with 2 kids, evicted yesterday, near Brownsville…",
  "Single man, nowhere to sleep tonight in Harlem…",
  "Teen feeling hopeless, doesn't want a hospital…",
  "Laid off in the Bronx, needs work and food…",
  "Uninsured dad in Queens needs a doctor…",
];
if (!reduceMotion) {
  const placeholder = situation.placeholder;
  let h = 0;
  let pos = 0;
  let deleting = false;
  const idle = () => !situation.value && document.activeElement !== situation;
  const tick = () => {
    if (!idle()) {
      hint.hidden = true;
      situation.placeholder = placeholder;
      setTimeout(tick, 400);
      return;
    }
    situation.placeholder = "";
    hint.hidden = false;
    const text = HINTS[h];
    pos += deleting ? -2 : 1;
    hint.textContent = text.slice(0, Math.max(0, pos));
    let wait = deleting ? 18 : 42 + Math.random() * 40;
    if (!deleting && pos >= text.length) {
      deleting = true;
      wait = 1800;
    } else if (deleting && pos <= 0) {
      deleting = false;
      h = (h + 1) % HINTS.length;
      wait = 350;
    }
    setTimeout(tick, wait);
  };
  setTimeout(tick, 900);
  situation.addEventListener("focus", () => (hint.hidden = true));
}

document.querySelectorAll(".examples .chip").forEach((chip, i) => chip.style.setProperty("--i", i));

for (const chip of document.querySelectorAll("[data-example]")) {
  chip.addEventListener("click", () => {
    $("situation").value = chip.dataset.example;
    form.requestSubmit();
  });
}

$("clear-search").addEventListener("click", () => {
  searchBlock.hidden = true;
  lastSearch = null;
  form.reset();
  $("situation").focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  button.disabled = true;
  button.classList.add("busy");
  buttonLabel.textContent = "Finding…";
  try {
    const zip = String(fd.get("zip") || "").trim();
    if (!here && ZIPS[zip]) setHere({ lat: ZIPS[zip][0], lng: ZIPS[zip][1], approx: true, label: zip }, { refresh: false });
    lastQuery = { situation: fd.get("situation"), zip };
    const data = await api.search({ situation: fd.get("situation"), zip, urgency: fd.get("urgency") });
    renderSearch(data);
    searchBlock.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    statusEl.replaceChildren(noteBox("warn", `${err.message} If it keeps happening, call 311.`));
    resultsEl.replaceChildren();
    searchBlock.hidden = false;
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    buttonLabel.textContent = "Find next steps";
  }
});

// ---------- Browse ----------

const browse = { category: "", borough: "", openNow: false };
const grid = $("category-grid");
const panel = $("browse-panel");

function renderGrid() {
  grid.replaceChildren();
  CATEGORY_TILES.forEach((c, i) => {
    const tile = withIndex(el("button", `tile cat-${c.key}`), i);
    tile.type = "button";
    tile.dataset.category = c.key;
    tile.setAttribute("aria-pressed", String(browse.category === c.key));
    const ic = el("span", "cat-icon");
    ic.append(icon(c.key, 24));
    const text = el("span", "tile-text");
    text.append(el("span", "tile-name", c.name), el("span", "tile-blurb", c.blurb));
    tile.append(ic, text);
    tile.addEventListener("click", (e) => {
      if (!reduceMotion) addRipple(tile, e);
      openCategory(c.key);
    });
    grid.append(tile);
  });
}

// A ripple of the category color spreads from where the tile was tapped.
function addRipple(tile, e) {
  const box = tile.getBoundingClientRect();
  const ripple = el("span", "ripple");
  ripple.style.left = `${(e.clientX || box.left + box.width / 2) - box.left}px`;
  ripple.style.top = `${(e.clientY || box.top + box.height / 2) - box.top}px`;
  tile.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

function showCounts(counts = {}) {
  for (const tile of grid.children) {
    const n = counts[tile.dataset.category];
    if (!n) continue;
    const count = el("span", "tile-count", "0");
    tile.append(count);
    countUp(count, n);
  }
}

function renderBoroughFilters() {
  const row = $("borough-filters");
  row.replaceChildren();
  for (const b of ["", ...BOROUGH_FILTERS]) {
    const chip = el("button", "chip filter", b || "All boroughs");
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(browse.borough === b));
    chip.addEventListener("click", () => {
      browse.borough = b;
      renderBoroughFilters();
      loadBrowse();
    });
    row.append(chip);
  }
}

async function loadBrowse() {
  const list = $("browse-list");
  const { results } = await api.browse({ category: browse.category, borough: browse.borough, open: browse.openNow ? "1" : "" });
  if (here) {
    // Nearest first; phone and online help (no distance) after the places.
    const dist = (r) => distanceOf(r)?.miles ?? Infinity;
    results.sort((a, b) => dist(a) - dist(b));
  }
  const where = browse.borough ? ` in ${browse.borough} or citywide` : "";
  $("browse-count").textContent = `${results.length} ${results.length === 1 ? "resource" : "resources"}${where}${browse.openNow ? ", open now" : ""}${here ? ", nearest first" : ""}`;
  list.replaceChildren();
  if (!results.length) list.append(el("p", "empty", "Nothing matches these filters. Try another borough or turn off Open now."));
  // Cascade the first few cards in; the rest arrive together.
  results.forEach((r, i) => list.append(withIndex(renderCard(r, { compact: true }), Math.min(i, 6))));
}

async function openCategory(key) {
  browse.category = key;
  for (const t of grid.children) t.setAttribute("aria-pressed", String(t.dataset.category === key));
  panel.className = `browse-panel cat-${key}`;
  $("browse-icon").replaceChildren(icon(key, 26));
  $("browse-name").textContent = CATEGORY_NAMES[key];
  renderBoroughFilters();
  panel.hidden = false;
  await loadBrowse();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("open-now").addEventListener("change", (e) => {
  browse.openNow = e.target.checked;
  loadBrowse();
});

$("browse-close").addEventListener("click", () => {
  panel.hidden = true;
  browse.category = "";
  for (const t of grid.children) t.setAttribute("aria-pressed", "false");
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Location bar ----------

function renderNear() {
  $("near").classList.toggle("set", Boolean(here));
  $("near-title").textContent = here ? `Distances from ${here.label}` : "See how far each place is";
  $("near-sub").textContent = here
    ? `${here.approx ? "Approximate, measured from the zip code's center." : "Measured from where you are."} It stays on this device.`
    : "Use your location or a zip code. It stays on this device.";
  $("near-clear").hidden = !here;
}

function setHere(loc, { refresh = true } = {}) {
  here = loc;
  renderNear();
  if (refresh) refreshCards();
}

function refreshCards() {
  if (lastSearch) renderSearch(lastSearch);
  if (browse.category) loadBrowse();
}

$("use-location").addEventListener("click", () => {
  const btn = $("use-location");
  if (!navigator.geolocation) {
    $("near-sub").textContent = "This browser can't share location. Type a zip code instead.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      btn.textContent = "Use my location";
      setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude, approx: false, label: "your location" });
    },
    () => {
      btn.disabled = false;
      btn.textContent = "Use my location";
      $("near-sub").textContent = "Couldn't get your location. Type a zip code instead.";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
});

$("near-zip-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const zip = $("near-zip").value.trim();
  if (!ZIPS[zip]) {
    $("near-sub").textContent = "That isn't a New York City zip code. Try another.";
    return;
  }
  setHere({ lat: ZIPS[zip][0], lng: ZIPS[zip][1], approx: true, label: zip });
});

$("near-clear").addEventListener("click", () => {
  $("near-zip").value = "";
  setHere(null);
});

// ---------- Detail sheet ----------

const detail = $("detail");

function directionsHref(r) {
  return "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + encodeURIComponent(mapQuery(r));
}

function smsHref(text) {
  return "sms:?&body=" + encodeURIComponent(text);
}

function openDetail(r) {
  const body = $("detail-body");
  body.replaceChildren();
  detail.className = `sheet cat-${r.category}`;

  const top = el("div", "sheet-photo");
  top.append(renderThumb(r));
  const close = el("button", "icon-button close-sheet");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.append(icon("close", 20));
  top.append(close);
  body.append(top);

  const title = el("h2", null, r.name);
  title.id = "detail-name";
  body.append(title, statusPills(r));
  if (r.why && r.why !== r.offers) body.append(el("p", "why", r.why));
  body.append(el("p", "offers", r.offers));

  const main = el("div", "detail-main");
  if (r.address) main.append(linkButton("primary", directionsHref(r), "directions", "Directions", true));
  if (r.phone) main.append(linkButton(r.address ? "secondary" : "primary", telHref(r.phone), "phone", `Call ${r.phone}`));
  if (!r.phone && r.website) main.append(linkButton(r.address ? "secondary" : "primary", webHref(r.website), "link", `Open ${r.website.split("/")[0]}`, true));
  const more = el("div", "detail-more");
  if (r.phone && r.website) more.append(linkButton("secondary", webHref(r.website), "link", "Website", true));
  more.append(linkButton("secondary", smsHref(asText(r)), "message", "Text to client"));
  more.append(handoutToggle(r, { large: true }));
  body.append(main, more);

  const where = r.address
    ? [r.address, [r.neighborhood, r.borough].filter((v, i, a) => v && v !== "Citywide" && a.indexOf(v) === i).join(", "), r.transit]
    : [r.website ? "Online or by phone" : "By phone", r.neighborhood === "Online" ? "" : r.neighborhood];
  const list = el("div", "meta-list");
  list.append(metaRow("pin", "Where", ...where));
  list.append(metaRow("clock", "Hours", r.hours ? prettyHours(r.hours) : "Not listed, call first", r.hours_notes ? el("em", "note", r.hours_notes) : ""));
  if (r.eligibility) list.append(metaRow("who", "Who can go", r.eligibility));
  if (r.what_to_bring) list.append(metaRow("bring", "Bring", r.what_to_bring));
  if (r.languages) list.append(metaRow("globe", "Languages", r.languages));
  body.append(list);

  const verified = el("p", r.verified ? "verified" : "verified pending");
  verified.textContent = r.verified
    ? `Last verified by phone on ${formatDate(r.last_verified)}`
    : "Not confirmed by phone yet. Details come from public directories and may be out of date. Call before sending anyone.";
  body.append(verified, reportForm(r));

  detail.showModal();
  close.focus();
}

function reportForm(r) {
  const box = el("details", "report");
  const summary = el("summary");
  summary.append(icon("flag", 16), el("span", null, "Report wrong info"));
  box.append(summary);
  const form = el("form", "report-form");
  const issues = ["wrong phone", "wrong address", "wrong hours", "closed for good", "eligibility changed", "other"];
  const group = el("fieldset", "report-issues");
  group.append(el("legend", null, "What's wrong?"));
  issues.forEach((issue, i) => {
    const id = `issue-${r.id}-${i}`;
    const input = el("input");
    input.type = "radio";
    input.name = "issue";
    input.value = issue;
    input.id = id;
    const label = el("label", null, issue[0].toUpperCase() + issue.slice(1));
    label.htmlFor = id;
    const wrap = el("span", "issue");
    wrap.append(input, label);
    group.append(wrap);
  });
  const note = el("textarea");
  note.name = "note";
  note.rows = 2;
  note.maxLength = 300;
  note.placeholder = "What did you find? (No names or personal details.)";
  note.setAttribute("aria-label", "Details");
  const send = el("button", "secondary", "Send report");
  send.type = "submit";
  const status = el("p", "report-status");
  status.setAttribute("aria-live", "polite");
  form.append(group, note, send, status);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const issue = new FormData(form).get("issue");
    if (!issue) {
      status.textContent = "Pick what's wrong first.";
      return;
    }
    send.disabled = true;
    try {
      status.textContent = await api.report({ id: r.id, issue, note: note.value });
      form.reset();
    } catch (err) {
      status.textContent = err.message;
    } finally {
      send.disabled = false;
    }
  });
  box.append(form);
  return box;
}

detail.addEventListener("click", (e) => {
  if (e.target === detail || e.target.closest(".close-sheet")) detail.close();
});

// ---------- Handout tray and sheet ----------

const handoutSheet = $("handout");

function saveHandout() {
  try {
    sessionStorage.setItem("handout", JSON.stringify(handout));
  } catch {
    // Private windows can refuse storage; the handout still works for this visit.
  }
}

function toggleHandout(r) {
  const i = handout.findIndex((h) => h.id === r.id);
  if (i >= 0) handout.splice(i, 1);
  else if (handout.length < HANDOUT_MAX) handout.push(r);
  saveHandout();
  for (const b of document.querySelectorAll(`.save-toggle[data-id="${CSS.escape(r.id)}"]`)) paintToggle(b);
  renderTray(true);
  if (handoutSheet.open) renderHandout();
}

function renderTray(bump = false) {
  const tray = $("tray");
  tray.hidden = handout.length === 0;
  document.body.classList.toggle("has-tray", handout.length > 0);
  $("tray-count").textContent = `${handout.length} ${handout.length === 1 ? "place" : "places"}`;
  if (bump && !tray.hidden) {
    tray.classList.remove("bump");
    void tray.offsetWidth;
    tray.classList.add("bump");
  }
}

function handoutText() {
  return ["Your next steps:", ...handout.map((r, i) => `\n${i + 1}. ${asText(r)}`), "\nCall 311 if anything has changed."].join("\n");
}

function renderHandout() {
  const list = $("handout-list");
  list.replaceChildren();
  for (const r of handout) {
    const li = el("li", `handout-item cat-${r.category}`);
    const ic = el("span", "cat-icon small");
    ic.append(icon(r.category, 18));
    const text = el("div", "handout-text");
    text.append(el("strong", null, r.name));
    for (const line of [r.address, r.phone, r.hours ? prettyHours(r.hours) : r.hours_notes]) if (line) text.append(el("span", "muted", line));
    const remove = el("button", "icon-button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${r.name}`);
    remove.append(icon("trash", 18));
    remove.addEventListener("click", () => toggleHandout(r));
    li.append(ic, text, remove);
    list.append(li);
  }
  if (!handout.length) list.append(el("li", "empty", "Nothing here yet. Tap \"Handout\" on a place to add it."));

  const actions = $("handout-actions");
  actions.replaceChildren();
  if (!handout.length) return;
  actions.append(linkButton("primary call", smsHref(handoutText()), "message", "Text to the person"));
  const copy = el("button", "secondary");
  copy.type = "button";
  const copyLabel = el("span", null, "Copy all");
  copy.append(icon("copy", 18), copyLabel);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(handoutText());
      copyLabel.textContent = "Copied";
    } catch {
      copyLabel.textContent = "Couldn't copy";
    }
    setTimeout(() => (copyLabel.textContent = "Copy all"), 2000);
  });
  actions.append(copy);
  if (navigator.share) {
    const share = el("button", "secondary");
    share.type = "button";
    share.append(icon("share", 18), el("span", null, "Share"));
    share.addEventListener("click", () => navigator.share({ title: "Next steps", text: handoutText() }).catch(() => {}));
    actions.append(share);
  }
  const clear = el("button", "secondary");
  clear.type = "button";
  clear.append(icon("trash", 18), el("span", null, "Clear"));
  clear.addEventListener("click", () => {
    for (const r of [...handout]) toggleHandout(r);
  });
  actions.append(clear);
}

$("tray-open").addEventListener("click", () => {
  renderHandout();
  handoutSheet.showModal();
});
handoutSheet.addEventListener("click", (e) => {
  if (e.target === handoutSheet || e.target.closest(".close-sheet")) handoutSheet.close();
});

// ---------- Start ----------

renderGrid();
renderTray();
api.zips().then((z) => (ZIPS = z)).catch(() => {});
api.info()
  .then((info) => {
    showCounts(info.categories);
    photosEnabled = Boolean(info.photos);
    liveWeb = Boolean(info.live_web);
    const banner = $("data-banner");
    if (info.sample) {
      banner.textContent = "Demo mode: these listings are made up. Don't refer anyone to them.";
      banner.hidden = false;
    } else if (info.unverified > 0) {
      banner.textContent = `Draft list: ${info.unverified} of ${info.count} resources haven't been confirmed by phone yet. Call before sending anyone.`;
      banner.hidden = false;
    }
  })
  .catch(() => {});
