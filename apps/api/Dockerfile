# The API and ingest, as one process. Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-slim

# pnpm 12 switches itself to the exact version in package.json "packageManager".
RUN npm install -g pnpm@12
WORKDIR /repo

# Manifests first, so the install layer is reused until a dependency changes. pnpm wants every workspace
# manifest the lockfile names, and installs only the API's part.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/schema/package.json packages/schema/
# With dev dependencies: the API runs its TypeScript through tsx, as `pnpm --filter @pulse/api start` does.
RUN pnpm install --frozen-lockfile --filter "@pulse/api..."

COPY .env.production tsconfig.json ./
COPY packages/schema packages/schema
COPY apps/api apps/api

USER node
WORKDIR /repo/apps/api
EXPOSE 3000
# The `start` script without pnpm in between, so the server gets the stop signal itself and shuts down cleanly.
# Secrets come from the container's environment, which wins over .env.production.
CMD ["node", "--import", "tsx", "--env-file-if-exists=../../.env.production", "src/server.ts"]
