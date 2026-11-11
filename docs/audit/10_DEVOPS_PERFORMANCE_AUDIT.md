# MISSION 10 — AUDIT DEVOPS, INFRASTRUCTURE & PERFORMANCE

Évalue la livraison, l'exploitation et la capacité du système à rester fiable dans son environnement cible.

## DevOps et déploiement
- Dockerfiles, images, utilisateurs non-root, couches, tailles et vulnérabilités connues.
- Compose dev/prod, réseaux, volumes, ports exposés, healthchecks, limites mémoire/CPU.
- Séparation migration/API/frontend/worker et cohérence avec les contraintes de processus uniques.
- Variables d'environnement, secrets, validation au démarrage et différences d'environnements.
- CI : qualité, tests, build, migrations, images et règles de déclenchement.
- Workflow deploy-dev : déclenchement, garde CI, SSH, permissions, concurrence, rollback.
- Aucun déploiement de production présumé ; distinguer dev réellement déployé et production théorique.
- Reverse proxy, HTTPS, DNS, certificats et exposition des ports selon documentation disponible.
- Sauvegardes, rétention, chiffrement, restauration testée et cohérence PostgreSQL/MongoDB.
- Logs, rotation, monitoring, alertes, health/readiness et diagnostic incident.

## Performance et capacité
- Requêtes lentes/N+1, index, pagination, gros payloads et chargement UI.
- Latence des LLM/connecteurs, timeouts, retries et saturation.
- Tâches de fond, files, verrous, concurrence et limites du processus unique.
- Consommation mémoire/CPU, stockage, taille conversations et documents.
- Cache Redis : bénéfices et comportement en panne.
- Capacité et coût d'exploitation à partir de mesures ou limites documentées.
- Goulots d'étranglement probables, à distinguer des problèmes mesurés.

## Sécurité d'exploitation
Ne jamais afficher les secrets. Ne pas exécuter de déploiement, backup, restore ou commande sur serveur réel. Ne pas lancer de benchmark de charge contre un environnement partagé.

## Livrable
Matrice environnement/composant/risque, cartographie pipeline, écarts entre dev et production, points de défaillance, capacité de reprise, performance mesurée ou hypothétique clairement distinguée, recommandations graduées.
