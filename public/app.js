const form = document.getElementById("search");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const button = document.getElementById("go");
const tpl = document.getElementById("card-tpl");

fetch("/api/info")
  .then((r) => r.json())
  .then((info) => {
    const banner = document.getElementById("data-banner");
    if (info.sample) {
      banner.textContent = "Demo mode: these listings are made up. Don't refer anyone to them.";
      banner.hidden = false;
    } else if (info.unverified > 0) {
      banner.textContent = `Draft list: ${info.unverified} of ${info.count} places haven't been confirmed by phone yet. Call before sending anyone.`;
      banner.hidden = false;
    }
  })
  .catch(() => {});

for (const chip of document.querySelectorAll("[data-example]")) {
  chip.addEventListener("click", () => {
    document.getElementById("situation").value = chip.dataset.example;
    form.requestSubmit();
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function telHref(phone) {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

// Addresses outside Brooklyn (citywide intake sites) name their borough.
function mapQuery(address) {
  return /\b(Bronx|Manhattan|Queens|Staten Island)\b/i.test(address) ? `${address}, NY` : `${address}, Brooklyn, NY`;
}

// Plain-text version a worker can paste into a text message for the person.
function asText(r) {
  return [
    r.name,
    r.address ? r.address + (r.transit ? ` (${r.transit})` : "") : "",
    r.phone ? `Phone: ${r.phone}` : "",
    r.hours ? `Hours: ${r.hours}${r.hours_notes ? ". " + r.hours_notes : ""}` : r.hours_notes,
    r.what_to_bring ? `Bring: ${r.what_to_bring}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCard(r) {
  const card = tpl.content.firstElementChild.cloneNode(true);
  card.querySelector(".name").textContent = r.name;

  const badge = card.querySelector(".badge");
  badge.textContent = r.category === "food" ? "Food" : "Housing";
  badge.classList.add(r.category);

  const top = card.querySelector(".card-top");
  const pill = card.querySelector(".open-pill");
  pill.textContent = r.open.label;
  pill.classList.add(r.open.state);
  if (!r.verified) top.append(el("span", "unverified", "Not yet verified"));

  card.querySelector(".why").textContent = r.why;
  const offers = card.querySelector(".offers");
  if (r.why === r.offers) offers.remove();
  else offers.textContent = r.offers;

  const where = card.querySelector(".where");
  where.append(el("span", null, r.address || "Phone or online only"));
  if (r.neighborhood && r.address) where.append(el("span", "muted", r.neighborhood));
  if (r.transit) where.append(el("span", "muted", r.transit));

  const hours = card.querySelector(".hours");
  if (r.hours) hours.append(el("span", "muted", r.hours));
  if (r.hours_notes) hours.append(el("span", "note", r.hours_notes));

  if (!r.hours && !r.hours_notes) hours.append(el("span", "muted", "Not listed, call first"));
  const fill = (sel, value) => {
    const dd = card.querySelector(sel);
    if (value) dd.textContent = value;
    else {
      dd.previousElementSibling.remove();
      dd.remove();
    }
  };
  fill(".eligibility", r.eligibility);
  fill(".bring", r.what_to_bring);
  fill(".languages", r.languages);

  const call = card.querySelector(".call");
  if (r.phone) {
    call.href = telHref(r.phone);
    call.textContent = `Call ${r.phone}`;
  } else if (r.website) {
    call.href = r.website.startsWith("http") ? r.website : `https://${r.website}`;
    call.target = "_blank";
    call.rel = "noopener";
    call.textContent = `Visit ${r.website}`;
  } else {
    call.remove();
  }

  const map = card.querySelector(".map");
  if (r.address) map.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery(r.address));
  else map.remove();

  const copy = card.querySelector(".copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(asText(r));
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Couldn't copy";
    }
    setTimeout(() => (copy.textContent = "Copy"), 2000);
  });

  const verified = card.querySelector(".verified");
  if (r.verified) {
    verified.textContent = `Last verified by phone on ${formatDate(r.last_verified)}`;
  } else {
    verified.textContent = "Not confirmed by phone yet. Details come from public directories and may be out of date. Call before sending anyone.";
    verified.classList.add("pending");
  }
  return card;
}

function renderFallback(items) {
  const box = el("div", "fallback");
  box.append(el("h2", null, "Other places to call"));
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

function render(data) {
  resultsEl.replaceChildren();
  statusEl.replaceChildren();

  if (data.redacted || data.looks_like_personal_info) {
    statusEl.append(
      el("p", "warn", data.redacted
        ? "Some personal details (phone, ID or date numbers) were removed before searching. Please leave them out."
        : "This looks like it might include a name or other personal details. Please leave them out next time.")
    );
  }
  if (data.mode === "keyword") {
    statusEl.append(el("p", "info", "Basic keyword search (AI matching is off). Check eligibility yourself."));
  }
  if (data.message && data.mode !== "keyword") statusEl.append(el("p", "message", data.message));

  if (data.results.length === 0) {
    resultsEl.append(el("p", "empty", "Nothing on our verified list fits this situation."));
  }
  for (const r of data.results) resultsEl.append(renderCard(r));
  if (data.fallback?.length) resultsEl.append(renderFallback(data.fallback));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  button.disabled = true;
  button.textContent = "Finding…";
  statusEl.replaceChildren(el("p", "info", "Checking the verified list…"));
  resultsEl.replaceChildren();
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        situation: fd.get("situation"),
        zip: fd.get("zip"),
        urgency: fd.get("urgency"),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed.");
    render(data);
    resultsEl.firstElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    statusEl.replaceChildren(el("p", "warn", `${err.message} If it keeps happening, call 311.`));
  } finally {
    button.disabled = false;
    button.textContent = "Find next steps";
  }
});
