# Déploiement sur le VPS

Pile Docker : `deploy/compose.prod.yml`. Deux services applicatifs (`<projet>-api`, `<projet>-web`), un
service de migration, PostgreSQL (pgvector) et MongoDB avec mot de passe. **Aucun port n'est publié** :
le reverse proxy du serveur (celui de Lingora et Inventory) joint les conteneurs par un réseau Docker
partagé.

> Ce guide est écrit **avant** la mise en place sur le serveur. Les points marqués **À CONFIRMER**
> dépendent de la configuration du reverse proxy existant et sont à compléter ensemble.

## 1. Deux environnements

| | `iagora-dev` | `iagora-prod` |
|---|---|---|
| Domaine | `dev.iagora.neosolve.info` | `iagora.neosolve.info` (à confirmer) |
| `ENVIRONMENT` | `development` (simulation et n8n autorisés) | `production` |
| `NEXT_PUBLIC_ENABLE_SIMULATOR` | `true` | `false` |
| Email réel | désactivé | seulement après recette (`docs/email.md`) |
| Dossier | `/srv/iagora-dev` | `/srv/iagora-prod` |

Chaque environnement a son dossier, son `deploy/.env` et son `IAGORA_PROJECT` (`iagora-dev`,
`iagora-prod`) : conteneurs, images et volumes sont distincts.

En `production`, l'application refuse de démarrer sans secret JWT d'au moins 32 caractères, avec `DEBUG`
actif ou avec un `CORS_ORIGINS` contenant `*`/localhost, et la simulation est refusée côté serveur.

## 2. Prérequis sur le serveur

- Docker + Docker Compose v2, `git`.
- Un enregistrement DNS pour chaque domaine vers l'IP du serveur.
- Le réseau Docker du reverse proxy (**À CONFIRMER** son nom ; sinon `docker network create proxy`).
- Au moins ~1,5 Go de mémoire disponible par environnement (limites réglables dans `deploy/.env`).

## 3. Installation (une fois par environnement)

```bash
sudo mkdir -p /srv/iagora-dev && sudo chown "$USER" /srv/iagora-dev
git clone https://github.com/Anjara7697/iagora.git /srv/iagora-dev
cd /srv/iagora-dev
cp deploy/.env.production.example deploy/.env
chmod 600 deploy/.env
```

Renseigner `deploy/.env` (chaque secret : `openssl rand -hex 32`) :
`IAGORA_PROJECT`, `ENVIRONMENT`, `CORS_ORIGINS`, `JWT_SECRET_KEY`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_ENABLE_SIMULATOR`, `POSTGRES_PASSWORD`, `MONGO_PASSWORD`, `GEMINI_API_KEY`,
`PROXY_NETWORK`. **Ce fichier ne va jamais dans Git.**

Premier démarrage :

```bash
deploy/deploy.sh dev          # branche à déployer (dev pour l'environnement d'essai)
```

Le script : récupère le code (fast-forward uniquement), sauvegarde, construit les images, applique les
migrations (service `migrate`), démarre, puis attend `/api/v1/health/ready`.

## 4. Reverse proxy — À CONFIRMER avec la configuration de Lingora/Inventory

Le proxy doit router, pour le domaine de l'environnement :

| Chemin | Cible |
|---|---|
| `/api/*` | `<projet>-api:8000` (garder le préfixe `/api/v1`) |
| tout le reste | `<projet>-web:3000` |

et envoyer `X-Forwarded-For` / `X-Forwarded-Proto` (l'API les lit pour la limitation des connexions).
Le certificat HTTPS est géré par le proxy. **Vérifier que `/api/...` atteint bien FastAPI et non la
page Next.js** (voir aussi `docs/n8n/README.md`).

## 5. Première mise en service

```bash
cd /srv/iagora-dev
docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec iagora-api \
  python -m app.cli create-admin --username admin --email vous@exemple.fr   # saisie du mot de passe
```

Les données de référence (canaux, programmes) sont créées par les migrations. La base de connaissances
est à alimenter avec les **vrais** documents DATUM (`python -m app.cli kb-ingest …`, voir `docs/rag.md`).

Contrôles rapides :

```bash
curl -s https://dev.iagora.neosolve.info/api/v1/health/ready      # {"status":"ok",…}
curl -s -o /dev/null -w "%{http_code}\n" https://dev.iagora.neosolve.info/api/v1/prospects   # 401
curl -s -o /dev/null -w "%{http_code}\n" https://iagora.neosolve.info/docs                    # 404 (prod)
```

Puis se connecter à la console, créer une campagne, vérifier **le mode assisté** (réglage par défaut).

## 6. Sauvegardes

`deploy/backup.sh` sauvegarde PostgreSQL (`pg_dump`) et MongoDB (`mongodump`) dans `/var/backups/iagora`
(14 jours). À planifier :

```cron
15 3 * * * /srv/iagora-prod/deploy/backup.sh >> /var/log/iagora-backup.log 2>&1
```

Le script est aussi lancé avant chaque mise à jour. **Copier régulièrement les sauvegardes hors du
serveur** (une sauvegarde sur la même machine ne protège pas d'une perte du disque).
Test de restauration à faire **avant** d'avoir des données réelles :

```bash
deploy/restore.sh /var/backups/iagora/postgres-AAAAMMJJ-HHMMSS.dump /var/backups/iagora/mongo-AAAAMMJJ-HHMMSS.archive.gz
```

## 7. Mise à jour et retour arrière

- Mise à jour : `deploy/deploy.sh <branche>`.
- Retour arrière du **code** : `git checkout <commit précédent> && deploy/deploy.sh <branche>` (le script
  affiche l'ancien commit). Une migration appliquée n'est pas défaite automatiquement : en cas de
  migration problématique, restaurer la sauvegarde faite juste avant (`deploy/restore.sh`).

## 8. Points de vigilance

- Un seul processus API (boucles de relance et d'email dans le même processus, protégées par un bail
  MongoDB) : ne pas passer `--workers` au-delà de 1 sans worker dédié.
- Les mots de passe des bases sont en hexadécimal pour éviter tout échappement dans les URL de connexion.
- `EMAIL_ENABLED` et `EMAIL_SEND_ENABLED` restent à `false` jusqu'à la recette sur boîte de test
  (`docs/email.md`), puis ouverture progressive avec `EMAIL_SANDBOX_RECIPIENTS`.
- La CI valide la construction des deux images et la syntaxe du compose ; elle ne déploie rien.
- Non vérifié : construction des images sur le serveur, comportement derrière le reverse proxy réel,
  quotas Gemini en usage réel.
