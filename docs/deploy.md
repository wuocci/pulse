# Private deploy

How to run the web app and the API on the server behind one password (#32). Automatic deploys, API keys and backups come later (#11, #3).

## What runs

`docker-compose.production.yml` is its own Compose project, `pulse-production`, with three containers:

| Container | What it does | Memory limit | Used when measured locally |
| --- | --- | --- | --- |
| `web` | Caddy: asks for the password, serves the built app, passes `/v0` to `api` | 64 MB | 22 MB |
| `api` | The API and ingest | 512 MB | 205 MB |
| `db` | Postgres, today only for the Classifier's answers | 384 MB | 35 MB |

Only `web` has a port, and only on the server itself: `127.0.0.1:8090`. `tailscale serve` handles HTTPS and passes traffic to it, so only devices on the tailnet can open the app.

Disk: the database image is about 3 GB and the API image about 0.8 GB.

## Nothing is built on the server

The server is shared and small, so `api` and `web` are built on GitHub and the server only downloads them. The "Deploy images" workflow (`.github/workflows/deploy-images.yml`) builds both and pushes them to GHCR as public images:

- `ghcr.io/wuocci/pulse-api`
- `ghcr.io/wuocci/pulse-web`

Each build is tagged `latest` and with its commit SHA. The images hold no secrets: those come from `.env.production.local` when the containers start.

To build: GitHub → Actions → "Deploy images" → Run workflow, and pick the branch. A workflow started by hand only shows up there once its file is on the default branch (`qa`).

## First time

1. In the Tailscale admin, DNS page, turn on HTTPS Certificates.
2. Run "Deploy images" once. Then, for each of the two packages on GitHub (Your profile → Packages), check that Package settings → Change visibility says Public. The server pulls without logging in.
3. Clone the repo on the server and go to its folder. Only the Compose file and the env files are used; nothing is built from the checkout.
4. Copy `.env.production.local.example` to `.env.production.local` and fill it in. The file says how to make each value.
5. Download and start:

   ```bash
   docker compose --env-file .env.production.local -f docker-compose.production.yml pull
   docker compose --env-file .env.production.local -f docker-compose.production.yml up -d
   ```

6. Put the app behind the server's tailnet address:

   ```bash
   sudo tailscale serve --bg 8090
   ```

   It's then at `https://<server>.<tailnet>.ts.net`; `tailscale serve status` shows the address. The setting survives reboots.

Another port: set `PULSE_PORT` in `.env.production.local`, and use it in `tailscale serve`.

### Later, with a domain

When there's a domain, `web` goes behind the server's Traefik like the other apps: Traefik labels on `web` instead of the port, in a `docker-compose.override.yml`. Not done yet.

## Check it

- `curl -I https://<server>.<tailnet>.ts.net/` and `curl -I https://<server>.<tailnet>.ts.net/v0/health` answer 401.
- On the phone, with Tailscale on, the address asks for the password, then opens the app. "Use my location" works and Home shows live Events.
- `docker stats` shows `stele` with the memory it had before.
- After `sudo reboot`, the app is back without doing anything.

## Update

Run "Deploy images" on the branch to deploy, then on the server:

```bash
git pull
docker compose --env-file .env.production.local -f docker-compose.production.yml pull
docker compose --env-file .env.production.local -f docker-compose.production.yml up -d
```

`git pull` is only for changes to the Compose file. To go back to an earlier build, set `PULSE_TAG=<commit SHA>` in `.env.production.local` and run `up -d` again.

## Logs and stopping

```bash
docker compose --env-file .env.production.local -f docker-compose.production.yml logs -f api
docker compose --env-file .env.production.local -f docker-compose.production.yml down
```

`down` keeps the database. Each container keeps at most 30 MB of logs.
