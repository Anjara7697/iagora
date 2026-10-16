#!/usr/bin/env bash
# Met à jour IAGORA : récupère le code, construit les images, migre, redémarre, vérifie.
# Usage (depuis la racine du dépôt) :  deploy/deploy.sh [branche]   (défaut : dev)
set -euo pipefail

BRANCH="${1:-dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.prod.yml" --env-file "$ROOT/deploy/.env")

[ -f "$ROOT/deploy/.env" ] || { echo "deploy/.env introuvable (voir deploy/.env.production.example)"; exit 1; }

cd "$ROOT"
echo "→ Code : $BRANCH"
git fetch --quiet origin "$BRANCH"
PREVIOUS="$(git rev-parse --short HEAD)"
git checkout --quiet "$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "   $PREVIOUS → $(git rev-parse --short HEAD)"

echo "→ Sauvegarde avant migration"
"$ROOT/deploy/backup.sh" || { echo "Sauvegarde impossible : arrêt."; exit 1; }

echo "→ Construction des images"
"${COMPOSE[@]}" build

echo "→ Migrations puis démarrage"
"${COMPOSE[@]}" up -d --remove-orphans

echo "→ Vérification (jusqu'à 90 s)"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T iagora-api python -c \
    "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/ready', timeout=4); sys.exit(0 if r.status==200 else 1)" \
    >/dev/null 2>&1; then
    echo "OK : API prête ($(git rev-parse --short HEAD))."
    exit 0
  fi
  sleep 3
done
echo "ÉCHEC : l'API n'est pas prête. Journaux :  ${COMPOSE[*]} logs --tail=80 iagora-api migrate"
echo "Retour arrière : git checkout $PREVIOUS && deploy/deploy.sh (voir docs/deploiement.md)."
exit 1
