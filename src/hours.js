// Opening hours in the spreadsheet use one simple format so they can be checked
// automatically:
//
//   Mon-Fri 09:00-17:00; Sat 10:00-14:00
//   Tue,Thu 12:00-14:00 16:00-18:00     (two windows on the same days)
//   24/7
//
// Days: Mon Tue Wed Thu Fri Sat Sun. Times: 24-hour HH:MM. A window may end at
// 24:00. Anything irregular ("2nd Saturday only", "call first") goes in the
// hours_notes column instead.

export const TIME_ZONE = "America/New_York";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

function parseDays(s) {
  const days = new Set();
  for (const part of s.toLowerCase().split(",")) {
    const range = part.split("-");
    const idx = range.map((d) => DAYS.indexOf(d.trim().slice(0, 3)));
    if (idx.some((i) => i < 0) || range.some((d) => d.trim().length < 3)) return null;
    if (idx.length === 1) {
      days.add(idx[0]);
    } else if (idx.length === 2) {
      for (let d = idx[0]; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === idx[1]) break;
      }
    } else {
      return null;
    }
  }
  return days;
}

// Returns { schedule: Array(7) of [startMin, endMin][], error: string|null }.
// An empty string means "hours unknown" and is not an error here (the
// validator reports it separately).
export function parseHours(text) {
  const schedule = Array.from({ length: 7 }, () => []);
  const src = (text || "").trim();
  if (!src) return { schedule, error: null, empty: true };
  if (/^24\s*\/\s*7$/.test(src)) {
    schedule.forEach((w) => w.push([0, 24 * 60]));
    return { schedule, error: null, empty: false };
  }
  for (const clause of src.split(";").map((c) => c.trim()).filter(Boolean)) {
    const [dayPart, ...windows] = clause.split(/\s+/);
    const days = parseDays(dayPart);
    if (!days) return { schedule, error: `can't read days "${dayPart}"`, empty: false };
    if (windows.length === 0) return { schedule, error: `no times after "${dayPart}"`, empty: false };
    for (const w of windows) {
      const [a, b] = w.split("-");
      const start = parseTime(a ?? "");
      const end = parseTime(b ?? "");
      if (start === null || end === null || end <= start) {
        return { schedule, error: `can't read time window "${w}" (use HH:MM-HH:MM, 24-hour)`, empty: false };
      }
      for (const d of days) schedule[d].push([start, end]);
    }
  }
  return { schedule, error: null, empty: false };
}

// Current weekday (0=Sun) and minutes past midnight in New York time.
export function nycClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = DAY_LABELS.indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function formatTime(min) {
  if (min === 0 || min === 24 * 60) return "midnight";
  if (min === 12 * 60) return "noon";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

// Returns { state: "open"|"closed"|"unknown", label: string }.
export function openStatus(hoursText, date = new Date()) {
  const { schedule, error, empty } = parseHours(hoursText);
  if (error || empty) return { state: "unknown", label: "Hours unknown, call first" };
  const { day, minutes } = nycClock(date);

  const current = schedule[day].find(([s, e]) => minutes >= s && minutes < e);
  if (current) {
    if (current[1] === 24 * 60 && current[0] === 0) return { state: "open", label: "Open 24 hours" };
    return { state: "open", label: `Open now, until ${formatTime(current[1])}` };
  }

  // Next opening within the coming week.
  for (let offset = 0; offset < 8; offset++) {
    const d = (day + offset) % 7;
    const next = schedule[d]
      .filter(([s]) => offset > 0 || s > minutes)
      .sort((a, b) => a[0] - b[0])[0];
    if (next) {
      const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_LABELS[d];
      return { state: "closed", label: `Closed now, opens ${when} ${formatTime(next[0])}` };
    }
  }
  return { state: "closed", label: "Closed" };
}
