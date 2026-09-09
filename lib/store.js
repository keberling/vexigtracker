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
    lastTagSyncOk: null,
    lastTagSyncError: null,
    lastDiagnose: [],
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
  const connected = Boolean(secrets.accessToken) && !store.settings.demoMode;
  return {
    settings: store.settings,
    account: store.account,
    connected,
    tokenPresent: Boolean(secrets.accessToken),
    graphHost: secrets.graphHost,
    lastTagSyncAt: store.lastTagSyncAt,
    lastTagSyncOk: store.lastTagSyncOk,
    lastTagSyncError: store.lastTagSyncError,
    lastDiagnose: store.lastDiagnose || [],
    lastFollowerImportAt: store.lastFollowerImportAt,
    followerCount: store.followers.length,
    instagramFollowersCount: store.account?.followersCount ?? null,
    tagCount: store.tags.length,
    steps: buildSteps(store, connected),
  };
}

function buildSteps(store, connected) {
  const steps = [];
  if (!connected) {
    steps.push({
      id: "connect",
      state: "todo",
      title: "Instagram is not connected",
      body: "Paste a token from Meta → Generate token, or use Connect with Instagram.",
    });
  } else {
    const count = store.account?.followersCount;
    steps.push({
      id: "connect",
      state: "done",
      title: `Connected as @${store.account?.username || "unknown"}`,
      body:
        count == null
          ? "Token accepted. Instagram still will not send follower names."
          : `Instagram reports ${Number(count).toLocaleString()} followers. That is a count only — names are not in the API.`,
    });
  }

  if (!connected) {
    steps.push({
      id: "tags",
      state: "todo",
      title: "Tagged posts not synced",
      body: "After you connect, the app fetches GET /{ig-user-id}/tags automatically.",
    });
  } else if (store.lastTagSyncError) {
    steps.push({
      id: "tags",
      state: "fail",
      title: "Tagged-post sync failed",
      body: store.lastTagSyncError,
    });
  } else if (!store.lastTagSyncAt) {
    steps.push({
      id: "tags",
      state: "todo",
      title: "Tagged posts not synced yet",
      body: "Click Sync tagged posts. Connecting a token does not load tags by itself unless this sync succeeds.",
    });
  } else if (!store.tags.length) {
    steps.push({
      id: "tags",
      state: "done",
      title: "Sync succeeded — 0 photo-tags",
      body: "Instagram returned no tagged posts. Private accounts tagging you are hidden. Caption @mentions are not included.",
    });
  } else {
    steps.push({
      id: "tags",
      state: "done",
      title: `${store.tags.length} tagged posts synced`,
      body: store.lastTagSyncAt ? `Last sync ${store.lastTagSyncAt}` : "",
    });
  }

  if (!store.followers.length) {
    steps.push({
      id: "followers",
      state: "todo",
      title: "No follower names imported",
      body: "This is expected. Upload an Instagram data export (Followers and following, JSON). The token cannot import the follower list.",
    });
  } else {
    steps.push({
      id: "followers",
      state: "done",
      title: `${store.followers.length} follower names imported`,
      body: store.lastFollowerImportAt ? `From export, last updated ${store.lastFollowerImportAt}` : "From export or manual add.",
    });
  }
  return steps;
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
  return recordTagSync({ ok: true, tags, error: null });
}

export function recordTagSync({ ok, tags, error, diagnose }) {
  const store = readStore();
  if (ok && Array.isArray(tags)) store.tags = tags;
  store.lastTagSyncAt = new Date().toISOString();
  store.lastTagSyncOk = Boolean(ok);
  store.lastTagSyncError = ok ? null : error || "Tagged-post sync failed.";
  if (diagnose) store.lastDiagnose = diagnose;
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
