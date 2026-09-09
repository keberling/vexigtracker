import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const dataDir = path.resolve(DATA_DIR);
const storePath = path.join(dataDir, "store.json");
const secretsPath = path.join(dataDir, "secrets.json");

function emptyStore() {
  return {
    settings: {
      sinceDate: defaultSinceDate(),
      includeUnknownDates: false,
      demoMode: true,
    },
    account: null,
    followers: [],
    tags: [],
    lastTagSyncAt: null,
    lastFollowerImportAt: null,
  };
}

function defaultSinceDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function ensure() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(emptyStore(), null, 2));
  }
  if (!fs.existsSync(secretsPath)) {
    fs.writeFileSync(secretsPath, JSON.stringify({ accessToken: null, graphHost: null }, null, 2));
  }
}

export function readStore() {
  ensure();
  const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
  return { ...emptyStore(), ...raw, settings: { ...emptyStore().settings, ...(raw.settings || {}) } };
}

export function writeStore(next) {
  ensure();
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2));
  return next;
}

export function updateStore(patch) {
  const current = readStore();
  const next = { ...current, ...patch };
  if (patch.settings) next.settings = { ...current.settings, ...patch.settings };
  return writeStore(next);
}

export function readSecrets() {
  ensure();
  return JSON.parse(fs.readFileSync(secretsPath, "utf8"));
}

export function writeSecrets(next) {
  ensure();
  fs.writeFileSync(secretsPath, JSON.stringify(next, null, 2));
  return next;
}

export function publicStatus() {
  const store = readStore();
  const secrets = readSecrets();
  return {
    settings: store.settings,
    account: store.account,
    connected: Boolean(secrets.accessToken) && !store.settings.demoMode,
    tokenPresent: Boolean(secrets.accessToken),
    graphHost: secrets.graphHost,
    lastTagSyncAt: store.lastTagSyncAt,
    lastFollowerImportAt: store.lastFollowerImportAt,
    followerCount: store.followers.length,
    tagCount: store.tags.length,
  };
}

export function upsertFollowers(incoming, source) {
  const store = readStore();
  const byName = new Map(store.followers.map((f) => [f.username.toLowerCase(), f]));
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    const username = normalizeUsername(row.username);
    if (!username) continue;
    const existing = byName.get(username);
    const next = {
      username,
      href: row.href || `https://www.instagram.com/${username}/`,
      followedAt: row.followedAt || existing?.followedAt || null,
      source: source || row.source || "import",
    };
    if (existing) {
      if (next.followedAt && next.followedAt !== existing.followedAt) updated += 1;
      byName.set(username, { ...existing, ...next });
    } else {
      added += 1;
      byName.set(username, next);
    }
  }
  store.followers = [...byName.values()].sort(byFollowedDesc);
  store.lastFollowerImportAt = new Date().toISOString();
  writeStore(store);
  return { added, updated, total: store.followers.length };
}

export function replaceTags(tags) {
  const store = readStore();
  store.tags = tags;
  store.lastTagSyncAt = new Date().toISOString();
  writeStore(store);
  return store.tags.length;
}

export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function byFollowedDesc(a, b) {
  const at = a.followedAt || "";
  const bt = b.followedAt || "";
  if (at === bt) return a.username.localeCompare(b.username);
  if (!at) return 1;
  if (!bt) return -1;
  return bt.localeCompare(at);
}

export { emptyStore };
