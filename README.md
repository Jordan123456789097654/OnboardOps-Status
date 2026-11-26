# OnboardOps status page

The public status page and uptime monitoring for OnboardOps, powered by [Kener](https://kener.ing) (open source) and hosted on [Railway](https://railway.com). This repository holds only the deploy configuration. Kener itself is the official Docker image, pinned to one version in the `Dockerfile`.

**Keep this separate from the main OnboardOps app.** The status page must stay up when the app (Vercel) or its database (Neon) is down, so it lives on a different provider.

## What's in here
| File | Purpose |
|---|---|
| `Dockerfile` | Runs the official Kener image at a pinned version |
| `railway.json` | Tells Railway how to build, health-check and restart it |
| `.env.example` | The settings Kener needs (no secrets) |
| `docker-compose.yml` | Optional: try it on your own computer |
| `branding/` | Logos for the status page |
| `OPERATIONS.md` | Updating, backups, rollback, and what to do if it breaks |

## Deploy on Railway (about 15 minutes)

1. **Put this folder on GitHub.** Create an empty private repository (for example `onboardops-status`), then:
   ```powershell
   cd C:\Users\jorda\Downloads\onboardops-status
   git init
   git add .
   git commit -m "Initial status page setup"
   git branch -M main
   git remote add origin https://github.com/<your-account>/onboardops-status.git
   git push -u origin main
   ```
2. **Create the Railway project.** In Railway choose **New Project, Deploy from GitHub repo** and pick this repository. Railway reads `railway.json` and builds the `Dockerfile`.
3. **Add the database and Redis.** In the same project choose **New, Database, Add PostgreSQL**, then **New, Database, Add Redis**. Kener needs both.
4. **Set the variables** on the Kener service (the **Variables** tab):
   | Variable | Value |
   |---|---|
   | `KENER_SECRET_KEY` | a long random secret (generate one: `openssl rand -base64 48`) |
   | `ORIGIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` at first; change to `https://status.onboardops.org` when the real domain is connected |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   Railway sets `PORT` itself. If a reference does not resolve, check the exact name of the Postgres and Redis services in your project and use that name inside `${{ }}`.
5. **Generate a public address.** In the service's **Settings, Networking** choose **Generate Domain**. Open it: you should see the Kener setup page.
6. **Check it's healthy.** Open `https://<your-domain>/healthcheck`. It should return `{"status":"ok","db":true,"redis":true}`.
7. **Finish Kener's first-run setup** in the browser (create the admin account with a strong password and turn on two-factor if offered).

> Do not point Railway's health check at `/healthcheck?strict=1`. Restarting Kener cannot fix a dead database and would loop. `railway.json` uses the plain path on purpose.

## Connect your own address
Use a temporary name first (for example `status2.onboardops.org`) while Better Stack still owns `status.onboardops.org`.
1. In Railway: **Settings, Networking, Custom Domain**, enter the name. Railway shows a CNAME target.
2. At your DNS provider, add that CNAME record. Do **not** change any other records.
3. Update `ORIGIN` to the new address and redeploy.
4. When you are ready to switch fully, move `status.onboardops.org` here (and plan the cutover from Better Stack in a quiet hour).


## The staff Discord bot (second Railway service)

The OnboardOps staff Discord bot lives in `discord-bot/` and runs as its own service in the **same Railway project** as Kener, built from this same repository.

**Before you start:** stop the bot wherever it runs today. If two copies run at once, every command gets answered twice.

1. In the Railway project choose **New, GitHub Repo** and pick this repository again. This creates a second service. Rename it `discord-bot`.
2. Open the new service, **Settings, Source, Root Directory**, and set it to `discord-bot`. Railway then reads `discord-bot/railway.json` and builds the bot (not Kener).
3. **Variables** (names only here; paste the real values straight into Railway, never into chat or git):
   | Variable | Value |
   |---|---|
   | `DISCORD_TOKEN` | the bot token from the Discord Developer Portal |
   | `DISCORD_CLIENT_ID` | the application ID |
   | `DISCORD_GUILD_ID` | the staff server's ID |
   | `STAFF_BOT_KEY` | the **same value** as `STAFF_BOT_KEY` in Vercel |
   | `SITE_URL` | `https://www.onboardops.org` |
   | `PORT` | `3000` |
   | `KENER_HEARTBEAT_URL` | added later (see below) |
4. Do **not** generate a public domain for the bot. It doesn't need one.
5. Deploy. The deploy is healthy when Railway sees `/healthz` return 200, which only happens once the bot is logged in to Discord. In the logs you should see `Ready as ...`.
6. **Watch paths (optional, recommended).** In each service's **Settings** set watch paths so a change to one doesn't redeploy the other: Kener `/Dockerfile` and `/railway.json`; bot `/discord-bot/**`.

### Watching the bot from the status page
The bot sends a heartbeat to the status page every minute while it's connected. In Kener, the **Discord bot** monitor is a heartbeat monitor: if the pings stop, it goes down. Copy that monitor's heartbeat address into the bot's `KENER_HEARTBEAT_URL` variable in Railway and redeploy the bot.

### Moving the code
This repo is now the home of the bot's code. The old copy in the main OnboardOps repository can be removed once this one is confirmed working, so there is only one place to edit.

## Set up monitors
In the Kener admin, add monitors for each service (website, sign-in, API, and so on) and group them on the status page. Match the service names you use today (Website, Sign-in, Core API, Public API, Database, File storage, Email, Domains, Overall status) so the OnboardOps admin tools line up.

## Connect to OnboardOps (later)
OnboardOps will talk to Kener through its REST API. When the OnboardOps side is ready you will add two variables in Vercel (never in git): the Kener address and an API key created in the Kener admin. Until then Better Stack stays in charge.

## Watch the watcher
Add a free external check (for example UptimeRobot's free plan) that pings `https://<status address>/healthcheck` and emails you if the status page itself goes down.

See `OPERATIONS.md` for updates, backups and rollback.
