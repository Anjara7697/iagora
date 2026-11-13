# Passation

Ce document permet à une autre personne de reprendre le projet sans l'auteur. Il dit ce qui marche
**vraiment**, ce qui est **simulé** et ce qui **reste à faire**. À mettre à jour à chaque étape importante
et le dernier jour du stage.

> État au 12 novembre 2026, branche `dev` (jusqu'au lot 11 de la feuille de route d'audit). Rien de ce qui est
> marqué « non vérifié » ne doit être présenté comme fonctionnel en production.

## 1. Ce que fait le projet

Un agent IA reçoit les prospects des programmes de DATUM Academy (eBIHAR, Les Compagnons, Master eBIHAR),
les qualifie, les score, leur répond à partir de documents validés, organise un rendez-vous avec un
conseiller ou leur passe la main, le tout sous contrôle humain (mode assisté par défaut).
Vue technique : [architecture.md](architecture.md).

## 2. État réel

### Fonctionne et testé

| Fonction | Preuve |
|---|---|
| Réception REST, déduplication, file « À attribuer » | Tests API, [intake.md](intake.md) |
| Workflow LangGraph : qualification, score, décision, réponse, transfert | Tests + scénarios hors ligne, [agent-workflow.md](agent-workflow.md) |
| Mode assisté, brouillons, arrêt d'urgence, file « À traiter » | Tests API et navigateur |
| Effacement RGPD d'un prospect (console, administrateur), liste de suppression, commande de purge par durée ([effacement-rgpd.md](effacement-rgpd.md)) | Tests (`test_erasure.py`) et navigateur |
| STOP et désinscription sur toutes les entrées | Tests (`test_lot1_safety.py`, `test_review_safeguards.py`) |
| RAG pgvector et page d'administration | Tests, [rag.md](rag.md) |
| Relances : fenêtre, plafond, arrêt après conversion | Tests (`test_auto_agent.py`), [follow-ups.md](follow-ups.md) |
| Campagnes, sources, responsable de campagne, affectation | Tests dont concurrence sur PostgreSQL réel en CI |
| Comptes, rôles, limitation des connexions, garde-fous de production | Tests (`test_auth.py`, `test_hardening.py`) |
| Console : Aujourd'hui, À traiter, Conversations, Rendez-vous (consultation), Prospects, Campagnes, Tableau de bord, Analyses, Agent, Base de connaissances, Équipe, Intégrations, Paramètres, Mon compte, Import CSV, Simulateur ; règles de présentation communes ([frontend/heroui.md](frontend/heroui.md)) | Tests Playwright (API simulée, audit axe) et parcours contre le vrai backend en CI (`e2e-api`) |
| Contrat frontend / API : types générés depuis OpenAPI, vérifiés en CI | `npm run api:check`, `scripts/export_openapi.py --check` |
| Durcissement issu de l'audit (lots 0 à 9) : en-têtes de sécurité, taille maximale des requêtes, identifiant de requête dans les journaux, reprise des leads Meta, relances plafonnées, téléphones en E.164, saisies protégées | Tests backend et navigateur ; [audit/reports/MODERNIZATION_ROADMAP.md](audit/reports/MODERNIZATION_ROADMAP.md) |
| Réglages sans `.env` : boîte email, agenda, Zoom, IA et relances, jetons de service ([parametres.md](parametres.md), [sources-leads.md](sources-leads.md)) | Tests API et navigateur |
| Email de bout en bout sur une boîte de test : réception, brouillon, validation, envoi | Recette manuelle ([recette-locale.md](recette-locale.md)) |
| Parcours complet avec Gemini jusqu'à un rendez-vous fictif | Recette locale déclarée par l'auteur ([n8n/README.md](n8n/README.md)) |
| Meta Lead Ads : configuration chiffrée, webhook signé, mapping formulaire/campagne, déduplication et simulateur local | Tests API et navigateur, [sources-leads.md](sources-leads.md) |
| Prospection après un import : colonne « consentement », premiers contacts préparés par lot depuis la campagne, validés dans « À traiter », envois étalés (D-29) | Tests API, navigateur et parcours contre le vrai backend, [sources-leads.md](sources-leads.md) |

### Codé, mais non vérifié en conditions réelles

| Fonction | Ce qui manque |
|---|---|
| Email IMAP/SMTP | Recette sur la boîte définitive de DATUM : [recette-locale.md](recette-locale.md) §4 |
| Google Calendar + Zoom (réglés dans la console, OAuth par conseiller) | Applications OAuth Google et Zoom en HTTPS, comptes réels et recette : [calendar.md](calendar.md) |
| Déploiement serveur (`deploy/`) | `dev` en ligne et déployé automatiquement après une CI verte ; reste la production, la copie des sauvegardes hors serveur (stockage à choisir, lot 6) et un test de restauration |
| Qualité des réponses avec le vrai modèle | `eval-agent --live` à lancer et à suivre ([agent-testing.md](agent-testing.md)) |
| Workflow n8n « prospect simulé » | Exécution sur l'instance n8n du serveur |
| STOP et « question inconnue » avec Gemini | Recette manuelle à confirmer |
| Meta Lead Ads | Application, permissions, page et formulaire réels à fournir puis tester avec l'outil Meta |

### Simulé aujourd'hui

- **Base de connaissances** : documents fictifs (`devtools/demo_kb/`). Les vrais documents DATUM manquent.
- **Agenda** en mode `demo` : créneaux et liens Zoom fictifs.
- **Prospects** en `@demo.example.com` : badge « Fictif », exclus des statistiques, jamais d'envoi réel.

### Pas fait

| Sujet | Raison ou prochaine action |
|---|---|
| Connecteur LinkedIn | Accès API non obtenu ; le socle générique d'ingestion existe |
| Gestion des rendez-vous | Liste de consultation disponible ; modification, annulation et synchronisation externe restent à développer |
| Rappel avant rendez-vous | Non développé |
| Connexion Gmail / Microsoft 365 par OAuth | Mot de passe d'application en attendant |

Liste complète des limites : [limites-et-dette.md](limites-et-dette.md).

### Décisions

Les décisions de la feuille de route d'audit ont été prises le 12 novembre 2026 : voir
[decisions.md](decisions.md) D-13 à D-28. Celles qui relèvent du DPO (conservation, base légale des leads
Meta, sous-traitance du modèle) y sont des propositions à faire valider avant un pilote réel. Restent hors
décision : les documents officiels de la base de connaissances (fournis par DATUM) et la double
authentification (reportée). Les lots de la feuille de route sont tous livrés, le lot 10 (sessions et accès)
compris.

## 3. Reprendre le projet en 15 minutes

Prérequis : Docker, Node 22 et une clé Gemini.

```bash
git clone https://github.com/Anjara7697/iagora.git && cd iagora
cp .env.example .env            # puis renseigner GEMINI_API_KEY dans .env (jamais dans Git)
docker compose up --build -d    # API : http://localhost:8000/docs
docker compose exec -e ADMIN_PASSWORD='un-mot-de-passe-de-12-caracteres-min' backend \
  python -m app.cli create-admin --username admin --email admin@example.com
docker compose exec backend python -m app.cli seed-demo
cd frontend && cp .env.example .env.local && npm ci && npm run dev   # http://localhost:3000
```

Ensuite : se connecter, laisser le mode **Assisté**, ouvrir **Simulateur** et suivre le parcours guidé
([simulator-journey.md](simulator-journey.md)).

Vérifier que tout est vert avant de modifier quoi que ce soit :

```bash
cd backend && ruff check . && ruff format --check . && mypy && pytest
cd ../frontend && npm run lint && npm run typecheck && npm run build
```

## 4. Règles de travail

- Branche par sujet depuis `dev` (`feat/…`, `fix/…`, `docs/…`), Pull Request vers `dev`. Jamais de
  commit direct sur `dev` ou `main`. Détail : [AGENTS.md](../AGENTS.md).
- Documenter dans `docs/` dans la même Pull Request que le code.
- Aucun secret dans Git, le code ou les journaux ; uniquement les API officielles.

## 5. Comptes et accès

Inventaire complet, propriétaires et procédure de remplacement : [acces-et-comptes.md](acces-et-comptes.md).
Point d'attention : plusieurs comptes (dépôt GitHub, Notion, clé Gemini, serveur) sont aujourd'hui au nom
du stagiaire et doivent être transférés ou recréés au nom de DATUM.

## 6. Check-list de fin de stage

- [ ] Transférer le dépôt GitHub à l'organisation DATUM (et décider s'il reste public).
- [ ] Recréer les clés et comptes au nom de DATUM, puis révoquer les anciens.
- [ ] Déplacer l'espace Notion du projet dans l'espace de DATUM.
- [ ] Créer un compte administrateur pour un responsable DATUM.
- [ ] Faire une sauvegarde et un test de restauration (`deploy/backup.sh`, `deploy/restore.sh`).
- [ ] Mettre à jour ce document, le README et le tableau de suivi Notion.
- [ ] Enregistrer une vidéo de démonstration (5 à 10 minutes).
- [ ] Séance de passation : démonstration, questions, remise des accès.

## 7. Contacts

| Rôle | Personne |
|---|---|
| Auteur du code (stagiaire) | ANDRIAMIHAINGO Anjara Valisoa |
| Encadrante | Ndeye Arame NIANG |
| Plateforme IAGORA | Nazim Okba |
