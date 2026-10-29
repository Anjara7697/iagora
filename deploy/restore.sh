#!/usr/bin/env bash
# Restaure une sauvegarde. DESTRUCTIF : remplace le contenu des bases.
# Usage :  deploy/restore.sh <postgres-AAAAMMJJ-HHMMSS.dump> <mongo-AAAAMMJJ-HHMMSS.archive.gz>
set -euo pipefail

[ $# -eq 2 ] || { echo "Usage : $0 <fichier postgres .dump> <fichier mongo .archive.gz>"; exit 1; }
PG_FILE="$1"; MONGO_FILE="$2"
[ -s "$PG_FILE" ] && [ -s "$MONGO_FILE" ] || { echo "Fichier introuvable ou vide."; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.prod.yml" --env-file "$ROOT/deploy/.env")
ENV_FILE="$ROOT/deploy/.env"
. "$ROOT/deploy/env.sh"
POSTGRES_USER="$(env_get POSTGRES_USER iagora)"
POSTGRES_DB="$(env_get POSTGRES_DB iagora)"
MONGO_USER="$(env_get MONGO_USER iagora)"
MONGO_DB="$(env_get MONGO_DB iagora)"
MONGO_PASSWORD="$(env_get MONGO_PASSWORD)"

read -r -p "Remplacer les bases ACTUELLES par ces sauvegardes ? Tapez « oui » : " answer
[ "$answer" = "oui" ] || { echo "Abandon."; exit 1; }

echo "→ Arrêt de l'API (les bases restent démarrées)"
"${COMPOSE[@]}" stop iagora-api

echo "→ PostgreSQL"
"${COMPOSE[@]}" exec -T postgres pg_restore -U "${POSTGRES_USER:-iagora}" -d "${POSTGRES_DB:-iagora}" \
  --clean --if-exists --no-owner < "$PG_FILE"

echo "→ MongoDB"
"${COMPOSE[@]}" exec -T mongo mongorestore --quiet --archive --gzip --drop \
  -u "${MONGO_USER:-iagora}" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --nsInclude "${MONGO_DB:-iagora}.*" < "$MONGO_FILE"

echo "→ Redémarrage"
"${COMPOSE[@]}" up -d
echo "Restauration terminée."
