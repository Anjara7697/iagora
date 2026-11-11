# MISSION 02 — AUDIT ARCHITECTURE

Évalue la cohérence de l'architecture réellement présente sur `dev`.

## Périmètre
Backend FastAPI, couches API/services/models/schemas, graph LangGraph, agents/runtime, ports/adaptateurs, intégrations, frontend Next.js, frontières entre applications et systèmes de données.

## Vérifications
- Respect des responsabilités et dépendances entre couches.
- Respect de la règle : graph/agents ne dépendent pas directement des SDK de plateformes ; passage par ports et intégrations.
- Cohérence des factories, interfaces, erreurs et configuration.
- Couplage, cycles d'import, duplication de logique, modules trop volumineux.
- Frontières entre API, logique métier, orchestration IA et effets externes.
- Cohérence du modèle d'exécution : processus backend, workers, tâches de fond, verrous/leases.
- Gestion des événements et contrats entre modules.
- Séparation des environnements demo/dev/production.
- Capacité à tester les composants sans dépendances réelles.
- Architecture actuelle versus besoins du MVP ; évolutivité sans sur-ingénierie.
- Conséquences de la coexistence PostgreSQL, MongoDB et Redis.

## Livrable
Rapport avec diagrammes, dépendances problématiques prouvées, bonnes pratiques à préserver, risques de changement et recommandations graduées. Ne recommande pas microservices, event bus ou multi-tenant par principe : justifie le besoin par un problème mesuré.
