# Comptes, accès et secrets

Inventaire de tout ce qu'il faut pour faire tourner IAGORA : **où** se trouve chaque secret et **à qui**
appartient chaque compte. Aucune valeur secrète n'est écrite ici ni ailleurs dans le dépôt (S-04).

> À compléter colonne « Propriétaire » avec DATUM avant la fin du stage. Un compte au nom d'un stagiaire
> disparaît avec son départ : tout ce qui est marqué « stagiaire » doit être transféré ou recréé.

## Comptes externes

| Service | Sert à | Propriétaire actuel | Action pour la passation |
|---|---|---|---|
| GitHub `Anjara7697/iagora` (**public**) | Code, CI, déploiement automatique de `dev` | Stagiaire | Transférer à l'organisation GitHub de DATUM ; décider de la visibilité |
| GitHub `Anjara7697/iagora-prototype` | Maquette publiée sur GitHub Pages | Stagiaire | Transférer ou archiver |
| Google AI Studio / Cloud (clé Gemini) | Modèle de langage et embeddings | À confirmer | Créer une clé DATUM sur une offre payante, révoquer l'ancienne |
| Serveur VPS + domaine `neosolve.info` | Environnements `dev` et `prod`, reverse proxy Caddy | À confirmer | Décider de l'hébergement définitif de la production |
| n8n (`n8n.neosolve.info`) | Workflow de prospect simulé | À confirmer | Facultatif ; exporter le workflow si conservé |
| Boîte email (IONOS) | Canal email de l'agent | DATUM | À obtenir : boîte dédiée + destinataire de test |
| Google Cloud (compte de service Calendar) | Lire et écrire les agendas des conseillers | À créer | Créer dans le projet Google de DATUM |
| Zoom (application Server-to-Server OAuth) | Créer les réunions | À créer | Créer sur le compte Zoom de DATUM |
| LinkedIn Developers, Meta for Developers | Sources de prospects | — | Obtenir les accès API officiels |
| Notion (suivi de projet) | Accueil, suivi des tâches, guide utilisateur | Stagiaire | Déplacer dans l'espace Notion de DATUM |

## Secrets de l'application

Ils sont lus depuis l'environnement (`backend/app/config.py`). En local : `.env` à la racine (modèle :
`.env.example`). Sur le serveur : `deploy/.env` (modèle : `deploy/.env.production.example`, droits `600`).

| Variable | Contenu | Conséquence d'un changement |
|---|---|---|
| `JWT_SECRET_KEY` | Signature des jetons de connexion (32 caractères minimum en production) | Tous les utilisateurs sont déconnectés ; si `CONNECTORS_SECRET_KEY` est vide, le mot de passe email enregistré devient illisible |
| `CONNECTORS_SECRET_KEY` | Chiffrement des identifiants saisis dans la console | Ressaisir le mot de passe de la boîte email dans « Intégrations » |
| `POSTGRES_PASSWORD`, `MONGO_PASSWORD` | Accès aux bases | Changer aussi le mot de passe dans la base elle-même |
| `GEMINI_API_KEY` (ou `OPENAI_API_KEY`) | Modèle de langage et embeddings | Aucune, si le modèle d'embeddings ne change pas |
| `EMAIL_USERNAME`, `EMAIL_PASSWORD` | Boîte email (valeur de départ si rien n'est enregistré dans la console) | Le réglage de la console est prioritaire |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Clé du compte de service Google (sur une ligne) | Chaque conseiller doit partager son agenda avec le nouveau compte |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Application Zoom | Aucune |
| `ADMIN_PASSWORD` | Uniquement pour `create-admin`, jamais conservé | — |

Le mot de passe de la boîte saisi dans la console est stocké **chiffré** dans MongoDB et n'est jamais
renvoyé par l'API.

## Secrets de la CI (GitHub, environnement `dev`)

Utilisés par `.github/workflows/deploy-dev.yml` :

| Secret | Contenu |
|---|---|
| `DEPLOY_HOST` | Adresse du serveur |
| `DEPLOY_USER` | Utilisateur SSH de déploiement |
| `DEPLOY_PATH` | Dossier du dépôt sur le serveur |
| `DEPLOY_SSH_KEY` | Clé privée ed25519 dédiée à IAGORA |
| `DEPLOY_KNOWN_HOSTS` | Empreinte du serveur (`ssh-keyscan -t ed25519 <hôte>`) |

Lors d'un transfert du dépôt, ces secrets suivent le dépôt mais la clé SSH reste autorisée sur le serveur :
la remplacer et retirer l'ancienne de `~/.ssh/authorized_keys`.

## Comptes de l'application

- Aucun compte n'est créé automatiquement. Le premier administrateur se crée en ligne de commande :
  `python -m app.cli create-admin --username … --email …` (mot de passe demandé ou `ADMIN_PASSWORD`).
- Les autres comptes se créent par l'API `/users` (administrateur). L'écran de gestion de l'équipe est sur
  la branche `feat/team-management`, non fusionnée.
- Pour Google Calendar, l'email du compte conseiller dans IAGORA sert d'identifiant d'agenda.

## Remplacer un secret (procédure)

1. Générer la nouvelle valeur (`openssl rand -hex 32` pour les secrets internes) ou la créer chez le
   fournisseur.
2. La mettre dans `deploy/.env` sur le serveur (jamais dans Git ni dans un message).
3. Relancer : `deploy/deploy.sh <branche>` (ou `docker compose up -d` en local).
4. Vérifier : `curl -s https://<domaine>/api/v1/health/ready`.
5. Révoquer l'ancienne valeur chez le fournisseur.

## Vérification du dépôt

Le 23 octobre 2026, une recherche dans **tout l'historique Git** (clés Google, OpenAI, GitHub, Slack,
clés privées, mots de passe en clair) n'a rien trouvé. Seul `.env.example` est versionné. À refaire avant
de rendre le dépôt public à nouveau ou de le transférer, par exemple avec `gitleaks detect`.
