const loginEl = document.getElementById("login");
const appEl = document.getElementById("app");

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.dataset.tab;
    document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`panel-${id}`).classList.remove("hidden");
  });
});

async function loadDashboard() {
  const r = await fetch("/api/dashboard");
  if (r.status === 401) {
    loginEl.classList.remove("hidden");
    appEl.classList.add("hidden");
    return;
  }
  const data = await r.json();
  loginEl.classList.add("hidden");
  appEl.classList.remove("hidden");

  const s = data.stats || {};
  document.getElementById("stats").innerHTML = [
    pill("Eligible", s.eligible_count ?? 0),
    pill("Tags", s.tag_count ?? 0),
    pill("Followers", s.follower_names ?? 0),
    pill("IG count", s.follower_count ?? "—"),
    pill("Window", `${s.window?.start || "?"} → ${s.window?.end || "?"}`),
  ].join("");

  const eligible = (data.tags || []).filter((t) => t.eligible);
  document.getElementById("eligible").innerHTML = eligible.length
    ? eligible.map(card).join("")
    : emptyState("No eligible entries yet", "Need follow + tag dated Sept 13–15.");

  document.getElementById("tags").innerHTML = (data.tags || []).length
    ? data.tags.slice(0, 48).map(card).join("")
    : emptyState("No tags ingested yet", "Browser checks will POST photo-tags here.");

  const rows = data.rows || [];
  document.getElementById("followers").innerHTML = rows.length
    ? `<table>
        <thead><tr><th>Follower</th><th>Tagged</th><th>Eligible</th><th>Post</th></tr></thead>
        <tbody>
          ${rows
            .slice(0, 300)
            .map(
              (r) => `<tr>
            <td><strong>@${esc(r.username)}</strong>${r.display_name ? `<div class="meta">${esc(r.display_name)}</div>` : ""}</td>
            <td><span class="dot ${r.tagged ? "on" : "off"}"></span>${r.tagged ? "Yes" : "No"}</td>
            <td><span class="dot ${r.eligible ? "on" : "off"}"></span>${r.eligible ? "Yes" : "No"}</td>
            <td>${r.post ? `<a href="${esc(r.post.permalink)}" target="_blank" rel="noopener">Open</a>` : "—"}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>`
    : emptyState("No followers on file", "Ingest follower names from the browser checker.");

  const ingest = s.last_ingest_at
    ? `Last ingest ${new Date(s.last_ingest_at).toLocaleString()}`
    : "Waiting for first ingest";
  document.getElementById("ingestMeta").textContent = ingest;
}

function pill(label, value) {
  return `<div class="pill">${esc(label)} <strong>${esc(String(value))}</strong></div>`;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${esc(title)}</strong><div class="meta" style="margin-top:.4rem">${esc(body)}</div></div>`;
}

function card(t) {
  const media = t.media_url
    ? `<div class="media"><img src="${esc(t.media_url)}" alt="" loading="lazy" /></div>`
    : `<div class="media">No image</div>`;
  return `<article class="card">
    ${media}
    <div class="body">
      <div class="user">@${esc(t.username)}</div>
      <div class="meta">${esc(t.display_name || "")}</div>
      <div class="meta">${esc(t.tagged_at_chicago || "")} · ${esc(t.source || "")}</div>
      <div class="meta"><a href="${esc(t.permalink)}" target="_blank" rel="noopener">Open post</a></div>
      <span class="badge ${t.eligible ? "yes" : "no"}">${t.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}</span>
    </div>
  </article>`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.getElementById("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const password = document.getElementById("password").value;
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    document.getElementById("loginErr").textContent = "Wrong password";
    return;
  }
  document.getElementById("loginErr").textContent = "";
  loadDashboard();
});

const es = new EventSource("/api/stream");
es.addEventListener("stats", () => loadDashboard());
es.addEventListener("entry.created", () => loadDashboard());

loadDashboard();
