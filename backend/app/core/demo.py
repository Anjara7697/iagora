"""Marque des données fictives : adresses en `@demo.example.com` (AUDIT-ARCH-001).

Le domaine est réservé (jamais livrable). Ce module ne dépend de rien : les schémas l'utilisent sans
importer de service ; la purge des données fictives reste dans `app.services.demo`.
"""

DEMO_DOMAIN = "demo.example.com"
DEMO_SUFFIX = f"@{DEMO_DOMAIN}"


def is_demo_email(email: str | None) -> bool:
    return bool(email) and str(email).strip().lower().endswith(DEMO_SUFFIX)
