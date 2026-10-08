# Brooklyn Resource Finder (MVP)

A mobile web page with one search box for frontline workers in Brooklyn: hospital and ER social workers, pantry and shelter staff, library and school social workers. The worker describes a situation in plain words, e.g. *"Mom with 2 kids, evicted yesterday, no food at home, near Brownsville, speaks Spanish."* The page gives back 2–3 next steps from **your phone-verified list**. Each one shows what they offer, address and transit, whether it's open now, who's eligible, what to bring, a call button, and the date it was last verified.

It covers two needs only: **food** and **urgent housing**. No logins, no accounts, nothing saved.

## Run it

Requires Node 22+.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional, see "How matching works"
npm start                             # http://localhost:3000
```

Until `data/listings.csv` exists, the app runs on **made-up sample listings** and shows a red "Demo mode" banner on every page.

## Your listings spreadsheet

This is the core asset. Keep it in Google Sheets or Excel, then export it as CSV to `data/listings.csv`. Start from `data/listings-template.csv` (header row only); `data/sample-listings.csv` shows filled-in rows.

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Short code you choose (`F01`, `H07`). Never reuse one. |
| `name` | yes | |
| `category` | yes | `food` or `housing` |
| `offers` | yes | What they do, in plain words |
| `address` | yes | |
| `neighborhood` | | Helps match "near Brownsville" |
| `zip` | yes | 5 digits |
| `transit` | | Nearest subway or bus |
| `hours` | | Strict format, so "open now" can be worked out (see below). Blank shows "Hours unknown, call first". |
| `hours_notes` | | Anything irregular: "2nd Sat only", "line forms at 6pm", "by appointment" |
| `eligibility` | | Who can go |
| `what_to_bring` | | ID, proof of address, etc. |
| `phone` | yes | |
| `languages` | | e.g. `English, Spanish` |
| `website` | | |
| `last_verified` | yes | `YYYY-MM-DD` of your last phone call |
| `verified_by` | | Not shown to users or sent to the AI |
| `internal_notes` | | Not shown to users or sent to the AI |

**Hours format:** `Mon-Fri 09:00-17:00; Sat 10:00-14:00`. Use 24-hour time. For two windows on the same days, list both: `Tue,Thu 12:00-14:00 16:00-18:00`. Overnight: `Mon-Sun 19:00-24:00 00:00-08:00`. Always open: `24/7`.

**Check the file after every edit:**

```bash
npm run check-data
```

It lists rows with errors (missing address, unreadable hours, bad date, duplicate id) and rows not verified in the last 90 days. **Rows with errors are left out of search**, so a typo never turns into a wrong address or hour on someone's screen.

## How matching works

1. The worker's text is cleaned up first. Phone numbers, emails, SSNs, dates, Medicaid IDs and long ID numbers are removed. The text is never logged or stored.
2. **AI mode** (when `ANTHROPIC_API_KEY` is set): Claude reads the situation and the verified list and returns **only listing IDs**, plus a short line on why each one fits. The server then:
   - drops any ID that isn't in your spreadsheet,
   - fills in every fact shown (address, hours, phone, eligibility) **from the spreadsheet row, never from the AI's text**,
   - replaces a "why" line that mentions a phone number or time with the listing's own description.

   Claude also respects eligibility (no men's shelter for a mother with kids), prefers places open now when help is needed today, and flags text that looks like it has a name in it.
3. **Keyword mode** (no API key, or if the AI call fails): it matches on words like "food", "evicted" and "shelter", the zip code, open-now status and language. It doesn't check eligibility, and the page says so.
4. If nothing fits, or there are fewer than 2 results, the page shows 311, 988 and 911 (from `data/fallback-resources.json`).

The model is `claude-opus-5-5` at low effort (set `CLAUDE_MODEL` to change it). The listings block is prompt-cached, so repeat searches mostly pay for the short situation text. The request opts into server-side refusal fallbacks (`fallbacks: "default"`), so if the primary model declines a request, another model can answer it.

## Settings

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on AI matching |
| `CLAUDE_MODEL` | `claude-opus-5-5` | |
| `USE_AI` | on | `USE_AI=0` forces keyword mode |
| `PORT` | `3000` | |
| `LISTINGS_CSV` | `data/listings.csv` | Falls back to the sample file if missing |
| `RATE_LIMIT_PER_MIN` | `20` | Searches per minute per IP, to protect the API bill |
| `TRUST_PROXY` | off | Set to `1` on hosts behind a proxy (Render, Railway, Fly.io) so the limit applies per visitor, not to everyone at once |

## Tests

```bash
npm test
```

## Deploying

Any host that runs Node works (Render, Railway, Fly.io, a small VPS). Set `ANTHROPIC_API_KEY` there and commit your `data/listings.csv`. Put it behind HTTPS before sharing the link or QR code.

## Deliberately left out (see the plan)

SOS / case manager button, SMS, sponsor features, accounts and history, follow-up nudges, anything touching patient records, needs other than food and housing, other boroughs, multiple interface languages, native apps.
