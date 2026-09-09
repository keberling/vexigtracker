import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APP_URL, DATA_DIR } from "./config.js";

const mediaDir = () => path.resolve(DATA_DIR, "media");

function ensureMediaDir() {
  fs.mkdirSync(mediaDir(), { recursive: true });
}

/** Build Instagram's legacy media redirect URL from a post permalink. */
export function instagramMediaCandidate(permalink) {
  const m = String(permalink || "").match(/\/(p|reel|tv)\/([^/?#]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const code = m[2];
  // /media/?size=l works for /p/ and often /reel/
  return `https://www.instagram.com/${kind}/${code}/media/?size=l`;
}

export async function downloadToMedia(remoteUrl, { baseUrl } = {}) {
  if (!remoteUrl) return null;
  ensureMediaDir();
  const res = await fetch(remoteUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("image") && !ctype.includes("octet-stream")) {
    throw new Error(`not an image (${ctype || "unknown type"})`);
  }
  let ext = ".jpg";
  if (ctype.includes("png")) ext = ".png";
  else if (ctype.includes("webp")) ext = ".webp";
  else if (ctype.includes("gif")) ext = ".gif";
  const filename = `${crypto.randomUUID()}${ext}`;
  const dest = path.join(mediaDir(), filename);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  const base = String(baseUrl || APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/media/${filename}` : `/media/${filename}`;
}

/**
 * If media_url missing, try Instagram /media/?size=l from permalink and cache locally.
 * Returns updated media_url or null.
 */
export async function ensureCachedMedia(tag, { baseUrl } = {}) {
  if (tag.media_url) return tag.media_url;
  const candidate = instagramMediaCandidate(tag.permalink);
  if (!candidate) return null;
  try {
    return await downloadToMedia(candidate, { baseUrl });
  } catch (err) {
    console.warn("ensureCachedMedia failed:", tag.permalink, err.message);
    return null;
  }
}
