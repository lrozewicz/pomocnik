# LibreChat Admin Panel (admin-panel/, LibreChat-AI/admin-panel ba88991 as a git subtree, AGPL-3.0)
# with Pomocnik's "Users" page (create, edit, reset password, suspend, delete) backed by the
# /api/admin/users additions in this LibreChat. Build context: admin-panel/
#   docker build -f docker/admin-panel/Dockerfile --target runtime admin-panel
# Based on admin-panel/Dockerfile; runs as UID 10001 on port 8080 with a read-only root filesystem.
FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN bun install --frozen-lockfile

# The upstream CI checks: type check, lint without warnings, unit tests.
FROM deps AS test
COPY . .
RUN bunx tsc --noEmit
RUN bunx eslint src/ --max-warnings 0
RUN bun run test

FROM deps AS build
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    NODE_ENV=production
RUN bun run build

FROM base AS prod-deps
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN bun install --frozen-lockfile && bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOME=/tmp
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/src/server src/server
COPY server.ts package.json ./
USER 10001
EXPOSE 8080
CMD ["bun", "run", "start"]
