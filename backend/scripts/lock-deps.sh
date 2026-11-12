#!/usr/bin/env bash
# Régénère les versions figées (AUDIT-OPS-001) à partir de requirements.txt et requirements-dev.txt.
# Les versions déjà figées sont gardées tant que les bornes le permettent : seul un changement des
# fichiers d'entrée, ou --upgrade, fait évoluer le résultat.
#   scripts/lock-deps.sh            mettre à jour après avoir modifié requirements*.txt
#   scripts/lock-deps.sh --upgrade  monter toutes les dépendances (puis relancer les tests)
set -euo pipefail
cd "$(dirname "$0")/.."
common=(--python-version 3.12 --python-platform linux --no-header --annotation-style line -q "$@")
uv pip compile requirements.txt "${common[@]}" -o requirements.lock.txt
uv pip compile requirements-dev.txt -c requirements.lock.txt "${common[@]}" -o requirements-dev.lock.txt
