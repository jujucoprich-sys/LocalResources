import test from "node:test";
import assert from "node:assert/strict";
import { createAuth, makeSession, parseCookies, readSession } from "../src/auth.js";

const SECRET = "test-secret-123";

test("session cookie: round-trips, rejects tampering and expiry", () => {
  const now = Date.UTC(2026, 9, 13);
  const token = makeSession({ email: "worker@hospital.org", name: "Sam" }, SECRET, now);
  assert.deepEqual(readSession(token, SECRET, now + 1000), { email: "worker@hospital.org", name: "Sam" });
  assert.equal(readSession(token, "other-secret", now), null);
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "boss@hospital.org", name: "", exp: now + 1e9 })).toString("base64url");
  assert.equal(readSession(`${forged}.${mac}`, SECRET, now), null);
  assert.equal(readSession(`${body}.${mac}`, SECRET, now + 8 * 86_400_000), null); // a week later
  assert.equal(readSession("garbage", SECRET, now), null);
});

test("auth is off (and never required) until Google is set up", () => {
  const auth = createAuth({ clientId: "", clientSecret: "", sessionSecret: "", publicUrl: "", requireLogin: true });
  assert.equal(auth.enabled, false);
  assert.equal(auth.requireLogin, false);
  assert.equal(auth.user({ headers: {} }), null);
});

function fakeGoogle({ email = "worker@hospital.org", verified = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(opts.body));
      if (body.get("code") !== "good-code") return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ access_token: "at-1" }) };
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      assert.equal(opts.headers.Authorization, "Bearer at-1");
      return { ok: true, json: async () => ({ email, email_verified: verified, name: "Sam Rivera" }) };
    }
    throw new Error("unexpected " + url);
  };
  return { calls, fetchImpl };
}

const config = (extra) => ({ clientId: "cid", clientSecret: "csecret", sessionSecret: SECRET, publicUrl: "https://nextstep.example", ...extra });

test("Google sign-in: asks only for name and email, checks state, sets a session", async () => {
  const google = fakeGoogle();
  const auth = createAuth(config({ fetchImpl: google.fetchImpl }));
  const start = auth.start();
  const url = new URL(start.location);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "openid email profile"); // no Gmail access
  assert.equal(url.searchParams.get("redirect_uri"), "https://nextstep.example/auth/google/callback");
  const state = url.searchParams.get("state");
  assert.match(start.cookies[0], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);

  const stateCookie = `ns_oauth_state=${state}`;
  const bad = await auth.finish({ url: `/auth/google/callback?code=good-code&state=wrong`, headers: { cookie: stateCookie } });
  assert.match(bad.error, /expired/);

  const ok = await auth.finish({ url: `/auth/google/callback?code=good-code&state=${state}`, headers: { cookie: stateCookie } });
  assert.equal(ok.location, "/");
  const session = ok.cookies.find((c) => c.startsWith("ns_session="));
  const token = decodeURIComponent(session.split(";")[0].split("=")[1]);
  assert.deepEqual(auth.user({ headers: { cookie: `ns_session=${encodeURIComponent(token)}` } }), { email: "worker@hospital.org", name: "Sam Rivera" });
});

test("Google sign-in: work-domain limit and unverified emails", async () => {
  const outsider = createAuth(config({ allowedDomains: "hospital.org", fetchImpl: fakeGoogle({ email: "someone@gmail.com" }).fetchImpl }));
  const s1 = new URL(outsider.start().location).searchParams.get("state");
  const r1 = await outsider.finish({ url: `/cb?code=good-code&state=${s1}`, headers: { cookie: `ns_oauth_state=${s1}` } });
  assert.match(r1.error, /@hospital\.org/);

  const unverified = createAuth(config({ fetchImpl: fakeGoogle({ verified: false }).fetchImpl }));
  const s2 = new URL(unverified.start().location).searchParams.get("state");
  const r2 = await unverified.finish({ url: `/cb?code=good-code&state=${s2}`, headers: { cookie: `ns_oauth_state=${s2}` } });
  assert.match(r2.error, /verified/);
});

test("parseCookies", () => {
  assert.deepEqual(parseCookies("a=1; b=x%20y"), { a: "1", b: "x y" });
  assert.deepEqual(parseCookies(""), {});
});
