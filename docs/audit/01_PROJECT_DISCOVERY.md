# MISSION 01 — PROJECT DISCOVERY

Utiliser avec `00_MASTER_PROMPT.md`. Périmètre : branche `dev` uniquement.

## Objectif
Prendre connaissance d'IAGORA comme un nouveau responsable technique. Produire une cartographie factuelle avant tout audit spécialisé. Ne pas faire de refonte ni déduire l'existence d'une fonctionnalité à partir d'une maquette ou d'un document ancien.

## Étapes
1. Relever SHA de `dev`, date, état du dépôt et derniers commits. Ne pas changer de branche.
2. Lire `AGENTS.md`, `README.md`, `docs/README.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/passation.md`, `docs/limites-et-dette.md`, puis les documents métier/techniques pertinents.
3. Inventorier les dossiers, modules, applications, dépendances, scripts, variables d'environnement (noms uniquement), workflows CI/CD et tests.
4. Cartographier frontend, backend, agent LangGraph, services, adaptateurs, bases et déploiement.
5. Reconstituer les flux : entrée prospect, campagne/source, qualification, conversation, décision agent, brouillon/validation/envoi, relance, rendez-vous, effacement RGPD.
6. Identifier pour chaque intégration son statut réel : code présent, configurée, testée en simulation, testée avec service réel, non branchée, inconnue.
7. Comparer Notion, documentation du dépôt et code. Noter la date et la source de chaque divergence.
8. Lister les zones sensibles et les dépendances croisées.

## Questions à résoudre
- Quelles fonctions sont réellement implémentées sur dev ?
- Quels traitements sont synchrones, asynchrones ou périodiques ?
- Quel composant détient la responsabilité de chaque règle métier ?
- Où et comment sont stockés prospects, interactions, conversations, runs et documents ?
- Comment sont gérés les modes assisté/auto/manuel et l'arrêt d'urgence ?
- Quelles actions ont un effet externe ?
- Quelles fonctionnalités sont simulées ou non testées en conditions réelles ?
- Quelles limites sont déjà reconnues dans la documentation ?

## Livrable
Créer le rapport `PROJECT_DISCOVERY.md` seulement si la création documentaire a été autorisée. Inclure :
- identité du commit audité ;
- stack observée et structure du dépôt ;
- diagramme Mermaid des composants ;
- inventaire des modules avec statut ;
- diagrammes Mermaid des flux principaux ;
- inventaire des intégrations et niveau de validation ;
- cartographie des données et systèmes de stockage ;
- couverture de tests connue ;
- écarts documentation/code/Notion ;
- risques préliminaires et questions ouvertes ;
- recommandation d'ordre des audits.

Ne lancer aucun audit spécialisé tant que le responsable n'a pas validé cette cartographie.
