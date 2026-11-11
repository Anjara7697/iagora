# MISSION 11 — CONSOLIDATION & FEUILLE DE ROUTE

Cette mission ne s'exécute qu'après validation de la découverte et réception des audits spécialisés.

## Objectif
Consolider les constats sans doublons, arbitrer les contradictions et proposer un plan d'amélioration progressif, sûr et utile au produit.

## Entrées
Tous les rapports spécialisés, la découverte, les documents métier et la dette déjà reconnue. Chaque constat doit conserver son ID d'origine et sa preuve.

## Travail demandé
1. Dédupliquer les constats ; relier les constats de cause commune sans effacer les preuves.
2. Identifier les dépendances entre corrections.
3. Séparer :
   - correction nécessaire (bug/risque confirmé) ;
   - amélioration recommandée (fonctionnement acceptable mais perfectible) ;
   - évolution future (capacité non nécessaire au MVP actuel).
4. Identifier les risques préalables à un pilote réel avec DATUM.
5. Identifier les décisions qui appartiennent au responsable métier, DPO, équipe DATUM ou responsable technique.
6. Estimer la complexité S/M/L/XL et le risque de régression.
7. Proposer des lots petits et vérifiables, sans imposer une réécriture.
8. Définir les critères d'acceptation et les tests de non-régression par lot.
9. Protéger les invariants : consentement/STOP, contrôle humain, absence d'hallucination sur les faits commerciaux, données demo isolées, permissions, traçabilité et intégrité des données.
10. Signaler les éléments qui ne doivent pas être modifiés avant une décision ou un test réel.

## Priorisation
- P0 : action immédiate avant toute exposition.
- P1 : avant pilote ou usage réel concerné.
- P2 : avant montée en charge ou extension fonctionnelle.
- P3 : confort et dette non bloquante.
La priorité doit être justifiée par un risque utilisateur ou opérationnel concret.

## Format du plan
- Résumé exécutif et état de confiance global.
- Risques bloquants pour le pilote.
- Tableau consolidé : ID, domaine, priorité, preuve, dépendances, lot, complexité, validation.
- Lots ordonnés avec objectif, périmètre, exclusions, critères d'acceptation et tests.
- Décisions humaines requises.
- Éléments à préserver.
- Évolutions futures séparées du périmètre correctif.
- Incertitudes restantes.

## Limites
Ne crée pas automatiquement des issues, branches, PR ou tâches Notion. Ne modifie pas le code. Cette feuille de route est une proposition à valider par le responsable.
