# Prospect Gemini dans n8n — préparation et recette

Ce dossier contient un **workflow à importer et à configurer**, laissé inactif.
Il n’a pas été importé ni exécuté sur `n8n.neosolve.info` pendant cette intervention.
Les tests locaux vérifient la logique et le JSON avec des services simulés ; ils
ne constituent ni une recette avec Gemini, ni une validation du moteur n8n du VPS.

## État de la recette IAGORA

Référence : branche `dev` après fusion de la PR #46.
Le parcours technique a été rejoué avec le graphe réel et un modèle scripté :
qualification en plusieurs tours, mémoire, brouillons, STOP, arrêt manuel,
réservation fictive et rejeu sans doublon. Les tests navigateur simulent l’API.

**Retour de recette locale :** l’utilisateur indique avoir terminé le parcours
avec Gemini jusqu’à un rendez-vous. Ce résultat est déclaré par l’utilisateur ;
les réponses, traces et critères détaillés de qualité n’ont pas été inspectés
directement pendant cette intervention. Les essais STOP et question inconnue
restent à confirmer manuellement, en complément des régressions automatisées.

IAGORA tourne actuellement sur ce PC ; `dev.iagora.neosolve.info` est une cible de
déploiement ultérieure, pas un service vérifié disponible. Aucun déploiement
n’est réalisé par ce lot. Les prix et données métier restent fictifs.

### Parcours manuel sur le PC

Récupérer `dev`, redémarrer l’application, ouvrir `/simulator`, choisir le parcours
guidé et démarrer une session. Garder le mode assisté pour la première passe.

| Tour | Message indicatif du prospect | Vérification attendue |
|---|---|---|
| 1 | Bonjour, je cherche une formation pour devenir data analyst. Comment se déroule le programme ? | Réponse pertinente à partir des extraits fictifs, brouillon invisible dans la boîte du prospect avant validation. |
| 2 | J’ai un Bac+3 en informatique et je souhaite travailler en alternance. | Niveau, domaine et objectif retenus ; pas de demande inutile d’informations déjà fournies. |
| 3 | Je crains de ne pas trouver d’entreprise. Quel accompagnement proposez-vous ? | Accompagnement conforme au document fictif, aucune garantie de contrat inventée. |
| 4 | Je voudrais prendre rendez-vous avec un conseiller. | Trois créneaux fictifs fournis par le calendrier de test ; aucune date inventée par le modèle. |
| 5 | Le deuxième créneau me convient. | Un seul rendez-vous persisté, confirmation fictive reçue après validation. |

Adapter les messages aux questions réelles ; ne pas imposer une réponse exacte.
À chaque tour, regarder la décision, les sources et le profil mémorisé. Valider
le brouillon, puis vérifier sa réception dans la boîte fictive. Si le modèle
transfère la conversation, relever le motif et s’arrêter : ce résultat n’est pas
une réussite automatique du scénario.

Sur **deux autres prospects fictifs**, tester séparément :

- **STOP avec brouillon en attente** : brouillon annulé, saisie arrêtée, aucune
  livraison supplémentaire. Le statut de conversation peut rester `open` ;
  `can_continue` doit devenir `false`.
- **Question non documentée** : demander le prix exact ou le financement CPF.
  L’agent ne doit inventer aucun tarif ni engagement ; contrôler son transfert
  et sa justification.

Faire ensuite une passe en mode auto **sur l’environnement de test uniquement**.
Le réglage est global : revenir au mode assisté à la fin. Ne pas modifier un mode
global partagé pendant une recette sans organiser cette intervention.
Conserver le bilan des faits observés : modèle/version, identifiant de conversation,
réponses, décisions et écarts. Aucun bilan réel de Gemini n’est prérempli ici.

## Prérequis avant le branchement du VPS

1. Parcours local jusqu’au rendez-vous confirmé par l’utilisateur ; compléter
   les cas STOP et question inconnue lors de la recette accompagnée.
2. Déployer la version contenant le raccord `/simulation/{cid}/dispatch` sur
   l’environnement de test, avec `ENVIRONMENT=development` (ou `test`). La
   simulation est refusée en production, même si le frontend affiche le bouton.
3. Vérifier **depuis le VPS n8n** que l’API est joignable avec TLS valide. La
   configuration proposée est `https://dev.iagora.neosolve.info/api/v1` ; le
   reverse proxy doit réellement router ce chemin vers FastAPI, pas vers une
   page HTML Next.js. `localhost` du VPS ne désigne pas le PC de l’utilisateur.
4. Créer/utiliser un compte IAGORA de test ADVISOR ou ADMIN et un jeton Bearer
   valide pour la durée de l’essai. Le workflow s’arrête sur 401 ; il ne renouvelle
   pas automatiquement les jetons.
5. Disposer d’une clé Gemini utilisable depuis le VPS. Le modèle qui joue le
   prospect peut avoir la même référence que celui d’IAGORA, mais son rôle et son
   historique sont séparés.

## Import et configuration

Dans n8n, importer le fichier
[`iagora-prospect-gemini.json`](iagora-prospect-gemini.json). Le laisser inactif ;
le déclencheur est manuel. Le format utilise Code v2, HTTP Request v4.2,
IF v2.2 et Wait v1.1. Vérifier leur prise en charge sur la version installée du VPS.

Créer **deux credentials distincts de type Header Auth** dans n8n :

| Credential | Nom du header | Valeur à saisir uniquement dans n8n | Nœuds concernés |
|---|---|---|---|
| IAGORA dev | `Authorization` | `Bearer <jeton du compte de test>` | Create session, Dispatch, Read exchange, Read report, Send prospect |
| Gemini prospect | `x-goog-api-key` | Clé Gemini | Gemini prospect uniquement |

Le JSON ne contient ni secret ni identifiant de credential. Sélectionner le bon
credential dans chacun des six nœuds HTTP après import. Ne jamais sélectionner
le credential IAGORA sur le nœud Gemini, ni l’inverse. Le jeton IAGORA s’obtient
via l’authentification de l’application (`POST /api/v1/auth/login`) et reste dans
le gestionnaire de credentials n8n ; ne pas le coller dans le JSON ou le chat.

Au début du nœud **Configuration**, vérifier :

- `baseUrl` : URL réelle de l’API de test, terminée par `/api/v1` ;
- `model` : référence Gemini disponible, proposée `gemini-2.5-flash` ;
- `persona` : profil privé fictif ;
- `conversationId` : vide pour créer une session, ou identifiant d’une session
  guidée existante pour la reprendre ;
- budgets par défaut : 8 messages prospect, 60 passages, 15 minutes ;
- `resume` : `null` au premier lancement ; objet du bilan précédent pour reprendre
  un envoi incertain avec exactement le même contenu et le même identifiant.

Exécuter **une seule instance par conversation**. Le premier lancement doit être
observé avec un conseiller connecté à IAGORA. Le prospect n8n crée une session
visible dans les prospects et dans « À traiter » ; la retrouver via son identifiant.

## Comportement du workflow

1. Crée une session guidée, ou utilise la session configurée.
2. Livre dans la boîte fictive les messages **déjà autorisés** via `/dispatch`.
   Ce raccord n’appelle pas le LLM et n’approuve aucun brouillon. Il permet à la
   validation faite dans « À traiter » de devenir visible au prospect n8n.
3. Lit `/exchange`. Le modèle prospect ne reçoit que `id`, `role` et `content`
   des messages de cette vue, avec sa propre fiche privée.
4. Lit `/report` uniquement pour contrôler l’existence d’un rendez-vous ; le
   rapport, les scores et les décisions ne sont jamais inclus dans son prompt.
5. Attend 15 secondes si aucune nouvelle réponse n’a été reçue. En mode assisté,
   le conseiller valide dans « À traiter » ; le workflow n’a aucun nœud d’approbation.
6. Appelle Gemini pour formuler le prochain message, puis le poste avec un
   `external_message_id` stable pour ce tour.
7. Arrête sur STOP/transfert/clôture, budget atteint ou erreur HTTP/réseau. Pour
   réussir le parcours technique, il attend un rendez-vous enregistré **et une
   réponse effectivement visible dans la boîte**, pas seulement un brouillon.

Le résultat `appointment_recorded_reply_received` atteste ces deux faits ; il ne
juge pas la qualité commerciale ni le contenu exact de la confirmation. Les
résultats `poll_limit`, `time_limit` et `turn_limit` sont des limites d’essai,
pas des succès ou des preuves d’une défaillance commerciale de l’agent.

Après une erreur réseau, un message peut déjà avoir été enregistré. Le bilan
conserve `resume.pending` avec son texte et son identifiant. Pour reprendre,
recopier l’objet `resume` complet dans Configuration ; ne pas remplacer le
message par un nouveau tour. Le même identifiant ne doit pas porter deux textes.
Une erreur de création de session n’est pas automatiquement rejouée : vérifier
si une session a déjà été créée avant de recommencer.

## Critères de la première exécution n8n réelle

- Le conseiller peut retrouver la session et valider ses brouillons.
- Le prospect n8n reste en attente tant que le brouillon n’est pas validé.
- Chaque nouveau message reçu déclenche au plus un nouveau tour prospect.
- Le profil se remplit progressivement et l’objection est traitée sans invention.
- Le rendez-vous et sa confirmation fictive sont présents ; aucun email réel.
- Un second essai STOP s’arrête sans nouvelle sollicitation.
- Une reprise d’envoi incertain conserve son identifiant sans doublon.

**Ces critères restent à confirmer sur le VPS et avec le vrai modèle.**
Le workflow ne simule pas encore le temps des relances, les pannes d’un vrai
connecteur, la conversion commerciale ni les autres profils de prospect.

## Maintenance et tests hors ligne

Source des fonctions : `tools/n8n/prospect.mjs`. Générateur :
`tools/n8n/build.mjs`. Le JSON est généré ; ne pas modifier directement ses
copies des fonctions. La configuration locale peut être éditée après import.

```sh
node tools/n8n/build.mjs
node tools/n8n/build.mjs --check
node --test tools/n8n/prospect.test.mjs
```

Les tests contrôlent le câblage et exécutent les nœuds Code/IF et expressions du
JSON dans un interpréteur de test avec services fictifs : confidentialité du
prompt, attente, STOP, budgets, envoi incertain et réservation avant réception
de la réponse. **Cet interpréteur ne remplace pas le moteur n8n réel.** La CI
exécute ces contrôles ainsi que les tests HTTP backend et les tests navigateur.
