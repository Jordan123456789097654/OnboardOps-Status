# Operating the status page

## Updating Kener
1. Check the release notes for the new version (GitHub releases for `rajnandan1/kener`).
2. Change `KENER_VERSION` in the `Dockerfile` to the new tag and commit.
3. Push. Railway builds and redeploys automatically.
4. Open `/healthcheck` and the status page. If anything is wrong, roll back (below).

Update on a schedule (monthly is fine) and never in the middle of an incident.

## Rolling back
- **Railway:** open the service, **Deployments**, pick the last good deployment and choose **Redeploy** (or **Rollback** if offered).
- **Git:** `git revert` the bad commit and push.
Database changes made by a newer Kener version may not be reversible, so take a backup first (below).

## Backups
Your monitors, incidents and subscribers live in Railway's Postgres.
- Before every update, create a backup: in the Postgres service use **Backups** if your plan has them, or run `pg_dump` against the connection string from a trusted computer.
- Keep one copy outside Railway. Test restoring one occasionally.
- Kener's own export of monitors and pages (if available in the admin) is a useful second copy.

## Secrets
- `KENER_SECRET_KEY`, the database and Redis URLs, SMTP or Resend keys and any API key live **only** in Railway's Variables (and later, the Kener key in Vercel).
- Never commit `.env`. If a secret is ever pasted into chat, email or git, rotate it.
- Rotating `KENER_SECRET_KEY` signs everyone out. Do it deliberately.

## Access
- Only named people have Railway and GitHub access, each with two-factor on.
- Use a strong admin password and two-factor in Kener, and a separate account for each person.

## If the status page is down
1. Check `/healthcheck` and Railway's **Deployments** and logs.
2. `db:false` means check Postgres; `redis:false` means check Redis.
3. Redeploy the last good deployment.
4. If it will take a while, post an update on social media or by email so people are not left guessing.

## Costs
Railway bills by usage. Set a spending limit under **Settings, Usage** so nothing surprises you, and review the bill monthly.
