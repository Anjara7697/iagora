# Mode démo et simulateur

Le simulateur et le jeu de démonstration (`seed-demo`) créent des **prospects fictifs** dont l'adresse
est en `@demo.example.com` (domaine réservé, jamais livrable). C'est la marque de reconnaissance de
toutes les données fictives.

- **Repérage** : l'API expose `is_demo` sur chaque prospect ; l'interface affiche un badge « Fictif »
  (prospects, conversations, à traiter, fiches, campagnes).
- **Filtre** : `GET /prospects?demo=exclude|only|all` ; case « Masquer les prospects fictifs » dans la liste.
- **Aucun envoi réel** : le connecteur email bloque toute adresse fictive (`blocked`, motif « adresse fictive »).
- **Purge** : `GET /demo` (compteurs) et `DELETE /demo/data` (administrateur, **refusé en production**)
  suppriment les prospects fictifs, leurs conversations et les décisions de l'agent ; bouton dans le simulateur.
- **Simulateur** : bandeau « MODE DÉMO » permanent, réservé aux conseillers et administrateurs ; à désactiver
  en production avec `NEXT_PUBLIC_ENABLE_SIMULATOR=false` au build.

Limite connue : les prospects fictifs sont rattachés à une vraie campagne (le simulateur choisit une
campagne existante) et comptent donc dans ses statistiques tant qu'ils ne sont pas purgés.
