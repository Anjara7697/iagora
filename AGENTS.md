# Consignes pour les agents IA

Projet : Agent Intelligent Commercial 2.0 (cahier des charges v1.0). Voir `README.md` pour la structure.

## Git
- Ne jamais committer sur `dev` ou `main` : une branche dédiée par sujet, créée depuis `dev` à jour.
- Commits clairs (Conventional Commits), regroupés par objectif. Pull Request vers `dev`.
- Ne jamais merger ni déployer : les merges sont faits par le responsable du projet.

## Code
- Backend : Python/FastAPI. Avant de proposer une PR : `ruff check .`, `ruff format --check .`, `mypy`, `pytest` (dans `backend/`).
- Frontend : `npm run lint && npm run typecheck && npm run build` (dans `frontend/`).
- `app/graph` et `app/agents` ne dépendent d'aucune API ou SDK de plateforme : tout passe par `app/integrations` (NF-01, NF-02).
- Le LLM n'invente jamais de prix, date, condition ou disponibilité (NF-10).

## Sécurité
- Aucun secret dans Git, le code ou les logs. Seul `.env.example` est versionné (S-04).
- Uniquement les API officielles des plateformes, pas de scraping (S-08).
- Les outils de recette (`app/devtools`, commandes `seed-demo`, `scenario`, `chat`) ne s'exécutent jamais en production et ne manipulent que des données fictives en `@demo.example.com`.
