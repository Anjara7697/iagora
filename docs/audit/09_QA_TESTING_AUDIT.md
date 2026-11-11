# MISSION 09 — AUDIT QA & TESTS

Évalue la capacité du dispositif de test à détecter les régressions et à protéger les parcours critiques d'IAGORA.

## Vérifications
- Inventaire Pytest, tests API/services/modèles/migrations/intégrations/workflow.
- Fixtures, fakes, mocks, données de test, isolation, nettoyage et dépendance aux services.
- Tests PostgreSQL/MongoDB réels en CI versus mocks ; couverture et pertinence des assertions.
- Tests Playwright, routes réellement exercées, API simulée, scénarios par rôle et états d'erreur.
- Accessibilité axe-core et tests responsive si présents.
- Contrats API frontend/backend et tests de compatibilité.
- Cas limites : concurrence, doublons, retries, crash, timeout, indisponibilité, événements rejoués.
- Parcours critiques : prospect → qualification → brouillon → validation → envoi ; STOP ; relance ; campagne/affectation ; rendez-vous ; effacement RGPD.
- Tests de sécurité, séparation demo/réel, secrets et permissions.
- Fiabilité CI, versions, dépendances, caches et conditions de déclenchement.
- Couverture réelle des règles métier, pas seulement pourcentage global.
- Tests de performance uniquement si existants ou réalisables sans risque.

## Méthode
Ne pas lancer de tests qui contactent des services réels ou modifient des données partagées. Indiquer commandes sûres et prérequis. Ne pas déclarer une suite verte si elle n'a pas été exécutée.

## Livrable
Matrice risque/scénario/test existant/manquant, qualité des fixtures, angles morts, qualité CI, commandes de validation recommandées et plan de couverture par priorité.
