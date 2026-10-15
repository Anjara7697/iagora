# Entrées, attribution et contexte commercial (lot 2)

## Parcours

Une réception REST (`POST /prospects`, ou interaction entrante) est conservée dans SQL puis
raccordée à une conversation sur son canal déclaré. Son message est stocké dans MongoDB ;
`interactions.conversation_ref` fait le lien et le contenu SQL est vidé après enregistrement.
Le canal n'est jamais inventé : une entrée sans canal est enregistrée, mais ne peut pas déclencher
une conversation automatique tant que son canal n'est pas renseigné dans le parcours d'entrée.

Le rejeu avec le même identifiant externe conserve l'entrée originale : il ne réapplique pas les
informations, le consentement ou la date d'activité d'une ancienne campagne. Un identifiant externe
appartenant à un autre prospect donne une erreur 409. Sans identifiant externe, deux réceptions sont
deux événements distincts, même si elles concernent le même prospect.

## À attribuer

Un nouvel expéditeur email n'est pas rattaché arbitrairement à une campagne. Les prospects sans
rattachement sont accessibles par **Prospects → À attribuer** (`pending_campaign=true`). Le compteur
est calculé côté base, avant pagination. L'export CSV conserve ce filtre.

Un conseiller ou administrateur choisit la campagne et sa source depuis la fiche prospect :
`POST /prospects/{id}/campaigns` avec `campaign_id` et `source_id`. La source doit appartenir à une
campagne active et être active. L'attribution est tracée, rejouable sans doublon et n'enregistre
aucune fausse réception. Un observateur conserve un accès en lecture.

Une cible unique de campagne complète une cible prospect absente. Une cible déjà connue n'est
pas écrasée. L'attribution déclenche le traitement des conversations ouvertes, si la réponse
automatique est activée. STOP, le mode manuel et le transfert humain gardent leur priorité.

## Contexte partagé

Le moteur, la boîte de réception, ses filtres d'affectation et « À traiter » utilisent le même
rattachement : `last_seen_at` décroissant, puis `id` décroissant en cas d'égalité. La fiche indique
`current_membership_id`, la campagne et la source retenues. Une ancienne réception rejouée ne
change donc pas ce contexte.

Les scores et étapes restent propres à chaque `campaign_source_id` : deux sources de la même
campagne peuvent porter deux rattachements. Ce lot ne fusionne pas leurs historiques et ne modifie
pas les unités des statistiques de campagne. Le contexte est celui de l'activité commerciale
actuelle du prospect ; il n'est pas figé historiquement pour chacune de ses conversations.

## Déclenchement et reprise

- `AGENT_AUTO_REPLY=true` active les traitements immédiats et le worker de reprise au démarrage.
- Une demande persistante `agent_events` est identifiée par conversation et message entrant
  (ou `first` pour un premier contact sans message). Les réceptions email mettent la demande en
  file avant de marquer le mail lu. Les endpoints REST la mettent en file avant leur réponse.
- Le worker reprend au plus 50 demandes dues par passage, toutes les 10 secondes. Les demandes
  différées sont réexaminées après 60 secondes, notamment après un arrêt d'urgence ou une panne.
- Sans rattachement actif, l'agent ne qualifie ni n'écrit : la réception reste disponible pour
  attribution. La commande manuelle exige aussi un rattachement.
- Une exécution terminée est réutilisée lors d'un rejeu, y compris si le brouillon a été refusé
  ensuite. La régénération explicite reste possible depuis la console.
- Les exécutions d'une conversation partagent un bail MongoDB à propriétaire unique, renouvelé
  toutes les 30 secondes (expiration à 90 secondes), en plus du verrou local. La perte du bail
  interrompt l'exécution. Le bail est libéré à la fin du traitement.
- Un événement dépassé par un message plus récent est marqué comme remplacé ; une conversation
  supprimée, clôturée, transférée ou désinscrite ne reçoit pas de nouvelle réponse automatique.

La file ne fournit pas de transaction distribuée entre SQL, MongoDB, LLM et SMTP. Une panne en
plein workflow peut nécessiter une vérification des traces avant reprise. Ce lot évite la répétition
d'une exécution déjà terminée ; il ne promet pas une exécution transactionnelle des effets partiels.
Les limites de livraison SMTP du lot 1 restent applicables.
