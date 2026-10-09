# NYC Resource Finder (MVP)

A mobile web page with one search box for frontline workers in New York City: hospital and ER social workers, pantry and shelter staff, library and school social workers. The worker describes a situation in plain words, e.g. *"Mom with 2 kids, evicted yesterday, no food at home, near Brownsville, speaks Spanish."* The page gives back 2–3 next steps from **your phone-verified list**. Each one shows what they offer, address and transit, whether it's open now, who's eligible, what to bring, a call button, and the date it was last verified.

It covers Manhattan, Brooklyn, Queens and the Bronx, plus citywide phone and online services, across **food**, **urgent housing**, **health care**, **mental health**, **education**, **jobs**, **legal help**, **safety** and **community** help. Listings can be walk-in places, hotlines, text lines or websites. No logins, no accounts, nothing saved.

## Run it

Requires Node 22+.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional, see "How matching works"
npm start                             # http://localhost:3000
```

`data/listings.csv` holds 145 real resources that haven't been verified by phone yet. The page labels each one "Not yet verified" and shows a banner until they're confirmed. Set `ONLY_VERIFIED=1` before real use to hide unverified rows. Without `data/listings.csv`, the app falls back to made-up sample listings with a "Demo mode" banner.

## Using the page

- **Search:** describe the situation in plain words (or tap an example) and get the 2–3 best matches.
- **Browse by need:** nine sections, each with its own icon and color: Food, Housing & shelter, Health care, Mental health, Safety, Legal help, Jobs, Education and Community & fun (skateparks, rec centers, free dance and fitness, free afterschool and summer programs, free museum days, teen centers, homework help and volunteering). Open one to see everything in it, filter by borough (citywide services always show), and tick "Open now".
- **Distances:** tap "Use my location" or type a zip code. Cards show "1.2 mi · 25 min walk" and browsing sorts nearest first. The location never leaves the device. Places with exact positions (from `npm run geocode`) get exact distances; the rest are estimated from their zip code and say "About".
- **Tap a place** to open its full details: big picture, Directions (Google Maps, transit), Call, Website, Text to client (a pre-filled text message), Add to handout, and Report wrong info.
- **Handout:** add 2–3 places and a tray appears at the bottom. Open it to text, copy or share them to the person as one list of next steps.
- **Report wrong info** saves to `data/reports.csv` on the server (not in git): date, listing, what's wrong and a note, with phone numbers and other personal details stripped. Use it as the call list for re-verifying.
- Each card shows whether it's open now, where it is, hours, who can go and what to bring, with buttons to call, map, open the website or copy the details into a text message.

## Your listings spreadsheet

This is the core asset. Keep it in Google Sheets or Excel, then export it as CSV to `data/listings.csv`. Start from `data/listings-template.csv` (header row only); `data/sample-listings.csv` shows filled-in rows.

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Short code you choose (`F01`, `H07`). Never reuse one. |
| `name` | yes | |
| `category` | yes | `food`, `housing`, `health`, `mental_health`, `education`, `jobs`, `legal`, `safety` or `community` |
| `offers` | yes | What they do, in plain words |
| `address` | one of these three | Leave blank for phone- or online-only help |
| `neighborhood` | | Helps match "near Brownsville" |
| `borough` | | `Manhattan`, `Brooklyn`, `Queens`, `Bronx`, `Staten Island`, or `Citywide` for phone and online help. Searches stay in the person's borough. |
| `zip` | | 5 digits |
| `transit` | | Nearest subway or bus |
| `hours` | | Strict format, so "open now" can be worked out (see below). Blank shows "Hours unknown, call first". |
| `hours_notes` | | Anything irregular: "2nd Sat only", "line forms at 6pm", "by appointment" |
| `eligibility` | | Who can go |
| `what_to_bring` | | ID, proof of address, etc. |
| `phone` | one of these three | |
| `languages` | | e.g. `English, Spanish` |
| `website` | one of these three | |
| `last_verified` | | `YYYY-MM-DD` of your last phone call. Blank means "Not yet verified". |
| `verified_by` | | Not shown to users or sent to the AI |
| `internal_notes` | | Not shown to users or sent to the AI |

**It's also your call sheet.** The 146 rows came from public directories and official sites in October 2026: food pantries, soup kitchens, drop-in centers, shelters, youth drop-ins, hospitals and clinics, crisis lines, Family Justice Centers, Workforce1 centers, legal and immigration help, libraries and adult classes, plus citywide phone and online services. The `to_confirm_on_call` column lists what each call needs to settle, and `sources` lists where each row came from.

**Hours format:** `Mon-Fri 09:00-17:00; Sat 10:00-14:00`. Use 24-hour time. For two windows on the same days, list both: `Tue,Thu 12:00-14:00 16:00-18:00`. Overnight: `Mon-Sun 19:00-24:00 00:00-08:00`. Always open: `24/7`.

**Exact map positions:** run `npm run geocode` from a computer with normal internet access. It looks up each address with NYC's free GeoSearch service and fills in the `lat` and `lng` columns, listing any address it couldn't find. Run it again after adding places (`npm run geocode -- --all` redoes everything). `npm run build-zips` rebuilds the zip code centers used for estimates.

**Check the file after every edit:**

```bash
npm run check-data
```

It lists rows with errors (no address, phone or website; unreadable hours; bad date; duplicate id), rows not verified yet, and rows not verified in the last 90 days. **Rows with errors are left out of search**, so a typo never turns into a wrong address or hour on someone's screen.

## How matching works

1. The worker's text is cleaned up first. Phone numbers, emails, SSNs, dates, Medicaid IDs and long ID numbers are removed. The text is never logged or stored.
2. **AI mode** (when `ANTHROPIC_API_KEY` is set): Claude reads the situation and the verified list and returns **only listing IDs**, plus a short line on why each one fits. The server then:
   - drops any ID that isn't in your spreadsheet,
   - fills in every fact shown (address, hours, phone, eligibility) **from the spreadsheet row, never from the AI's text**,
   - replaces a "why" line that mentions a phone number or time with the listing's own description.

   Claude also respects eligibility (no men's shelter for a mother with kids), prefers places open now when help is needed today, and flags text that looks like it has a name in it.
3. **Keyword mode** (no API key, or if the AI call fails): it matches on words like "food", "evicted", "court papers" and "nowhere to sleep", plus the neighborhood, zip, open-now status and language. It applies a few simple eligibility rules (no family intake for a single adult, no "ID required" place when the person has no ID). The page tells workers to check eligibility themselves.
4. If nothing fits, or there are fewer than 2 results, the page shows 311, 988 and 911 (from `data/fallback-resources.json`).

The model is `claude-opus-5-5` at low effort (set `CLAUDE_MODEL` to change it). The listings block is prompt-cached, so repeat searches mostly pay for the short situation text. The request opts into server-side refusal fallbacks (`fallbacks: "default"`), so if the primary model declines a request, another model can answer it.

## Thumbnails and Street View photos

Every card has a **drawn thumbnail**: the borough's skyline (or a phone and laptop for phone and online help) in the category's colors, with small details that vary per listing. Nothing to set up, and new listings get one automatically.

With a Google Maps key, walk-in places also get a **Street View photo** of the building, which fades in over the drawing. Places Google has no photo for, and phone or online services, keep the drawing.

1. In [Google Cloud](https://console.cloud.google.com/), create a project, turn on billing, and enable only the **Street View Static API**.
2. Create an API key and restrict it to that API.
3. Optional: copy the **URL signing secret** from the Street View Static API page; signed requests can't be reused if the key leaks.
4. Set `GOOGLE_MAPS_API_KEY` (and `GOOGLE_MAPS_SIGNING_SECRET`) on the server and restart.

Cost: Google bills each photo shown (about $7 per 1,000 after the monthly free allowance). The server first asks Google whether a photo exists (free), so you never pay for blank ones, and each browser keeps a photo for a day. Google's terms don't allow storing Street View images, so the server fetches them when needed instead of saving copies. The key stays on the server; browsers only see `/api/photo/<id>`.

The demo link can't show photos (previews block outside images), so it always shows the drawings.

## Settings

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on AI matching |
| `CLAUDE_MODEL` | `claude-opus-5-5` | |
| `ONLY_VERIFIED` | off | `1` hides listings without a `last_verified` date |
| `USE_AI` | on | `USE_AI=0` forces keyword mode |
| `PORT` | `3000` | |
| `LISTINGS_CSV` | `data/listings.csv` | Falls back to the sample file if missing |
| `GOOGLE_MAPS_API_KEY` | none | Turns on Street View photos for walk-in places |
| `GOOGLE_MAPS_SIGNING_SECRET` | none | Signs Street View requests (recommended) |
| `RATE_LIMIT_PER_MIN` | `20` | Searches per minute per IP, to protect the API bill |
| `TRUST_PROXY` | off | Set to `1` on hosts behind a proxy (Render, Railway, Fly.io) so the limit applies per visitor, not to everyone at once |

## Tests

```bash
npm test
```

## Deploying

Any host that runs Node works (Render, Railway, Fly.io, a small VPS). Set `ANTHROPIC_API_KEY` there and commit your `data/listings.csv`. Put it behind HTTPS before sharing the link or QR code.

## Deliberately left out (see the plan)

SOS / case manager button, SMS, sponsor features, accounts and history, follow-up nudges, anything touching patient records, Staten Island, multiple interface languages, native apps.
