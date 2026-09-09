import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import {
  APP_PASSWORD,
  HOST,
  IG_ACCESS_TOKEN,
  IG_APP_SECRET,
  PORT,
  WEBHOOK_VERIFY_TOKEN,
  isProd,
  oauthConfigured,
} from "./lib/config.js";
import { loadDemo } from "./lib/demo.js";
import {
  detectAndConnect,
  exchangeCodeForToken,
  fetchMediaPreview,
  fetchMentionedMedia,
  formatIgError,
  InstagramApiError,
  runDiagnostics,
  subscribeAccountWebhooks,
  authorizeUrl,
} from "./lib/instagram.js";
import { parseFollowerUpload } from "./lib/parseExport.js";
import { buildResults } from "./lib/results.js";
import {
  publicStatus,
  readSecrets,
  readStore,
  recordTagSync,
  updateStore,
  upsertFollowers,
  upsertTag,
  writeSecrets,
} from "./lib/store.js";

const app = express();
app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const oauthStates = new Map();
const sessions = new Map();

app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const cookie = parseCookies(req.headers.cookie);
  req.sessionId = cookie.tagwatch || null;
  req.authed = !APP_PASSWORD || sessions.get(req.sessionId) === true;
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/webhooks/instagram", (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  if (mode === "subscribe" && token && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return res.status(200).send(challenge);
  }
  res.status(403).send("Webhook verification failed.");
});

app.post("/webhooks/instagram", async (req, res) => {
  res.status(200).send("EVENT_RECEIVED");
  try {
    if (!verifyWebhookSignature(req)) {
      console.error("Instagram webhook signature mismatch");
      return;
    }
    await handleInstagramWebhook(req.body);
  } catch (err) {
    console.error("Instagram webhook handler failed:", err.message);
  }
});

app.post("/api/login", (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (req.body?.password !== APP_PASSWORD) {
    return res.status(401).json({ error: "Wrong password." });
  }
  const id = crypto.randomBytes(16).toString("hex");
  sessions.set(id, true);
  res.setHeader(
    "Set-Cookie",
    `tagwatch=${id}; Path=/; HttpOnly; SameSite=Lax${isProd ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/login") return next();
  if (!req.authed) return res.status(401).json({ error: "Password required.", needsAuth: true });
  next();
});

app.get("/api/status", (_req, res) => {
  res.json({
    ...publicStatus(),
    oauthReady: oauthConfigured(),
    passwordRequired: Boolean(APP_PASSWORD),
  });
});

app.post("/api/settings", (req, res) => {
  const sinceDate = String(req.body?.sinceDate || "").slice(0, 10);
  const includeUnknownDates = Boolean(req.body?.includeUnknownDates);
  if (sinceDate && !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    return res.status(400).json({ error: "sinceDate must be YYYY-MM-DD." });
  }
  updateStore({
    settings: {
      ...(sinceDate ? { sinceDate } : {}),
      includeUnknownDates,
    },
  });
  res.json(publicStatus());
});

app.post("/api/demo", (_req, res) => {
  loadDemo();
  writeSecrets({ accessToken: null, graphHost: null });
  res.json({ ok: true, status: publicStatus() });
});

app.post("/api/connect/token", async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || "").trim();
    if (!accessToken) return res.status(400).json({ error: "Paste an Instagram or Facebook access token." });
    const result = await connectAndSync(accessToken, "ui");
    res.json({ ok: true, ...result, status: publicStatus() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/disconnect", (_req, res) => {
  writeSecrets({ accessToken: null, graphHost: null });
  updateStore({ account: null, settings: { demoMode: true } });
  res.json({ ok: true, status: publicStatus() });
});

app.get("/auth/instagram", (req, res) => {
  if (!req.authed) return res.status(401).send("Password required.");
  const url = authorizeUrl(issueState());
  if (!url) return res.status(400).send("Set IG_APP_ID, IG_APP_SECRET, and IG_REDIRECT_URI (or APP_URL).");
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state, error_description: desc } = req.query;
    if (desc) return res.status(400).send(String(desc));
    if (!code || !consumeState(String(state || ""))) {
      return res.status(400).send("Invalid OAuth callback.");
    }
    const token = await exchangeCodeForToken(String(code));
    await connectAndSync(token, "oauth");
    res.redirect("/?connected=1");
  } catch (err) {
    res.status(400).send(err.message || "OAuth failed.");
  }
});

app.post("/api/sync/tags", async (_req, res) => {
  try {
    const result = await syncTagsFromStore();
    res.json({ ok: result.ok, tagCount: result.tagCount, message: result.message, status: publicStatus() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/followers/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose an Instagram export zip, JSON, HTML, or CSV." });
    const followers = parseFollowerUpload(req.file.buffer, req.file.originalname);
    const summary = upsertFollowers(followers, "export");
    res.json({ ok: true, imported: followers.length, ...summary, status: publicStatus() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/followers/manual", (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "Username required." });
  const followedAt = req.body?.followedAt ? new Date(req.body.followedAt).toISOString() : new Date().toISOString();
  const summary = upsertFollowers(
    [{ username, followedAt, href: `https://www.instagram.com/${username.replace(/^@/, "")}/` }],
    "manual",
  );
  res.json({ ok: true, ...summary, status: publicStatus() });
});

app.get("/api/results", (req, res) => {
  const results = buildResults({
    sinceDate: req.query.since || undefined,
    includeUnknownDates: req.query.unknown === "1" ? true : req.query.unknown === "0" ? false : undefined,
    filter: req.query.filter || "all",
    q: req.query.q || "",
  });
  res.json(results);
});

app.use(express.static("public"));

app.use((err, _req, res, _next) => {
  sendError(res, err);
});

function issueState() {
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

function consumeState(state) {
  const exp = oauthStates.get(state);
  oauthStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k] = rest.join("=");
  }
  return out;
}

async function connectAndSync(accessToken, source = "ui") {
  const connected = await detectAndConnect(accessToken);
  writeSecrets({
    accessToken: connected.accessToken,
    graphHost: connected.graphHost,
    source,
    fingerprint: crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 16),
  });
  updateStore({ account: connected.account, settings: { demoMode: false }, lastConnectError: null });
  try {
    const subs = await subscribeAccountWebhooks({
      graphHost: connected.graphHost,
      accessToken: connected.accessToken,
    });
    console.log("Webhook field subscribe:", subs.map((s) => `${s.field}=${s.ok ? "ok" : s.detail}`).join(", "));
  } catch (err) {
    console.error("Webhook subscribe failed:", err.message);
  }
  let sync;
  try {
    sync = await syncTagsFromStore();
  } catch (err) {
    sync = { ok: false, tagCount: 0, message: formatIgError(err) };
  }
  return {
    username: connected.account.username,
    instagramFollowersCount: connected.account.followersCount,
    tagSync: sync,
  };
}

async function syncTagsFromStore() {
  const secrets = readSecrets();
  const store = readStore();
  if (!secrets.accessToken || !store.account?.id || store.settings.demoMode) {
    throw new InstagramApiError("Connect an Instagram professional account first.", 400);
  }
  const altIds = [store.account.appScopedId].filter(Boolean);
  try {
    const diag = await runDiagnostics({
      graphHost: secrets.graphHost,
      accessToken: secrets.accessToken,
      userId: store.account.id,
      altIds,
    });
    const tagTest = diag.tests.find((t) => t.name.startsWith("Photo-tags"));
    const ok = Boolean(tagTest?.ok);
    recordTagSync({
      ok,
      tags: ok ? diag.tags : undefined,
      error: ok ? null : tagTest?.detail || "Tagged-post sync failed.",
      diagnose: diag.tests,
    });
    return {
      ok,
      tagCount: ok ? diag.tags.length : store.tags.length,
      message: tagTest?.detail,
      tests: diag.tests,
    };
  } catch (err) {
    const message = formatIgError(err);
    recordTagSync({ ok: false, error: message });
    throw err;
  }
}

function verifyWebhookSignature(req) {
  if (!IG_APP_SECRET) return true;
  const header = String(req.headers["x-hub-signature-256"] || "");
  const expected = "sha256=" + crypto.createHmac("sha256", IG_APP_SECRET).update(req.rawBody || Buffer.from("")).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleInstagramWebhook(body) {
  if (body?.object !== "instagram") return;
  const secrets = readSecrets();
  const store = readStore();
  if (!secrets.accessToken || !store.account?.id) return;
  const ourName = String(store.account.username || "").toLowerCase();
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (!["mentions", "comments", "live_comments"].includes(change.field)) continue;
      const value = change.value || {};
      const mediaId = value.media_id || value.media?.id;
      if (!mediaId) continue;
      const fromUsername = value.from?.username || "";
      const text = String(value.text || value.caption || "");
      let tag = null;
      try {
        tag = await fetchMentionedMedia({
          graphHost: secrets.graphHost,
          accessToken: secrets.accessToken,
          userId: store.account.id,
          mediaId,
        });
      } catch {
        tag = null;
      }
      if (!tag) {
        try {
          const media = await fetchMediaPreview({
            graphHost: secrets.graphHost,
            accessToken: secrets.accessToken,
            mediaId,
          });
          const owner = String(media.username || "").toLowerCase();
          if (owner && owner === ourName) continue;
          const mentioned = ourName && text.toLowerCase().includes(`@${ourName}`);
          if (!mentioned && change.field !== "mentions") continue;
          tag = {
            id: String(media.id),
            username: (fromUsername || media.username || "").replace(/^@/, "").toLowerCase(),
            caption: media.caption || text,
            mediaType: media.media_type || "UNKNOWN",
            permalink: media.permalink || null,
            timestamp: media.timestamp || null,
            source: "mention",
          };
        } catch {
          continue;
        }
      }
      if (fromUsername && tag && !tag.username) {
        tag.username = fromUsername.replace(/^@/, "").toLowerCase();
      }
      if (tag) upsertTag(tag);
    }
  }
}

function sendError(res, err) {
  const payload = {
    error: err instanceof InstagramApiError ? formatIgError(err) : err.message || "Request failed.",
    code: err.code,
  };
  const status = err instanceof InstagramApiError ? 400 : 400;
  res.status(status).json(payload);
}

if (!isProd && !readStore().followers.length && !readStore().tags.length) {
  loadDemo();
}

async function applyEnvToken() {
  if (!IG_ACCESS_TOKEN) return;
  console.log("Applying IG_ACCESS_TOKEN from environment");
  try {
    const result = await connectAndSync(IG_ACCESS_TOKEN, "env");
    const tagBit = result.tagSync?.ok
      ? `${result.tagSync.tagCount} tagged posts`
      : result.tagSync?.message || "tagged-post sync failed";
    console.log(`Connected @${result.username} from env (${tagBit})`);
  } catch (err) {
    const message = formatIgError(err);
    console.error("IG_ACCESS_TOKEN failed:", message);
    updateStore({ lastConnectError: message });
  }
}

app.listen(PORT, HOST, () => {
  console.log(`vexigtracker listening on http://${HOST}:${PORT}`);
  applyEnvToken();
});
