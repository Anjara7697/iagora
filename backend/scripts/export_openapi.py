"""Exporte le contrat OpenAPI de l'API vers frontend/src/lib/api/openapi.json (AUDIT-ARCH-003).

    python scripts/export_openapi.py          écrit le fichier
    python scripts/export_openapi.py --check  échoue si le fichier versionné n'est plus à jour (CI)

Le frontend en génère ses types (`npm run api:types`) : renommer un champ côté API casse la CI au
lieu de casser l'écran sur le serveur.
"""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ENVIRONMENT", "development")  # documentation OpenAPI active hors production
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402

TARGET = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "api" / "openapi.json"


def render() -> str:
    return json.dumps(create_app().openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    content = render()
    if "--check" in sys.argv:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != content:
            print(f"{TARGET} n'est plus à jour : lancer python scripts/export_openapi.py")
            return 1
        print("Contrat OpenAPI à jour.")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(content, encoding="utf-8")
    print(f"Écrit : {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
