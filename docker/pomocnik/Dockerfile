# Pomocnik: LibreChat image for the OVH platform (github.com/lrozewicz/.github CI, chart webapp).
# Based on the upstream Dockerfile.multi (kept unchanged, so upstream merges stay easy).
# Contract: targets "test" and "runtime"; runs as UID 10001 with a read-only root filesystem;
# listens on 8080; writable: /tmp (emptyDir) and /data (volume: uploads, images).
# Build from the repo root: docker build -f docker/pomocnik/Dockerfile --target runtime .

ARG NODE_MAX_OLD_SPACE_SIZE=6144
ARG NODE_IMAGE=node:24.16.0-alpine

FROM ${NODE_IMAGE} AS base-min
RUN apk upgrade --no-cache && apk add --no-cache jemalloc
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2 \
    SCARF_ANALYTICS=false
WORKDIR /app
RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 15000
COPY package*.json ./
COPY packages/data-provider/package*.json ./packages/data-provider/
COPY packages/api/package*.json ./packages/api/
COPY packages/data-schemas/package*.json ./packages/data-schemas/
COPY packages/client/package*.json ./packages/client/
COPY client/package*.json ./client/
COPY api/package*.json ./api/

FROM base-min AS base
RUN npm ci --no-audit --no-fund

FROM base AS data-provider-build
WORKDIR /app/packages/data-provider
COPY packages/data-provider ./
RUN npm run build

FROM base AS data-schemas-build
WORKDIR /app/packages/data-schemas
COPY packages/data-schemas ./
COPY --from=data-provider-build /app/packages/data-provider/dist /app/packages/data-provider/dist
RUN npm run build

FROM base AS api-package-build
WORKDIR /app/packages/api
COPY packages/api ./
COPY --from=data-provider-build /app/packages/data-provider/dist /app/packages/data-provider/dist
COPY --from=data-schemas-build /app/packages/data-schemas/dist /app/packages/data-schemas/dist
RUN npm run build

FROM base AS client-package-build
WORKDIR /app/packages/client
COPY packages/client ./
COPY --from=data-provider-build /app/packages/data-provider/dist /app/packages/data-provider/dist
RUN npm run build

FROM base AS client-build
WORKDIR /app/client
COPY client ./
COPY --from=data-provider-build /app/packages/data-provider/dist /app/packages/data-provider/dist
COPY --from=client-package-build /app/packages/client/dist /app/packages/client/dist
COPY --from=client-package-build /app/packages/client/src /app/packages/client/src
COPY --from=client-package-build /app/packages/client/tailwind.preset.cjs /app/packages/client/tailwind.preset.cjs
ARG NODE_MAX_OLD_SPACE_SIZE
ENV NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}"
RUN npm run build

# Unit tests of data-provider (config schema, API types; the full upstream suite runs in upstream
# CI; the data-schemas tests need mongodb-memory-server, which has no Alpine binaries) and a check
# that our librechat.yaml is accepted by the upstream config schema.
FROM base AS test
COPY config ./config
COPY packages/data-provider ./packages/data-provider
COPY docker/pomocnik ./docker/pomocnik
COPY --from=data-provider-build /app/packages/data-provider/dist ./packages/data-provider/dist
RUN cd packages/data-provider && npx jest --ci --silent
RUN node docker/pomocnik/check-config.cjs docker/pomocnik/librechat.yaml

FROM base-min AS runtime
# npm bundled with the node image (11.13) ships a tar with a CRITICAL fix available (Trivy gate);
# npm stays in the image for npx-based MCP servers.
RUN npm install -g npm@11.21.1 --no-audit --no-fund && rm -rf /root/.npm
COPY --from=ghcr.io/astral-sh/uv:0.9.5-python3.12-alpine /usr/local/bin/uv /usr/local/bin/uvx /bin/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && rm -rf /root/.npm
COPY api ./api
COPY config ./config
COPY skill ./skill
COPY --from=data-provider-build /app/packages/data-provider/dist ./packages/data-provider/dist
COPY --from=data-schemas-build /app/packages/data-schemas/dist ./packages/data-schemas/dist
COPY --from=api-package-build /app/packages/api/dist ./packages/api/dist
COPY --from=client-build /app/client/dist ./client/dist
COPY docker/pomocnik/librechat.yaml /app/pomocnik/librechat.yaml
# User administration (create, suspend, delete, ...): ovh-infra/scripts/pomocnik/users.sh runs it in the pod.
COPY docker/pomocnik/pomocnik-users.js /app/config/pomocnik-users.js
# Read-only root filesystem: everything LibreChat writes goes to /data (volume) or /tmp.
RUN rm -rf /app/uploads /app/client/public/images /app/data && \
    mkdir -p /app/client/public && \
    ln -s /data/uploads /app/uploads && \
    ln -s /data/images /app/client/public/images && \
    ln -s /tmp/librechat-data /app/data
ARG BUILD_COMMIT=
ENV BUILD_COMMIT=${BUILD_COMMIT} \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CONFIG_PATH=/app/pomocnik/librechat.yaml \
    LOG_TO_FILE=false \
    CONSOLE_JSON=true \
    HOME=/tmp \
    npm_config_cache=/tmp/.npm \
    UV_CACHE_DIR=/tmp/.uv
USER 10001
WORKDIR /app/api
EXPOSE 8080
CMD ["node", "server/index.js"]
