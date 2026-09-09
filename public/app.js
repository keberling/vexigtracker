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
  el.style.borderColor = isError ? "#e4572e" : "#d9a441";
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
  $("account-handle").textContent = status.account ? `@${status.account.username}` : "Connect Instagram or load demo";
  $("stat-followers").textContent = status.followerCount;
  $("stat-tags").textContent = status.tagCount;
  $("since-date").value = status.settings.sinceDate;
  $("unknown-dates").checked = Boolean(status.settings.includeUnknownDates);
  $("oauth-link").classList.toggle("hidden", !status.oauthReady);
  const bits = [];
  if (status.lastFollowerImportAt) bits.push(`Followers imported ${fmtDate(status.lastFollowerImportAt)}`);
  if (status.lastTagSyncAt) bits.push(`Tags synced ${fmtDate(status.lastTagSyncAt)}`);
  $("sync-meta").textContent = bits.join(" · ");
}

function renderResults(results) {
  $("kpi-total").textContent = results.total;
  $("kpi-tagged").textContent = results.tagged;
  $("kpi-untagged").textContent = results.untagged;
  $("kpi-rate").textContent = `${Math.round(results.tagRate * 100)}%`;
  const body = $("rows");
  if (!results.rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No followers in this date range. Upload an Instagram follower export, or load demo data.</td></tr>`;
    return;
  }
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
    flash(`Synced ${data.tagCount} tagged posts.`);
  } catch (err) {
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
    await api("/api/connect/token", {
      method: "POST",
      body: JSON.stringify({ accessToken: $("access-token").value }),
    });
    $("access-token").value = "";
    await refresh();
    flash("Instagram account connected. Click Sync tagged posts.");
  } catch (err) {
    flash(err.message, true);
  }
});

$("disconnect").addEventListener("click", async () => {
  await api("/api/disconnect", { method: "POST", body: "{}" });
  await refresh();
  flash("Disconnected.");
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

refresh().catch((err) => {
  if (err.message !== "Password required.") flash(err.message, true);
});
