# Sources de leads : formulaire du site, outils (n8n…) et import CSV

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
être repris trois fois. Le formulaire fixe la campagne, la source et éventuellement le programme.
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
