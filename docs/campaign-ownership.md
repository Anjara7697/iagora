# Affectation par campagne

Un administrateur définit le **responsable de campagne** depuis sa fiche.
Les conseillers et observateurs consultent ce responsable sans pouvoir le modifier.
Le responsable est un compte actif ADMIN ou ADVISOR ; aucune affectation automatique
par tour de rôle ou par charge de travail n'est appliquée.

## Nouveaux prospects

Chaque nouveau rattachement reçoit le responsable de sa campagne. Cela s'applique
à la réception REST/email une fois attribuée et à l'attribution manuelle depuis
la file « À attribuer ». Un email inconnu sans campagne reste à attribuer.

L'exception individuelle d'un prospect dans une campagne s'applique à toutes ses
sources, y compris une nouvelle source reçue plus tard. Ses autres campagnes ne
sont pas modifiées. L'étape et les scores restent propres à chaque source.

## Changement du responsable

L'administrateur doit choisir explicitement une politique :

- **Transférer les prospects suivant la règle de campagne** : mettre à jour leurs
  conseillers ; conserver les exceptions individuelles.
- **Conserver les affectations actuelles** : figer les attributions existantes
  comme exceptions, y compris celles sans conseiller ; les nouveaux prospects
  sans exception suivent le nouveau responsable.

Retirer le responsable avec la première politique rend les prospects hérités
non affectés. Les exceptions restent inchangées. Rejouer exactement le responsable
courant ne modifie pas les attributions.

Dans la fiche prospect, une affectation individuelle crée une exception pour ce
prospect dans cette campagne, sur toutes ses sources. « Suivre le responsable de
campagne » retire l'exception et reprend la règle courante.

Si le responsable devient inactif ou perd son rôle de conseiller/administrateur,
la fiche campagne le signale. Les nouveaux prospects sans exception restent non
affectés jusqu'à la correction ; les affectations existantes restent visibles et
ne sont pas déplacées silencieusement.

## Visibilité et cohérence

« Mes campagnes » filtre le responsable de campagne. « Mes prospects » et « Moi »
dans Conversations utilisent l'affectation du contexte commercial courant, qui
peut être une exception. La conversation affiche le nom du conseiller affecté ;
un prospect multicampagne conserve un conseiller par parcours, sans fusion.

Les écritures verrouillent la campagne pour sérialiser changement du responsable,
création de rattachement et exception individuelle. Un transfert n'efface ni
conversation, ni interaction, ni score, ni événement d'étape ; il ne change pas
la date d'activité qui détermine le contexte commercial. L'auteur et la politique
du changement sont journalisés côté serveur, sans nouveau journal d'affectation
dans l'interface.

## Migration et recette

La migration Alembic `0009` ajoute le responsable et l'indicateur d'exception.
Les campagnes existantes démarrent sans responsable. Les attributions individuelles
non nulles sont préservées comme exceptions ; les rattachements sans conseiller
peuvent suivre une future affectation de campagne. Si les anciennes sources d'un
même prospect avaient des conseillers différents, leurs choix sont conservés ;
une modification individuelle explicite les harmonise dans cette campagne.

Avant application en exploitation, utiliser la procédure habituelle de sauvegarde
et migration. Aucun déploiement n'est réalisé par cette modification.

Les tests API couvrent héritage, exceptions multisources, indépendance des campagnes,
transfert, conservation, retrait, retour à l'héritage, droits et comptes inactifs.
Le test de concurrence s'exécute en CI sur PostgreSQL réel. Les tests navigateur
vérifient les choix explicites, erreurs et contrôles par rôle avec API simulée.
