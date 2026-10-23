# Rendez-vous : agenda des conseillers et visioconférence

Quand un prospect demande un échange, l'agent propose des **créneaux réellement libres** dans l'agenda
du conseiller qui lui est attribué, réserve le créneau choisi et envoie le lien de visioconférence.
Il n'invente jamais une disponibilité (NF-10). Sans agenda branché, la demande est **transférée au
conseiller** avec une fiche de transfert (motif « agenda non branché »).

Code : `app/integrations/calendar/` derrière le port `Calendar` ; le graphe de l'agent n'en dépend pas.

## Brancher l'agenda depuis la console (recommandé, sans `.env`)

**Une fois, par l'administrateur — Google Cloud** (console.cloud.google.com) :

1. Créer (ou choisir) un projet, activer **Google Calendar API**.
2. *Écran de consentement OAuth* : type **Interne** si les conseillers ont des comptes Google Workspace de
   l'école (aucune validation Google), sinon **Externe** : en mode « Test », ajouter chaque conseiller comme
   *utilisateur test* (limite : 100 ; Google peut alors faire expirer l'autorisation au bout de 7 jours —
   publier l'application pour un usage durable). Champs d'application : `calendar.events`,
   `calendar.freebusy`, `openid`, `email`.
3. *Identifiants* → **Créer un ID client OAuth** → type **Application Web** → *URI de redirection
   autorisés* : l'adresse affichée dans IAGORA (**Intégrations → Agenda**), par exemple
   `https://dev.iagora.neosolve.info/api/v1/calendar/google/callback` (en local :
   `http://localhost:8000/api/v1/calendar/google/callback`).

**Dans IAGORA — Intégrations → Agenda** : mode « Google Agenda de chaque conseiller », identifiant et code
secret du client (chiffré, jamais réaffiché), agenda par défaut pour les prospects sans conseiller,
**Enregistrer**. Effet immédiat, sans redémarrage. La carte liste les agendas connectés.

**Chaque conseiller — Mon compte → Mon agenda** : **Connecter mon agenda Google**, autoriser chez Google,
retour automatique dans la console. L'agent utilise alors l'agenda **principal** de ce compte : créneaux
libres (freeBusy) et réservation. « Déconnecter » révoque l'accès chez Google. Si l'accès est révoqué
côté Google, la console l'indique (« à reconnecter ») et les demandes de rendez-vous sont transférées.

Sans agenda connecté pour le conseiller du prospect (ni agenda par défaut), la demande est transférée au
conseiller : escalade normale, pas un incident. Diagnostic : `python -m app.cli calendar-check --advisor
<email du conseiller>` (ne réserve rien).

## Brancher Zoom depuis la console (sans `.env`)

**Intégrations → Zoom**, trois modes (effet au prochain rendez-vous, sans redémarrage) :

| Mode | À créer sur marketplace.zoom.us | Effet |
|---|---|---|
| Aucun | — | Rendez-vous réservé sans lien de visioconférence. |
| Compte Zoom de l'école | Application **Server-to-Server OAuth** (Account ID, Client ID, Client secret ; droits : créer des réunions pour les utilisateurs du compte, ex. `meeting:write:meeting:admin`) | Réunion créée au nom du conseiller s'il a un compte Zoom dans l'école, sinon de l'**hôte par défaut**. |
| Compte de chaque conseiller | Application **General** (gérée par l'utilisateur) : Client ID, Client secret, **URL de redirection** affichée dans IAGORA ; droits : `meeting:write:meeting`, `user:read:user` | Chaque conseiller clique **Connecter mon compte Zoom** dans *Mon compte* ; réunion à son nom. Sans compte connecté : rendez-vous sans lien. |

Les secrets sont chiffrés en base et jamais réaffichés. Zoom remplace le jeton de renouvellement à chaque
usage : IAGORA conserve automatiquement le nouveau. Une autorisation révoquée s'affiche « à reconnecter »
et la réservation concernée est transférée au conseiller. Zoom peut exiger une URL de redirection en
HTTPS : utiliser alors l'environnement `dev` publié plutôt que `localhost`.

## Choisir le mode (`CALENDAR_PROVIDER`, ancien réglage par le `.env`)

Ce réglage ne sert que tant qu'aucun agenda n'est enregistré dans la console.


| Valeur | Effet |
|---|---|
| `none` (défaut) | Pas d'agenda : toute demande de rendez-vous est transférée à un conseiller. |
| `demo` | Créneaux **fictifs** et lien fictif (`zoom.example.com`). Recette locale. **Refusé en production.** |
| `google` | Google Calendar du conseiller + réunion Zoom. |

## Règles de disponibilité

Réglables dans `.env` : `CALENDAR_TIMEZONE` (Europe/Paris), `CALENDAR_WORK_DAYS` (`1,2,3,4,5` = lundi à
vendredi), `CALENDAR_WORK_START_HOUR` / `CALENDAR_WORK_END_HOUR` (9 / 18), `CALENDAR_SLOT_MINUTES` (30),
`CALENDAR_MIN_NOTICE_HOURS` (4 : pas de créneau dans les prochaines heures), `CALENDAR_HORIZON_DAYS` (14),
`CALENDAR_BUFFER_MINUTES` (0 : marge autour des rendez-vous existants).
L'agent propose jusqu'à 3 créneaux, sur des jours différents quand c'est possible. Au moment de réserver,
la disponibilité est **revérifiée** : si le créneau a été pris entre-temps, la demande est transférée.

## Google Calendar par compte de service (`.env`, alternative)

L'agenda utilisé est celui du conseiller attribué au prospect (son **email de compte IAGORA** = identifiant
d'agenda). À défaut, l'agenda commun `GOOGLE_CALENDAR_DEFAULT_ID`.

1. Dans Google Cloud : créer un projet, activer **Google Calendar API**, créer un **compte de service** et
   télécharger sa clé JSON (jamais dans Git, S-04).
2. Chaque conseiller **partage son agenda** avec l'adresse du compte de service (`…@….iam.gserviceaccount.com`),
   avec le droit « Apporter des modifications aux événements ».
3. Renseigner dans `.env` la clé **sur une seule ligne**, entre apostrophes :
   ```
   CALENDAR_PROVIDER=google
   GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account", ... }'
   ```
   PowerShell, pour obtenir la ligne : `(Get-Content cle.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress)`.
   Alternative hors Docker : `GOOGLE_SERVICE_ACCOUNT_FILE=/chemin/cle.json`.

Limite connue : un compte de service ne peut pas inviter le prospect à l'événement sans délégation à
l'échelle du domaine. Le prospect reçoit donc son lien **dans la réponse de l'agent** ; l'événement du
conseiller contient son email et le lien.

## Zoom

Application **Server-to-Server OAuth** (marketplace.zoom.us) avec le droit de créer des réunions
(`meeting:write:meeting:admin`, ou `meeting:write:admin` selon l'interface), puis dans `.env` :
```
ZOOM_ACCOUNT_ID=…
ZOOM_CLIENT_ID=…
ZOOM_CLIENT_SECRET=…
ZOOM_HOST_USER=me
```
La réunion est créée au nom du conseiller si son email a un compte Zoom dans l'organisation, sinon au nom de
`ZOOM_HOST_USER`. Sans identifiants Zoom, le rendez-vous est réservé **sans lien** de visioconférence.

## Tester

```powershell
docker compose up -d
docker compose exec backend python -m app.cli calendar-check --advisor conseiller@exemple.com
```
La commande affiche l'état de Google (et le nombre de créneaux trouvés) et de Zoom. **Elle ne réserve rien.**
En mode `demo`, elle liste les créneaux fictifs. Puis, dans la console, un prospect qui demande un rendez-vous
reçoit des créneaux ; son choix crée le rendez-vous (visible dans l'agenda et dans IAGORA).

## Cas d'échec et comportement

| Situation | Comportement |
|---|---|
| `CALENDAR_PROVIDER=none` | Transfert normal, motif « agenda non branché » (escalade, pas incident). |
| Google/Zoom en erreur (réseau, droits) | Transfert, motif « agenda indisponible » (incident). |
| Agenda non partagé avec le compte de service | Erreur explicite demandant de le partager. |
| Aucun créneau libre sur la période | Transfert, motif « aucun créneau ». |
| Créneau pris entre la proposition et le choix | Transfert, motif « réservation impossible ». |
