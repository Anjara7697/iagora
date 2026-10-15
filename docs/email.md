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

## Limites connues

- Un message resté `sending` après un arrêt brutal du serveur n'est pas repris automatiquement
  (on préfère ne rien renvoyer que d'envoyer deux fois) : à vérifier à la main.
- Plusieurs emails rapprochés du même prospect reçoivent une réponse chacun.
- Pas encore de gestion des pièces jointes ni du texte HTML riche en sortie (texte brut).
