#!/usr/bin/env bash
# Lecture SÛRE de deploy/.env : le fichier n'est jamais exécuté par bash (une valeur avec espace ou
# un caractère spécial ne doit pas casser un script). À charger avec `. deploy/env.sh`, après avoir
# défini ENV_FILE. Usage : env_get NOM [valeur_par_défaut]
env_get() {
  local line value
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "${2:-}"
    return 0
  fi
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}
