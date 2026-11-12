# Sources de leads : formulaire du site, outils (n8n…) et import CSV

## Fonctionnement d'une source de campagne

Une **campagne IAGORA** organise le suivi d'un recrutement. Une **source** identifie la provenance des
contacts dans cette campagne. La créer n'ouvre aucun compte publicitaire et ne publie rien sur Meta
ou LinkedIn. La publicité, son budget, son audience et le formulaire public sont gérés sur le service
extérieur. Le connecteur transmet ensuite les contacts à IAGORA.

Depuis **Campagnes → une campagne → Sources**, chaque source propose son parcours de réception et
un lien vers ses contacts. Les liens de configuration et d'import conservent campagne et source ;
la destination n'est préremplie qu'après vérification de leur association dans les données chargées.
Avec plusieurs sources, le choix reste explicite. Le type « Import » propose le CSV quelle que soit
la plateforme : une provenance LinkedIn peut aussi être alimentée par un export manuel.

| Origine | À préparer à l'extérieur | Branchement IAGORA | Déclenchement de l'agent |
|---|---|---|---|
| Formulaire du site / landing page | Page et formulaire avec traitement serveur | Jeton de service lié à la campagne/source, puis `POST /api/v1/leads` | Le message fourni peut déclencher le traitement ; sans message, réception de la fiche seulement |
| Meta Lead Ads | Publicité et formulaire instantané, application et permissions Meta, abonnement de la page aux notifications `leadgen` | Application et webhook, puis correspondance du formulaire vers campagne/source | Le message extrait des réponses peut déclencher le traitement ; pas de campagne de démarchage automatique des contacts sans message |
| LinkedIn Lead Gen | Formulaire et export autorisé sur LinkedIn | CSV aujourd'hui ; connecteur direct non livré | Aucun message au seul import |
| Publicité vers le site | Publicité externe renvoyant vers la landing page | Jeton du formulaire du site, même si la provenance est LinkedIn ou Meta | Selon la présence d'un message |
| Salon / webinaire / liste | Fichier obtenu par l'organisateur, ou formulaire d'inscription | CSV ou API avec jeton propre à cette source | Aucun message au seul import ; API selon le message fourni |
| Email | Boîte IMAP/SMTP dédiée | Connecteur email global ; vérification du rattachement par le conseiller si ambigu | Message reçu, sous réserve des réglages et garde-fous |

**Source d'acquisition et canal de réponse sont distincts.** Un contact acquis sur Meta peut ensuite
échanger par email. Choisir la plateforme « Meta » ne fournit pas un canal Messenger et choisir
« LinkedIn » ne permet pas d'envoyer des messages privés LinkedIn.

### Activation et erreurs

Les configurations peuvent être préparées en brouillon. La réception dans une destination exige une
campagne active, une source active et un rattachement actif. Une réception refusée par l'API retourne
`422` avant de créer ou enrichir une fiche ; le système émetteur doit conserver le contact et le
renvoyer après correction. Les dates de campagne sont descriptives : elles ne constituent pas un
planificateur d'activation automatique.

Si une source a été retirée après la création d'un jeton ou d'une correspondance Meta, sa destination
devient invalide. Il faut corriger le branchement ; IAGORA ne choisit pas une autre source en silence.
Un lead resté « en attente » plus de 5 minutes (arrêt du serveur pendant son traitement) est repris
automatiquement, une seule fois à la fois. Un lead en échec (formulaire non associé, campagne désactivée,
erreur Meta) se rejoue depuis **Intégrations → Meta Lead Ads → Rejouer les leads en échec**, une fois le
branchement corrigé : 50 leads au plus par clic, 5 essais au total par lead. Il n'y a pas de rejeu
automatique illimité.

### Recette de bout en bout

1. Créer la campagne, ses programmes et une source au nom précis ; l'activer pour la réception.
2. Depuis la source, ouvrir le branchement et vérifier campagne/source préremplies.
3. Pour un formulaire, créer le jeton, le conserver côté serveur puis transmettre un contact de test
   identifiable avec un `external_id` stable. Ne pas exposer le jeton dans le navigateur public.
4. Pour Meta, enregistrer les paramètres, tester d'abord le rangement avec le simulateur, puis utiliser
   l'outil Lead Ads de Meta avec les comptes autorisés. Un essai simulé ne valide pas les permissions.
5. Contrôler la fiche, la campagne, la source et le message. Rejouer le même événement : pas de seconde
   fiche ni d'interaction supplémentaire lorsque l'identifiant de réception est conservé.
6. En mode assisté, contrôler le brouillon et sa destination avant toute validation. La distribution
   email dépend du connecteur et de ses réglages ; recevoir un lead ne prouve pas un envoi réussi.
7. Désactiver la campagne puis vérifier le refus d'une nouvelle réception. Réactiver et renvoyer le
   contact conservé par l'émetteur.

Les tests automatisés avec services simulés vérifient ces contrats internes. La recette réelle Meta
attend toujours l'application, la page, les permissions et le formulaire autorisés. LinkedIn reste
manuel via CSV ou formulaire du site tant que son adaptateur API officiel n'est pas livré.

## Jetons de service (formulaire du site, n8n, Zapier…)

**Intégrations → Formulaire du site et outils** (administrateur) : créer un jeton en lui donnant un nom
et, de préférence, la **campagne / source** où ranger les prospects reçus. Le jeton (`iag_…`) est affiché
**une seule fois** ; seule son empreinte est conservée. Il ne permet **que** l'envoi de prospects
(aucune lecture, aucun autre accès). « Révoquer » le désactive immédiatement.

```http
POST /api/v1/leads
Authorization: Bearer iag_…          (ou en-tête X-API-Key: iag_…)
Content-Type: application/json

{"first_name": "Inès", "last_name": "Martin", "email": "ines@exemple.fr", "phone": "0612345678",
 "message": "Je voudrais des informations sur eBIHAR", "consent": true, "target_code": "ebihar_students"}
```

- Réponse `201` (créé) ou `200` (prospect déjà connu, reconnu par email/téléphone) :
  `{"prospect_id": 12, "created": true}` ; `401` jeton absent, invalide ou révoqué ; `429` plus de
  60 envois par minute pour ce jeton ; `422` données invalides (ni email ni téléphone…).
- `consent: true` uniquement si la case de consentement du formulaire est cochée : il est enregistré avec
  la source « formulaire : <nom du jeton> » (RGPD). Sinon le consentement reste à recueillir.
- Un `message` est traité comme toute arrivée : l'agent prépare sa réponse (validation en mode assisté),
  STOP est respecté.
- **Formulaire du site** : le jeton ne doit pas être exposé dans le code du navigateur d'une page publique
  sans protection ; le plus sûr est de l'envoyer depuis le serveur du site, ou via n8n (nœud
  *HTTP Request*, méthode POST, en-tête `Authorization: Bearer iag_…`, corps JSON ci-dessus).

## Import CSV

**Prospects → Importer un CSV** (conseiller ou administrateur) : choisir le fichier, la campagne / source,
indiquer si les personnes ont consenti, puis **Aperçu** (rien n'est enregistré : lignes à créer, déjà
connues, invalides avec leur numéro, colonnes reconnues) et **Importer**.

- Colonnes reconnues par leur intitulé : prénom, nom, email / e-mail / courriel, téléphone / mobile,
  programme, ville, entreprise, niveau d'études, identifiant ; les autres sont ignorées. Une colonne email
  ou téléphone est obligatoire.
- Séparateur `;` ou `,`, encodage UTF-8 ou Windows (export Excel). 2 Mo et 5000 lignes au maximum.
- Doublons : reconnus dans la base et dans le fichier ; un réimport ne crée aucun doublon.
- Les prospects importés **ne déclenchent pas l'agent** : personne n'est contacté sans décision d'un
  conseiller.

## Meta Lead Ads

**Intégrations → Meta Lead Ads** prépare les formulaires instantanés Facebook et Instagram :

1. renseigner l'identifiant et le secret de l'application, le jeton d'accès de la page et un jeton de
   vérification choisi par l'administrateur ;
2. copier l'URL `/api/v1/webhooks/meta` dans Meta for Developers ;
3. associer chaque identifiant de formulaire à une source déjà rattachée à une campagne IAGORA ;
4. créer un lead fictif `@demo.example.com` pour vérifier le rangement sans appeler Meta ;
5. activer la réception, puis utiliser l'outil de test Lead Ads de Meta lorsque les permissions sont
   disponibles.

Le challenge `GET` exige le bon jeton de vérification. Chaque notification `POST` exige une signature
`X-Hub-Signature-256` valide. IAGORA demande ensuite le détail du lead à l'API Graph officielle. Les
identifiants sont chiffrés et ne sont jamais renvoyés par l'API IAGORA.

Le jeton de la page part dans l'en-tête `Authorization: Bearer`, jamais dans l'URL : `httpx` journalise
l'URL de chaque requête, un jeton en paramètre se retrouverait dans les journaux (S-04). Un identifiant de
lead qui n'est pas un simple identifiant (lettres, chiffres, tiret) est ignoré au lieu d'être inséré dans
une URL.

Le `leadgen_id` réserve l'événement avant traitement : un rejeu ne crée pas de doublon et un échec peut
être repris (renotification de Meta, bouton « Rejouer », reprise des leads en attente). Le formulaire fixe la campagne, la source et éventuellement le programme.
L'identifiant Meta, le formulaire, la publicité, la campagne publicitaire et les réponses personnalisées
restent dans le profil pour l'audit.

Le dépôt d'un formulaire publicitaire ne devient pas automatiquement un consentement marketing : le
statut reste `unknown` tant que DATUM n'a pas validé la base légale et la formulation du formulaire.

Les états **Non configuré**, **Configuré, inactif**, **Actif, à tester** et **Testé avec un lead réel**,
puis les compteurs reçus, traités et en erreur décrivent IAGORA. Seul un essai depuis Meta prouve les
permissions, le jeton de page et la livraison réelle du webhook.

## LinkedIn Lead Gen

Reste à brancher : il exige une application LinkedIn approuvée. En attendant, les leads peuvent passer
par l'API générique avec un jeton de service ou par un export CSV.
