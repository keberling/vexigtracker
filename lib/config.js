const trimSlash = (value) => String(value || "").replace(/\/+$/, "");

export const NODE_ENV = process.env.NODE_ENV || "development";
export const isProd = NODE_ENV === "production";
export const HOST = process.env.HOST || (isProd ? "0.0.0.0" : "127.0.0.1");
export const PORT = Number(process.env.PORT || 3847);
export const DATA_DIR = process.env.DATA_DIR || "data";
export const APP_PASSWORD = process.env.APP_PASSWORD || "";
export const APP_URL = trimSlash(process.env.APP_URL || "");
export const IG_APP_ID = process.env.IG_APP_ID || "";
export const IG_APP_SECRET = process.env.IG_APP_SECRET || "";
export const IG_REDIRECT_URI =
  process.env.IG_REDIRECT_URI || (APP_URL ? `${APP_URL}/auth/callback` : "http://127.0.0.1:3847/auth/callback");
export const IG_API_VERSION = process.env.IG_API_VERSION || "v21.0";
export const IG_ACCESS_TOKEN = String(process.env.IG_ACCESS_TOKEN || "").trim();
export const WEBHOOK_VERIFY_TOKEN = String(process.env.WEBHOOK_VERIFY_TOKEN || APP_PASSWORD || "vexigtracker").trim();

export function oauthConfigured() {
  return Boolean(IG_APP_ID && IG_APP_SECRET && IG_REDIRECT_URI);
}
