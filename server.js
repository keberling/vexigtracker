import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  APP_PASSWORD,
  APP_URL,
  DATA_DIR,
  HOST,
  INGEST_API_KEY,
  PORT,
  WINDOW_END,
  WINDOW_START,
  isProd,
} from "./lib/config.js";
import { addClient, broadcast, clientCount } from "./lib/sse.js";
import {
  addSnapshot,
  buildDashboard,
  listEntries,
  publicStats,
  readStore,
  upsertFollowers,
  upsertTags,
  writeStore,
} from "./lib/store.js";
import { downloadToMedia, ensureCachedMedia } from "./lib/media.js";

const app = express();
app.set("trust proxy", 1);
const mediaDir = path.resolve(DATA_DIR, "media");
fs.mkdirSync(mediaDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const sessions = new Map();

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  const cookie = parseCookies(req.headers.cookie);
  req.sessionId = cookie.tagwatch || null;
  req.authed = !APP_PASSWORD || sessions.get(req.sessionId) === true;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "vexigtracker",
    mode: "browser-ingest",
    window: { start: WINDOW_START, end: WINDOW_END },
    ingestConfigured: Boolean(INGEST_API_KEY),
    time: new Date().toISOString(),
  });
});

/** Public read APIs for display boards */
app.get("/api/stats", (_req, res) => {
  res.json({ ...publicStats(), sse_clients: clientCount() });
});

app.get("/api/entries", (req, res) => {
  const eligible = req.query.eligible === "true" ? true : req.query.eligible === "false" ? false : undefined;
  const in_window = req.query.in_window === "true" ? true : req.query.in_window === "false" ? false : undefined;
  const limit = req.query.limit;
  res.json({ entries: listEntries({ eligible, in_window, limit }) });
});

app.get("/api/entries/latest", (req, res) => {
  const eligible = req.query.eligible === "true";
  const limit = req.query.limit || 20;
  res.json({ entries: listEntries({ eligible: eligible ? true : undefined, limit }) });
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, stats: publicStats() })}\n\n`);
  addClient(res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(ping);
    }
  }, 25000);
  req.on("close", () => clearInterval(ping));
});

app.use("/media", express.static(mediaDir, { maxAge: "7d" }));


async function enrichTagsWithMedia(tags, req) {
  const base = APP_URL || `${req.protocol}://${req.get("host")}`;
  const out = [];
  for (const tag of tags || []) {
    const copy = { ...tag };
    if (!copy.media_url && copy.permalink) {
      copy.media_url = await ensureCachedMedia(copy, { baseUrl: base });
    } else if (copy.media_url && !String(copy.media_url).includes("/media/")) {
      try {
        copy.media_url = await downloadToMedia(copy.media_url, { baseUrl: base });
      } catch (err) {
        console.warn("cache remote media_url failed:", err.message);
      }
    }
    out.push(copy);
  }
  return out;
}

function requireIngest(req, res, next) {
  if (!INGEST_API_KEY) {
    return res.status(503).json({ error: "INGEST_API_KEY not configured on server" });
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : String(req.headers["x-api-key"] || "");
  if (token !== INGEST_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/**
 * Browser / agent ingest webhook bundle.
 * POST /api/ingest
 * Authorization: Bearer $INGEST_API_KEY
 * {
 *   followers?: [{ username, display_name?, followedAt? }],
 *   tags?: [{ username, permalink, tagged_at, media_url?, caption?, follows?, display_name? }],
 *   snapshot?: { follower_count, notes? },
 *   replace_followers?: boolean  // if true, still upsert (not wipe) — reserved
 * }
 */
app.post("/api/ingest", requireIngest, async (req, res) => {
  try {
    const body = req.body || {};
    const out = {};
    if (Array.isArray(body.followers) && body.followers.length) {
      out.followers = upsertFollowers(body.followers, body.source || "browser");
    }
    if (Array.isArray(body.tags) && body.tags.length) {
      const tags = await enrichTagsWithMedia(body.tags, req);
      out.tags = upsertTags(tags, body.source || "browser");
    }
    if (body.snapshot && body.snapshot.follower_count != null) {
      out.snapshot = addSnapshot(body.snapshot);
    }
    const stats = publicStats();
    broadcast("stats", stats);
    if (out.tags?.added) broadcast("entry.created", { count: out.tags.added });
    res.json({ ok: true, ...out, stats });
  } catch (err) {
    res.status(400).json({ error: err.message || "ingest_failed" });
  }
});

app.post("/api/ingest/followers", requireIngest, (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.followers || [];
  const result = upsertFollowers(list, req.body?.source || "browser");
  broadcast("stats", publicStats());
  res.json({ ok: true, ...result, stats: publicStats() });
});

app.post("/api/ingest/tags", requireIngest, upload.single("media"), async (req, res) => {
  try {
  let tags = Array.isArray(req.body?.tags) ? req.body.tags : null;
  if (!tags && req.body?.username && req.body?.permalink) {
    tags = [req.body];
  }
  if (!tags) return res.status(400).json({ error: "tags array or username+permalink required" });
  if (req.file) {
    const base = APP_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${base.replace(/\/$/, "")}/media/${req.file.filename}`;
    tags = tags.map((t, i) => (i === 0 ? { ...t, media_url: url } : t));
  } else {
    tags = await enrichTagsWithMedia(tags, req);
  }
  const result = upsertTags(tags, req.body?.source || "browser");
  const entries = listEntries({ limit: 5 });
  broadcast("stats", publicStats());
  if (entries[0]) broadcast("entry.created", entries[0]);
  res.json({ ok: true, ...result, latest: entries[0] || null, stats: publicStats() });
  } catch (err) {
    res.status(400).json({ error: err.message || "ingest_tags_failed" });
  }
});

app.post("/api/ingest/snapshot", requireIngest, (req, res) => {
  if (req.body?.follower_count == null) {
    return res.status(400).json({ error: "follower_count required" });
  }
  const snap = addSnapshot(req.body);
  broadcast("stats", publicStats());
  res.status(201).json({ ok: true, snapshot: snap, stats: publicStats() });
});


app.post("/api/ingest/backfill-media", requireIngest, async (req, res) => {
  try {
    const store = readStore();
    const base = APP_URL || `${req.protocol}://${req.get("host")}`;
    let updated = 0;
    let failed = 0;
    for (const tag of store.tags) {
      if (tag.media_url) continue;
      const media_url = await ensureCachedMedia(tag, { baseUrl: base });
      if (media_url) {
        tag.media_url = media_url;
        tag.updated_at = new Date().toISOString();
        updated += 1;
      } else {
        failed += 1;
      }
    }
    writeStore(store);
    broadcast("stats", publicStats());
    res.json({ ok: true, updated, failed, stats: publicStats() });
  } catch (err) {
    res.status(400).json({ error: err.message || "backfill_failed" });
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

app.get("/api/dashboard", (req, res) => {
  if (!req.authed) return res.status(401).json({ error: "Password required.", needsAuth: true });
  res.json(buildDashboard());
});

app.use(express.static("public"));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) return next();
  res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`vexigtracker v2 listening on ${HOST}:${PORT}`);
  console.log(`ingest key configured: ${Boolean(INGEST_API_KEY)}`);
  console.log(`window ${WINDOW_START} → ${WINDOW_END}`);
});

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
