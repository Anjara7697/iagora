# Déploiement sur le VPS

Pile Docker : `deploy/compose.prod.yml`. Deux services applicatifs (`<projet>-api`, `<projet>-web`), un
service de migration, PostgreSQL (pgvector) et MongoDB avec mot de passe.
L'API et le web sont publiés **uniquement sur `127.0.0.1`** (`IAGORA_API_PORT`, `IAGORA_WEB_PORT`) ; le
reverse proxy de l'hôte les joint. Les bases ne sont jamais publiées.

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
- Deux ports libres sur `127.0.0.1` par environnement (vérifier : `ss -ltnp`).
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
`IAGORA_API_PORT`, `IAGORA_WEB_PORT`. **Ce fichier ne va jamais dans Git.**

Premier démarrage :

```bash
deploy/deploy.sh dev          # branche à déployer (dev pour l'environnement d'essai)
```

Le script : récupère le code (fast-forward uniquement), sauvegarde (sauf à la première installation,
quand les bases n'existent pas encore), construit les images, applique les migrations (service
`migrate`), démarre, puis attend `/api/v1/health/ready`. Sans droits sur `/var/backups`, renseigner
`BACKUP_DIR` dans `deploy/.env` (dossier de l'utilisateur de déploiement).

## 4. Reverse proxy (Caddy)

Ajouter un **nouveau** bloc de site (ne modifier aucun site existant), par exemple dans un fichier
importé par le Caddyfile :

```caddyfile
dev.iagora.neosolve.info {
	encode gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:8120   # IAGORA_API_PORT
	}
	handle {
		reverse_proxy 127.0.0.1:3130   # IAGORA_WEB_PORT
	}
}
```

Caddy obtient le certificat HTTPS tout seul (le DNS doit déjà pointer vers le serveur) et transmet
`X-Forwarded-For`/`X-Forwarded-Proto`, que l'API lit pour la limitation des connexions. Valider puis
recharger sans coupure : `caddy validate --config <Caddyfile>` puis `caddy reload --config <Caddyfile>`.
**Vérifier que `/api/...` atteint bien FastAPI et non la page Next.js** (voir aussi `docs/n8n/README.md`).

## 4 bis. Déploiement automatique (GitHub Actions)

`.github/workflows/deploy-dev.yml` : après une CI verte sur `dev`, le workflow se connecte en SSH et
lance `deploy/deploy.sh dev`. Environnement GitHub `dev` avec les secrets :

| Secret | Contenu |
|---|---|
| `DEPLOY_HOST` | adresse du serveur |
| `DEPLOY_USER` | utilisateur SSH de déploiement |
| `DEPLOY_PATH` | dossier du dépôt sur le serveur (ex. `/srv/iagora-dev`) |
| `DEPLOY_SSH_KEY` | clé privée dédiée (ed25519), créée uniquement pour IAGORA |
| `DEPLOY_KNOWN_HOSTS` | sortie de `ssh-keyscan -t ed25519 <hôte>` (vérifiée une fois à la main) |

La clé publique correspondante est ajoutée à `~/.ssh/authorized_keys` de l'utilisateur de déploiement.
Le déploiement de production restera manuel.

## 5. Première mise en service

```bash
cd /srv/iagora-dev
docker compose -f deploy/compose.prod.yml --env-file deploy/.env exec iagora-api \
  python -m app.cli create-admin --username admin --email vous@exemple.fr   # saisie du mot de passe
```

C'est la **seule** commande de compte à lancer sur le serveur. Ensuite, tout se fait dans la console :
**Équipe** (administrateur) pour ajouter les conseillers (mot de passe temporaire affiché une fois, à
changer à la première connexion), changer les rôles, désactiver un compte ou réinitialiser un mot de
passe ; **Mon compte** (clic sur l'avatar) pour changer le sien. Un changement ou une réinitialisation de
mot de passe ferme les sessions ouvertes.

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
