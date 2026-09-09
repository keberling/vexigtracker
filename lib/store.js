import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, IG_ACCESS_TOKEN } from "./config.js";

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
    lastConnectError: null,
    lastWebhook: null,
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
  const envTokenConfigured = Boolean(IG_ACCESS_TOKEN);
  return {
    settings: store.settings,
    account: store.account,
    connected,
    tokenPresent: Boolean(secrets.accessToken),
    envTokenConfigured,
    tokenSource: secrets.source || null,
    lastConnectError: store.lastConnectError || null,
    graphHost: secrets.graphHost,
    lastTagSyncAt: store.lastTagSyncAt,
    lastTagSyncOk: store.lastTagSyncOk,
    lastTagSyncError: store.lastTagSyncError,
    lastDiagnose: store.lastDiagnose || [],
    lastFollowerImportAt: store.lastFollowerImportAt,
    followerCount: store.followers.length,
    instagramFollowersCount: store.account?.followersCount ?? null,
    tagCount: store.tags.length,
    lastWebhook: store.lastWebhook || null,
    steps: buildSteps(store, connected, envTokenConfigured, secrets),
  };
}

function buildSteps(store, connected, envTokenConfigured, secrets) {
  const steps = [];
  if (!connected) {
    steps.push({
      id: "connect",
      state: store.lastConnectError ? "fail" : "todo",
      title: store.lastConnectError ? "Instagram token failed" : "Instagram is not connected",
      body: store.lastConnectError
        ? store.lastConnectError
        : envTokenConfigured
          ? "IG_ACCESS_TOKEN is set. The app applies it on startup — wait a few seconds and refresh if this is a fresh deploy."
          : "Set IG_ACCESS_TOKEN in Coolify, or paste a token from Meta → Generate token.",
    });
  } else {
    const count = store.account?.followersCount;
    const fromEnv = envTokenConfigured || secrets.source === "env";
    steps.push({
      id: "connect",
      state: "done",
      title: `Connected as @${store.account?.username || "unknown"}`,
      body:
        (fromEnv ? "Using IG_ACCESS_TOKEN from environment. " : "Token was pasted in the dashboard. ") +
        (count == null
          ? "Instagram still will not send follower names."
          : `Instagram reports ${Number(count).toLocaleString()} followers (count only — names are not in the API).`),
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
      body: "GET /tags only returns posts where someone used Instagram’s person-tag on the photo. Writing @yourname in a caption is a mention and is not in this list unless the mentions webhook is on. Private posts are hidden.",
    });
  } else {
    steps.push({
      id: "tags",
      state: "done",
      title: `${store.tags.length} tagged posts synced`,
      body: store.lastTagSyncAt ? `Last sync ${store.lastTagSyncAt}` : "",
    });
  }

  const hook = store.lastWebhook;
  if (!hook) {
    steps.push({
      id: "webhook",
      state: "todo",
      title: "No webhooks received from Meta yet",
      body: "A caption @mention from another account does not appear in /tags. Meta must POST /webhooks/instagram. If this stays empty, the event never arrived (common with Instagram Login + a personal account that is not an app tester).",
    });
  } else if (hook.error) {
    steps.push({
      id: "webhook",
      state: "fail",
      title: "Webhook received but not processed",
      body: hook.error,
    });
  } else {
    steps.push({
      id: "webhook",
      state: "done",
      title: `Last webhook: ${hook.fields?.join(", ") || "instagram"} `,
      body: hook.at ? `Received ${hook.at}` : "",
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
  if (ok && Array.isArray(tags)) {
    const incomingIds = new Set(tags.map((t) => t.id));
    const mentions = store.tags.filter((t) => t.source === "mention" && !incomingIds.has(t.id));
    store.tags = [...tags, ...mentions];
  }
  store.lastTagSyncAt = new Date().toISOString();
  store.lastTagSyncOk = Boolean(ok);
  store.lastTagSyncError = ok ? null : error || "Tagged-post sync failed.";
  if (diagnose) store.lastDiagnose = diagnose;
  writeStore(store);
  return store.tags.length;
}

export function recordWebhook(event) {
  const store = readStore();
  store.lastWebhook = {
    at: event.at || new Date().toISOString(),
    ok: Boolean(event.ok),
    error: event.error || null,
    fields: event.fields || [],
    summary: event.summary || "",
  };
  writeStore(store);
}

export function upsertTag(tag) {
  if (!tag?.id) return;
  const store = readStore();
  const idx = store.tags.findIndex((t) => t.id === tag.id);
  if (idx >= 0) store.tags[idx] = { ...store.tags[idx], ...tag };
  else store.tags.unshift(tag);
  writeStore(store);
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
