import crypto from "node:crypto";

// "Continue with Google": standard Google sign-in (OAuth 2.0 / OpenID
// Connect). We ask only for the person's name and email ("openid email
// profile"), never access to their Gmail. Nothing is stored on the server:
// the session is a signed cookie holding name, email and an expiry.
//
// Setup (Google Cloud console > APIs & Services > Credentials):
//   1. Create an OAuth client ID of type "Web application".
//   2. Add the redirect URI  <PUBLIC_URL>/auth/google/callback
//   3. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET and PUBLIC_URL.
//   Optional: ALLOWED_EMAIL_DOMAINS=hospital.org,cityagency.gov to limit who can sign in.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SESSION_COOKIE = "ns_session";
const STATE_COOKIE = "ns_oauth_state";
const SESSION_DAYS = 7;

const b64 = (s) => Buffer.from(s).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function makeSession(user, secret, now = Date.now()) {
  const body = b64(JSON.stringify({ email: user.email, name: user.name || "", exp: now + SESSION_DAYS * 86_400_000 }));
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token, secret, now = Date.now()) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(unb64(body));
    return data.exp > now ? { email: data.email, name: data.name } : null;
  } catch {
    return null;
  }
}

export function createAuth({
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  sessionSecret = process.env.SESSION_SECRET,
  publicUrl = process.env.PUBLIC_URL || "",
  allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS || "",
  requireLogin = process.env.REQUIRE_LOGIN === "1",
  fetchImpl = fetch,
} = {}) {
  const enabled = Boolean(clientId && clientSecret && sessionSecret && publicUrl);
  const domains = allowedDomains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const secure = publicUrl.startsWith("https://");
  const redirectUri = `${publicUrl.replace(/\/+$/, "")}/auth/google/callback`;
  const cookie = (name, value, maxAge) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  return {
    enabled,
    // Without Google set up there's nothing to sign in with, so never lock people out.
    requireLogin: enabled && requireLogin,

    user(req) {
      if (!enabled) return null;
      return readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE], sessionSecret);
    },

    // Step 1: send the browser to Google's sign-in page.
    start() {
      const state = crypto.randomBytes(16).toString("base64url");
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      });
      return { location: `${AUTH_URL}?${params}`, cookies: [cookie(STATE_COOKIE, state, 600)] };
    },

    // Step 2: Google sends the browser back with a one-time code.
    // Returns { location, cookies } on success or { error } for the page.
    async finish(req) {
      const url = new URL(req.url, "http://x");
      const state = parseCookies(req.headers.cookie)[STATE_COOKIE];
      const clearState = cookie(STATE_COOKIE, "", 0);
      if (url.searchParams.get("error")) return { error: "Sign-in was cancelled.", cookies: [clearState] };
      if (!state || state !== url.searchParams.get("state")) return { error: "That sign-in link expired. Try again.", cookies: [clearState] };
      const code = url.searchParams.get("code");
      if (!code) return { error: "Google didn't send a sign-in code. Try again.", cookies: [clearState] };

      const tokenRes = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      if (!tokenRes.ok) return { error: "Couldn't finish signing in with Google. Try again.", cookies: [clearState] };
      const { access_token: accessToken } = await tokenRes.json();
      const infoRes = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!infoRes.ok) return { error: "Couldn't read your Google account. Try again.", cookies: [clearState] };
      const info = await infoRes.json();
      const email = String(info.email || "").toLowerCase();
      if (!email || info.email_verified === false) return { error: "Your Google email isn't verified yet.", cookies: [clearState] };
      if (domains.length && !domains.includes(email.split("@")[1])) {
        return { error: `Sign in with your work account (${domains.map((d) => "@" + d).join(" or ")}).`, cookies: [clearState] };
      }
      const session = makeSession({ email, name: String(info.name || "").slice(0, 80) }, sessionSecret);
      return { location: "/", cookies: [clearState, cookie(SESSION_COOKIE, session, SESSION_DAYS * 86_400)] };
    },

    signOutCookie: () => cookie(SESSION_COOKIE, "", 0),
  };
}
