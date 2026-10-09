import Anthropic from "@anthropic-ai/sdk";
import { listingForModel } from "./listings.js";
import { nycClock, openStatus } from "./hours.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_RESULTS = 3;

const SYSTEM_RULES = `You help frontline workers in New York City (hospital social workers, food pantry and shelter staff, library and school social workers) find next steps for someone they're helping. The list covers all five boroughs, plus citywide phone and online services, across food, urgent housing, health care, mental health, education, jobs, legal help, safety and community help. Some listings are walk-in places; others are hotlines, text lines or websites. The worker describes the person's situation in plain words. You pick the 2-3 best options from the VERIFIED LISTINGS below.

Rules:
- Only recommend listings from VERIFIED LISTINGS, by their exact id. Never invent or suggest any other place, program, address, phone number, or hours.
- Recommend at most 3. Fewer is better than a weak fit. Order them best first.
- If the situation has more than one need (e.g. food and housing), cover the most urgent need first, then the others if a listing fits.
- If the person may be in danger of suicide or self-harm, put a 24/7 crisis line first (NYC 988) and say in "message" to call 911 if there is immediate danger.
- Respect eligibility. Don't recommend a listing the person clearly doesn't qualify for (e.g. a men's shelter for a mother with children).
- Respect age limits. If the person is under 18, never recommend adult-only places (18+, single adults, adult shelter intake); use youth drop-ins and youth shelters that serve their age. If they're over 24, don't recommend youth-only programs.
- If the worker needs help today, prefer listings that are open now or later today. Respect hours_notes.
- Prefer listings with verified: true. Unverified listings may be recommended when they fit clearly better; the app labels them "call first".
- Some listings are citywide intake sites outside Brooklyn (e.g. PATH for families with children). Recommend them when the situation requires that intake.
- Prefer walk-in listings in the person's borough and neighborhood. Don't send someone across the city when a closer listing fits. Listings with borough "Citywide" serve everyone.
- If someone may be unsafe at home, include domestic violence help (NYC Hope Hotline or a Family Justice Center) and say in "message" to call 911 in immediate danger.
- Prefer listings in or near the person's neighborhood or zip, and ones that speak the person's language when it's mentioned.
- "why" is one short sentence, in plain words, saying why this option fits this situation. Do not state addresses, phone numbers, or hours in "why"; those are shown to the worker from the verified data.
- If nothing in the list fits a need, set nothing_fits to true for that case and say so plainly in "message" (one or two sentences). The app will show NYC 311 and crisis hotlines, and logs the gap so the team can find more resources.
- "message" is optional context for the worker: an important gap, an eligibility caution, or what to ask the person. Leave it empty if there's nothing useful to add.
- Set looks_like_personal_info to true if the text seems to contain a person's name, exact street address of the person, date of birth, or ID number.

VERIFIED LISTINGS (JSON):
`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          why: { type: "string" },
        },
        required: ["id", "why"],
        additionalProperties: false,
      },
    },
    nothing_fits: { type: "boolean" },
    message: { type: "string" },
    looks_like_personal_info: { type: "boolean" },
  },
  required: ["results", "nothing_fits", "message", "looks_like_personal_info"],
  additionalProperties: false,
};

export function buildSystemPrompt(listings) {
  return SYSTEM_RULES + JSON.stringify(listings.map(listingForModel), null, 1);
}

function buildUserMessage({ situation, zip, urgency }, listings, now) {
  const { day, minutes } = nycClock(now);
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const openIds = listings.filter((l) => openStatus(l.hours, now).state === "open").map((l) => l.id);
  return [
    `Right now in New York City: ${dayName} ${time}.`,
    `Listings open right now: ${openIds.length ? openIds.join(", ") : "none"}.`,
    `Needs help: ${urgency === "week" ? "this week" : "today"}.`,
    zip ? `Person's zip code: ${zip}.` : null,
    "",
    "Situation, as described by the worker:",
    situation,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// Asks Claude to pick listings. Returns the parsed JSON object.
export async function matchWithClaude(query, listings, { client, now = new Date() } = {}) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    // The listings block is identical across searches, so it's cached.
    system: [{ type: "text", text: buildSystemPrompt(listings), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(query, listings, now) }],
  });

  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("model response was cut off");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("model returned no text");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Keyword matcher: used when no API key is configured, or if the AI call
// fails. Cruder, but still only ever returns verified listings.

const NEED_WORDS = {
  food: ["wic", "food", "hungry", "hunger", "eat", "meal", "pantry", "groceries", "grocery", "snap", "ebt", "food stamps", "formula", "lunch", "dinner", "breakfast", "soup kitchen", "comida", "hambre"],
  health: ["doctor", "clinic", "sick", "insurance", "medicaid", "medicine", "medication", "prescription", "prenatal", "dentist", "dental", "tooth", "teeth", "std", "sti", "hiv", "prep", "birth control", "sexual health", "plan b", "uninsured", "checkup", "health care", "healthcare", "injury", "pain"],
  mental_health: ["depress", "anxiety", "anxious", "suicid", "kill myself", "hopeless", "therapy", "therapist", "counsel", "mental", "stress", "panic", "grief", "grieving", "self-harm", "lonely", "loneliness", "crisis", "overwhelmed", "trauma", "overdos", "using drugs", "addict", "opioid", "heroin", "fentanyl", "naloxone", "narcan", "drinking problem", "sober", "recovery", "veteran", "alcohol", "drinking", "aa meeting", "aa meetings", "al-anon", "alateen", "narcotics anonymous", "sobriety"],
  education: ["school", "enroll", "ged", "hse", "high school", "english class", "learn english", "esol", "literacy", "college", "computer skills", "learn to read", "resume", "job search"],
  jobs: ["job", "jobs", "need work", "find work", "looking for work", "out of work", "unemploy", "laid off", "fired", "lost (my|his|her|their) job", "career", "hiring", "interview", "job training", "training program", "summer job", "work as a", "internship"],
  legal: ["lawyer", "legal", "attorney", "immigra", "green card", "citizenship", "daca", "tps", "asylum", "deport", "visa", "court date", "sued", "debt collector"],
  safety: ["abuse", "abusive", "hits me", "hurting", "domestic violence", "unsafe at home", "partner hurt", "boyfriend hurt", "girlfriend hurt", "husband hurt", "wife hurt", "threaten", "stalk", "assault", "raped", "rape", "molest", "order of protection", "afraid of", "trafficked", "trafficking", "forcing me to work", "forced to work", "took my passport", "being hurt", "child abuse", "hate crime", "bias", "harass", "discriminat", "elder abuse"],
  community: ["skate", "dance", "zumba", "fun", "hang out", "hangout", "video game", "gaming", "games", "study", "homework", "tutor", "camp", "summer program", "childcare", "babysit", "a break", "sports", "basketball", "gym", "swim", "pool", "fitness", "exercise", "work out", "workout", "museum", "zoo", "things to do", "bored", "activities", "recreation", "rec center", "volunteer", "metrocard", "fare", "id card", "idnyc", "taxes", "tax", "benefits", "older adult", "senior", "afterschool", "after school", "community", "mutual aid", "neighbors", "isolated", "city services", "311", "help line", "where to start"],
  housing: ["evict", "eviction", "evicted", "homeless", "shelter", "heat", "heating", "utility bill", "con ed", "sleep", "nowhere", "kicked out", "lost his room", "lost her room", "drop-in", "court papers", "behind on rent", "housing", "rent", "landlord", "lockout", "locked out", "sleeping", "street", "couch", "nowhere to stay", "place to stay", "place to live", "somewhere to live", "need a home", "apartment", "a room", "housing program", "housing court", "marshal", "arrears", "desalojo", "vivienda", "albergue"],
};
export const CATEGORY_LABELS = {
  food: "Food help",
  housing: "Housing help",
  health: "Health care",
  mental_health: "Mental health support",
  education: "Education",
  jobs: "Job help",
  legal: "Legal help",
  safety: "Safety support",
  community: "Community help",
};
const LANGUAGES = ["spanish", "chinese", "mandarin", "cantonese", "haitian creole", "creole", "russian", "arabic", "bengali", "urdu", "polish", "yiddish", "french"];

// Situation words that point to a kind of help, matched against the
// listing's own text: [situation pattern, listing pattern, score, reason].
const LGBTQ = /\b(lgbt|gay|lesbian|bi|bisexual|trans|transgender|queer|nonbinary)\b/i;
const NO_ID = /\bno id\b|without (an )?id|(doesn'?t|does not|don'?t) have (an )?id/i;
const IMMIGRATION = /\b(immigra|deport|asylum|green card|visa|citizenship|daca|tps|undocumented|papers)/i;
const TOPICS = [
  [/\b(court|lawyer|attorney|marshal|lockout|locked out|landlord|evict)/i, /lawyer|legal|eviction defense|court/i, 3, "free legal help"],
  [/\b(rent|arrears|behind)/i, /back rent|rent help|eviction prevention/i, 3, "help with back rent"],
  [/\b(kids?|children|child|baby|pregnant|families|son|daughter)\b/i, /families with children/i, 4, "for families with children"],
  [/\b(sleep|street|nowhere|tonight|homeless|shelter|lost (his|her|their) room|kicked out)/i, /intake|drop-in|shelter/i, 3, "a place to stay"],
  [/\b(meal|hungry|hot food|eat|lunch|dinner|breakfast)/i, /meal|soup kitchen|lunch|breakfast|dinner/i, 2, "serves meals"],
  [NO_ID, /no id needed|not turned away/i, 2, "no ID needed"],
  [/\b(suicid|kill (my|him|her)self|self-harm|hopeless|crisis|want to die)/i, /crisis counseling/i, 5, "24/7 crisis support"],
  [LGBTQ, /LGBTQ/i, 4, "LGBTQ support"],
  [/\b(overdos|using drugs|addict|opioid|heroin|fentanyl|naloxone|narcan)/i, /harm reduction|overdose|substance use/i, 5, "overdose prevention and drug help"],
  [/\b(rape|raped|sexual(ly)? assault|molest)/i, /sexual assault|sexual violence/i, 5, "support after sexual assault"],
  [/\b(traffick|forc(ed|ing) (me )?to work|took my passport)/i, /trafficking|forced or tricked/i, 6, "help for people forced to work"],
  [/\b(child abuse|hurting (a|my|the) (child|kid)|being hurt)/i, /child abuse|worried about a child/i, 4, "child abuse help"],
  [/\b(disab|wheelchair|blind|deaf)/i, /disabilit/i, 6, "for people with disabilities"],
  [/\b(training|tech|coding|computer|it job)/i, /training/i, 3, "free job training"],
  [/\b(std|sti|hiv|prep|birth control|sexual health|plan b)\b/i, /sexual health|sti and hiv/i, 5, "sexual health care"],
  [/\b(summer job|teen job|first job)/i, /summer jobs/i, 8, "summer jobs for young people"],
  [/\bveteran/i, /veterans/i, 5, "for veterans"],
  [/\b(dentist|dental|tooth|teeth)/i, /dental|dentist/i, 6, "dental care"],
  [/\b(alcohol|drinking|aa\b|al-anon|alateen|sobriety)/i, /alcoholics|al-anon|drinking/i, 6, "alcohol recovery support"],
  [/\b(hate crime|bias|discriminat|harass)/i, /hate|bias|discriminat/i, 6, "bias and hate crime help"],
  [/\b(grandm|grandf|grandpa|grandma|elder|older adult|senior|aging parent)/i, /older adult|elder|60\+/i, 8, "for older adults"],
  [/\b(prison|jail|incarcerat|parole|probation|record|conviction|felony)/i, /incarcerat|justice involvement|record|parole/i, 6, "for people with records"],
  [/\b(boyfriend|girlfriend|dating|bf|gf)\b/i, /dating/i, 4, "dating abuse help"],
  [/\b(teen|teenager|1[3-9] ?(yo|years?)|i'?m 1[3-9]|i am 1[3-9])\b/i, /\bteens?\b|young people/i, 2, "for teens"],
  [/\b(debt|sued|collector|garnish)/i, /consumer debt|debt/i, 5, "help with debt cases"],
  [/\b(immigra|deport|asylum|green card|visa)/i, /immigra|deportation/i, 5, "immigration legal help"],
  [/\bvolunteer/i, /volunteer(?!-run)|clean up, plant/i, 5, "volunteering"],
  [/\bskat/i, /skatepark/i, 6, "skatepark"],
  [/\b(danc|zumba)/i, /dance/i, 6, "dance classes"],
  [/\b(study|homework|tutor)/i, /homework|tutor|study/i, 4, "study help"],
  [/\b(video ?games?|gaming|games|hang ?out|chill)/i, /video game|gaming|teen space|teen center/i, 5, "games and a place to hang out"],
  [/\b(after ?school|camp|summer|childcare|babysit|a break|keep (my|the) kids|kids? (busy|activities))/i, /afterschool|summer program|community centers/i, 5, "free kids' programs"],
  [/\b(gym|work ?out|exercise|fitness|sports|basketball|swim|pool)/i, /recreation center|fitness/i, 4, "gym and fitness"],
  [/\b(museum|zoo|day out|things to do|fun|bored|free activities)/i, /museum|zoo|pay what you wish/i, 3, "free days out"],
  [/\b(teen|teenager|youth|young person|student|(1[0-9]|2[0-4])[- ]?(year|yr)s?[- ]old)\b/i, /teens|young people/i, 3, "for young people"],
  [/\b(uninsured|no insurance|undocumented|immigra|asylum|new arrival)/i, /immigration status|can't afford/i, 3, "any immigration status"],
  [/\b(ged|hse|high school (diploma|equivalency))/i, /HSE|GED/i, 4, "GED / HSE classes"],
  [/\b(english|esol)\b/i, /English classes/i, 3, "English classes"],
  [/\b(enroll|register|new school|school for (my|her|his|their))/i, /enrolling/i, 3, "school enrollment"],
  [/\b(pregnant|baby|infant|newborn|breastfeed)/i, /WIC|pregnant/i, 3, "for pregnant people and babies"],
  [/\b(family|families|mom|mother|parent)\b/i, /NAMI|families/i, 1, "family support"],
  [/\b(immigra|green card|citizenship|daca|tps|asylum|deport|undocumented)/i, /immigration legal|immigration information/i, 4, "immigration help"],
  [/\b(abuse|abusive|hits me|hurting|domestic violence|unsafe|threaten|stalk|assault|afraid of)/i, /domestic violence|survivors/i, 5, "safety help"],
  [/\b(job|work(?! ?out)|unemploy|laid off|fired|hiring|career|interview)/i, /job search|unemployment claim/i, 3, "job search help"],
  [/\b(laid off|fired|lost (my|his|her|their) job|unemploy)/i, /unemployment claim/i, 3, "unemployment benefits"],
  [/\b(older|senior|elderly|aging|grandm|grandf)\b/i, /older adults|60\+/i, 3, "for older adults"],
  [/\b(metrocard|subway|fare|transit)/i, /fare/i, 4, "half-price transit"],
  [/\b(id card|idnyc|no id|photo id)\b/i, /photo ID card/i, 3, "free city ID"],
];
const BOROUGH_WORDS = {
  Manhattan: /\b(manhattan|harlem|chelsea|midtown|washington heights|inwood|lower east side|upper west side|upper east side|uptown|downtown manhattan)\b/i,
  Bronx: /\b(bronx|fordham|hunts point|mott haven|concourse|melrose|morrisania|tremont|kingsbridge|williamsbridge|parkchester)\b/i,
  Queens: /\b(queens|jamaica|flushing|corona|elmhurst|jackson heights|astoria|far rockaway|richmond hill|forest hills|kew gardens|woodside|ridgewood)\b/i,
  "Staten Island": /\b(staten island|st\.? george|port richmond|stapleton|tottenville|new dorp)\b/i,
  Brooklyn: /\b(brooklyn|brownsville|east new york|bedford-stuyvesant|crown heights|bushwick|flatbush|sunset park|williamsburg|canarsie|bay ridge|park slope)\b/i,
};

export function boroughFromZip(zip) {
  if (/^112/.test(zip)) return "Brooklyn";
  if (/^104/.test(zip)) return "Bronx";
  if (/^10[0-2]/.test(zip)) return "Manhattan";
  if (/^11[0-6]/.test(zip)) return "Queens";
  if (/^103/.test(zip)) return "Staten Island";
  return "";
}

export function boroughFromText(text) {
  return Object.keys(BOROUGH_WORDS).find((b) => BOROUGH_WORDS[b].test(text)) || "";
}

const NEIGHBORHOOD_ALIASES = [
  [/\bbed[- ]?stuy\b/gi, "Bedford-Stuyvesant"],
  [/\beny\b/gi, "East New York"],
];

// The person's own age, from "I'm 16", "im 16", "age 16", "16 yo" or
// "16-year-old" (but not "my 16-year-old son").
export function personAge(text) {
  const patterns = [
    /\b(?:i'?m|i am|im|age|aged)\s+(\d{1,2})\b(?!\s*(?:kids?|children|days?|weeks?|months?))/i,
    /\b(\d{1,2})\s*(?:-|\s)?(?:years?|yrs?)(?:\s*|-)old\b(?!\s*(?:son|daughter|kid|child|boy|girl|baby|brother|sister|niece|nephew|grand))/i,
    /\b(\d{1,2})\s*(?:yo|y\/o)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && Number(m[1]) >= 5) return Number(m[1]);
  }
  return null;
}

// A child's age from "my 10 year old daughter" / "my son, 8".
export function childAge(text) {
  const m = /\b(\d{1,2})\s*(?:-|\s)?(?:years?|yrs?)(?:\s*|-)old\s*(?:son|daughter|kid|child|boy|girl|brother|sister)\b/i.exec(text)
    || /\b(?:son|daughter|kid|child|boy|girl)\s*,?\s*(?:is\s*|aged?\s*)?(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

// Age range a listing serves, read from the start of its eligibility text:
// "Young people 14-24", "Single adults 18+", "Adults 17 and older",
// "LGBTQ+ young people up to 24".
export function ageLimits(eligibility) {
  const first = String(eligibility || "").split(/[.;]/)[0];
  let min = 0;
  let max = 200;
  let m;
  if ((m = first.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\b/))) [min, max] = [Number(m[1]), Number(m[2])];
  if ((m = first.match(/(\d{2})\s*(?:\+|and older|or older)/))) min = Number(m[1]);
  if ((m = first.match(/up to (\d{2})\b/))) max = Number(m[1]);
  if (!min && /\badults?\b/i.test(first)) min = 18;
  return { min, max };
}

// Rules out listings the person clearly can't use, judged from the
// eligibility text. Keyword mode only; the AI reads eligibility itself.
function ineligible(listing, text) {
  const kids = /\b(kids?|children|child|baby|pregnant|son|daughter)\b/i.test(text);
  const woman = /\b(woman|women|female|she|her|mom|mother)\b/i.test(text);
  const man = /\b(man|men|male|he|his|dad|father)\b/i.test(text);
  // For activities, a parent asking for their child means the child's age counts.
  const age = personAge(text) ?? (listing.category === "community" ? childAge(text) : null);
  const e = listing.eligibility;
  if (age !== null) {
    const { min, max } = ageLimits(e);
    if (age < min || age > max) return true;
  }
  const minor = age !== null ? age < 18 : /\b(teen|teenager|minor)\b/i.test(text);
  if (minor && (/18\+|single adult/i.test(e) || /^adults?\b(?! and| or|, (children|kids|teens))/i.test(e))) return true;
  const youthCue = age !== null ? age <= 24 : minor || /\b(youth|young|kid|child|student|teens?)\b/i.test(text);
  if (/young people/i.test(e) && !youthCue) return true;
  if (/single adult men/i.test(e)) return kids || (woman && !man);
  if (/single adult women/i.test(e)) return kids || (man && !woman);
  if (/families with children/i.test(e)) return !kids;
  if (/no children under 21/i.test(e)) return kids || /\bsingle\b/i.test(text) || (!/\b(couple|partner|wife|husband|family)\b/i.test(text));
  if (NO_ID.test(text) && /\bID required/i.test(listing.what_to_bring)) return true;
  if (/^LGBTQ/i.test(e) && !LGBTQ.test(text)) return true;
  if (/^veterans/i.test(e) && !/\b(veteran|vet|military|served|army|navy|marine)/i.test(text)) return true;
  if (/single adults/i.test(e)) return kids;
  return false;
}

function mentions(text, word) {
  return new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}`, "i").test(text);
}

export function detectNeeds(text) {
  text = text.replace(/after[- ]school/gi, "afterschool"); // not a school need
  return Object.entries(NEED_WORDS)
    .filter(([, words]) => words.some((w) => mentions(text, w)))
    .map(([need]) => need);
}

export function matchWithKeywords({ situation, zip, urgency }, listings, { now = new Date() } = {}) {
  for (const [re, name] of NEIGHBORHOOD_ALIASES) situation = situation.replace(re, name);
  const needs = detectNeeds(situation);
  if (needs.length === 0) {
    return {
      results: [],
      nothing_fits: true,
      message: "Couldn't tell what kind of help this is. Try words like \"food\", \"evicted\", \"doctor\", \"stressed\", \"GED\", \"job\", \"lawyer\" or \"unsafe at home\".",
      looks_like_personal_info: false,
    };
  }
  const languages = LANGUAGES.filter((lang) => mentions(situation, lang));
  const borough = boroughFromZip(zip) || boroughFromText(situation);

  const scored = listings
    .filter((l) => needs.includes(l.category) && !ineligible(l, situation))
    .map((l) => {
      const reasons = [CATEGORY_LABELS[l.category]];
      let score = 0;
      if (needs[0] === l.category) score += 2; // first-mentioned need
      if (zip && l.zip === zip) {
        score += 3;
        reasons.push(`same zip (${zip})`);
      } else if (l.neighborhood && mentions(situation, l.neighborhood)) {
        score += 3;
        reasons.push(`in ${l.neighborhood}`);
      }
      if (l.verified) score += 1;
      const age = personAge(situation);
      if (age !== null && age <= 24 && /young people|teens/i.test(l.eligibility)) {
        score += 4;
        reasons.push(age < 18 ? "serves people under 18" : "for young people");
      }
      const listingText = `${l.name} ${l.offers} ${l.eligibility} ${l.what_to_bring}`;
      for (const [want, has, points, reason] of TOPICS) {
        if (want.test(situation) && has.test(listingText)) {
          score += points;
          reasons.push(reason);
        }
      }
      // Narrow legal help (immigration-only, eviction-only) doesn't fit
      // someone with a different legal problem.
      const about = `${l.name} ${l.offers}`;
      if (/immigra/i.test(about) && !IMMIGRATION.test(situation) && !/\b(any|all) (legal|kind)/i.test(about)) score -= 4;
      if (/\beviction lawyer|facing eviction/i.test(about) && !/\b(evict|landlord|housing court|marshal|lockout)/i.test(situation)) score -= 4;
      // Someone in crisis needs a line that answers crises.
      if (/\b(suicid|kill (my|him|her)self|want to die|self-harm|crisis)/i.test(situation) && /not a crisis line/i.test(`${l.offers} ${l.hours_notes}`)) score -= 6;
      if (borough && l.borough) {
        if (l.borough === borough) {
          // A neighborhood match already counted; don't double-reward it.
          if (!reasons.some((r) => r.startsWith("in "))) {
            score += 3;
            reasons.push(`in ${borough}`);
          }
        } else if (l.borough === "Citywide") {
          score += 1;
        } else {
          score -= 4;
        }
      }
      const status = openStatus(l.hours, now).state;
      if (status === "open") {
        score += urgency === "week" ? 1 : 2;
        // Someone unsafe or in crisis needs help that answers right now.
        if (["safety", "mental_health"].includes(l.category) && urgency !== "week") score += 3;
        reasons.push("open now");
      }
      for (const lang of languages) {
        if (mentions(l.languages, lang)) {
          score += 1;
          reasons.push(`speaks ${lang[0].toUpperCase() + lang.slice(1)}`);
        }
      }
      return { l, score, why: reasons.join(", ") + "." };
    })
    .sort((a, b) => b.score - a.score);

  // Make sure each detected need gets at least one slot.
  const picked = [];
  for (const need of needs) {
    const best = scored.find((s) => s.l.category === need);
    if (best) picked.push(best);
  }
  for (const s of scored) {
    if (picked.length >= MAX_RESULTS) break;
    if (!picked.includes(s)) picked.push(s);
  }
  picked.sort((a, b) => b.score - a.score);

  return {
    results: picked.slice(0, MAX_RESULTS).map((s) => ({ id: s.l.id, why: s.why })),
    nothing_fits: picked.length === 0,
    message: "Keyword matching only (AI is off). It doesn't check eligibility. Read each listing before you refer.",
    looks_like_personal_info: false,
  };
}

// ---------------------------------------------------------------------------
// Turns the matcher's picks into what the page shows. Every fact shown
// (address, hours, phone, eligibility) comes from the spreadsheet row, never
// from the model's text.

const PHONE_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)/i;

function safeWhy(why, listing) {
  const text = String(why || "").trim().slice(0, 300);
  // The model is told not to state contact details or hours. If it does
  // anyway, fall back to the listing's own description instead of showing a
  // detail that might not match the verified data.
  if (!text || PHONE_RE.test(text) || TIME_RE.test(text)) return listing.offers;
  return text;
}

// One listing as the page shows it. Every fact comes from the spreadsheet row.
export function toCard(l, why, now = new Date()) {
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    offers: l.offers,
    why,
    address: l.address,
    neighborhood: l.neighborhood,
    borough: l.borough,
    zip: l.zip,
    lat: l.lat ? Number(l.lat) : null,
    lng: l.lng ? Number(l.lng) : null,
    transit: l.transit,
    hours: l.hours,
    hours_notes: l.hours_notes,
    open: !l.address && !l.hours
      ? { state: "online", label: l.website ? "Online" : "By phone" }
      : openStatus(l.hours, now),
    eligibility: l.eligibility,
    what_to_bring: l.what_to_bring,
    phone: l.phone,
    languages: l.languages,
    website: l.website,
    last_verified: l.last_verified,
    verified: l.verified,
    has_photo: Boolean(l.photo_commons || l.address),
  };
}

export function buildResponse(match, listings, now = new Date()) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const seen = new Set();
  const results = [];
  for (const r of Array.isArray(match.results) ? match.results : []) {
    const l = byId.get(String(r.id));
    if (!l || seen.has(l.id)) continue; // drop anything not in the list
    seen.add(l.id);
    results.push(toCard(l, safeWhy(r.why, l), now));
    if (results.length >= MAX_RESULTS) break;
  }
  return {
    results,
    nothing_fits: results.length === 0 || Boolean(match.nothing_fits),
    message: String(match.message || "").slice(0, 600),
    looks_like_personal_info: Boolean(match.looks_like_personal_info),
  };
}

// Everything in one category, for browsing. Open now first, then verified,
// then by name. "Citywide" listings show under every borough filter.
const OPEN_ORDER = { open: 0, online: 1, unknown: 2, closed: 3 };
export function browseListings(listings, { category, borough = "", openNow = false } = {}, now = new Date()) {
  return listings
    .filter((l) => l.category === category)
    .filter((l) => !borough || l.borough === borough || l.borough === "Citywide")
    .map((l) => toCard(l, l.offers, now))
    .filter((c) => !openNow || c.open.state === "open")
    .sort((a, b) =>
      OPEN_ORDER[a.open.state] - OPEN_ORDER[b.open.state] ||
      Number(b.verified) - Number(a.verified) ||
      a.name.localeCompare(b.name));
}

export function categoryCounts(listings) {
  const counts = {};
  for (const l of listings) counts[l.category] = (counts[l.category] || 0) + 1;
  return counts;
}
