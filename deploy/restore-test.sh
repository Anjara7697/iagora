#!/usr/bin/env bash
# Test de restauration SANS toucher aux bases en service (décision D-13) : restaure une sauvegarde dans
# deux conteneurs jetables (PostgreSQL et MongoDB), compte les principales données, puis les supprime.
# Usage :
#   deploy/restore-test.sh                      dernière sauvegarde locale
#   deploy/restore-test.sh --remote             dernière sauvegarde hors serveur (BACKUP_REMOTE)
#   deploy/restore-test.sh <fichier .dump> <fichier .archive.gz>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
. "$ROOT/deploy/env.sh"
DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR /var/backups/iagora)}"
REMOTE="${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}"
MONGO_DB="$(env_get MONGO_DB iagora)"
WORK="$(mktemp -d)"
SUFFIX="restore-test-$$"
cleanup() {
  docker rm -f "pg-$SUFFIX" "mongo-$SUFFIX" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

latest() { ls -1t "$1"/$2 2>/dev/null | head -1; }

if [ $# -eq 2 ]; then
  PG_FILE="$1"; MONGO_FILE="$2"
elif [ "${1:-}" = "--remote" ]; then
  [ -n "$REMOTE" ] || { echo "BACKUP_REMOTE absent de deploy/.env"; exit 1; }
  PG_NAME="$(rclone lsf "$REMOTE" --include 'postgres-*.dump' | sort | tail -1)"
  [ -n "$PG_NAME" ] || { echo "Aucune sauvegarde PostgreSQL sur $REMOTE"; exit 1; }
  STAMP="${PG_NAME#postgres-}"; STAMP="${STAMP%.dump}"
  echo "→ Téléchargement de la sauvegarde $STAMP depuis $REMOTE"
  rclone copy "$REMOTE" "$WORK" --include "postgres-$STAMP.dump" --include "mongo-$STAMP.archive.gz"
  PG_FILE="$WORK/postgres-$STAMP.dump"; MONGO_FILE="$WORK/mongo-$STAMP.archive.gz"
else
  PG_FILE="$(latest "$DIR" 'postgres-*.dump')"; MONGO_FILE="$(latest "$DIR" 'mongo-*.archive.gz')"
fi
[ -s "${PG_FILE:-}" ] && [ -s "${MONGO_FILE:-}" ] || { echo "Sauvegarde introuvable ou vide."; exit 1; }
echo "→ Fichiers : $PG_FILE, $MONGO_FILE"

echo "→ Conteneurs jetables"
docker run -d --name "pg-$SUFFIX" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore \
  pgvector/pgvector:pg16 >/dev/null
docker run -d --name "mongo-$SUFFIX" mongo:7 >/dev/null
for _ in $(seq 1 60); do
  docker exec "pg-$SUFFIX" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
for _ in $(seq 1 60); do
  docker exec "mongo-$SUFFIX" mongosh --quiet --eval 1 >/dev/null 2>&1 && break
  sleep 1
done

echo "→ Restauration PostgreSQL"
docker exec -i "pg-$SUFFIX" pg_restore -U postgres -d restore --no-owner --no-privileges < "$PG_FILE"
echo "→ Restauration MongoDB"
docker exec -i "mongo-$SUFFIX" mongorestore --quiet --archive --gzip < "$MONGO_FILE"

echo "→ Contrôle"
for table in prospects campaigns users interactions; do
  n="$(docker exec "pg-$SUFFIX" psql -U postgres -d restore -tAc "SELECT count(*) FROM $table")"
  echo "  PostgreSQL $table : $n"
done
for col in conversations agent_runs; do
  n="$(docker exec "mongo-$SUFFIX" mongosh --quiet "$MONGO_DB" --eval "db.$col.countDocuments()")"
  echo "  MongoDB $col : $n"
done
echo "Test de restauration réussi (les conteneurs jetables sont supprimés)."
