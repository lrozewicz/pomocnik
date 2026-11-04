# LibreChat Admin Panel (github.com/LibreChat-AI/admin-panel, AGPL-3.0): roles, groups, grants,
# configuration overrides and users, as a separate web app on its own host
# (pomocnik-admin[.dev].lucasnextgen.com). Signs in against the LibreChat API (admin accounts only).
# Pinned to the upstream image of commit ba88991 (2026-10-29): the last one built against the
# LibreChat 0.8.8 packages (later commits move to the Zod 4 packages of LibreChat 0.8.9).
FROM ghcr.io/librechat-ai/librechat-admin-panel:ba889912425a3ca75c64b6cb08ae828c0c69a3fe AS runtime
ENV HOME=/tmp \
    PORT=8080
USER 10001
EXPOSE 8080
