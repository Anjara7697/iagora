#!/usr/bin/env bash
# Sauvegarde PostgreSQL + MongoDB dans ${BACKUP_DIR:-/var/backups/iagora} (7 jours sur le serveur), puis
# copie chiffrée hors serveur (30 jours) si BACKUP_REMOTE est renseigné (décisions D-13, D-19).
# Signale le début, la réussite ou l'échec à Healthchecks.io si HEALTHCHECK_URL est renseigné (D-14).
# À planifier (cron) : 15 3 * * * /chemin/iagora/deploy/backup.sh >> /var/log/iagora-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.prod.yml" --env-file "$ROOT/deploy/.env")
ENV_FILE="$ROOT/deploy/.env"
. "$ROOT/deploy/env.sh"
POSTGRES_USER="$(env_get POSTGRES_USER iagora)"
POSTGRES_DB="$(env_get POSTGRES_DB iagora)"
MONGO_USER="$(env_get MONGO_USER iagora)"
MONGO_DB="$(env_get MONGO_DB iagora)"
MONGO_PASSWORD="$(env_get MONGO_PASSWORD)"
[ -n "$MONGO_PASSWORD" ] || { echo "MONGO_PASSWORD absent de deploy/.env"; exit 1; }

DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR /var/backups/iagora)}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(env_get BACKUP_KEEP_DAYS 7)}"
# Remote rclone de type « crypt » (chiffrement côté serveur avant envoi), ex. iagora-crypt:prod
REMOTE="${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE)}"
REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-$(env_get BACKUP_REMOTE_KEEP_DAYS 30)}"
HEALTHCHECK="${HEALTHCHECK_URL:-$(env_get HEALTHCHECK_URL)}"

# Signal à Healthchecks.io : un échec du signal ne fait jamais échouer la sauvegarde.
ping() {
  [ -n "$HEALTHCHECK" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK$1" || echo "Signal Healthchecks impossible ($1)"
}
# Tout arrêt en erreur (commande échouée ou `exit 1` explicite) est signalé comme un échec.
on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] || ping /fail
}
trap on_exit EXIT
ping /start

if [ -n "$REMOTE" ]; then
  command -v rclone >/dev/null || { echo "BACKUP_REMOTE renseigné mais rclone absent du serveur"; exit 1; }
  # Refus d'envoyer des sauvegardes en clair : le remote doit être de type crypt.
  rclone listremotes --long | grep -qE "^${REMOTE%%:*}:[[:space:]]+crypt\b" \
    || { echo "Le remote ${REMOTE%%:*} n'est pas de type crypt : envoi refusé (voir docs/deploiement.md §6)"; exit 1; }
fi
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
# Une sauvegarde est aussi prise avant chaque déploiement : au plus N de chaque sorte (AUDIT-OPS-005).
KEEP_MAX="${BACKUP_KEEP_MAX:-$(env_get BACKUP_KEEP_MAX 30)}"
for pattern in 'postgres-*.dump' 'mongo-*.archive.gz'; do
  find "$DIR" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' | sort -rn \
    | tail -n +"$((KEEP_MAX + 1))" | cut -d' ' -f2- | xargs -r rm -f --
done
echo "[$STAMP] OK → $DIR"

if [ -n "$REMOTE" ]; then
  echo "[$STAMP] Copie chiffrée → $REMOTE"
  rclone copy "$DIR" "$REMOTE" --include "postgres-$STAMP.dump" --include "mongo-$STAMP.archive.gz"
  # Rétention hors serveur : une donnée effacée disparaît de toutes les copies en REMOTE_KEEP_DAYS jours.
  rclone delete "$REMOTE" --min-age "${REMOTE_KEEP_DAYS}d"
  echo "[$STAMP] Copie hors serveur OK"
fi
ping ""
