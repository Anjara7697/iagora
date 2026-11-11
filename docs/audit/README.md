# Référentiel d'audit IAGORA

Version 1.0 — périmètre de référence : branche `dev`.

## Objectif
Ce dossier fournit une méthode reproductible pour auditer le produit IAGORA — Agent Intelligent Commercial 2.0, à partir de son code et de sa documentation réels. Il s'agit d'un audit **en lecture seule** : aucune correction n'est autorisée pendant ces missions.

## Sources de vérité
1. Code et documentation du dépôt sur `dev` pour l'état implémenté.
2. `AGENTS.md`, `README.md` et `docs/README.md` pour les conventions et la navigation.
3. Notion pour le contexte produit, les décisions et les informations de suivi.
4. Si les sources divergent, documenter l'écart sans choisir arbitrairement : vérifier le code, dater les documents et poser une question si nécessaire.

La branche `main` n'est pas la référence de cet audit. Ne pas la modifier.

## Architecture connue à confirmer sur dev
- Backend : Python, FastAPI, Pydantic, SQLAlchemy asynchrone, Alembic.
- Agent : LangGraph / LangChain, graphe et ports/adaptateurs.
- Données : PostgreSQL (dont pgvector), MongoDB, Redis.
- Frontend : Next.js, React, TypeScript, HeroUI v3, Tailwind CSS.
- Tests : Pytest, Playwright, axe-core ; CI GitHub Actions.
- Déploiement : Docker Compose, environnement dev, scripts de sauvegarde/restauration.
- Intégrations documentées : email IMAP/SMTP, Google Calendar, Zoom, Meta Lead Ads, LLM et embeddings. LinkedIn est documenté comme non branché. Vérifier l'état réel de chaque connecteur sur `dev`.

## Ordre d'exécution
1. `00_MASTER_PROMPT.md` — règles communes.
2. `01_PROJECT_DISCOVERY.md` — cartographie et état réel.
3. Faire valider la découverte par le responsable.
4. Exécuter les audits 02 à 10, idéalement dans cet ordre : architecture, données, backend, sécurité, métier, IA/intégrations, frontend, QA, DevOps/performance.
5. `11_MODERNIZATION_ROADMAP.md` — consolidation après réception des rapports.

## Documents
- `00_MASTER_PROMPT.md` : contrat commun d'audit.
- `01_PROJECT_DISCOVERY.md` : prompt de découverte.
- `02_ARCHITECTURE_AUDIT.md`
- `03_BACKEND_API_AUDIT.md`
- `04_DATABASE_AUDIT.md`
- `05_SECURITY_AUDIT.md`
- `06_FRONTEND_UX_AUDIT.md`
- `07_BUSINESS_LOGIC_AUDIT.md`
- `08_AI_INTEGRATIONS_AUDIT.md`
- `09_QA_TESTING_AUDIT.md`
- `10_DEVOPS_PERFORMANCE_AUDIT.md`
- `11_MODERNIZATION_ROADMAP.md`

## Règles Git
Conformément à `AGENTS.md` : branche dédiée créée depuis `dev`, commits Conventional Commits, PR vers `dev`. Ne jamais committer directement sur `dev` ou `main`. Ne jamais merger ni déployer. Pour les audits eux-mêmes, ne pas modifier le code applicatif.

## Définition de terminé
Un audit est terminé lorsque son périmètre, ses limites, ses preuves, ses constats classés, ses points positifs et ses questions ouvertes sont consignés. Une liste de recommandations sans preuves ne constitue pas un audit.
