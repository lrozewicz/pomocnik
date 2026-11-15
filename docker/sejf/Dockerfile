# Sejf: client secrets for agents, without the model seeing them. One image, two components:
#   sejf - MCP proxy in front of "browser" that types passwords on allowed pages (sejf.mjs, default)
#   ssh  - MCP server that runs commands on the client's servers (ssh.mjs: CMD node /app/ssh.mjs)
# Plain Node, no npm dependencies; ssh uses the OpenSSH client.
# The chart runs it as UID 10001 with a read-only root filesystem.
FROM node:24-alpine AS base
WORKDIR /app
COPY secrets.mjs sejf.mjs ssh.mjs ./

FROM base AS test
COPY *.test.mjs ./
RUN node --test

FROM base AS runtime
# Trivy: Alpine fixes newer than the base image; the bundled npm is not used at runtime.
RUN apk upgrade --no-cache && \
    apk add --no-cache openssh-client-default && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn* && \
    adduser -D -H -u 10001 -h /tmp pomocnik  # OpenSSH needs a passwd entry ("No user exists for uid")
USER 10001
ENV PORT=8932 \
    UPSTREAM=http://browser:8931/mcp
EXPOSE 8932
CMD ["node", "/app/sejf.mjs"]
