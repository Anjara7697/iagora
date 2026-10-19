# Recette locale : Gemini puis IONOS

Procédure pour l’installation sur le PC. Aucun résultat ci-dessous n’est présumé
réussi. Cette procédure n’a pas été exécutée sur le PC de l’utilisateur depuis
l’environnement de développement distant.

## 1. Préparer la version et l’environnement

Après intégration de la correction dans `dev` par le responsable du projet,
vérifier les changements locaux (`git status`), puis récupérer `dev` à jour.
Pour tester la branche avant intégration, utiliser une copie de test dédiée de
`fix/follow-ups-after-conversion`.

Dans le `.env` local, conserver `ENVIRONMENT=development`, renseigner la clé
`GEMINI_API_KEY` dans ce fichier uniquement, et commencer avec :

```dotenv
EMAIL_ENABLED=false
EMAIL_SEND_ENABLED=false
```

Ne pas transmettre de clé ou de mot de passe dans le chat ni dans un rapport.

Depuis la racine du dépôt :

```sh
docker compose up -d --build
docker compose exec backend python -m app.cli seed-demo
```

Démarrer la console selon le README (`cd frontend`, `npm ci`, puis `npm run dev`).
Ouvrir `http://localhost:3000`, se connecter avec le compte existant et choisir
le mode **Assisté**. Les changements de mode sont globaux à cette installation.

## 2. Vérifier Gemini sans email réel

Dans `/simulator`, démarrer le parcours guidé. Les documents et rendez-vous de
ce parcours sont fictifs. Valider chaque brouillon dans « À traiter » puis
vérifier qu’il devient visible dans la boîte fictive du prospect.

| Essai | Message ou action | Critère de réussite |
|---|---|---|
| Qualification | « Je cherche une formation pour devenir data analyst. » puis préciser son niveau et son projet | Profil mémorisé, questions pertinentes, aucune répétition inutile. |
| Objection | « Je crains de ne pas trouver d’entreprise. » | Réponse fondée sur les sources, aucune garantie inventée. |
| Rendez-vous fictif | Demander un rendez-vous puis choisir un créneau proposé | Un rendez-vous enregistré, confirmation visible après validation. |
| STOP, sur une nouvelle session | Envoyer STOP avec un brouillon en attente | Brouillon annulé, arrêt de la session, aucun nouveau message livré. |
| Question inconnue, sur une nouvelle session | Demander un tarif exact absent des documents | Aucun tarif inventé ; transfert motivé au conseiller. |

Si un transfert interrompt un scénario, relever son motif ; ne pas le compter
comme une réussite du parcours attendu. Le calendrier réel Google/Zoom n’est
pas encore connecté.

La commande suivante complète la recette avec les scénarios existants et le
vrai modèle (elle consomme son quota) :

```sh
docker compose exec backend python -m app.cli scenario --live
```

## 3. Préparer les données métier

Avant de juger les réponses commerciales réelles, charger les documents
**officiels et validés** dans « Base de connaissances ». Vérifier pour chaque
programme les admissions, durées, rythmes, accompagnements et informations
commerciales disponibles. Ne pas transformer les données fictives du simulateur
en faits métier. Tester les questions et les extraits trouvés depuis cette page.

## 4. Vérifier IONOS sur une boîte de test

Utiliser une boîte dédiée et un destinataire autorisé. Renseigner localement
`EMAIL_USERNAME`, `EMAIL_PASSWORD` et les paramètres IMAP/SMTP, puis vérifier :

```sh
docker compose up -d backend
docker compose exec backend python -m app.cli email-check
```

Un changement du `.env` nécessite de recréer le backend pour lui transmettre
les nouvelles valeurs : `docker compose up -d backend`.

1. Activer `EMAIL_ENABLED=true` en gardant `EMAIL_SEND_ENABLED=false`, puis
   recréer le backend. Envoyer un message depuis l’adresse autorisée vers la
   boîte de test : vérifier prospect, conversation et brouillon.
2. Valider le brouillon : aucun email ne doit partir tant que l’envoi est désactivé.
3. Vérifier les anciens messages prêts à envoyer et les anciens brouillons
   dépourvus de métadonnée de relance ; retirer ceux qui ne doivent plus partir.
4. Définir `EMAIL_SANDBOX_RECIPIENTS` avec l’adresse autorisée, puis activer
   `EMAIL_SEND_ENABLED=true` et recréer le backend. Vérifier un seul email reçu,
   le même fil et le statut `sent` dans la console.
5. Répondre STOP depuis cette adresse : vérifier la désinscription et l’absence
   d’envoi ultérieur. Ne pas réutiliser ce prospect pour un scénario commercial.
6. Revenir à `EMAIL_SEND_ENABLED=false` à la fin de l’essai et recréer le backend.

La recette de conversion/relance utilise aussi les règles de
[follow-ups.md](follow-ups.md). Les tests automatisés couvrent l’annulation des
relances programmées et le blocage SMTP après conversion en modes auto et assisté.
Ils ne prouvent pas la livraison par un serveur IONOS réel.

## Bilan à conserver

Pour chaque essai : version/commit, modèle, identifiant de conversation, résultat
attendu, résultat observé, décision de l’agent et anomalie éventuelle. Éviter les
secrets et les données personnelles dans les captures ou rapports partagés.

| Essai | Conversation | Résultat observé | Réussi / échoué / non exécuté |
|---|---|---|---|
| Qualification et mémoire | | | Non exécuté |
| Objection | | | Non exécuté |
| Rendez-vous fictif | | | Non exécuté |
| STOP | | | Non exécuté |
| Question inconnue | | | Non exécuté |
| Réception IONOS | | | Non exécuté |
| Envoi IONOS | | | Non exécuté |
| STOP par email | | | Non exécuté |
