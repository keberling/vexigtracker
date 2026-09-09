import { readStore } from "./store.js";

export function buildResults({ sinceDate, includeUnknownDates, filter, q } = {}) {
  const store = readStore();
  const since = sinceDate || store.settings.sinceDate;
  const unknown = includeUnknownDates ?? store.settings.includeUnknownDates;
  const query = String(q || "").trim().toLowerCase();
  const sinceMs = since ? Date.parse(`${since}T00:00:00.000Z`) : 0;

  const tagsByUser = new Map();
  for (const tag of store.tags) {
    const key = tag.username.toLowerCase();
    if (!tagsByUser.has(key)) tagsByUser.set(key, []);
    tagsByUser.get(key).push(tag);
  }
  for (const list of tagsByUser.values()) {
    list.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  }

  const rows = [];
  for (const follower of store.followers) {
    const followedMs = follower.followedAt ? Date.parse(follower.followedAt) : null;
    const isNew = followedMs == null ? Boolean(unknown) : followedMs >= sinceMs;
    if (!isNew) continue;
    const posts = tagsByUser.get(follower.username) || [];
    const row = {
      username: follower.username,
      profileUrl: follower.href,
      followedAt: follower.followedAt,
      tagged: posts.length > 0,
      postCount: posts.length,
      posts: posts.map((p) => ({
        id: p.id,
        permalink: p.permalink,
        caption: p.caption,
        mediaType: p.mediaType,
        timestamp: p.timestamp,
      })),
    };
    if (filter === "tagged" && !row.tagged) continue;
    if (filter === "untagged" && row.tagged) continue;
    if (query && !row.username.includes(query)) continue;
    rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.tagged !== b.tagged) return a.tagged ? -1 : 1;
    return String(b.followedAt || "").localeCompare(String(a.followedAt || ""));
  });

  const tagged = rows.filter((r) => r.tagged).length;
  return {
    since,
    includeUnknownDates: Boolean(unknown),
    total: rows.length,
    tagged,
    untagged: rows.length - tagged,
    tagRate: rows.length ? tagged / rows.length : 0,
    rows,
    allTags: store.tags.map((p) => ({
      id: p.id,
      username: p.username,
      permalink: p.permalink,
      caption: p.caption,
      mediaType: p.mediaType,
      timestamp: p.timestamp,
      source: p.source || "photo_tag",
    })),
  };
}
