# Limites connues et dette technique

Toutes les limites connues, regroupées en un seul endroit. Chacune renvoie à la page qui la détaille.
Priorités : **P1** avant une mise en production réelle · **P2** avant une montée en charge · **P3** confort.

## Fonctionnel

| Prio | Limite | Détail |
|---|---|---|
| P1 | Base de connaissances fictive : les documents officiels de DATUM manquent | [rag.md](rag.md) |
| P1 | Durée de conservation à décider avec DATUM puis à planifier (la commande `purge-inactive` existe) ; emails de la boîte et événements Google / Zoom d'un prospect effacé à supprimer à la main | [effacement-rgpd.md](effacement-rgpd.md) |
| P1 | Email : recette réussie sur une boîte de test (réception, brouillon, validation, envoi) ; reste la boîte définitive de DATUM | [recette-locale.md](recette-locale.md) |
| P1 | Rendez-vous Google + Zoom : réglables dans la console (OAuth par conseiller), jamais testés avec de vrais comptes | [calendar.md](calendar.md) |
| P2 | Pas de rappel avant rendez-vous ; le prospect n'est pas invité à l'événement Google (il reçoit le lien dans la réponse) | [calendar.md](calendar.md) |
| P2 | Meta Lead Ads : webhook, sécurité, mapping et simulation livrés ; recette réelle en attente des accès et permissions. LinkedIn non branché | [sources-leads.md](sources-leads.md) |
| P3 | Le RAG complète une question de suivi courte (moins de six mots) avec les deux messages précédents du prospect (D-43) ; un changement de sujet non annoncé peut encore manquer de contexte | [rag.md](rag.md) |
| P3 | Doublons repérés seulement quand un même lead porte les identifiants de deux fiches (pas de rapprochement par nom) ; une fusion ne se défait pas | [doublons.md](doublons.md) |
| P3 | Emails rapprochés regroupés pendant 120 s ; un email arrivé juste après, alors que la réponse automatique aux précédents est déjà prête, reçoit la sienne | [email.md](email.md) |
| P3 | Rendez-vous disponible en consultation, sans modification ni synchronisation des changements externes | [calendar.md](calendar.md) |
| P3 | Prospects fictifs comptés dans la campagne choisie par le simulateur tant qu'ils ne sont pas purgés | [demo-mode.md](demo-mode.md) |
| P3 | Email : mise en page HTML simple, pas de pièces jointes ni d'images intégrées ; Gmail et Microsoft 365 en OAuth non gérés (mot de passe d'application nécessaire) | [email.md](email.md) |

## Technique

| Prio | Limite | Détail |
|---|---|---|
| P3 | Un message resté `sending` après un arrêt brutal n'est jamais renvoyé seul : il passe en échec « envoi interrompu » après 15 minutes, le conseiller vérifie puis relance | [email.md](email.md) |
| P1 | Pas de transaction entre PostgreSQL, MongoDB, le LLM et SMTP : une panne en plein workflow peut demander de vérifier les traces avant reprise | [intake.md](intake.md) |
| P1 | Seul l'environnement `dev` est déployé et vérifié ; production, restauration d'une sauvegarde et quotas Gemini en usage réel restent à vérifier | [deploiement.md](deploiement.md) §8 |
| P2 | Tâches de fond dans le processus de l'API : garder `--workers 1` (un second processus éventuel ne sert que le HTTP avec `BACKGROUND_WORKERS_ENABLED=false`) ; un worker dédié si la charge augmente | [architecture.md](architecture.md) |
| P3 | File « À traiter » : 500 conversations examinées au plus ; au-delà, l'écran l'annonce (« Liste incomplète ») ; pagination côté base à faire si ce volume est atteint | [advisor-workflow.md](advisor-workflow.md) |
| P3 | Limitation des connexions en mémoire, par processus (une seule instance déployée) : un compteur partagé (Redis) si plusieurs instances | `core/ratelimit.py` |
| P3 | Pas de double authentification (reportée, décision du 12/11/2026) | [acces-et-comptes.md](acces-et-comptes.md) |
| P3 | Redis déclaré (compose local, configuration) mais utilisé seulement par le contrôle de santé ; absent en production, gardé pour un compteur de connexions partagé | [database/README.md](database/README.md) |
| P3 | Messages embarqués dans le document de conversation (16 Mo maximum) | [database/README.md](database/README.md) |
| P3 | Identifiants sensibles à la casse | [revue-qualite.md](revue-qualite.md) |

## Tests et recette

| Prio | Limite | Détail |
|---|---|---|
| P1 | Recette manuelle avec Gemini : STOP et « question inconnue » à confirmer | [recette-locale.md](recette-locale.md) |
| P3 | Les tests navigateur détaillés utilisent une API simulée ; un parcours contre le vrai backend (job CI `e2e-api`) et le contrat de types (`src/lib/api/contract.ts`) couvrent l'intégration réelle | [frontend/integration-prototype.md](frontend/integration-prototype.md) |
| P2 | Le workflow n8n est testé hors ligne seulement, jamais sur le moteur n8n du serveur | [n8n/README.md](n8n/README.md) |
| P2 | Qualité des réponses : l'outil `eval-agent` et son jeu de questions de référence existent ; la mesure avec le vrai modèle (`eval-agent --live`) reste à faire et à suivre | [agent-testing.md](agent-testing.md) |

## Documentation

| Prio | Limite |
|---|---|
| P3 | Les seuils (score, niveaux, relances, priorités de « À traiter ») sont des valeurs de conception à valider avec DATUM |
