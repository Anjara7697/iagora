# Connecteur email (IONOS)

Le canal email permet à l'agent de **recevoir** les messages des prospects (IMAP) et d'**envoyer** les
réponses validées (SMTP). Le code n'utilise que la bibliothèque standard Python (`imaplib`,
`smtplib`) : aucune dépendance de plus, aucun SDK de plateforme dans `app/graph` (NF-01, NF-02).

## Sécurité par défaut

| Réglage | Défaut | Effet |
|---|---|---|
| `EMAIL_ENABLED` | `false` | La boucle de fond ne démarre pas. |
| `EMAIL_SEND_ENABLED` | `false` | Même activé, **rien n'est envoyé** : les messages validés restent `not_sent`. |
| `EMAIL_SANDBOX_RECIPIENTS` | vide | Si renseigné, l'agent n'écrit **qu'à** ces adresses ; les autres sont `blocked`. |

Le mot de passe (`EMAIL_PASSWORD`) ne se met que dans le `.env` local (S-04). Il n'est jamais journalisé
ni renvoyé par l'API. Utilisez une **boîte de test dédiée**, pas une boîte de production.

## Mise en route

1. Renseigner dans `.env` : `EMAIL_USERNAME`, `EMAIL_PASSWORD` (et vérifier hôtes/ports IONOS).
2. Tester la connexion (rien n'est lu ni envoyé) : `python -m app.cli email-check`
   ou, dans la console, **Intégrations → Tester la connexion**.
3. Activer la réception : `EMAIL_ENABLED=true`, redémarrer. Écrire à la boîte depuis une adresse
   personnelle : un prospect et une conversation apparaissent, l'agent prépare un brouillon
   (mode assisté).
4. Valider le brouillon dans « À traiter » : il passe à `not_sent`.
5. Activer l'envoi, d'abord en bac à sable : `EMAIL_SEND_ENABLED=true` et
   `EMAIL_SANDBOX_RECIPIENTS=votre.adresse@exemple.com`.

`python -m app.cli email-sync` exécute un passage (réception puis envoi) à la demande.

**Dossier à surveiller.** `EMAIL_IMAP_FOLDER` (défaut `INBOX`) accepte un sous-dossier, par exemple
`INBOX/Test`, y compris avec des espaces. Le nom doit être exactement celui renvoyé par le serveur
(`LIST`) ; un dossier inconnu donne une erreur visible dans le diagnostic. Éviter les accents.

## Fonctionnement

**Réception.** Chaque email non lu devient un message du prospect (créé s'il est inconnu, avec un
consentement « le prospect nous a écrit »). L'en-tête `Message-ID` sert d'identifiant d'idempotence :
relire un email ne crée aucun doublon. L'email n'est marqué lu qu'après enregistrement. Sont écartés
(marqués lus, sans réponse) : réponses automatiques, rebonds, listes de diffusion, nos propres messages.
Un email dont l'authentification échoue (`dmarc=fail`) est conservé mais l'agent n'y répond pas.
L'historique cité (`> …`, « Le … a écrit : ») est retiré ; le contenu est borné et traité comme **non
fiable** (aucune pièce jointe, aucun lien suivi).

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
