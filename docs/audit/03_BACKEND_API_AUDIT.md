# MISSION 03 — AUDIT BACKEND & API

Audite le backend Python/FastAPI sur `dev`, en suivant les parcours HTTP et événements entrants jusqu'aux services, données et intégrations.

## Vérifications
- Contrats REST : méthodes, statuts HTTP, pagination, filtres, tri, schémas Pydantic, compatibilité.
- Authentification, dépendances FastAPI, rôles et autorisations par ressource.
- Séparation routes/services/repositories/models/schemas.
- Validation des entrées, normalisation, erreurs cohérentes et absence de fuite d'informations.
- Transactions SQLAlchemy, sessions async, concurrence et verrous.
- Idempotence, déduplication et traitement des retries.
- Tâches de fond, leases, reprise après crash, états bloqués et files d'échec.
- Gestion des exceptions des connecteurs et timeouts.
- Limites de débit, taille des payloads, upload/import CSV.
- Configuration, logs structurés, corrélation des requêtes et absence de données sensibles.
- Cohérence des migrations et schémas exposés.
- Contrats API consommés par le frontend et tests associés.

## Parcours prioritaires
Création/import prospect, rattachement campagne, affectation, interaction entrante, génération de brouillon, validation/envoi, opt-out/STOP, relance, rendez-vous, effacement RGPD, gestion utilisateurs.

## Livrable
Rapport de constats référencés, endpoints et services couverts, problèmes de contrat, cas de concurrence, risques de reprise, tests manquants et recommandations. Ne pas appeler les API de production ni envoyer de messages.
