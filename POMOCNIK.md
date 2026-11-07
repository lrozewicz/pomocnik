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
- `docker/pomocnik/pomocnik-users.js`: administracja kontami, której LibreChat 0.8.8 nie ma w UI ani w API
  (lista, tworzenie, reset hasła, zawieszanie, rola, nazwa, e-mail, usuwanie); uruchamia go
  `ovh-infra/scripts/pomocnik/users.sh`. Zawieszenie = ban bez terminu (wymaga `BAN_VIOLATIONS=true`).
- `docker/mongo/`: obraz `mongo` (MongoDB 8.0) i `dump-loop.sh` (codzienny `mongodump` do `/data/dump`).
- `docker/browser/`: obraz `browser` (Playwright MCP, headless Chromium) — serwer MCP „Przeglądarka” dla agentów
  (`librechat.yaml`, `mcpServers.browser`); osobny kontekst przeglądarki na użytkownika, ruch wychodzący
  tylko do internetu (NetworkPolicy `egress: internet` w `platform-gitops`).
- `admin-panel/` + `docker/admin-panel/`: LibreChat Admin Panel (AGPL-3.0) jako `git subtree` z
  LibreChat-AI/admin-panel (ba88991), budowany ze źródeł: role, grupy, uprawnienia, konfiguracja per
  rola/grupa oraz nasza strona **Users** (tworzenie z hasłem pokazanym raz, edycja, reset hasła,
  zawieszanie, usuwanie). Backend: `api/server/routes/admin/pomocnikUsers.js` +
  `api/server/services/Pomocnik/userAdmin.js` (te same operacje co CLI `pomocnik-users.js`).
  Osobny host `pomocnik-admin[.dev].lucasnextgen.com`, logowanie kontem admina LibreChat.
  Aktualizacja panelu: `git subtree pull --prefix=admin-panel https://github.com/LibreChat-AI/admin-panel.git <commit> --squash`.
  Przy aktualizacji LibreChat podnieś też commit panelu zgodny z nową wersją pakietów `librechat-data-provider`.
- Zmiana własnego hasła (LibreChat 0.8.8 jej nie ma, a reset mailem bez SMTP jest wyłączony):
  *Settings → Account → Change password* (`client/.../SettingsTabs/Account/ChangePassword.tsx`,
  wpis `changePassword` w `client/src/components/Nav/Settings/registry.tsx`) →
  `POST /api/pomocnik/account/password` (`api/server/routes/pomocnikAccount.js`): wymaga obecnego hasła,
  10 prób na 15 min, wylogowuje pozostałe sesje. Tylko konta lokalne. Teksty: klucze `com_pomocnik_*`
  w `client/src/locales/{en,pl}/translation.json`.
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
