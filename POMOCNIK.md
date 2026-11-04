# Pomocnik

Kopia [LibreChat](https://github.com/danny-avila/LibreChat) wdrażana na platformę OVH
(Rancher + Argo CD + Harbor):

| Środowisko | Adres | Wdrożenie |
|---|---|---|
| dev | https://pomocnik.dev.lucasnextgen.com | każdy merge do `main` |
| prod | https://pomocnik.lucasnextgen.com | tag `v*` na commicie z `main` (ten sam obraz) |

Konfiguracja klastra (zmienne, zasoby, sekrety): `platform-gitops/apps/pomocnik/`.

## Co jest nasze

Pliki upstreamu zostają bez zmian (łatwe dociąganie nowych wersji). Nasze są tylko:

- `docker/pomocnik/Dockerfile`: obraz `api` (etapy `test` i `runtime`; UID 10001, read-only FS, port 8080,
  dane w `/data`: `uploads`, `images`).
- `docker/pomocnik/librechat.yaml`: konfiguracja LibreChat wbudowana w obraz (`CONFIG_PATH`); bez sekretów,
  wartości `${VAR}` przychodzą ze zmiennych środowiskowych. Etap `test` sprawdza ją schematem upstreamu.
- `docker/mongo/`: obraz `mongo` (MongoDB 8.0) i `dump-loop.sh` (codzienny `mongodump` do `/data/dump`).
- `docker/browser/`: obraz `browser` (Playwright MCP, headless Chromium) — serwer MCP „Przeglądarka” dla agentów
  (`librechat.yaml`, `mcpServers.browser`); osobny kontekst przeglądarki na użytkownika, ruch wychodzący
  tylko do internetu (NetworkPolicy `egress: internet` w `platform-gitops`).
- `docker/admin-panel/`: obraz `admin-panel` (LibreChat Admin Panel, AGPL-3.0, obraz upstream przypięty do commita):
  role, grupy, uprawnienia (grants), konfiguracja per rola/grupa; osobny host `pomocnik-admin[.dev].lucasnextgen.com`,
  logowanie kontem admina LibreChat. Kont użytkowników nie tworzy (API LibreChat 0.8.8 nie ma takiej operacji).
  Przy aktualizacji LibreChat podnieś też commit panelu zgodny z nową wersją pakietów `librechat-data-provider`.
- `.github/`: CI ze wspólnych workflowów `lrozewicz/.github` (workflowy upstreamu usunięte).

## Aktualizacja LibreChat

```bash
git remote add upstream https://github.com/danny-avila/LibreChat.git   # raz
git fetch upstream --tags      # tagi upstreamu tylko lokalnie: NIGDY `git push --tags` (tag v* = wdrożenie prod)
git switch -c update/v0.8.9 main
git merge v0.8.9            # konflikty zwykle tylko w .github/ (u nas usunięte: git rm)
docker build -f docker/pomocnik/Dockerfile --target test .   # m.in. walidacja librechat.yaml
# sprawdź UPGRADING.md i wersję w librechat.example.yaml (pole version), potem PR do main
```

Po każdej aktualizacji sprawdź na dev izolację przeglądarki (zależy od tego, jak LibreChat traktuje
`{{LIBRECHAT_USER_ID}}` w `mcpServers.browser.headers`: osobne połączenie MCP na użytkownika):
agent użytkownika A otwiera `https://httpbin.org/cookies/set?owner=A`, potem agent użytkownika B
otwiera `https://httpbin.org/cookies` i ma zobaczyć `{}`; A w kolejnej wiadomości nadal widzi `owner=A`.

## API z zewnątrz

LibreChat udostępnia agentów przez API zgodne z OpenAI (agent = `model`):
`POST https://pomocnik.lucasnextgen.com/api/agents/v1/chat/completions`, lista agentów
`GET /api/agents/v1/models`, nagłówek `Authorization: Bearer <klucz API z ustawień użytkownika>`.
Wymaga uprawnienia roli `REMOTE_AGENTS` (USE).
