# Parcours conseiller — lot 4

## Utilisation

1. Ouvrir un prospect reçu. S'il n'a aucune campagne, choisir explicitement sa
   campagne et sa source dans la file « À attribuer » (lot 2).
2. Sur la fiche, chaque rattachement présente son étape, ses scores et son
   conseiller. Un administrateur peut affecter, réaffecter ou retirer le
   conseiller ; seuls les comptes actifs ADMIN/ADVISOR sont proposés.
3. Administrateurs et conseillers peuvent changer l'étape avec un motif non
   vide. La nouvelle étape et son auteur sont enregistrés dans l'historique.
   Un observateur consulte sans action d'écriture.
4. Consulter les interactions paginées et ouvrir l'échange lié. Le contenu
   canonique des messages est dans la conversation, sans copie dans le journal
   SQL. La réponse du conseiller se fait dans Conversations.
5. Utiliser « Mes prospects » et « Moi » dans Conversations pour retrouver les
   prospects du contexte commercial courant. Dans une campagne particulière,
   le filtre conseiller porte sur le contexte courant de cette campagne.
   L'export reprend le filtre conseiller et le choix d'inclure les données fictives.

Les liens directs ouvrent une conversation ou une tâche même hors de la page
chargée ou des filtres affichés. Une tâche qui n'est plus en attente renvoie un
message explicite ; son échange reste consultable dans Conversations.
La file « À traiter » affiche 50 éléments par page ; les interactions, 20.

## Convention des indicateurs

- Une campagne compte un prospect une seule fois dans ses totaux, étapes,
  niveaux et score moyen : le rattachement le plus récemment actif dans **cette
  campagne** fait référence (`last_seen_at` décroissant, puis `id` décroissant).
- Les décomptes par source restent distincts : leur somme peut dépasser le
  total de prospects uniques. Aucun score ni historique de source n'est fusionné.
- La fiche campagne affiche le rattachement de cette campagne, selon la même
  règle. Les identifiants de source et de lien campagne/source sont distincts.
- L'entonnoir global retient le contexte courant de chaque prospect, dont la
  première apparition sur ce rattachement date des 30 derniers jours. Un même
  prospect n'est pas additionné plusieurs fois entre campagnes/sources.
- Les statistiques excluent les données fictives. La liste prospects les
  inclut tant que le filtre d'exclusion n'est pas activé. Les signaux forts du
  tableau de bord continuent de retenir le meilleur score ouvert par prospect.

Cette convention corrige le double comptage ; elle ne crée pas de score consolidé.

## Vérification et limites

Les tests API couvrent le parcours réception → attribution → affectation →
réponse conseiller → étape → historique/indicateurs, les rôles, les liens
directs et le cas d'un prospect multisource. Les tests navigateur vérifient les
formulaires et parcours avec API simulée ; ils ne prouvent pas une livraison email.

L'affectation administrative peut désormais se définir au niveau de la campagne,
avec héritage et exceptions : voir [affectation par campagne](campaign-ownership.md). Une
réaffectation conserve les interactions, scores et événements d'étape ; son
auteur est journalisé côté serveur, sans nouveau journal d'affectation en base.
Les intégrations de rendez-vous et la recette IONOS restent des lots séparés.

La construction de la file de tâches et des décisions traitées conserve la
limite existante de 500 conversations examinées. La pagination parcourt cette
fenêtre ; les liens directs vers une tâche en attente ciblent sa conversation et
ne dépendent pas de cette fenêtre. Une file de volume supérieur demandera une
requête agrégée et des compteurs exhaustifs avant exploitation à cette échelle.
