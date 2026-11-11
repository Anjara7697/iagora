# MISSION 07 — AUDIT LOGIQUE MÉTIER & PROCESSUS COMMERCIAL

Évalue si le comportement logiciel correspond aux règles métier documentées et si les invariants sont respectés dans tous les parcours.

## Références métier
Lire le cahier des charges disponible, `docs/agent-workflow.md`, `docs/intake.md`, `docs/advisor-workflow.md`, `docs/campaign-ownership.md`, `docs/follow-ups.md`, `docs/sources-leads.md`, `docs/effacement-rgpd.md`, `docs/demo-mode.md` et la passation.

## Vérifications
- Prospect, source, campagne et rattachement : cardinalités, doublons, multi-campagnes et historique.
- Distinction niveau d'intérêt (froid/tiède/chaud) et étape de conversion ; transitions et responsabilités.
- Affectation du responsable de campagne, exceptions individuelles, conseiller inactif et cohérence des filtres.
- Entrées REST/email/import/webhook : normalisation, attribution, déduplication, erreurs et reprise.
- Qualification, score, justification, historique et possibilité de correction humaine.
- Conversation, contexte commercial, transfert, clôture, brouillons et validation concurrente.
- Modes assisté/automatique/manuel, arrêt d'urgence, autorisations et conditions d'envoi.
- STOP, opt-out et consentement à toutes les entrées, relances et sorties.
- Relances : fenêtre, plafond, arrêt après conversion/opposition, idempotence, fuseau horaire et erreurs.
- Rendez-vous : disponibilité réelle, réservation, annulation, timezone, conseiller et confirmation.
- Démo : marquage, filtres, simulation, purge et impossibilité d'effets externes.
- Effacement RGPD et propagation aux stockages et systèmes tiers.

## Livrable
Produire une matrice règle métier → implémentation → tests → écart, diagrammes de cycle de vie utiles, invariants, scénarios limites et décisions à demander au responsable/DATUM. Distinguer défaut logiciel et règle métier non décidée.
