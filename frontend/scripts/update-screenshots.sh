#!/usr/bin/env bash
# Régénère toutes les captures de référence (tests/visuel.spec.ts), même celles dont l'écart reste sous la tolérance,
# dans l'image Playwright de la CI : même navigateur,
# mêmes polices, donc les mêmes pixels que la CI. Nécessite Docker. Les arguments sont passés à Playwright
# (ex. `npm run test:visual:update -- -g aujourdhui`).
# node_modules et .next restent dans des volumes du conteneur : rien n'est écrasé dans la copie locale.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")
image="mcr.microsoft.com/playwright:v${version}-noble"
owner="$(id -u):$(id -g)"

docker run --rm --ipc=host \
  -e CI=1 -e PLAYWRIGHT_PRODUCTION=1 -e NEXT_TELEMETRY_DISABLED=1 \
  -v "$PWD":/work -v /work/node_modules -v /work/.next -w /work \
  "$image" bash -c '
    set -e
    npm ci --no-audit --no-fund
    npm run build
    npx playwright test tests/visuel.spec.ts --update-snapshots=all --trace off "$@" || status=$?
    chown -R '"$owner"' tests/__screenshots__
    exit ${status:-0}
  ' bash "$@"
