# SocketSpace web app as a container: a portable alternative to Vercel (risk R1 in the plan).
# The free deployment runs on Vercel; this image is built and smoke-tested in CI so the app can
# move to any container host if Vercel's free tier ever changes.
#
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t socketspace-web .
# Run (every variable is described in apps/web/.env.example):
#   docker run --rm -p 3000:3000 --env-file apps/web/.env.local socketspace-web

FROM node:22-bookworm-slim AS build
ENV CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
RUN npm install --global pnpm@12.8.1 && pnpm --version
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/realtime/package.json apps/realtime/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@socketspace/web..."

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/web apps/web
RUN pnpm --filter @socketspace/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone server plus the static assets it serves.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/sign-in').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
