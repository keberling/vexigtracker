const trimSlash = (v) => String(v || "").replace(/\/+$/, "");

export const NODE_ENV = process.env.NODE_ENV || "development";
export const isProd = NODE_ENV === "production";
export const HOST = process.env.HOST || (isProd ? "0.0.0.0" : "127.0.0.1");
export const PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = process.env.DATA_DIR || "data";
export const APP_URL = trimSlash(process.env.APP_URL || process.env.PUBLIC_BASE_URL || "");
export const APP_PASSWORD = String(process.env.APP_PASSWORD || "").trim();
export const INGEST_API_KEY = String(
  process.env.INGEST_API_KEY || process.env.IGTRACKER_INGEST_API_KEY || "",
).trim();
export const TZ = process.env.TZ || "America/Chicago";
export const WINDOW_START = process.env.GIVEAWAY_WINDOW_START || "2026-09-13";
export const WINDOW_END = process.env.GIVEAWAY_WINDOW_END || "2026-09-15";
