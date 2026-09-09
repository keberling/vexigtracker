import AdmZip from "adm-zip";
import { normalizeUsername } from "./store.js";

export function parseFollowerUpload(buffer, originalName = "") {
  const name = originalName.toLowerCase();
  if (name.endsWith(".zip")) return parseZip(buffer);
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (name.endsWith(".html") || name.endsWith(".htm") || text.trim().startsWith("<")) {
    return parseHtml(text);
  }
  if (name.endsWith(".csv") || looksLikeCsv(text)) return parseCsv(text);
  return parseJsonText(text);
}

function parseZip(buffer) {
  const zip = new AdmZip(buffer);
  const collected = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const base = entry.entryName.replace(/\\/g, "/").toLowerCase();
    if (!base.includes("follower")) continue;
    const buf = entry.getData();
    if (base.endsWith(".json")) collected.push(...parseJsonText(buf.toString("utf8")));
    else if (base.endsWith(".html") || base.endsWith(".htm")) collected.push(...parseHtml(buf.toString("utf8")));
    else if (base.endsWith(".csv")) collected.push(...parseCsv(buf.toString("utf8")));
  }
  if (!collected.length) {
    throw new Error(
      "No follower files found in that zip. Export from Meta Accounts Center, choose JSON, and include Followers and following.",
    );
  }
  return dedupe(collected);
}

function parseJsonText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON. Re-export Instagram data as JSON, or upload a CSV of usernames.");
  }
  return parseJson(data);
}

function parseJson(data) {
  const rows = [];
  const arrays = findFollowerArrays(data);
  for (const item of arrays) {
    if (typeof item === "string") {
      const username = normalizeUsername(item);
      if (username) rows.push({ username, href: profileUrl(username), followedAt: null });
      continue;
    }
    const list = item?.string_list_data || item?.stringListData || [];
    if (list.length) {
      for (const cell of list) {
        const username = normalizeUsername(cell.value || cell.username || hrefUsername(cell.href) || item.title);
        if (!username) continue;
        rows.push({
          username,
          href: cell.href || profileUrl(username),
          followedAt: unixToIso(cell.timestamp),
        });
      }
      continue;
    }
    const username = normalizeUsername(item.username || item.value || item.title || hrefUsername(item.href));
    if (!username) continue;
    rows.push({
      username,
      href: item.href || item.url || profileUrl(username),
      followedAt: unixToIso(item.timestamp || item.followed_at || item.followedAt),
    });
  }
  if (!rows.length) {
    throw new Error("JSON parsed, but no follower usernames were found.");
  }
  return dedupe(rows);
}

function findFollowerArrays(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const preferred = [
    "relationships_followers",
    "followers_1",
    "followers",
    "subscribers_1",
  ];
  for (const key of preferred) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function parseHtml(html) {
  const rows = [];
  const linkRe = /<a[^>]+href=["'](https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([^"'/?#]+))[^"']*["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html))) {
    const username = normalizeUsername(match[3] || match[2]);
    if (!username || username === "instagram" || username === "_u") continue;
    const after = html.slice(match.index, match.index + 800);
    const ts = extractHtmlDate(after);
    rows.push({ username, href: profileUrl(username), followedAt: ts });
  }
  if (!rows.length) throw new Error("No Instagram profile links found in that HTML export.");
  return dedupe(rows);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("CSV was empty.");
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => /user|handle|name|date|follow/.test(h));
  const start = hasHeader ? 1 : 0;
  const userIdx = Math.max(0, header.findIndex((h) => /user|handle|name/.test(h)));
  const dateIdx = header.findIndex((h) => /date|time|follow/.test(h));
  const rows = [];
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line);
    const username = normalizeUsername(cols[hasHeader ? userIdx : 0]);
    if (!username) continue;
    const rawDate = hasHeader && dateIdx >= 0 ? cols[dateIdx] : cols[1];
    rows.push({
      username,
      href: profileUrl(username),
      followedAt: parseLooseDate(rawDate),
    });
  }
  if (!rows.length) throw new Error("CSV had no usernames.");
  return dedupe(rows);
}

function extractHtmlDate(chunk) {
  const iso = chunk.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/);
  if (iso) return new Date(iso[0]).toISOString();
  const unix = chunk.match(/datetime=["'](\d{9,13})["']/i);
  if (unix) return unixToIso(unix[1]);
  const pretty = chunk.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}(?:[,\s]+\d{1,2}:\d{2}(?:\s*[ap]m)?)?/i,
  );
  if (pretty) {
    const d = new Date(pretty[0]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function unixToIso(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return parseLooseDate(value);
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseLooseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hrefUsername(href) {
  if (!href) return "";
  const m = String(href).match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
  return m ? m[1] : "";
}

function profileUrl(username) {
  return `https://www.instagram.com/${username}/`;
}

function looksLikeCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || "";
  return first.includes(",") && !first.trim().startsWith("{") && !first.trim().startsWith("[");
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function dedupe(rows) {
  const map = new Map();
  for (const row of rows) {
    const prev = map.get(row.username);
    if (!prev || (!prev.followedAt && row.followedAt)) map.set(row.username, row);
  }
  return [...map.values()];
}
