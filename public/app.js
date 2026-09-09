
const loginEl = document.getElementById('login');
const appEl = document.getElementById('app');

async function loadDashboard() {
  const r = await fetch('/api/dashboard');
  if (r.status === 401) {
    loginEl.classList.remove('hidden');
    appEl.classList.add('hidden');
    return;
  }
  const data = await r.json();
  loginEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  const s = data.stats;
  document.getElementById('stats').innerHTML = `
    <div>Eligible <strong>${s.eligible_count}</strong></div>
    <div>Tags <strong>${s.tag_count}</strong></div>
    <div>Followers named <strong>${s.follower_names}</strong></div>
    <div>IG count <strong>${s.follower_count ?? '—'}</strong></div>
    <div>Window <strong>${s.window.start} → ${s.window.end}</strong></div>
  `;
  const eligible = (data.tags || []).filter((t) => t.eligible);
  document.getElementById('eligible').innerHTML = eligible.length
    ? eligible.map(card).join('')
    : '<p class="empty">No eligible entries yet (need follow + tag in Sept 13–15).</p>';
  document.getElementById('tags').innerHTML = (data.tags || []).length
    ? data.tags.slice(0, 24).map(card).join('')
    : '<p class="empty">No tags ingested yet.</p>';
  const rows = data.rows || [];
  document.getElementById('followers').innerHTML = rows.length
    ? `<table><thead><tr><th>Follower</th><th>Tagged?</th><th>Eligible?</th><th>Post</th></tr></thead><tbody>${
        rows.slice(0, 200).map((r) => `<tr>
          <td>@${r.username}</td>
          <td>${r.tagged ? 'yes' : 'no'}</td>
          <td>${r.eligible ? 'yes' : 'no'}</td>
          <td>${r.post ? `<a href="${r.post.permalink}" target="_blank" rel="noopener">open</a>` : '—'}</td>
        </tr>`).join('')
      }</tbody></table>`
    : '<p class="empty">No followers ingested yet.</p>';
}

function card(t) {
  return `<article class="card">
    ${t.media_url ? `<img src="${t.media_url}" alt="" />` : ''}
    <div class="body">
      <div><strong>@${t.username}</strong></div>
      <div class="meta">${t.tagged_at_chicago || ''} · ${t.source || ''}</div>
      <div class="meta"><a href="${t.permalink}" target="_blank" rel="noopener">Open post</a></div>
      <span class="badge ${t.eligible ? '' : 'no'}">${t.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</span>
    </div>
  </article>`;
}

document.getElementById('loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const password = document.getElementById('password').value;
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    document.getElementById('loginErr').textContent = 'Wrong password';
    return;
  }
  loadDashboard();
});

const es = new EventSource('/api/stream');
es.addEventListener('stats', () => loadDashboard());
es.addEventListener('entry.created', () => loadDashboard());

loadDashboard();
