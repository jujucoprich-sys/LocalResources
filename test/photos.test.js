import test from "node:test";
import assert from "node:assert/strict";
import { createCommons, createMapillary, createPhotos } from "../src/photos.js";

const jsonRes = (body) => ({ ok: true, json: async () => body });
const imgRes = () => ({ ok: true, headers: new Map([["content-type", "image/jpeg"]]), arrayBuffer: async () => new Uint8Array([9, 9]).buffer });

test("commons: reads the thumbnail, photographer and license", async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, ua: opts?.headers?.["User-Agent"] });
    if (url.includes("api.php")) {
      return jsonRes({ query: { pages: { 1: { imageinfo: [{ thumburl: "https://upload.wikimedia.org/x/800px-a.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg", extmetadata: { Artist: { value: '<a href="#">Beyond My Ken</a>' }, LicenseShortName: { value: "CC BY-SA 3.0" } } }] } } } });
    }
    return imgRes();
  };
  const photo = await createCommons({ fetchImpl: fake })({ id: "M14", photo_commons: "A.jpg" });
  assert.equal(photo.credit, "Photo: Beyond My Ken, CC BY-SA 3.0, via Wikimedia Commons");
  assert.equal(photo.link, "https://commons.wikimedia.org/wiki/File:A.jpg");
  assert.match(calls[0].url, /titles=File%3AA\.jpg/);
  assert.match(calls[0].ua, /NextStep/); // Wikimedia asks for an identifying User-Agent
  assert.deepEqual([...(await photo.image()).body], [9, 9]);
  assert.equal(await createCommons({ fetchImpl: fake })({ id: "X", photo_commons: "" }), null);
});

test("mapillary: needs a token and exact coordinates, picks the nearest non-panorama", async () => {
  assert.equal(createMapillary({ token: "" }), null);
  let asked = "";
  const fake = async (url) => {
    asked = url;
    if (url.includes("graph")) {
      return jsonRes({ data: [
        { id: "far", thumb_1024_url: "https://img/far.jpg", is_pano: false, creator: { username: "far_user" }, computed_geometry: { coordinates: [-73.8890, 40.8638] } },
        { id: "pano", thumb_1024_url: "https://img/pano.jpg", is_pano: true, creator: { username: "p" }, computed_geometry: { coordinates: [-73.8895, 40.8633] } },
        { id: "near", thumb_1024_url: "https://img/near.jpg", is_pano: false, creator: { username: "near_user" }, computed_geometry: { coordinates: [-73.88952, 40.86331] } },
      ] });
    }
    return imgRes();
  };
  const mapillary = createMapillary({ token: "t", fetchImpl: fake, api: "https://graph.mapillary.com/images" });
  assert.equal(await mapillary({ id: "X01", lat: "", lng: "" }), null); // zip-only: no random street photos
  const photo = await mapillary({ id: "X01", lat: "40.8633", lng: "-73.8895" });
  assert.match(asked, /bbox=/);
  assert.equal(photo.link, "https://www.mapillary.com/app/?pKey=near");
  assert.equal(photo.credit, "Photo: near_user, CC BY-SA 4.0, via Mapillary");
});

test("photos: Commons first, then Google, then Mapillary; remembers the choice", async () => {
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    if (url.includes("api.php")) return jsonRes({ query: { pages: { "-1": { missing: "" } } } });
    if (url.includes("/metadata?")) return jsonRes({ status: "OK" });
    if (url.includes("graph")) return jsonRes({ data: [] });
    return imgRes();
  };
  const photos = createPhotos({ fetchImpl: fake, googleKey: "g", googleSecret: "", mapillaryToken: "m" });
  assert.deepEqual(photos.providers, { commons: true, google: true, mapillary: true });
  const listing = { id: "M02", address: "227 Bowery", borough: "Manhattan", zip: "10002", photo_commons: "Missing.jpg", lat: "40.72", lng: "-73.99" };
  const photo = await photos.find(listing);
  assert.equal(photo.provider, "google"); // Commons had no such file
  const before = seen.length;
  await photos.find(listing);
  assert.equal(seen.length, before); // cached choice, no new lookups

  const none = createPhotos({ fetchImpl: fake, googleKey: "", mapillaryToken: "" });
  assert.equal(await none.find({ id: "O01", address: "" }), null);
});
