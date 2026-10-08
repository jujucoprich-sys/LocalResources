const form = document.getElementById("search");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const button = document.getElementById("go");
const tpl = document.getElementById("card-tpl");

fetch("/api/info")
  .then((r) => r.json())
  .then((info) => {
    if (info.sample) document.getElementById("sample-banner").hidden = false;
  })
  .catch(() => {});

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

// Plain-text version a worker can paste into a text message for the person.
function asText(r) {
  return [
    r.name,
    r.address + (r.transit ? ` (${r.transit})` : ""),
    `Phone: ${r.phone}`,
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

  card.querySelector(".why").textContent = r.why;
  const offers = card.querySelector(".offers");
  if (r.why === r.offers) offers.remove();
  else offers.textContent = r.offers;

  const where = card.querySelector(".where");
  where.append(el("span", null, r.address));
  if (r.transit) where.append(el("span", "muted", r.transit));

  const hours = card.querySelector(".hours");
  hours.append(el("span", `open-state ${r.open.state}`, r.open.label));
  if (r.hours) hours.append(el("span", "muted", r.hours));
  if (r.hours_notes) hours.append(el("span", "note", r.hours_notes));

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
  call.href = telHref(r.phone);
  call.textContent = `Call ${r.phone}`;

  card.querySelector(".map").href =
    "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${r.address}, Brooklyn, NY`);

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

  card.querySelector(".verified").textContent = `Last verified by phone on ${formatDate(r.last_verified)}`;
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
