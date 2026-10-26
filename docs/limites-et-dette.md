# Limites connues et dette technique

Toutes les limites connues, regroupées en un seul endroit. Chacune renvoie à la page qui la détaille.
Priorités : **P1** avant une mise en production réelle · **P2** avant une montée en charge · **P3** confort.

## Fonctionnel

| Prio | Limite | Détail |
|---|---|---|
| P1 | Base de connaissances fictive : les documents officiels de DATUM manquent | [rag.md](rag.md) |
| P1 | Pas de mention IA systématique dans les emails | [conformite-rgpd.md](conformite-rgpd.md) §3.1 |
| P1 | Pas d'effacement / anonymisation d'un prospect réel, pas de durée de conservation | [conformite-rgpd.md](conformite-rgpd.md) §3.2 |
| P1 | Email : recette réussie sur une boîte de test (réception, brouillon, validation, envoi) ; reste la boîte définitive de DATUM | [recette-locale.md](recette-locale.md) |
| P1 | Rendez-vous Google + Zoom : réglables dans la console (OAuth par conseiller), jamais testés avec de vrais comptes | [calendar.md](calendar.md) |
| P2 | Pas de rappel avant rendez-vous ; le prospect n'est pas invité à l'événement Google (il reçoit le lien dans la réponse) | [calendar.md](calendar.md) |
| P2 | LinkedIn et Meta non branchés (accès API non obtenus) ; en attendant : formulaire externe, jeton de service ou import CSV | [sources-leads.md](sources-leads.md) |
| P2 | Le RAG cherche avec le dernier message seul : une question courte (« et le prix ? ») manque de contexte | [rag.md](rag.md) |
| P2 | Plusieurs emails rapprochés du même prospect reçoivent chacun une réponse | [email.md](email.md) |
| P2 | Pas de fusion des fiches en double ; pas de file d'arbitrage des doublons | [revue-qualite.md](revue-qualite.md) |
| P3 | Dashboard et Analytics absents ; Rendez-vous disponible en consultation, sans modification ni synchronisation des changements externes | [frontend/prototype-conformity.md](frontend/prototype-conformity.md) |
| P3 | Prospects fictifs comptés dans la campagne choisie par le simulateur tant qu'ils ne sont pas purgés | [demo-mode.md](demo-mode.md) |
| P3 | Email en texte brut, pas de pièces jointes ; Gmail et Microsoft 365 en OAuth non gérés (mot de passe d'application nécessaire) | [email.md](email.md) |

## Technique

| Prio | Limite | Détail |
|---|---|---|
| P1 | Un message resté `sending` après un arrêt brutal n'est pas repris automatiquement (on préfère ne pas envoyer deux fois) : vérification manuelle | [email.md](email.md) |
| P1 | Pas de transaction entre PostgreSQL, MongoDB, le LLM et SMTP : une panne en plein workflow peut demander de vérifier les traces avant reprise | [intake.md](intake.md) |
| P1 | Déploiement non vérifié sur le serveur (construction des images, reverse proxy réel, quotas Gemini) | [deploiement.md](deploiement.md) §8 |
| P2 | Tâches de fond dans le processus de l'API : garder `--workers 1` ; un worker dédié si la charge augmente | [decisions.md](decisions.md) D-08 |
| P2 | Verrou par conversation local au processus (en plus du bail MongoDB) | [revue-qualite.md](revue-qualite.md) |
| P2 | File « À traiter » : 500 conversations examinées au plus ; pagination côté base à faire | [advisor-workflow.md](advisor-workflow.md) |
| P2 | Limitation des connexions en mémoire, par processus | `core/ratelimit.py` |
| P2 | Jeton de connexion dans `localStorage` au lieu d'un cookie `HttpOnly` | [architecture.md](architecture.md) |
| P3 | Redis déclaré (compose local, configuration) mais utilisé seulement par le contrôle de santé ; absent en production | [architecture.md](architecture.md) |
| P3 | Messages embarqués dans le document de conversation (16 Mo maximum) | [database/README.md](database/README.md) |
| P3 | Identifiants sensibles à la casse | [revue-qualite.md](revue-qualite.md) |

## Tests et recette

| Prio | Limite | Détail |
|---|---|---|
| P1 | Recette manuelle avec Gemini : STOP et « question inconnue » à confirmer | [recette-locale.md](recette-locale.md) |
| P2 | Les tests navigateur utilisent une API simulée : ils ne prouvent pas l'intégration réelle | [frontend/prototype-conformity.md](frontend/prototype-conformity.md) |
| P2 | Le workflow n8n est testé hors ligne seulement, jamais sur le moteur n8n du serveur | [n8n/README.md](n8n/README.md) |
| P3 | Pas de mesure suivie de la qualité des réponses (jeu de questions de référence avec le vrai modèle) | [agent-testing.md](agent-testing.md) |

## Documentation

| Prio | Limite |
|---|---|
| P3 | Les seuils (score, niveaux, relances, priorités de « À traiter ») sont des valeurs de conception à valider avec DATUM |
