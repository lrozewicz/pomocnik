# Browser for Pomocnik agents: Playwright MCP (headless Chromium) as an MCP server over HTTP.
# LibreChat connects to http://browser:8931/mcp with a per-user header ({{LIBRECHAT_USER_ID}}), so
# every user gets an own MCP session, and every session an own in-memory browser context
# (--isolated, no --shared-browser-context): cookies and logins are not shared between users.
# The chart runs it as UID 10001 with a read-only root filesystem (writable: /tmp); Chromium runs
# without its own sandbox (Pod Security "restricted"), the egress NetworkPolicy keeps it off the
# cluster network.
FROM mcr.microsoft.com/playwright/mcp:v0.0.83 AS runtime
USER root
# Debian security fixes not yet in the upstream image (Trivy gate: fixable CRITICAL).
RUN apt-get update && \
    apt-get install -y --no-install-recommends --only-upgrade libbrotli1 perl-base && \
    rm -rf /var/lib/apt/lists/*
USER 10001
# PLAYWRIGHT_MCP_PING_TIMEOUT_MS=0: no server-to-client heartbeat. LibreChat keeps no stream open
# between chat turns, so the 3-second pings failed and the server closed the session (and the
# user's browser) about 5 s after every turn; the next turn started with an empty browser.
# Idle browsers are closed by --idle-timeout instead (30 min; the next tool call starts a new one).
ENV HOME=/tmp \
    PLAYWRIGHT_MCP_PING_TIMEOUT_MS=0
# The base ENTRYPOINT adds: --headless --browser chromium --no-sandbox
CMD ["--isolated", "--port", "8931", "--host", "::", "--allowed-hosts", "browser:8931", \
     "--output-dir", "/tmp/playwright-output", "--timeout-navigation", "60000", \
     "--idle-timeout", "1800000"]
