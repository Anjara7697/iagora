# Doublons de prospects

Les identifiants d'un prospect (email, téléphone, LinkedIn, Facebook, Instagram) sont uniques (F-05). Un doublon
apparaît quand deux fiches ont été créées séparément pour la même personne (l'une par son email, l'autre par son
téléphone), puis qu'un même lead porte les deux identifiants.

## Repérage

À la réception (`services/prospects.py`, `ingest_prospect`, par toutes les entrées : formulaire, import CSV, Meta,
email), quand les identifiants reçus désignent plusieurs fiches :

- le lead est rattaché à la première fiche trouvée, par ordre de priorité des identifiants (comme avant) ;
- la paire est enregistrée dans `duplicate_candidates` (statut `pending`), avec les identifiants partagés.
  Un rejeu ne crée pas de second signalement ; une paire déclarée distincte n'est plus signalée.

**Rien n'est fusionné automatiquement** (décision d'Anjara du 25/11/2026) : un téléphone ou une adresse partagés
(famille, standard d'entreprise) peuvent relier deux vraies personnes, et une fusion ne se défait pas.

## Trancher

Console : bandeau « N doublons à trancher » sur la liste des prospects, et « Doublon possible » sur la fiche ; le
panneau « Doublons à trancher » montre les deux fiches côte à côte.
API : `GET /duplicates` (filtre `prospect_id`), `POST /duplicates/{id}/merge` (`keep_prospect_id`),
`POST /duplicates/{id}/distinct`.

Conseiller ou administrateur ; un conseiller ne voit et ne tranche que les paires dont les deux fiches sont dans son
périmètre (D-23). L'observateur voit la file sans pouvoir trancher.

**Fusionner** dans la fiche gardée (`services/duplicates.py`) :

- identifiants, nom et programme manquants repris de l'autre fiche ; profil complété (la fiche gardée prime) ;
- interactions, rendez-vous, relances, scores, consentements, canaux et campagnes rattachés à la fiche gardée ; dans
  une même campagne et une même source, le rattachement de la fiche gardée reste (étape, score, conseiller) et reçoit
  l'historique de l'autre ;
- conversations et traces de l'agent (MongoDB) rattachées à la fiche gardée ;
- **une désinscription de l'une des deux fiches s'applique à la fiche fusionnée** et annule ses relances (S-03) ;
- les autres paires en attente qui citaient la fiche absorbée citent la fiche gardée ;
- la fiche absorbée est supprimée ; la paire passe à `merged` avec la fiche gardée, l'auteur et la date, et une
  interaction `prospects_merged` est ajoutée à la fiche gardée.

Refusé (409) si les deux fiches ont une conversation en cours sur le même canal : clôturer l'une d'elles d'abord.
La fusion est rejouable : MongoDB est mis à jour avant PostgreSQL ; si l'étape SQL échoue, la paire reste à
trancher et un nouvel appel termine le travail.

**Distinctes** : la paire passe à `distinct` et ne revient pas.

Un effacement RGPD supprime les paires encore à trancher de la fiche effacée.

## Limites

- Pas de rapprochement par nom ou par adresse proche (« marie.durand@… » et « m.durand@… ») : seulement les
  identifiants exacts d'un même lead.
- Les doublons créés avant la migration 0017 ne sont pas repérés tant qu'aucun nouveau lead ne les relie.
- Une fusion ne se défait pas.
