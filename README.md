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
cp .env.example .env        # Windows : copy .env.example .env
# Optionnel pour Docker (valeurs de dev par défaut), requis pour lancer le backend hors Docker.
# Ne jamais commiter .env.
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

## API (état actuel)

Documentation interactive : `http://localhost:8000/docs`. Endpoints disponibles (préfixe `/api/v1`) :

| Ressource | Endpoints |
|---|---|
| Prospects | `POST, GET /prospects` · `GET, PATCH /prospects/{id}` |
| Consentement | `POST /prospects/{id}/opt-out` · `POST /prospects/{id}/consent` |
| Interactions | `POST, GET /prospects/{id}/interactions` |
| Étapes, scores, affectation | `GET, PATCH /campaign-prospects/{id}` · `POST /campaign-prospects/{id}/scores` · `GET /campaign-prospects/{id}/history` |
| Conversations (MongoDB) | `POST /conversations` · `GET, PATCH /conversations/{id}` · `POST /conversations/{id}/messages` · `GET /prospects/{id}/conversation` |
| Campagnes | `POST, GET /campaigns` · `GET, PATCH /campaigns/{id}` |
| Authentification | `POST /auth/login` · `GET /auth/me` |
| Utilisateurs (ADMIN) | `POST, GET /users` · `GET, PATCH /users/{id}` |
| Santé (public) | `GET /health` · `GET /health/ready` |

### Authentification et rôles (S-06)

Toutes les routes, sauf la santé et la connexion, exigent un jeton : `Authorization: Bearer <jeton>`
(obtenu via `POST /auth/login`, champ `username` = email ou nom d'utilisateur ; bouton « Authorize » dans `/docs`).

| Action | ADMIN | ADVISOR | VIEWER |
|---|---|---|---|
| Consulter prospects, interactions, campagnes | oui | oui | oui |
| Modifier un prospect, interactions, opt-out / consentement | oui | oui | non |
| Créer / modifier une campagne | oui | non | non |
| Gérer les comptes | oui | non | non |

Le rôle est relu en base à chaque requête : désactiver un compte ou changer son rôle prend effet immédiatement.

**Créer le premier administrateur** (aucune route publique d'inscription) :

```bash
# Docker
docker compose exec -e ADMIN_PASSWORD='un-mot-de-passe-de-12-caracteres-min' backend \
  python -m app.cli create-admin --username admin --email admin@example.com
# Local (le mot de passe est demandé si ADMIN_PASSWORD n'est pas défini)
cd backend && python -m app.cli create-admin --username admin --email admin@example.com
```

En production, définir `JWT_SECRET_KEY` (32 caractères minimum, voir `.env.example`) : l'application refuse de
démarrer sans cela quand `ENVIRONMENT=production`.

`POST /prospects` reçoit un prospect : déduplication sur email / téléphone / identifiants réseaux (200 si
déjà connu, 201 si créé), rattachement à la campagne, interaction d'entrée. Un prospect désinscrit ne
peut plus recevoir d'interaction sortante.

### Étapes, scoring et affectation

`GET /prospects/{id}` liste les rattachements du prospect à ses campagnes (`campaigns[].id` = identifiant du rattachement,
utilisé par les routes `/campaign-prospects/{id}`).

- **Étape (F-13)** : `PATCH` avec `conversion_stage` et une `reason` obligatoire. Chaque changement est horodaté et attribué
  dans l'historique ; rester sur la même étape ne crée rien.
- **Affectation (F-22)** : `assigned_advisor_id` (ADMIN uniquement ; `null` retire l'affectation). Le conseiller doit être
  un compte actif ADVISOR ou ADMIN. L'historique suit le prospect, pas le conseiller.
- **Scoring (F-10, F-11, F-12)** : deux composantes de 0 à 100, l'*intérêt* et l'*adéquation* ; le **total** = 60 % intérêt
  + 40 % adéquation (arrondi). Le niveau en découle : < 25 froid, 25-49 tiède, 50-74 chaud, ≥ 75 très chaud.
  `POST .../scores` accepte soit un `signal` (règles prédéfinies, ex. `meeting_requested` = +30 d'intérêt), soit un
  ajustement manuel `score_type` + `points` + `reason`. Chaque variation produit un événement justifié, avec la valeur
  résultante et son auteur ; le total est recalculé et tracé à chaque changement. Poids, seuils et règles sont des valeurs de
  conception (CdC §4.2), regroupées dans `backend/app/services/scoring.py`.

### Conversations (MongoDB)

Une conversation est un document MongoDB (prospect, canal, statut, résumé, messages horodatés avec leur
rôle `prospect` / `agent` / `advisor`). PostgreSQL ne garde que le journal `interactions`, avec une référence
`conversation_ref` : le contenu d'un message n'existe qu'à un seul endroit.

- Une seule conversation active (`open` ou `handed_off`) par prospect et par canal ; `POST /conversations` renvoie
  l'existante (200) au lieu d'en créer une seconde.
- Un message rejoué avec le même `external_message_id` ne crée pas de doublon (200).
- Statuts : `open` ⇄ `handed_off` (transfert à un conseiller, F-20) → `closed` (définitif).
- Un prospect désinscrit ne peut plus recevoir de message sortant (`agent` / `advisor`), mais peut toujours écrire.

## Base de données et migrations

Modèles : `backend/app/models/` ; schéma de référence et décisions : `docs/database/README.md`.
Avec Docker, les migrations sont appliquées au démarrage du backend. En local :

```bash
cd backend
alembic upgrade head                          # appliquer
alembic revision --autogenerate -m "message"  # créer une migration après modification des modèles
alembic check                                 # vérifier que les modèles et les migrations sont synchronisés
```

## Qualité du code

```bash
cd backend
ruff check . && ruff format --check .   # lint + format
mypy                                    # typage strict
pytest                                  # tests (SQLite et mongomock en mémoire) + couverture (seuil 70 %, NF-07)
# Avec de vraies bases (comme la CI) :
#   TEST_DATABASE_URL=postgresql+asyncpg://user:pwd@localhost:5432/iagora_test \
#   TEST_MONGO_URI=mongodb://localhost:27017 pytest

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

Fait : initialisation, modèles et migrations, endpoints prospects / campagnes / interactions, authentification et rôles, conversations (MongoDB), étapes, scoring et affectation.
Prochaine étape : workflow LangGraph (agents, RAG), puis intégrations réelles.
