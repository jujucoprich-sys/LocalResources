// Review page: lists gaps and pending candidates; runs research; approves
// or rejects. The token lives only in sessionStorage for this tab.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let token = "";
try {
  token = sessionStorage.getItem("nextstep-admin") || "";
} catch {}

async function call(path, body) {
  const res = await fetch("/api/admin/" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, ...(body && { "Content-Type": "application/json" }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed."), { status: res.status });
  return data;
}

const FIELDS = [
  ["name", "Name", "wide"],
  ["offers", "What they offer", "wide"],
  ["eligibility", "Who it's for", "wide"],
  ["address", "Address"],
  ["neighborhood", "Neighborhood"],
  ["borough", "Borough"],
  ["zip", "Zip"],
  ["phone", "Phone"],
  ["website", "Website"],
  ["hours", "Hours (e.g. Mon-Fri 09:00-17:00)"],
  ["hours_notes", "Hours notes"],
  ["what_to_bring", "What to bring"],
  ["languages", "Languages"],
];
const LABELS = { food: "Food", housing: "Housing", health: "Health", mental_health: "Mental health", education: "Education", jobs: "Jobs", legal: "Legal", safety: "Safety", community: "Community" };

function renderCandidate(c) {
  const li = el("li", "cand");
  const head = el("div", "cand-head");
  head.append(el("strong", null, c.listing.name), el("span", "cand-for", `${LABELS[c.listing.category] || c.listing.category} · found ${c.found_at} for "${c.gap_key}"`));
  const fields = el("div", "cand-fields");
  const inputs = {};
  for (const [key, label, wide] of FIELDS) {
    const lab = el("label", wide || null, label);
    const input = key === "offers" || key === "eligibility" ? el("textarea") : el("input");
    if (input.tagName === "TEXTAREA") input.rows = 2;
    input.value = c.listing[key] || "";
    inputs[key] = input;
    lab.append(input);
    fields.append(lab);
  }
  const sources = el("div", "cand-sources");
  sources.append(el("strong", null, "Sources: "));
  c.listing.sources.forEach((url, i) => {
    const a = el("a", null, new URL(url).hostname.replace(/^www\./, ""));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    sources.append(i ? ", " : "", a);
  });
  li.append(head, fields, sources);
  if (c.listing.to_confirm_on_call) li.append(el("p", "cand-confirm", "Confirm on the call: " + c.listing.to_confirm_on_call));

  const actions = el("div", "cand-actions");
  const check = el("label", "check");
  const checked = el("input");
  checked.type = "checkbox";
  check.append(checked, "I phoned and confirmed these details");
  const who = el("input", "who");
  who.placeholder = "Your initials";
  who.maxLength = 40;
  const approve = el("button", "primary", "Approve");
  const reject = el("button", null, "Reject");
  approve.type = reject.type = "button";
  approve.addEventListener("click", async () => {
    const edits = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    approve.disabled = reject.disabled = true;
    try {
      const { id } = await call(`candidates/${c.cid}/approve`, { edits, phone_checked: checked.checked, reviewer: who.value.trim() });
      li.replaceChildren(el("p", null, `Added as ${id}. It now shows up in searches${checked.checked ? " as verified" : ", labeled \"call first\""}.`));
    } catch (err) {
      alert(err.message);
      approve.disabled = reject.disabled = false;
    }
  });
  reject.addEventListener("click", async () => {
    const reason = prompt("Why reject it? (optional, e.g. closed, wrong place)") ?? null;
    if (reason === null) return;
    approve.disabled = reject.disabled = true;
    try {
      await call(`candidates/${c.cid}/reject`, { reason });
      li.replaceChildren(el("p", "empty", `Rejected ${c.listing.name}.`));
    } catch (err) {
      alert(err.message);
      approve.disabled = reject.disabled = false;
    }
  });
  actions.append(check, who, approve, reject);
  li.append(actions);
  return li;
}

function renderGap(g, ai) {
  const li = el("li", "gap");
  li.append(el("span", "gap-title", g.summary[0].toUpperCase() + g.summary.slice(1)));
  const times = g.count === 1 ? "1 search" : `${g.count} searches`;
  li.append(el("span", "gap-meta", `${times}, last ${g.last_seen}. Missing: ${g.reasons.join("; ")}.${g.researched ? ` Researched ${g.researched}.` : ""}`));
  const btn = el("button", g.researched ? null : "primary", g.researched ? "Research again" : "Find resources");
  btn.type = "button";
  btn.disabled = !ai;
  if (!ai) btn.title = "Needs ANTHROPIC_API_KEY on the server";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Searching the web…";
    $("research-status").textContent = `Researching "${g.summary}". This takes about a minute.`;
    try {
      const r = await call("research", { key: g.key });
      const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.name} (${s.problems.join(", ")})`).join("; ")}.` : "";
      $("research-status").textContent = `Found ${r.added} new to review after ${r.searches} web searches.${skipped}`;
      await load();
    } catch (err) {
      $("research-status").textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Find resources";
    }
  });
  li.append(btn);
  return li;
}

async function load() {
  const [{ gaps, ai }, { candidates }] = await Promise.all([call("gaps"), call("candidates")]);
  $("pending-count").textContent = `(${candidates.length})`;
  $("gap-count").textContent = `(${gaps.length})`;
  const cl = el("ul", "cand-list");
  candidates.forEach((c) => cl.append(renderCandidate(c)));
  $("candidates").replaceChildren(candidates.length ? cl : el("p", "empty", "Nothing waiting. Use \"Find resources\" on a gap below."));
  const gl = el("ul", "gap-list");
  gaps.forEach((g) => gl.append(renderGap(g, ai)));
  $("gaps").replaceChildren(gaps.length ? gl : el("p", "empty", "No gaps logged yet. They appear when searches come back thin."));
}

async function open() {
  try {
    await load();
    $("login").hidden = true;
    $("admin").hidden = false;
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").hidden = false;
  }
}

$("login").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  try {
    sessionStorage.setItem("nextstep-admin", token);
  } catch {}
  open();
});
if (token) open();
