import { TZ, WINDOW_START, WINDOW_END } from "./config.js";

export function chicagoDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function inWindow(chicagoDay) {
  if (!chicagoDay) return false;
  return chicagoDay >= WINDOW_START && chicagoDay <= WINDOW_END;
}

/** Follow may predate window; tag date must be in window. */
export function computeEligible({ follows, tagged, taggedAt }) {
  const day = chicagoDate(taggedAt);
  const window = inWindow(day);
  return {
    tagged_at_chicago: day,
    in_window: window,
    eligible: Boolean(follows) && Boolean(tagged) && window,
  };
}
