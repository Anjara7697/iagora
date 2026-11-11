# MISSION 04 — AUDIT BASES DE DONNÉES

Audite le modèle et les usages PostgreSQL/pgvector, MongoDB et Redis sur `dev`.

## Vérifications
- Modèles SQLAlchemy, migrations Alembic et cohérence modèle/migration.
- PK/FK, contraintes, enums, nullabilité, unicité, cascades et intégrité.
- Index, requêtes fréquentes, N+1, pagination et plans d'exécution si disponibles sans charge dangereuse.
- Transactions, isolation, verrous, concurrence et opérations multi-étapes.
- Cohérence des données réparties entre PostgreSQL et MongoDB ; stratégie de compensation/reprise en l'absence de transaction distribuée.
- Schémas MongoDB, indexes, identifiants et requêtes ; cohérence des conversations et agent_runs.
- Usage réel de Redis : cache, rate limit, coordination ou autre ; expiration et comportement si Redis indisponible.
- pgvector : dimensions, embeddings, index, stratégie de mise à jour/suppression et cohérence avec les documents sources.
- Données démo et séparation stricte des données réelles.
- Rétention, anonymisation/effacement, traces et sauvegardes/restauration.
- Évolution des migrations, downgrade, données historiques et compatibilité de déploiement.

## Attention
Ne jamais lancer migration, reset, seed, purge ou restauration pendant l'audit. Ne pas accéder à des bases réelles sans autorisation. Ne pas afficher de données personnelles. Distinguer la conception du schéma des données réellement observées.

## Livrable
Cartographie des entités et stockages, diagramme ER Mermaid si justifié, matrice des relations/contraintes, constats, risques d'intégrité et recommandations de migration sûres.
