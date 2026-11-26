# Lancer la démo de soutenance (en local)

Mode d'emploi court pour faire la démo sur le PC, avec le vrai modèle Gemini et des données fictives
(adresses `@demo.example.com`, aucun email réel). Voir aussi [demo-mode.md](demo-mode.md).

## La veille (une fois)

1. Récupérer `dev` à jour : `git checkout dev && git pull`.
2. Préparer `.env` à la racine (`cp .env.example .env`), puis vérifier :
   - `ENVIRONMENT=development`
   - `GEMINI_API_KEY=` votre clé (dans ce fichier seulement, jamais dans Git ni dans un chat)
   - `EMAIL_ENABLED=false` et `EMAIL_SEND_ENABLED=false`
   - `DEMO_IN_DASHBOARD=true` (l'accueil montre les prospects fictifs)
3. Démarrer bases et API : `docker compose up -d --build`.
4. Premier lancement seulement, créer l'administrateur :
   `docker compose exec -e ADMIN_PASSWORD='…' backend python -m app.cli create-admin --username admin --email admin@example.com`
5. Charger les données de démo : `docker compose exec backend python -m app.cli seed-demo --reset`.
   Les lignes « base de démo : … créé » doivent s'afficher. Sinon, la clé Gemini manque.
6. Console : `cd frontend`, `cp .env.example .env.local`, `npm ci`, `npm run build`, `npm start`.
7. Ouvrir `http://localhost:8000/api/v1/health/ready` : `"status":"ok"`.
8. Se connecter en administrateur. Vérifier que l'agent est en mode **Assisté** (Paramètres).
9. Faire une répétition complète, puis relancer l'étape 5 pour repartir de données propres.

## Le jour J (30 minutes avant)

1. `docker compose up -d`, puis `npm start` dans `frontend`. Vérifier `/health/ready`.
2. `docker compose exec backend python -m app.cli seed-demo --reset` : efface les essais de la répétition.
3. Ouvrir trois onglets (zoom 125 %, notifications coupées) :
   - **Aujourd'hui** ;
   - **Simulateur → Ouvrir le parcours guidé → Démarrer le parcours guidé** ;
   - **Prospects → Chloé Dubois** (candidature déposée).
4. Garder le simulateur dans son onglet : il ne se recharge pas. Ouvrir À traiter, la fiche
   et les rendez-vous dans les autres onglets.

## L'ordre de la démo

Le rendez-vous passe **avant** la question hors base : un transfert au conseiller arrête le parcours guidé.

| Étape | Où | Geste |
|---|---|---|
| Accueil | Aujourd'hui | Prospects à fort signal, rendez-vous, question sans réponse |
| Un prospect écrit | Simulateur | Étape 1 : « Bonjour, je cherche une formation pour devenir data analyst… » |
| Réponse sourcée | Simulateur | Montrer le brouillon et ses sources |
| Le conseiller valide | Onglet À traiter | Ouvrir le brouillon de Camille, « Modifier », changer un mot, « Valider la version modifiée ». Revenir au simulateur, cliquer **Actualiser le bilan** : le message arrive dans la boîte du prospect |
| Fiche et score | Lien « Voir le prospect fictif et son suivi » | Score justifié, étape |
| Rendez-vous | Simulateur | Étape 5 puis valider, étape 6 puis valider : rendez-vous réservé (page Rendez-vous) |
| Question hors base | Simulateur | « Proposez-vous un logement étudiant sur place ? » : transfert, visible dans À traiter avec son motif |
| Inscription | Onglet Chloé Dubois | Parcours → Modifier l'affectation ou l'étape → Confirmer l'inscription, preuve « Email de confirmation de l'école » et une référence fictive |
| STOP | Simulateur | Démarrer un nouveau parcours guidé, écrire « STOP » : prospect désinscrit |

Option : « Jusqu'à quand puis-je candidater ? » montre que l'agent répond avec la **fiche de campagne**
(date limite fictive du 15 janvier 2027).

## Bon à savoir

- Les heures de la console suivent le fuseau du PC ; l'agent écrit en heure de Paris. Mettre le PC à l'heure de
  Paris évite un écart à l'écran.
- Les créneaux fictifs tombent 7 jours après le début du parcours, en jours ouvrés.
- Pas d'email réel, ni de détection de candidature par email pendant la démo : ces deux parties demandent une vraie
  boîte mail. Elles se racontent avec la fiche de Chloé Dubois.
- Plan B si Gemini ne répond pas : la conversation part dans À traiter avec le motif d'indisponibilité, c'est le
  comportement voulu ; puis la vidéo.
