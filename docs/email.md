# Connecteur email (toute boîte IMAP/SMTP)

Le canal email permet à l'agent de **recevoir** les messages des prospects (IMAP) et d'**envoyer** les
réponses validées (SMTP). Le code n'utilise que la bibliothèque standard Python (`imaplib`,
`smtplib`) : aucune dépendance de plus, aucun SDK de plateforme dans `app/graph` (NF-01, NF-02).

## Sécurité par défaut

| Réglage | Défaut | Effet |
|---|---|---|
| Relève (`EMAIL_ENABLED`) | désactivée | Rien n'est lu tant qu'elle n'est pas cochée. |
| Envoi (`EMAIL_SEND_ENABLED`) | désactivé | **Rien n'est envoyé** : les messages validés restent `not_sent`. |
| Bac à sable (`EMAIL_SANDBOX_RECIPIENTS`) | vide | Si renseigné, l'agent n'écrit **qu'à** ces adresses ; les autres sont `blocked`. |

Le mot de passe est saisi dans la console (chiffré en base) ou, à défaut, dans le `.env` du serveur (S-04).
Il n'est jamais journalisé ni renvoyé par l'API. Pendant les essais, utilisez une **boîte de test dédiée**.

## Mise en route (console, sans `.env`)

Un administrateur ouvre **Intégrations → Messagerie → Paramètres de la boîte** :

1. Saisir l'adresse et le mot de passe de la boîte, puis **Détecter les serveurs**. La détection marche
   pour n'importe quelle boîte : fournisseur connu (Gmail, Outlook, Orange…), hébergeur reconnu d'après
   les serveurs MX du domaine (OVHcloud, IONOS, Google Workspace, Microsoft 365, Gandi…), base publique de
   Thunderbird, sinon paramètres devinés. Tout reste modifiable (« Serveurs (avancé) »).
2. **Tester ces paramètres** : connexion IMAP et SMTP, rien n'est lu ni envoyé, rien n'est enregistré.
   Le test liste les dossiers de la boîte : choisir le **dossier surveillé** dans la liste (noms exacts,
   accents compris).
3. Renseigner le bac à sable, cocher « Relever la boîte » puis, plus tard, « Envoyer réellement ».
4. **Enregistrer**. La relève prend la nouvelle configuration au passage suivant, **sans redémarrage**.

Le mot de passe est chiffré en base (clé `CONNECTORS_SECRET_KEY`, à défaut dérivée de `JWT_SECRET_KEY` :
changer cette clé oblige à ressaisir le mot de passe) et n'est jamais renvoyé par l'API. Gmail, Yahoo et
iCloud exigent un **mot de passe d'application** ; Microsoft 365 refuse souvent la connexion par mot de
passe (OAuth : lot suivant).

Les variables `EMAIL_*` du `.env` restent une valeur de départ : elles s'appliquent tant qu'aucune boîte
n'est enregistrée dans la console (« Oublier cette boîte » y revient).

En ligne de commande : `python -m app.cli email-check` (test) et `email-sync` (un passage immédiat).

## Fonctionnement

**Réception.** Chaque email non lu devient un message du prospect (créé s'il est inconnu, avec un
consentement « le prospect nous a écrit »). L'en-tête `Message-ID` sert d'identifiant d'idempotence :
relire un email ne crée aucun doublon. L'email n'est marqué lu qu'après enregistrement. Sont écartés
(marqués lus, sans réponse) : réponses automatiques, rebonds, listes de diffusion, nos propres messages.
Un email dont l'authentification échoue (`dmarc=fail`) est conservé mais l'agent n'y répond pas.
L'historique cité (`> …`, « Le … a écrit : ») est retiré ; le contenu est borné et traité comme **non
fiable** (aucun lien suivi). Les petits PDF et fichiers texte peuvent fournir des indices pour la
file **Candidatures** ; voir [candidatures.md](candidatures.md). Les documents originaux restent dans
la boîte email.

**Envoi.** Les messages `delivery: not_sent` (brouillons validés, réponses d'un conseiller, réponses
directes en mode automatique) sont envoyés un par un, dans le même fil (`Re:`, `In-Reply-To`,
`References`), avec une mention de désinscription (`STOP`) et l'en-tête `List-Unsubscribe`. Chaque message
est réclamé de façon atomique avant l'envoi : jamais deux envois. Jamais vers un prospect désinscrit.

Cycle de vie : `not_sent → sending → sent | failed | blocked`. Un refus du serveur est retenté
(3 essais), puis le message passe à `failed` et reste visible dans la console.

## Refaire un essai sans tout effacer

`python -m app.cli reset-prospect <adresse> [--unread]` supprime **un seul** prospect de test avec ses
conversations, décisions de l'agent, rendez-vous, relances et consentements ; l'adresse peut ensuite refaire
tout le parcours. `--unread` remet en « non lu » ses emails dans le dossier surveillé, pour qu'ils soient
relus. Garde-fous : **refusé en production**, et uniquement pour une adresse fictive (`@demo.example.com`)
ou listée dans `EMAIL_SANDBOX_RECIPIENTS` (adresses de test). Le reste de la base n'est pas touché.

```powershell
docker compose exec backend python -m app.cli reset-prospect moi@exemple.com --unread
docker compose exec backend python -m app.cli email-sync
```

## Arrêt d'urgence et désinscription (lot 1)

- Le mode **Manuel** suspend la génération, les relances et les emails de l'agent en attente,
  même déjà validés. Ils restent `not_sent`, sans consommer d'essai. La réception continue,
  notamment pour enregistrer les demandes STOP. Les réponses écrites par un conseiller
  restent expédiables, avec les mêmes contrôles de consentement et de bac à sable.
- La reprise en **Assisté** réautorise les messages déjà validés. Un ancien message automatique
  sans validation est remis en brouillon dans « À traiter » avant tout envoi. L'accusé de transfert
  fixe conserve son exemption de validation ; il est lui aussi suspendu en mode Manuel.
- STOP est traité sans LLM dans le service d'ajout des messages (premier message inclus),
  ainsi que sur les entrées REST prospects/interactions. Un rejeu répare une désinscription
  interrompue après l'écriture du message, sans ajouter de doublon ni remplacer un nouveau brouillon.
- Une désinscription annule les brouillons et relances et bloque définitivement les messages
  déjà prêts à envoyer : un consentement ultérieur ne réactive pas ces anciens messages.
- Avant chaque transmission, le transport relit la conversation, le consentement et le mode.
  Un email dont la transmission SMTP a déjà commencé ne peut pas être rappelé. Un arrêt brutal
  pendant la transmission nécessite toujours la vérification manuelle décrite ci-dessous.

## Limites connues

- Un message resté `sending` après un arrêt brutal du serveur n'est pas repris automatiquement
  (on préfère ne rien renvoyer que d'envoyer deux fois) : à vérifier à la main.
- Plusieurs emails rapprochés du même prospect reçoivent une réponse chacun.
- Pas encore de gestion des pièces jointes ni du texte HTML riche en sortie (texte brut).
