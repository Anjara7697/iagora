#!/usr/bin/env bash
# Met à jour IAGORA : récupère le code, construit les images, migre, redémarre, vérifie.
# Usage (depuis la racine du dépôt) :  deploy/deploy.sh [branche] [commit]   (défaut : dev)
#   deploy/deploy.sh main            met à jour vers la dernière version de la branche
#   deploy/deploy.sh main <commit>   retour arrière : redéploie ce commit (voir docs/deploiement.md §7)
set -euo pipefail

BRANCH="${1:-dev}"
REF="${2:-}" # retour arrière : commit à redéployer, sans avancer jusqu'à la dernière version
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.prod.yml" --env-file "$ROOT/deploy/.env")

[ -f "$ROOT/deploy/.env" ] || { echo "deploy/.env introuvable (voir deploy/.env.production.example)"; exit 1; }

cd "$ROOT"
echo "→ Code : $BRANCH"
git fetch --quiet origin "$BRANCH"
PREVIOUS="$(git rev-parse --short HEAD)"
if [ -n "$REF" ]; then
  git cat-file -e "$REF^{commit}" 2>/dev/null || { echo "Commit introuvable : $REF"; exit 1; }
  git checkout --quiet "$REF"
else
  git checkout --quiet "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
echo "   $PREVIOUS → $(git rev-parse --short HEAD)"

# Première installation : les bases n'existent pas encore, il n'y a rien à sauvegarder.
if [ -n "$("${COMPOSE[@]}" ps -q postgres 2>/dev/null)" ]; then
  echo "→ Sauvegarde avant migration"
  "$ROOT/deploy/backup.sh" || { echo "Sauvegarde impossible : arrêt."; exit 1; }
else
  echo "→ Première installation : aucune sauvegarde à faire"
fi

echo "→ Construction des images"
"${COMPOSE[@]}" build

echo "→ Migrations puis démarrage"
"${COMPOSE[@]}" up -d --remove-orphans

echo "→ Vérification de l'API et de la console (jusqu'à 90 s)"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T iagora-api python -c \
    "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/ready', timeout=4); sys.exit(0 if r.status==200 else 1)" \
    >/dev/null 2>&1 \
    && "${COMPOSE[@]}" exec -T iagora-web wget -q --spider http://127.0.0.1:3000/login \
    >/dev/null 2>&1; then
    echo "OK : API et console prêtes ($(git rev-parse --short HEAD))."
    exit 0
  fi
  sleep 3
done
echo "ÉCHEC : l'API ou la console n'est pas prête. Journaux :  ${COMPOSE[*]} logs --tail=80 iagora-api iagora-web migrate"
echo "Retour arrière : deploy/deploy.sh $BRANCH $PREVIOUS (voir docs/deploiement.md §7)."
exit 1
