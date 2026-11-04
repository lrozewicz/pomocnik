# Pomocnik

Prywatna kopia [LibreChat](https://github.com/danny-avila/LibreChat) wdrażana na platformę OVH
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

## API z zewnątrz

LibreChat udostępnia agentów przez API zgodne z OpenAI (agent = `model`):
`POST https://pomocnik.lucasnextgen.com/api/agents/v1/chat/completions`, lista agentów
`GET /api/agents/v1/models`, nagłówek `Authorization: Bearer <klucz API z ustawień użytkownika>`.
Wymaga uprawnienia roli `REMOTE_AGENTS` (USE).
