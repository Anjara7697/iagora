# Premier parcours guidé et futur branchement n8n

## Ce qui a été vérifié dans le simulateur précédent

L’écran `/simulator` crée un prospect fictif et appelle les API commerciales
ordinaires : création du prospect, conversation, message, exécution de l’agent,
validation du brouillon. L’agent automatique peut également traiter le message ;
l’écran récupère alors sa dernière décision après un conflit d’exécution.
Les décisions et plusieurs tours sont consultables, mais les boutons de messages
prédéfinis ne constituent pas des scénarios complets.

L’API ordinaire injecte `UnconfiguredCalendar` : cliquer « Rendez-vous » ne prouve
pas une réservation. Les outils CLI disposent déjà de `FakeCalendar`,
`FakeKnowledge` et de scénarios ; leur exécution hors ligne emploie `FakeLLM`,
ce qui vérifie la logique technique sans évaluer l’intelligence du modèle.
Enfin, un brouillon ou un message prêt à envoyer n’est pas un message reçu.

## Parcours ajouté

Dans `/simulator`, ouvrir **Ouvrir le parcours guidé**, puis **Démarrer le parcours
guidé**. La création est réservée aux conseillers/administrateurs et refusée côté
serveur en production, indépendamment du drapeau d’affichage du frontend.

Le scénario `qualification-meeting-v1` crée Camille, une adresse unique
`@demo.example.com` et un rattachement à une campagne/source de démonstration.
Le profil privé du rôle : Bac+3 en informatique, objectif data analyst,
recherche d’alternance, crainte de ne pas trouver d’entreprise. Ces faits ne sont
pas préremplis dans le profil connu de l’agent : le prospect doit les révéler.

Les suggestions guident cinq échanges : besoin initial, qualification, objection,
demande de rendez-vous, choix du deuxième créneau. Elles restent des suggestions :
adapter le texte si l’agent pose une autre question. Aucun clic n’envoie un message
sans action explicite. Le mode global de l’agent reste applicable ; l’arrêt
manuel est respecté. En mode assisté, valider ou refuser le brouillon avant le
tour suivant ; STOP reste accepté même avec un brouillon en attente.

Le parcours emploie :

| Élément | Comportement |
|---|---|
| Graphe, profil, scoring, historique, règles STOP et brouillons | Mécanismes réels de l’application |
| Modèle | Adaptateur LLM configuré ; aucune substitution silencieuse par un faux modèle |
| Connaissances | Deux extraits fictifs contrôlés, recherche locale simple par mots partagés ; **pas de validation du RAG/embeddings réel** |
| Documents | Durée fictive de 18 mois en alternance ; accompagnement fictif à la recherche d’entreprise et au CV, sans garantie de contrat ; pas de tarif ni de financement documenté |
| Calendrier | Trois créneaux fictifs stables par session, à partir de sept jours après sa création ; réservation via le port Calendar et persistance réelle du rendez-vous |
| Visioconférence | URL fictive `zoom.example.com`, jamais une vraie réunion |
| Boîte du prospect | Message validé/prêt marqué `delivery=simulated` ; jamais `sent`, aucun appel SMTP |

La vue opérateur affiche les brouillons et décisions. La **boîte du prospect**
exclut les brouillons, les messages refusés/remplacés et les données internes.
Un accusé de transfert peut être livré directement, comme dans le mode assisté
ordinaire. Un transfert arrête le jeu automatique : un conseiller doit reprendre.

Le bilan montre le profil réellement enregistré, les exécutions et les rendez-vous
persistés. Il ne déclare pas la qualité commerciale « conforme » automatiquement.
Un rendez-vous n’est pas une conversion commerciale. Les données restent
consultables depuis la fiche du prospect et supprimables par la purge démo.
L’état de l’écran n’est pas restauré automatiquement après rechargement ; les
identifiants API permettent de retrouver le rapport et les échanges persistés.

## Contrat HTTP pour n8n

Base : `/api/v1/simulation`. Authentification Bearer de l’application, rôle
ADVISOR ou ADMIN ; prévoir un compte de test dédié et conserver son identifiant
et son secret dans les credentials n8n, jamais dans un export de workflow.
Le jeton peut expirer : prévoir son renouvellement. Il ne s’agit pas encore d’un
compte technique avec droits restreints au seul scénario.

1. `POST /sessions` avec `{"first_name":"Camille"}` retourne
   `prospect_id`, `conversation_id`, `scenario`, `guide`. Chaque appel crée une
   nouvelle session ; conserver les identifiants pour reprendre la même.
2. `GET /{conversation_id}/exchange` retourne uniquement `conversation_id`, le statut
   `status` (`open`, `handed_off`, `closed`), `can_continue` et `messages: [{id, role, content, created_at}]`. **Seule cette vue doit alimenter
   le contexte du modèle qui joue le prospect.**
3. `POST /{conversation_id}/messages` avec
   `{"content":"…","external_message_id":"run-123-tour-1"}` enregistre l’entrée,
   appelle le vrai agent et livre sa réponse fictive si elle est autorisée.
   La réponse contient le rapport opérateur : ne pas l’injecter dans le prompt
   du prospect ; relire `/exchange`.
4. En mode assisté, attendre la validation humaine dans l’écran. L’API
   `POST /{conversation_id}/drafts/{message_id}/approve` effectue la validation
   auditée puis la livraison fictive ; ne pas l’automatiser dans le workflow
   prospect destiné à vérifier le mode assisté.
5. `GET /{conversation_id}/report` est réservé à l’orchestrateur/évaluateur :
   guide, échanges visibles, rendez-vous et limites. Les décisions complètes
   restent disponibles via les API des exécutions et la fiche du prospect.
6. `POST /{conversation_id}/dispatch` livre uniquement les messages déjà autorisés
   dans la boîte fictive, sans appel LLM ni approbation automatique. À appeler
   après une validation effectuée dans « À traiter » avant de relire `/exchange`.
7. `POST /{conversation_id}/run` reprend un traitement après incident ou arrêt
   manuel levé ; après un refus de brouillon, permet une nouvelle génération.
   Ce point d’entrée peut aussi déclencher le premier contact.

Rejouer **le même identifiant avec le même contenu** évite de créer une nouvelle
entrée ou une nouvelle réservation. Un contenu différent sous le même identifiant
est refusé. Un conflit 409 peut signifier brouillon en attente, arrêt manuel,
conversation transférée/clôturée ou traitement concurrent. Ne pas répondre par
une nouvelle entrée à chaque erreur : relire l’état et reprendre le traitement.
Après une erreur technique, l’entrée peut déjà avoir été enregistrée.

Le futur workflow n8n doit conserver le curseur du dernier message vu, ne générer
qu’une réponse par nouveau message reçu, limiter les tours et la durée, et arrêter
quand `can_continue=false` (transfert/STOP/clôture). Une désinscription peut
laisser le statut de conversation `open` : ce statut seul ne suffit pas. Le rôle prospect reçoit son profil privé ; l’agent
IAGORA n’y accède que par les messages. Le juge éventuel reste séparé de ce rôle.
Aucun webhook public ni instance n8n n’a été créé par ce lot.

## Vérification et limites

Les tests HTTP traversent le vrai graphe, les services SQL et MongoDB, avec un
modèle scripté pour obtenir une régression déterministe : mémoire du profil,
réservation, idempotence, visibilité avant/après validation, STOP, arrêt manuel,
refus/régénération, protection de production et séparation du runtime ordinaire.
Les tests navigateur utilisent une API simulée : ils vérifient l’interface.
Cela ne constitue pas une recette avec un vrai modèle ou les vrais connecteurs.

L’environnement de développement de cette intervention ne fournit pas d’accès
LLM prêt à l’emploi. La qualité des réponses, les objections, la répétition des
questions et les formulations naturelles doivent donc être évaluées avec le
modèle configuré sur l’environnement de test. En cas d’indisponibilité du modèle,
les règles habituelles de transfert s’appliquent ; aucune réponse fictive n’est
présentée comme une réponse réelle du modèle.

Le worker ordinaire exclut les adresses `@demo.example.com` avant la sélection
de son lot : les relances fictives ne prennent pas la place des vraies.
Les relances du parcours guidé ne sont pas exécutées par ce worker.
Le temps accéléré, les incidents de livraison, la conversion et l’évaluation de
non-répétition restent à développer. Le garde-fou général de relance après
conversion signalé dans le rapport de conformité reste un lot métier distinct.

## Suite et critères de passage

1. **Recette manuelle avec le vrai modèle** : terminer les cinq échanges en mode
   assisté puis auto ; examiner mémoire, pertinence, absence d’invention et
   réservation. Documenter les écarts réels, sans imposer le mot-à-mot des réponses.
2. **Workflow n8n prospect** : un profil et un scénario, historique limité à
   `/exchange`, reprise avec les mêmes identifiants, attente de validation et
   limite de tours ; rejouer sans doublon ni accès aux brouillons.
3. **Horloge et incidents contrôlés** : faire avancer le temps dans le périmètre
   d’une session, vérifier les annulations après STOP/conversion et les reprises
   sans double livraison. Ne pas modifier l’horloge globale du serveur.
4. **Catalogue et évaluation** : profils hésitant, hors cible, demande inconnue,
   désinscription ; contrôles déterministes des invariants et évaluation séparée
   de la qualité commerciale. Comparer plusieurs exécutions et versions du modèle.

Préparation du workflow importable, recette locale et configuration du VPS :
[guide n8n](n8n/README.md). L’exécution réelle reste à confirmer.
