# vexigtracker

Internal dashboard: who followed after a given date, and did they tag you? Matching rows include the Instagram post URL.

## API (what Meta actually gives you)

Use **Instagram API with Instagram Login**. The account must be Business or Creator.

| Need | Official API |
| --- | --- |
| Posts that tag your account | `GET /{ig-user-id}/tags` (`permalink`, `username`, `timestamp`) |
| Follower **count** | `followers_count` on `GET /me` |
| List of individual followers | **Not available** |
| New-follower webhook | **Not available** |

Follow dates come from an Instagram data export (Accounts Center → Export your information → Followers and following, JSON). The app joins export usernames to `/tags`.

Permissions: `instagram_business_basic`, `instagram_business_manage_comments`.

## Local

```powershell
copy .env.example .env
npm install
npm start
```

Open http://127.0.0.1:3847

## Coolify

Build pack: **Dockerfile**. Exposed port: **3000**. Persistent storage: **`/data`**.

See the Coolify env/storage list in this repo’s deploy notes after push, or the table below.

### Environment variables

| Key | Required | Example | Notes |
| --- | --- | --- | --- |
| `APP_PASSWORD` | **Yes** on the public internet | a long random string | Gates the dashboard |
| `APP_URL` | Yes if using Instagram OAuth | `https://igtracker.apps.vexitey.com` | No trailing slash |
| `IG_APP_ID` | Yes for live Instagram | from Meta app dashboard | |
| `IG_APP_SECRET` | Yes for live Instagram | from Meta app dashboard | Treat as secret |
| `IG_REDIRECT_URI` | If not using `APP_URL` | `https://igtracker.apps.vexitey.com/auth/callback` | Must match Meta exactly |
| `HOST` | No | `0.0.0.0` | Already set in the image |
| `PORT` | No | `3000` | Already set in the image |
| `DATA_DIR` | No | `/data` | Already set in the image |
| `NODE_ENV` | No | `production` | Already set in the image |
| `IG_API_VERSION` | No | `v21.0` | |

### Persistent storage

| Destination in container | Why |
| --- | --- |
| `/data` | `store.json` (followers, tags, settings) and `secrets.json` (Instagram token) |

Without this volume, a redeploy wipes the connected account and imported followers.

### Meta dashboard (after Coolify has a URL)

1. Instagram app → **Set up Instagram business login** → Valid OAuth redirect URI: `https://<your-domain>/auth/callback`
2. Add `vexitey` as Instagram Tester if the app is in Development mode
3. Generate a token and paste it in the dashboard, or use **Connect with Instagram**

Healthcheck path: `/api/health`
