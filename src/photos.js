import { createStreetView } from "./streetview.js";

// Photos for listings, tried in order of quality:
//   1. A hand-picked Wikimedia Commons photo (the listing's photo_commons
//      column): freely licensed, no key needed.
//   2. Google Street View, when GOOGLE_MAPS_API_KEY is set (paid).
//   3. Mapillary, when MAPILLARY_TOKEN is set (free, openly licensed street
//      photos). Only for listings with exact lat/lng, so it never shows a
//      random street near the zip code's center.
// Places none of these cover keep their drawn thumbnail.

const UA = "NextStep/0.1 (community resource finder; https://github.com/jujucoprich-sys/LocalResources)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const MAPILLARY_API = "https://graph.mapillary.com/images";

const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

async function getImage(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) return null;
  return { contentType: res.headers.get("content-type") || "image/jpeg", body: Buffer.from(await res.arrayBuffer()) };
}

export function createCommons({ fetchImpl = fetch, api = process.env.COMMONS_API_URL || COMMONS_API } = {}) {
  return async function commons(listing) {
    const title = String(listing.photo_commons || "").trim();
    if (!title) return null;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "800",
      titles: title.startsWith("File:") ? title : `File:${title}`,
    });
    const res = await fetchImpl(`${api}?${params}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const page = Object.values((await res.json()).query?.pages || {})[0];
    const info = page?.imageinfo?.[0];
    if (!info?.thumburl) return null;
    const meta = info.extmetadata || {};
    const artist = stripHtml(meta.Artist?.value) || "Unknown photographer";
    const license = stripHtml(meta.LicenseShortName?.value) || "see source";
    return {
      provider: "commons",
      credit: `Photo: ${artist}, ${license}, via Wikimedia Commons`,
      link: info.descriptionurl,
      image: () => getImage(fetchImpl, info.thumburl, { "User-Agent": UA }),
    };
  };
}

export function createMapillary({ token = process.env.MAPILLARY_TOKEN, fetchImpl = fetch, api = process.env.MAPILLARY_API_URL || MAPILLARY_API } = {}) {
  if (!token) return null;
  return async function mapillary(listing) {
    const lat = Number(listing.lat);
    const lng = Number(listing.lng);
    if (!lat || !lng) return null;
    const d = 0.0006; // about 65 m around the building
    const params = new URLSearchParams({
      access_token: token,
      fields: "id,thumb_1024_url,captured_at,is_pano,creator,computed_geometry",
      bbox: [lng - d, lat - d, lng + d, lat + d].join(","),
      limit: "30",
    });
    const res = await fetchImpl(`${api}?${params}`);
    if (!res.ok) return null;
    const near = ((await res.json()).data || [])
      .filter((p) => !p.is_pano && p.thumb_1024_url)
      .map((p) => {
        const [plng, plat] = p.computed_geometry?.coordinates || [lng + 1, lat + 1];
        return { ...p, dist: Math.hypot(plat - lat, (plng - lng) * Math.cos((lat * Math.PI) / 180)) };
      })
      // Closest first; among photos within ~15 m of each other, the newest.
      .sort((a, b) => Math.round(a.dist / 0.00015) - Math.round(b.dist / 0.00015) || (b.captured_at || 0) - (a.captured_at || 0));
    const best = near[0];
    if (!best) return null;
    return {
      provider: "mapillary",
      credit: `Photo: ${best.creator?.username || "Mapillary contributor"}, CC BY-SA 4.0, via Mapillary`,
      link: `https://www.mapillary.com/app/?pKey=${best.id}`,
      image: () => getImage(fetchImpl, best.thumb_1024_url),
    };
  };
}

export function createPhotos({ fetchImpl = fetch, googleKey, googleSecret, mapillaryToken } = {}) {
  const commons = createCommons({ fetchImpl });
  const streetView = createStreetView({ fetchImpl, ...(googleKey !== undefined && { key: googleKey }), ...(googleSecret !== undefined && { secret: googleSecret }) });
  const mapillary = createMapillary({ fetchImpl, ...(mapillaryToken !== undefined && { token: mapillaryToken }) });
  const google = streetView.enabled
    ? async (listing) => {
        // Street View images aren't stored (Google's terms), so each request
        // fetches again; the browser keeps it for a day.
        const first = await streetView.photo(listing);
        if (!first) return null;
        let pending = first;
        return {
          provider: "google",
          credit: "Photo: Google Street View",
          link: "",
          image: async () => {
            const img = pending || (await streetView.photo(listing));
            pending = null;
            return img;
          },
        };
      }
    : null;
  const sources = [commons, google, mapillary].filter(Boolean);
  const chosen = new Map(); // listing id -> photo or null (which source won; not the image)

  async function find(listing) {
    if (chosen.has(listing.id)) return chosen.get(listing.id);
    let found = null;
    for (const source of sources) {
      try {
        found = await source(listing);
      } catch {
        found = null;
      }
      if (found) break;
    }
    chosen.set(listing.id, found);
    return found;
  }

  return {
    providers: { commons: true, google: Boolean(google), mapillary: Boolean(mapillary) },
    find,
  };
}
