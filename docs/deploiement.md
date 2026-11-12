# Déploiement sur le VPS

Pile Docker : `deploy/compose.prod.yml`. Deux services applicatifs (`<projet>-api`, `<projet>-web`), un
service de migration, PostgreSQL (pgvector) et MongoDB avec mot de passe.
L'API et le web sont publiés **uniquement sur `127.0.0.1`** (`IAGORA_API_PORT`, `IAGORA_WEB_PORT`) ; le
reverse proxy de l'hôte les joint. Les bases ne sont jamais publiées.

> **État (29 octobre 2026)** : l'environnement `dev` est en ligne sur `dev.iagora.neosolve.info` (VPS,
> Caddy installé sur l'hôte) et se met à jour automatiquement après chaque CI verte sur `dev`. Les images
> se construisent, les migrations passent et l'API est joignable en HTTPS derrière Caddy. **Pas encore
> fait** : l'environnement de production, la planification des sauvegardes hors serveur et la recette
> des connecteurs réels (Google Agenda, Zoom, boîte définitive).

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
`IAGORA_API_PORT`, `IAGORA_WEB_PORT`. **Ce fichier ne va jamais dans Git.** Sans `ENVIRONMENT`, l'API
refuse de démarrer : indiquer `production`, ou `development` pour une instance d'essai.

Premier démarrage :

```bash
deploy/deploy.sh dev          # branche à déployer (dev pour l'environnement d'essai)
```

Le script : récupère le code (fast-forward uniquement), sauvegarde (sauf à la première installation,
quand les bases n'existent pas encore), construit les images, applique les migrations (service
`migrate`), démarre, puis attend `/api/v1/health/ready` et la page de connexion de la console. L'image
installe les versions figées de `backend/requirements.lock.txt`, celles testées par la CI. Sans droits sur
`/var/backups`, renseigner
`BACKUP_DIR` dans `deploy/.env` (dossier de l'utilisateur de déploiement).

## 4. Reverse proxy (Caddy)

Ajouter un **nouveau** bloc de site (ne modifier aucun site existant), par exemple dans un fichier
importé par le Caddyfile :

```caddyfile
dev.iagora.neosolve.info {
	encode gzip
	# Requêtes de plus de 5 Mo refusées (l'API applique la même limite sur Content-Length).
	request_body {
		max_size 5MB
	}
	# HTTPS seulement : HSTS est posé ici. Les autres en-têtes de sécurité viennent de l'API et de la console.
	header Strict-Transport-Security "max-age=31536000"
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
Contrôler ensuite les en-têtes : `curl -sI https://<domaine>/login` et `curl -sI https://<domaine>/api/v1/health`
doivent montrer `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` et
`Content-Security-Policy: frame-ancestors 'none'…`.

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

La clé publique correspondante est ajoutée à `~/.ssh/authorized_keys` de l'utilisateur de déploiement,
**restreinte à une seule commande** : même si la clé privée fuitait, elle ne servirait qu'à lancer le
déploiement de `dev` (le client ne peut rien exécuter d'autre) :

```text
command="cd /srv/iagora-dev && deploy/deploy.sh dev",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA… iagora-deploy-gha
```

`DEPLOY_KNOWN_HOSTS` se construit sur le serveur à partir de sa propre clé d'hôte, sans scan réseau :
`echo "<IP> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`. Après avoir copié la clé privée dans
le secret GitHub, la supprimer du serveur (`shred -u`). Le workflow ne gère que le port SSH 22. Pour
déclencher un déploiement à la main : Actions → « Deploy dev » → Run workflow.
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

## 6. Sauvegardes et alertes

### Sauvegarde quotidienne

`deploy/backup.sh` sauvegarde PostgreSQL (`pg_dump`) et MongoDB (`mongodump`) dans `BACKUP_DIR`
(`/var/backups/iagora` par défaut), puis en envoie une **copie chiffrée hors serveur** si `BACKUP_REMOTE` est
renseigné. Conservation (décision D-19) : 7 jours sur le serveur (au plus `BACKUP_KEEP_MAX` = 30 de chaque
sorte, sauvegardes d'avant déploiement comprises), 30 jours hors serveur. Le script est aussi lancé avant
chaque mise à jour. À planifier :

```cron
15 3 * * * /srv/iagora-prod/deploy/backup.sh >> /var/log/iagora-backup.log 2>&1
```

### Copie chiffrée vers un stockage S3 (D-13)

À faire une fois sur le serveur, par le responsable (les clés ne passent jamais par Git ni par la console) :

1. Créer un bucket S3 privé (Scaleway, OVH, Backblaze B2…) et une clé d'accès limitée à ce bucket.
2. Installer `rclone` (`sudo apt install rclone`), puis `rclone config` :
   - un remote `iagora-s3` de type `s3` (fournisseur, clé, région, bucket) ;
   - un remote `iagora-crypt` de type `crypt` qui pointe vers `iagora-s3:<bucket>/iagora`, avec un mot de
     passe et un sel générés (`openssl rand -hex 32`). **Les conserver dans le coffre de mots de passe de
     DATUM** : sans eux, les copies sont illisibles.
3. Dans `deploy/.env` : `BACKUP_REMOTE=iagora-crypt:prod` (et `iagora-crypt:dev` sur `dev`).

Le script refuse d'envoyer vers un remote qui n'est pas de type `crypt` : aucune sauvegarde ne part en clair.

### Alertes (D-14)

- **Sauvegarde** : créer un contrôle sur [Healthchecks.io](https://healthchecks.io) (période 1 jour, grâce
  2 heures, alerte par email au responsable), puis `HEALTHCHECK_URL=https://hc-ping.com/<uuid>` dans
  `deploy/.env`. Le script signale le début, la réussite ou l'échec ; une sauvegarde absente déclenche aussi
  l'alerte.
- **API** : créer une sonde HTTP sur [UptimeRobot](https://uptimerobot.com) vers
  `https://iagora.neosolve.info/api/v1/health/ready` (toutes les 5 minutes, alerte par email). Faire de même
  pour `dev` si utile.

### Test de restauration

À faire **avant** d'avoir des données réelles, puis après chaque changement de la procédure. Il restaure dans
des conteneurs jetables et ne touche pas aux bases en service :

```bash
deploy/restore-test.sh             # dernière sauvegarde locale
deploy/restore-test.sh --remote    # dernière copie hors serveur (téléchargée et déchiffrée)
```

Il affiche le nombre de prospects, campagnes, comptes, conversations et décisions restaurés. Restauration
réelle (DESTRUCTIF, après confirmation) :

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
- Vérifié sur `dev` : construction des images, migrations, démarrage, HTTPS derrière Caddy, déploiement
  automatique par GitHub Actions. Non vérifié : quotas Gemini en usage réel, restauration d'une sauvegarde
  (`deploy/restore-test.sh`, à lancer avant des données réelles), environnement de production.
- Mode automatique : refusé par l'API en production (décision D-16) ; chaque réponse y est validée.

## 9. Check-list avant le pilote en production (D-15)

Le pilote avec de vrais prospects se fait sur une instance `prod` séparée de `dev`. Avant le premier prospect :

- [ ] `ENVIRONMENT=production` dans `deploy/.env` (simulateur coupé, documents fictifs exclus, mode
      automatique refusé) ;
- [ ] clé Gemini **payante** et accord de sous-traitance inscrit au registre (D-25, à valider par le DPO) ;
- [ ] durées de conservation validées par le DPO (D-17 à D-19) et purge planifiée ([effacement-rgpd.md](effacement-rgpd.md)) ;
- [ ] copie chiffrée hors serveur configurée et `deploy/restore-test.sh --remote` réussi ;
- [ ] alertes Healthchecks.io et UptimeRobot reçues lors d'un essai (couper un instant l'API, sauter une sauvegarde) ;
- [ ] documents officiels importés dans la base de connaissances et `kb-eval` relancé ([rag.md](rag.md)) ;
- [ ] `eval-agent --live` passé avec le vrai modèle ([agent-testing.md](agent-testing.md)) ;
- [ ] boîte email définitive recettée ([recette-locale.md](recette-locale.md)).
- Un déploiement reconstruit les images puis redémarre l'API pendant environ une minute (relève mail et
  relances reprennent ensuite sans perte) : éviter de fusionner pendant une démonstration.
