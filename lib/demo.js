import { readStore, replaceTags, upsertFollowers, writeStore } from "./store.js";

const DEMO_FOLLOWERS = [
  ["maya.prints", daysAgo(4)],
  ["studio.north", daysAgo(9)],
  ["kai_rides", daysAgo(2)],
  ["nori.kitchen", daysAgo(18)],
  ["laneandco", daysAgo(6)],
  ["opal.archive", daysAgo(21)],
  ["river.supply", daysAgo(11)],
  ["juniper.film", daysAgo(1)],
  ["old.regular", daysAgo(400)],
  ["quiet.press", daysAgo(27)],
  ["ember.goods", daysAgo(14)],
  ["no.date.yet", null],
];

const DEMO_TAGS = [
  tag("maya.prints", "CxDemoMaya1", 3, "IMAGE", "Shot of the new drop — thanks @you"),
  tag("maya.prints", "CxDemoMaya2", 1, "CAROUSEL_ALBUM", "Studio table, tagged again"),
  tag("studio.north", "CxDemoNorth", 8, "VIDEO", "Walkthrough, you're in the credits"),
  tag("nori.kitchen", "CxDemoNori", 12, "IMAGE", "Collab plate, you're tagged"),
  tag("laneandco", "CxDemoLane", 5, "IMAGE", "Window display with your product"),
  tag("quiet.press", "CxDemoQuiet", 20, "CAROUSEL_ALBUM", "Zine spread featuring the shop"),
  tag("someone.else", "CxDemoOther", 7, "IMAGE", "Random tag from a non-follower"),
];

export function loadDemo() {
  const store = readStore();
  writeStore({
    ...store,
    settings: { ...store.settings, demoMode: true },
    account: {
      id: "demo",
      username: "yourshop",
      name: "Your Shop (demo)",
      accountType: "Creator",
      followersCount: 1284,
      profilePictureUrl: null,
      loginType: "demo",
    },
    followers: [],
    tags: [],
    lastTagSyncAt: new Date().toISOString(),
  });
  upsertFollowers(
    DEMO_FOLLOWERS.map(([username, followedAt]) => ({
      username,
      followedAt,
      href: `https://www.instagram.com/${username}/`,
      source: "demo",
    })),
    "demo",
  );
  replaceTags(DEMO_TAGS);
}

function tag(username, shortcode, days, mediaType, caption) {
  return {
    id: `demo-${shortcode}`,
    username,
    caption,
    mediaType,
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: daysAgo(days),
    shortcode,
    thumbnailUrl: null,
  };
}

function daysAgo(n) {
  if (n == null) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(15, 0, 0, 0);
  return d.toISOString();
}
