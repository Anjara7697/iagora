# Rapport d'audit — QA et tests

- Date : 2026-11-11
- Branche : dev
- SHA audité : `da56bae`
- Auditeur : agent IA (mission `docs/audit/09_QA_TESTING_AUDIT.md`)
- Périmètre : tests Pytest du backend, tests Playwright du frontend, CI, évaluation de l'agent.
- Exclusions : aucun test contactant un service réel ; Playwright non relancé localement.

## 1. Résumé exécutif

Le dispositif de test est solide :
- **663 tests backend réussis en local** (5 ignorés), couverture **90,6 %**, seuil de 70 % bloquant en CI ;
- en CI, les tests tournent sur un vrai PostgreSQL et un vrai MongoDB ;
- `alembic check` en CI ;
- environ 190 tests Playwright avec axe-core ;
- un jeu d'évaluation de l'agent (`eval-agent`).

Les règles critiques (STOP, opposition, relances, doublons, rejeux, envoi unique) sont testées, souvent avec des
cas de concurrence.

Les angles morts sont ciblés :
1. le frontend n'est jamais testé contre le vrai backend (QA-001) ;
2. les scénarios de **reprise après arrêt brutal** ne sont pas testés : lead Meta `queued`, envoi `sending`,
   créneau passé (QA-002) ;
3. pas de test du retour arrière des migrations (DATA-006).

## 2. Commandes exécutées

| Commande | Résultat réel |
|---|---|
| `python -m pytest -q -x` (dans `backend/`, SQLite + mongomock) | **663 réussis, 5 ignorés, 3 avertissements, 2 min 49** ; couverture 90,64 % (seuil 70 % atteint) |
| `npm run build` (dans `frontend/`) | réussi |
| Playwright | non relancé ; tâche `frontend` réussie en CI sur [Anjara7697/iagora#155](https://github.com/Anjara7697/iagora/pull/155) |

Les 5 tests ignorés en local dépendent de PostgreSQL ; ils tournent en CI.

## 3. Inventaire

| Niveau | Outil | Volume | Dépendances |
|---|---|---|---|
| Services, API, modèles, workflow | Pytest + pytest-asyncio | 50 fichiers, 663 cas | SQLite + mongomock en local ; PostgreSQL 16 + MongoDB 7 en CI |
| Migrations | `alembic upgrade head && alembic check` | CI | PostgreSQL |
| Agent (qualité des réponses) | `eval-agent` (`devtools/evaluation.py`) | jeu `eval_cases.json` | modèle simulé ; `--live` avec une clé (hors CI) |
| Navigateur | Playwright (Chromium) | 17 fichiers, environ 190 tests | **API simulée** (`page.route`) ; build de production servi |
| Accessibilité | axe-core | 16 fichiers sur 17 | idem |
| n8n | `node --test` | hors ligne | aucune |

Doublures : `tests/fakes.py` (modèle, agenda, email), `HashEmbeddings`, simulateur Meta. Elles sont isolées par
test et n'appellent rien à l'extérieur.

## 4. Matrice risque → test

| Risque | Test existant | Manquant |
|---|---|---|
| Envoi vers un prospect opposé | `test_lot1_safety` (dont `:250`), `test_agent_workflow:334` | — |
| Double envoi d'un email | `test_email:492` (deux exécutions concurrentes) | message resté `sending` après un arrêt (DATA-004) |
| Double relance | `test_auto_agent:171` (travailleurs concurrents) | relance en erreur répétée (BIZ-005) |
| Doublon de prospect, rejeu d'entrée | `test_conversations_api:215`, `test_intake_context:296`, `test_email:328` | téléphone sous deux formats (DATA-001) |
| Lead Meta perdu | rejeu sans doublon (`test_meta_leads`) | lead `queued` après redémarrage ; reprise d'un `failed` (API-001) |
| Réservation de rendez-vous | `test_calendar`, `test_appointments` | créneau passé (BIZ-001), conseiller désactivé (BIZ-002) |
| Invention d'informations (NF-10) | `test_policy`, `test_evaluation` | nombres en lettres, `14h30`, conditions (AI-001) |
| Effacement RGPD | `test_erasure` | — |
| Rôles et accès | `test_auth`, `test_team`, `test_hardening` ; 7 fichiers Playwright avec le rôle observateur | — |
| Contrat frontend / backend | — | aucun (QA-001) |
| Migrations | montée + `alembic check` | descente (DATA-006) |
| Séparation démo / réel | `test_demo`, `test_devtools`, `test_simulation` | chaque indicateur exclut les fictifs (DATA-007) |

## 5. Registre des constats

### AUDIT-QA-001 — Le frontend n'est jamais testé contre le vrai backend
- Catégorie : couverture
- Criticité : P2
- Confiance : Confirmé
- Preuve : `page.route` dans les tests Playwright ; `docs/limites-et-dette.md` (tests navigateur sur API simulée) ;
  voir ARCH-003.
- Scénario : un champ renommé côté API → tous les tests verts, écran cassé sur le serveur.
- Recommandation :
  - générer les types depuis OpenAPI (ARCH-003) ;
  - ajouter un petit parcours de bout en bout contre le vrai backend en CI (connexion, liste de prospects,
    validation d'un brouillon simulé). PostgreSQL et MongoDB y sont déjà disponibles.
- Complexité : M

### AUDIT-QA-002 — Scénarios de reprise après incident non testés
- Catégorie : robustesse
- Criticité : P2
- Confiance : Confirmé (recherche des tests)
- Preuve : aucun test pour les cas DATA-004, API-001, BIZ-001, BIZ-002, BIZ-005.
- Recommandation : un test par cas, écrit en même temps que son correctif (les cinq sont de taille S).
- Complexité : S chacun

### AUDIT-QA-003 — Pas de tests unitaires du frontend
- Catégorie : couverture
- Criticité : P3
- Confiance : Confirmé
- Preuve : aucun lanceur de tests unitaires dans `frontend/package.json` ; la logique pure (`humanError`, formats
  de durée, export CSV, `prospectNav`) n'est testée qu'à travers le navigateur.
- Recommandation : seulement si cette logique grossit. Sinon, l'e2e suffit.
- Complexité : S

### AUDIT-QA-004 — Un seul navigateur, peu de tests sur mobile
- Catégorie : couverture
- Criticité : P3
- Confiance : Confirmé
- Preuve : `frontend/playwright.config.ts` (Chromium seul) ; taille d'écran modifiée dans 3 fichiers de test.
- Recommandation : un projet « mobile » (WebKit, iPhone) limité aux parcours Aujourd'hui, À traiter et Conversations.
- Complexité : S

## 6. Qualité de la CI

- **Déclenchement** : à chaque push et à chaque PR (`ci.yml:3-5`).
- **Jobs** :
  - `backend` : ruff, format, mypy, migrations, pytest sur PostgreSQL et MongoDB réels ;
  - `frontend` : image Playwright fixe, build puis tests sur le build de production ;
  - `docker` : construction des images.
- **Stable depuis #153** : les erreurs de compilation à la volée ont disparu (191 tests en moins de 3 min).
- **Limite** : les dépendances Python ne sont pas figées (OPS-001). La CI teste les versions du jour, pas
  forcément celles construites au déploiement.

## 7. Commandes de validation recommandées (sûres, locales)

```bash
cd backend && ruff check . && ruff format --check . && mypy && pytest          # SQLite + mongomock
cd backend && TEST_DATABASE_URL=postgresql+asyncpg://… TEST_MONGO_URI=mongodb://localhost:27017 pytest  # moteurs réels locaux
cd backend && python -m app.cli eval-agent                                            # modèle simulé
cd frontend && npm run lint && npm run typecheck && npm run build && PLAYWRIGHT_PRODUCTION=1 npm run test:e2e
```

## 8. Plan de couverture par priorité

1. Tests de reprise (QA-002), avec les correctifs correspondants.
2. Cas NF-10 supplémentaires dans `eval-agent` et `test_policy` (AI-001).
3. Parcours e2e contre le vrai backend (QA-001).
4. Retour arrière des migrations en CI (DATA-006).
5. Projet mobile Playwright (QA-004).
