# SocketSpace realtime server.
#
# Build from the repository root (the build needs the shared packages):
#   docker build -f apps/realtime/Dockerfile -t socketspace-realtime .
# Run (every variable is described in apps/realtime/.env.example):
#   docker run --rm -p 4000:4000 --env-file apps/realtime/.env.local socketspace-realtime
#
# Two stages: the first installs dependencies and bundles the server into one file with esbuild;
# the second contains only Node.js and that file, running as the unprivileged "node" user.

FROM node:22-bookworm-slim AS build
ENV CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
# The same pnpm version as package.json's "packageManager" field.
RUN npm install --global pnpm@12.8.1 && pnpm --version
WORKDIR /repo

# Dependencies first, so this layer is reused when only source code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/realtime/package.json apps/realtime/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@socketspace/realtime..."

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/realtime apps/realtime
RUN pnpm --filter @socketspace/realtime build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/realtime/dist/ ./
USER node
EXPOSE 4000
# Render and most hosts check /healthz themselves; this helps `docker ps` show the state too.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The process receives SIGTERM directly (no shell in between), so it can shut down gracefully.
CMD ["node", "--enable-source-maps", "server.mjs"]
