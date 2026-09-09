import { IG_API_VERSION, IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI } from "./config.js";

const API_VERSION = IG_API_VERSION;
const TAG_FIELDS = [
  "id",
  "username",
  "caption",
  "media_type",
  "permalink",
  "timestamp",
  "shortcode",
  "thumbnail_url",
].join(",");

export class InstagramApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "InstagramApiError";
    this.status = status;
    this.body = body;
  }
}

export async function detectAndConnect(accessToken) {
  const ig = await tryInstagramLogin(accessToken);
  if (ig) return ig;
  const fb = await tryFacebookLogin(accessToken);
  if (fb) return fb;
  throw new InstagramApiError(
    "Could not use this token. It needs Instagram Login (graph.instagram.com) or a Facebook token for a Page linked to an Instagram professional account.",
    400,
  );
}

async function tryInstagramLogin(accessToken) {
  try {
    const me = unwrap(await graphGet("graph.instagram.com", "/me", {
      fields: "user_id,username,name,account_type,followers_count,profile_picture_url",
      access_token: accessToken,
    }));
    const userId = me.user_id || me.id;
    if (!userId || !me.username) return null;
    return {
      graphHost: "graph.instagram.com",
      accessToken,
      account: {
        id: String(userId),
        username: me.username,
        name: me.name || me.username,
        accountType: me.account_type || "Professional",
        followersCount: me.followers_count ?? null,
        profilePictureUrl: me.profile_picture_url || null,
        loginType: "instagram",
      },
    };
  } catch {
    return null;
  }
}

async function tryFacebookLogin(accessToken) {
  try {
    const pages = await graphGet("graph.facebook.com", "/me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username,name,followers_count,profile_picture_url}",
      access_token: accessToken,
    });
    const page = (pages.data || []).find((p) => p.instagram_business_account);
    if (!page) return null;
    const ig = page.instagram_business_account;
    return {
      graphHost: "graph.facebook.com",
      accessToken: page.access_token || accessToken,
      account: {
        id: String(ig.id),
        username: ig.username,
        name: ig.name || ig.username,
        accountType: "Business",
        followersCount: ig.followers_count ?? null,
        profilePictureUrl: ig.profile_picture_url || null,
        loginType: "facebook",
        pageId: page.id,
        pageName: page.name,
      },
    };
  } catch {
    return null;
  }
}

export async function fetchAllTags({ graphHost, accessToken, userId }) {
  const tags = [];
  const seenCursors = new Set();
  let after = null;

  while (tags.length < 2500) {
    const params = {
      fields: TAG_FIELDS,
      limit: 50,
      access_token: accessToken,
    };
    if (after) params.after = after;
    const page = await graphGet(graphHost, `/${userId}/tags`, params);
    const rows = page.data || [];
    for (const row of rows) tags.push(normalizeTag(row));
    const next = page.paging?.cursors?.after;
    if (!rows.length || !next || seenCursors.has(next)) break;
    seenCursors.add(next);
    after = next;
  }

  return tags;
}

export async function exchangeCodeForToken(code) {
  const appId = IG_APP_ID;
  const appSecret = IG_APP_SECRET;
  const redirectUri = IG_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new InstagramApiError("Set IG_APP_ID, IG_APP_SECRET, and IG_REDIRECT_URI (or APP_URL) first.", 400);
  }

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: String(code).replace(/#_+$/, ""),
  });

  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body,
  });
  const shortJson = await shortRes.json();
  const shortToken = shortJson.access_token || shortJson.data?.[0]?.access_token;
  if (!shortToken) {
    throw new InstagramApiError(shortJson.error_message || "Failed to exchange authorization code.", shortRes.status, shortJson);
  }

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("access_token", shortToken);
  const longRes = await fetch(longUrl);
  const longJson = await longRes.json();
  return longJson.access_token || shortToken;
}

export function authorizeUrl(state) {
  const appId = IG_APP_ID;
  const redirectUri = IG_REDIRECT_URI;
  if (!appId || !redirectUri) return null;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_comments");
  url.searchParams.set("state", state);
  return url.toString();
}

function normalizeTag(row) {
  const username = String(row.username || "").replace(/^@/, "").toLowerCase();
  const permalink = row.permalink || (row.shortcode ? `https://www.instagram.com/p/${row.shortcode}/` : null);
  return {
    id: String(row.id),
    username,
    caption: row.caption || "",
    mediaType: row.media_type || "UNKNOWN",
    permalink,
    timestamp: row.timestamp || null,
    shortcode: row.shortcode || null,
    thumbnailUrl: row.thumbnail_url || null,
  };
}

function unwrap(body) {
  if (Array.isArray(body?.data)) return body.data[0] || {};
  return body || {};
}

async function graphGet(host, path, params) {
  const url = new URL(`https://${host}/${API_VERSION}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    const message = json.error?.message || `Instagram API ${res.status}`;
    throw new InstagramApiError(message, res.status, json);
  }
  return json;
}
