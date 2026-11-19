# The web app as static files, served by Caddy. Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build

# pnpm 12 switches itself to the exact version in package.json "packageManager".
RUN npm install -g pnpm@12
WORKDIR /repo

# Manifests first, so the install layer is reused until a dependency changes. pnpm wants every workspace
# manifest the lockfile names, and installs only the web app's part.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/schema/package.json packages/schema/
RUN pnpm install --frozen-lockfile --filter "@pulse/web..."

COPY packages packages
COPY apps/web apps/web
# No VITE_API_URL: the app calls /v0 on the address it was opened from.
RUN pnpm --filter @pulse/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
