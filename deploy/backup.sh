#!/usr/bin/env bash
# Sauvegarde PostgreSQL + MongoDB dans ${BACKUP_DIR:-/var/backups/iagora}, 14 jours conservés.
# À planifier (cron) : 15 3 * * * /chemin/iagora/deploy/backup.sh >> /var/log/iagora-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.prod.yml" --env-file "$ROOT/deploy/.env")
set -a; . "$ROOT/deploy/.env"; set +a

DIR="${BACKUP_DIR:-/var/backups/iagora}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
umask 077

echo "[$STAMP] PostgreSQL…"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${POSTGRES_USER:-iagora}" -d "${POSTGRES_DB:-iagora}" \
  --format=custom > "$DIR/postgres-$STAMP.dump"

echo "[$STAMP] MongoDB…"
"${COMPOSE[@]}" exec -T mongo mongodump --quiet --archive --gzip \
  -u "${MONGO_USER:-iagora}" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --db "${MONGO_DB:-iagora}" > "$DIR/mongo-$STAMP.archive.gz"

# Un fichier vide signale une sauvegarde ratée.
for f in "$DIR/postgres-$STAMP.dump" "$DIR/mongo-$STAMP.archive.gz"; do
  [ -s "$f" ] || { echo "Sauvegarde vide : $f"; exit 1; }
done

find "$DIR" -type f \( -name 'postgres-*.dump' -o -name 'mongo-*.archive.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] OK → $DIR"
