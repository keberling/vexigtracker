const state = {
  filter: "all",
  q: "",
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.needsAuth) {
    $("gate").classList.remove("hidden");
    $("app").classList.add("hidden");
    throw new Error("Password required.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function flash(message, isError = false) {
  const el = $("flash");
  el.textContent = message;
  el.classList.toggle("hidden", !message);
  el.classList.toggle("bad", Boolean(isError));
  el.classList.toggle("ok", Boolean(message) && !isError);
}

function fmtDate(value) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderStatus(status) {
  const demo = status.settings.demoMode || status.account?.loginType === "demo";
  $("mode-label").textContent = demo ? "Demo data" : status.connected ? "Connected" : "Not connected";
  $("account-name").textContent = status.account?.name || "No account";
  $("account-handle").textContent = status.account
    ? `@${status.account.username}${status.graphHost ? ` · ${status.graphHost}` : ""}`
    : "Paste a token to connect";
  $("stat-ig-followers").textContent =
    status.instagramFollowersCount == null ? "—" : Number(status.instagramFollowersCount).toLocaleString();
  $("stat-followers").textContent = status.followerCount;
  $("stat-tags").textContent = status.tagCount;
  $("since-date").value = status.settings.sinceDate;
  $("unknown-dates").checked = Boolean(status.settings.includeUnknownDates);
  $("oauth-link").classList.toggle("hidden", !status.oauthReady);
  if ($("token-hint")) {
    $("token-hint").textContent = status.envTokenConfigured
      ? "IG_ACCESS_TOKEN is set in the environment and is applied on startup. A pasted token is used until the next restart, then env wins."
      : "Prefer IG_ACCESS_TOKEN in Coolify so it survives deploys. Pasting here is a one-off unless you also set env.";
  }
  const bits = [];
  if (status.lastFollowerImportAt) bits.push(`Export imported ${fmtDate(status.lastFollowerImportAt)}`);
  if (status.lastTagSyncAt) bits.push(`Tags ${status.lastTagSyncOk === false ? "failed" : "synced"} ${fmtDate(status.lastTagSyncAt)}`);
  $("sync-meta").textContent = bits.join(" · ");
  renderSteps(status.steps || []);
  renderDiagnose(status.lastDiagnose || []);
}

function renderSteps(steps) {
  $("steps").innerHTML = steps
    .map((step) => {
      const mark = step.state === "done" ? "✓" : step.state === "fail" ? "!" : "•";
      return `<article class="step ${step.state}">
        <span class="dot">${mark}</span>
        <div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p></div>
      </article>`;
    })
    .join("");
}

function renderDiagnose(tests) {
  if (!tests.length) {
    $("diagnose").innerHTML = "";
    return;
  }
  $("diagnose").innerHTML = tests
    .map(
      (t) =>
        `<div><span class="${t.ok ? "ok" : "bad"}">${t.ok ? "OK" : "FAIL"}</span><span>${escapeHtml(t.name)} — ${escapeHtml(t.detail)}</span></div>`,
    )
    .join("");
}

function renderResults(results) {
  $("kpi-total").textContent = results.total;
  $("kpi-tagged").textContent = results.tagged;
  $("kpi-untagged").textContent = results.untagged;
  $("kpi-rate").textContent = `${Math.round(results.tagRate * 100)}%`;
  const body = $("rows");
  if (!results.rows.length) {
    const why = results.allTags?.length
      ? `Tagged posts are in the table below, but this follower table is empty because no follower export has been imported. Instagram’s API cannot provide names.`
      : `No follower names in this date range. Connecting a token does not import followers — upload an Instagram “Followers and following” JSON export.`;
    body.innerHTML = `<tr><td colspan="4" class="empty">${why}</td></tr>`;
  } else {
  body.innerHTML = results.rows
    .map((row) => {
      const posts = row.posts.length
        ? `<div class="posts">${row.posts
            .map(
              (p) =>
                `<div><a href="${p.permalink}" target="_blank" rel="noreferrer">${p.permalink}</a><span class="caption">${escapeHtml(
                  [p.mediaType, p.timestamp ? fmtDate(p.timestamp) : "", p.caption].filter(Boolean).join(" · "),
                )}</span></div>`,
            )
            .join("")}</div>`
        : `<span class="muted">No tagged post</span>`;
      return `<tr>
        <td class="user"><a href="${row.profileUrl}" target="_blank" rel="noreferrer">@${escapeHtml(row.username)}</a></td>
        <td>${fmtDate(row.followedAt)}</td>
        <td><span class="badge ${row.tagged ? "yes" : "no"}">${row.tagged ? `Yes · ${row.postCount}` : "No"}</span></td>
        <td>${posts}</td>
      </tr>`;
    })
    .join("");
  }

  const tagBody = $("tag-rows");
  const tags = results.allTags || [];
  $("tags-hint").textContent = tags.length
    ? `${tags.length} photo-tags from Instagram /tags. These show even without a follower export.`
    : "These are photo-tags from /tags, even if you have not imported followers yet.";
  if (!tags.length) {
    tagBody.innerHTML = `<tr><td colspan="4" class="empty">No photo-tags from Instagram. If someone only wrote @yourname in a caption, that is a mention — enable the mentions webhook. Private accounts never show up here.</td></tr>`;
  } else {
    tagBody.innerHTML = tags
      .map(
        (p) => `<tr>
          <td class="user"><a href="https://www.instagram.com/${escapeHtml(p.username)}/" target="_blank" rel="noreferrer">@${escapeHtml(p.username || "unknown")}</a></td>
          <td>${escapeHtml(sourceLabel(p.source))}</td>
          <td>${fmtDate(p.timestamp)}</td>
          <td class="posts">${
            p.permalink
              ? `<a href="${p.permalink}" target="_blank" rel="noreferrer">${p.permalink}</a><span class="caption">${escapeHtml([p.mediaType, p.caption].filter(Boolean).join(" · "))}</span>`
              : "No permalink"
          }</td>
        </tr>`,
      )
      .join("");
  }
}

function sourceLabel(source) {
  if (source === "mention") return "@mention in caption";
  if (source === "collab") return "Collab post";
  return "Photo person-tag";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refresh() {
  const status = await api("/api/status");
  renderStatus(status);
  const params = new URLSearchParams({
    since: $("since-date").value,
    unknown: $("unknown-dates").checked ? "1" : "0",
    filter: state.filter,
    q: state.q,
  });
  const results = await api(`/api/results?${params}`);
  renderResults(results);
  $("app").classList.remove("hidden");
  $("gate").classList.add("hidden");
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    await refresh();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("save-settings").addEventListener("click", async () => {
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        sinceDate: $("since-date").value,
        includeUnknownDates: $("unknown-dates").checked,
      }),
    });
    await refresh();
    flash("Date filter updated.");
  } catch (err) {
    flash(err.message, true);
  }
});

$("sync-tags").addEventListener("click", async () => {
  try {
    flash("Syncing tagged posts from Instagram…");
    const data = await api("/api/sync/tags", { method: "POST", body: "{}" });
    await refresh();
    flash(data.message || (data.ok ? `Synced ${data.tagCount} tagged posts.` : "Tagged-post sync failed."), !data.ok);
  } catch (err) {
    await refresh().catch(() => {});
    flash(err.message, true);
  }
});

$("follower-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch("/api/followers/upload", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    await refresh();
    flash(`Imported ${data.imported} followers (${data.added} new).`);
  } catch (err) {
    flash(err.message, true);
  } finally {
    e.target.value = "";
  }
});

$("load-demo").addEventListener("click", async () => {
  await api("/api/demo", { method: "POST", body: "{}" });
  await refresh();
  flash("Demo followers and tagged posts loaded.");
});

$("save-token").addEventListener("click", async () => {
  try {
    flash("Connecting token and syncing tagged posts…");
    const data = await api("/api/connect/token", {
      method: "POST",
      body: JSON.stringify({ accessToken: $("access-token").value }),
    });
    $("access-token").value = "";
    await refresh();
    const count = data.instagramFollowersCount;
    const countBit = count == null ? "" : ` Instagram reports ${Number(count).toLocaleString()} followers (names are not included).`;
    const sync = data.tagSync || {};
    const syncBit = sync.ok
      ? ` Synced ${sync.tagCount} tagged posts.`
      : ` Tagged-post sync: ${sync.message || "failed"}.`;
    flash(`Connected @${data.username}.${countBit}${syncBit}`, !sync.ok);
  } catch (err) {
    flash(err.message, true);
  }
});

$("disconnect").addEventListener("click", async () => {
  await api("/api/disconnect", { method: "POST", body: "{}" });
  await refresh();
  flash("Disconnected.");
});

$("add-post").addEventListener("click", async () => {
  try {
    const data = await api("/api/posts/url", {
      method: "POST",
      body: JSON.stringify({ url: $("post-url").value }),
    });
    $("post-url").value = "";
    await refresh();
    flash(`Added post from @${data.tag?.username || "unknown"}.`);
  } catch (err) {
    flash(err.message, true);
  }
});

$("add-follower").addEventListener("click", async () => {
  try {
    await api("/api/followers/manual", {
      method: "POST",
      body: JSON.stringify({
        username: $("manual-user").value,
        followedAt: $("manual-date").value || undefined,
      }),
    });
    $("manual-user").value = "";
    await refresh();
  } catch (err) {
    flash(err.message, true);
  }
});

document.querySelectorAll("[data-filter]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    state.filter = btn.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("on", b === btn));
    await refresh();
  });
});

let searchTimer;
$("search").addEventListener("input", (e) => {
  state.q = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refresh().catch((err) => flash(err.message, true)), 180);
});

refresh()
  .then(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      flash("Instagram connected. Check the status cards — tagged posts sync automatically; follower names still need an export.");
      window.history.replaceState({}, "", "/");
    }
  })
  .catch((err) => {
    if (err.message !== "Password required.") flash(err.message, true);
  });
