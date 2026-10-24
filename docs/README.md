# Documentation IAGORA — Agent Intelligent Commercial 2.0

Sommaire de la documentation technique. Elle vit dans le dépôt, à côté du code : un changement de
comportement se documente **dans la même Pull Request** que le code qui le produit.

Une version courte, pour l'équipe et le suivi de projet, existe dans Notion (accueil du projet,
guide utilisateur, tableau des tâches). En cas de désaccord entre les deux, ce dossier fait foi.

## Par où commencer

| Vous êtes… | Lisez d'abord |
|---|---|
| Nouveau développeur sur le projet | [README du dépôt](../README.md) → [architecture.md](architecture.md) → [passation.md](passation.md) |
| Responsable qui reprend le projet | [passation.md](passation.md) → [acces-et-comptes.md](acces-et-comptes.md) → [limites-et-dette.md](limites-et-dette.md) |
| Chargé de la mise en production | [deploiement.md](deploiement.md) → [email.md](email.md) → [calendar.md](calendar.md) |
| DPO / juriste | [conformite-rgpd.md](conformite-rgpd.md) |

## Vue d'ensemble

| Document | Contenu |
|---|---|
| [architecture.md](architecture.md) | Couches, ports et adaptateurs, flux d'un message, tâches de fond, bases de données |
| [decisions.md](decisions.md) | Décisions techniques importantes, leurs raisons et leurs conséquences |
| [database/README.md](database/README.md) | Schéma de données, écarts avec le schéma d'origine, conversations MongoDB |

## L'agent

| Document | Contenu |
|---|---|
| [agent-workflow.md](agent-workflow.md) | Graphe LangGraph, règles de décision, garde-fous, modes assisté / auto / manuel |
| [prompts.md](prompts.md) | Catalogue des consignes données au modèle et règles pour les modifier |
| [rag.md](rag.md) | Base de connaissances : documents, recherche, seuil de pertinence |
| [follow-ups.md](follow-ups.md) | Relances : règles d'arrêt, contexte commercial |
| [agent-testing.md](agent-testing.md) | Données de démo, scénarios rejouables, simulateur en ligne de commande |

## Parcours commercial

| Document | Contenu |
|---|---|
| [intake.md](intake.md) | Réception des prospects, file « À attribuer », reprise des traitements |
| [advisor-workflow.md](advisor-workflow.md) | Travail des conseillers : affectation, étapes, indicateurs |
| [campaign-ownership.md](campaign-ownership.md) | Responsable de campagne, héritage et exceptions |
| [demo-mode.md](demo-mode.md) | Données fictives : repérage, filtre, purge |
| [simulator-journey.md](simulator-journey.md) | Parcours guidé du simulateur |

## Connecteurs

| Document | Contenu |
|---|---|
| [email.md](email.md) | Connecteur IMAP/SMTP : réglage depuis la console, sécurité par défaut, limites |
| [calendar.md](calendar.md) | Google Calendar et Zoom : réglage, règles de disponibilité, cas d'échec |
| [sources-leads.md](sources-leads.md) | Jetons de service (formulaire du site, n8n…) et import CSV de prospects |
| [parametres.md](parametres.md) | Réglages de l'agent depuis la console : IA, relances, emails, disponibilités |
| [n8n/README.md](n8n/README.md) | Workflow n8n qui joue un prospect fictif |

## Exploitation et qualité

| Document | Contenu |
|---|---|
| [deploiement.md](deploiement.md) | Déploiement sur le serveur, reverse proxy, sauvegardes, retour arrière |
| [recette-locale.md](recette-locale.md) | Procédure de recette avec Gemini puis une boîte IONOS |
| [revue-qualite.md](revue-qualite.md) | Revue avant mise en production, lots de corrections, décisions |
| [frontend/maquette-finale.md](frontend/maquette-finale.md) | Maquette finale : système visuel, état de chaque écran, écrans à créer |
| [frontend/prototype-conformity.md](frontend/prototype-conformity.md) | Écarts entre la console et la maquette |
| [frontend/integration-prototype.md](frontend/integration-prototype.md) | Intégration de la maquette dans Next.js |

## Passation

| Document | Contenu |
|---|---|
| [passation.md](passation.md) | État réel du projet, ce qui est simulé, reprise en 15 minutes, check-list |
| [acces-et-comptes.md](acces-et-comptes.md) | Comptes, clés et secrets : où ils sont, à qui ils appartiennent, comment les remplacer |
| [limites-et-dette.md](limites-et-dette.md) | Limites connues et dette technique, regroupées en un seul endroit |
| [conformite-rgpd.md](conformite-rgpd.md) | Données traitées, mesures en place, points à régler |

## Écrire dans ce dossier

- Une page par sujet, en français, en phrases courtes.
- Distinguer ce qui est **vérifié** (test, recette) de ce qui est **prévu** ou **non vérifié**.
- Aucun secret, aucune donnée personnelle réelle, même dans un exemple.
- Ajouter toute nouvelle page à ce sommaire.
