import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, WINDOW_START, WINDOW_END, TZ } from "./config.js";
import { computeEligible } from "./eligibility.js";

const root = path.resolve(DATA_DIR);
const storePath = path.join(root, "store.json");

function empty() {
  return {
    settings: {
      sinceDate: WINDOW_START,
      account: "vexitey",
    },
    followers: [],
    tags: [],
    snapshots: [],
    lastIngestAt: null,
    lastIngestSummary: null,
  };
}

function ensure() {
  fs.mkdirSync(path.join(root, "media"), { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(empty(), null, 2));
  }
}

export function readStore() {
  ensure();
  const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
  return { ...empty(), ...raw, settings: { ...empty().settings, ...(raw.settings || {}) } };
}

export function writeStore(next) {
  ensure();
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2));
  return next;
}

export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function upsertFollowers(incoming, source = "browser") {
  const store = readStore();
  const map = new Map(store.followers.map((f) => [f.username.toLowerCase(), f]));
  let added = 0;
  let updated = 0;
  for (const row of incoming || []) {
    const username = normalizeUsername(row.username);
    if (!username) continue;
    const existing = map.get(username);
    const next = {
      username,
      display_name: row.display_name || existing?.display_name || null,
      href: row.href || `https://www.instagram.com/${username}/`,
      followedAt: row.followedAt || existing?.followedAt || null,
      source: source || row.source || "browser",
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      updated += 1;
      map.set(username, { ...existing, ...next });
    } else {
      added += 1;
      map.set(username, next);
    }
  }
  store.followers = [...map.values()].sort((a, b) => a.username.localeCompare(b.username));
  store.lastIngestAt = new Date().toISOString();
  writeStore(store);
  return { added, updated, total: store.followers.length };
}

export function upsertTags(incoming, source = "browser") {
  const store = readStore();
  const byId = new Map(store.tags.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  for (const row of incoming || []) {
    const username = normalizeUsername(row.username);
    const permalink = String(row.permalink || "").trim();
    if (!username || !permalink) continue;
    const id = row.id || permalinkId(permalink) || crypto.randomUUID();
    const taggedAt = row.tagged_at || row.timestamp || new Date().toISOString();
    const follows =
      row.follows === true ||
      row.follows === 1 ||
      store.followers.some((f) => f.username === username);
    const tagged = row.tagged !== false;
    const elig = computeEligible({ follows, tagged, taggedAt });
    const existing = byId.get(id);
    const next = {
      id,
      username,
      display_name: row.display_name || existing?.display_name || null,
      permalink,
      media_url: row.media_url || existing?.media_url || null,
      caption: row.caption ?? existing?.caption ?? null,
      mediaType: row.mediaType || existing?.mediaType || "IMAGE",
      timestamp: taggedAt,
      tagged_at_chicago: elig.tagged_at_chicago,
      follows: Boolean(follows),
      tagged: Boolean(tagged),
      in_window: elig.in_window,
      eligible: elig.eligible,
      source: source || row.source || "browser",
      notes: row.notes ?? existing?.notes ?? null,
      updated_at: new Date().toISOString(),
      created_at: existing?.created_at || new Date().toISOString(),
    };
    if (existing) {
      updated += 1;
      byId.set(id, { ...existing, ...next, created_at: existing.created_at });
    } else {
      added += 1;
      byId.set(id, next);
    }
  }
  store.tags = [...byId.values()].sort((a, b) =>
    String(b.timestamp || "").localeCompare(String(a.timestamp || "")),
  );
  // Recompute eligibility if follower list changed
  for (const tag of store.tags) {
    const follows = store.followers.some((f) => f.username === tag.username) || tag.follows;
    const elig = computeEligible({ follows, tagged: tag.tagged, taggedAt: tag.timestamp });
    tag.follows = Boolean(follows);
    tag.in_window = elig.in_window;
    tag.eligible = elig.eligible;
    tag.tagged_at_chicago = elig.tagged_at_chicago;
  }
  store.lastIngestAt = new Date().toISOString();
  writeStore(store);
  return { added, updated, total: store.tags.length };
}

function permalinkId(permalink) {
  const m = String(permalink).match(/\/(p|reel|tv)\/([^/?#]+)/i);
  return m ? `ig_${m[2]}` : null;
}

export function addSnapshot({ follower_count, notes }) {
  const store = readStore();
  const snap = {
    id: crypto.randomUUID(),
    follower_count: Number(follower_count),
    notes: notes || null,
    created_at: new Date().toISOString(),
  };
  store.snapshots.unshift(snap);
  store.snapshots = store.snapshots.slice(0, 200);
  writeStore(store);
  return snap;
}

export function publicStats() {
  const store = readStore();
  const eligible = store.tags.filter((t) => t.eligible).length;
  const inWindow = store.tags.filter((t) => t.in_window).length;
  const latestSnap = store.snapshots[0];
  return {
    account: store.settings.account,
    follower_names: store.followers.length,
    follower_count: latestSnap?.follower_count ?? null,
    follower_count_at: latestSnap?.created_at ?? null,
    tag_count: store.tags.length,
    eligible_count: eligible,
    in_window_count: inWindow,
    last_ingest_at: store.lastIngestAt,
    window: { start: WINDOW_START, end: WINDOW_END, tz: TZ },
  };
}

export function listEntries({ eligible, in_window, limit = 100 } = {}) {
  const store = readStore();
  let tags = store.tags;
  if (eligible === true) tags = tags.filter((t) => t.eligible);
  if (eligible === false) tags = tags.filter((t) => !t.eligible);
  if (in_window === true) tags = tags.filter((t) => t.in_window);
  if (in_window === false) tags = tags.filter((t) => !t.in_window);
  return tags.slice(0, Math.min(Number(limit) || 100, 500));
}

export function buildDashboard() {
  const store = readStore();
  const tagsByUser = new Map();
  for (const t of store.tags) {
    if (!tagsByUser.has(t.username)) tagsByUser.set(t.username, []);
    tagsByUser.get(t.username).push(t);
  }
  const rows = store.followers.map((f) => {
    const posts = tagsByUser.get(f.username) || [];
    const best = posts.find((p) => p.eligible) || posts[0] || null;
    return {
      username: f.username,
      display_name: f.display_name,
      followedAt: f.followedAt,
      tagged: posts.length > 0,
      eligible: posts.some((p) => p.eligible),
      post: best
        ? {
            permalink: best.permalink,
            media_url: best.media_url,
            tagged_at_chicago: best.tagged_at_chicago,
            eligible: best.eligible,
          }
        : null,
    };
  });
  return { stats: publicStats(), rows, tags: store.tags.slice(0, 100) };
}
