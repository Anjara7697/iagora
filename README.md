# IAgora - Agent Intelligent Commercial 2.0

Prospection, qualification et conversion assistées par IA pour DATUM Academy
(eBIHAR, Les Compagnons, Master eBIHAR). Projet de stage M2 - voir le cahier des charges v1.0.

## Stack

| Couche | Technologies |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async) |
| Orchestration IA | LangChain / LangGraph *(à venir, semaine 3)* |
| Données | PostgreSQL, MongoDB, Redis |
| Interface | Next.js 15 (TypeScript) |
| DevOps | Docker, GitHub Actions |

## Structure

```
backend/
  app/
    api/            routes FastAPI (api/v1/...) et dépendances
    agents/         agents LangGraph
    graph/          State graph (SalesAgentState, nœuds)
    models/         modèles SQLAlchemy
    schemas/        schémas Pydantic
    services/       logique métier
    integrations/   connecteurs externes (IONOS, Meta, LinkedIn, Calendar, Zoom)
    database/       base SQLAlchemy, sessions, clients MongoDB / Redis
    core/           journalisation et utilitaires transverses
    config.py       configuration via variables d'environnement
  tests/
frontend/           tableau de bord Next.js
docs/               documentation (schéma de base : docs/database/)
docker-compose.yml  backend + PostgreSQL + MongoDB + Redis
```

## Démarrage rapide

Prérequis : Docker, ou bien Python >= 3.11 et Node >= 20.

```bash
cp .env.example .env        # puis renseigner les valeurs (jamais commité)
```

### Avec Docker (backend + bases)

```bash
docker compose up --build
# API : http://localhost:8000/docs   -   santé : http://localhost:8000/api/v1/health/ready
```

### Backend en local

```bash
docker compose up -d postgres mongo redis      # bases uniquement
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev                  # http://localhost:3000
```

## Qualité du code

```bash
cd backend
ruff check . && ruff format --check .   # lint + format
mypy                                    # typage strict
pytest                                  # tests + couverture (seuil 70 %, NF-07)

cd ../frontend
npm run lint && npm run typecheck && npm run build
```

Hooks Git optionnels : `pip install pre-commit && pre-commit install`.
La CI (`.github/workflows/ci.yml`) exécute ces contrôles à chaque push et pull request.

## Variables d'environnement

Voir `.env.example`. Les secrets ne sont jamais versionnés ni journalisés (S-04).

## Workflow Git

- `main` : production ; `dev` : intégration. On ne travaille jamais directement dessus.
- Une branche par sujet, créée depuis `dev` : `feat/...`, `fix/...`, `chore/...`.
- Pull Request vers `dev` ; les merges sont faits par le responsable du projet.
- Messages de commit : Conventional Commits (`feat(scope): ...`).

## État d'avancement

Étape actuelle : **initialisation** (squelette, outillage, CI). Prochaines étapes :
modèles et migrations Alembic à partir de `docs/database/`, endpoints CRUD, puis workflow LangGraph.
