# MISSION 08 — AUDIT IA, AGENT & INTÉGRATIONS

Audite le workflow LangGraph, les adaptateurs LLM/embeddings, le RAG et les connecteurs externes sur `dev`.

## Agent IA
- Graphe, état, nœuds, transitions, reprise, timeout, erreurs et traces d'exécution.
- Séparation graph/agents/integrations et respect des ports.
- Modes assisté/auto/manuel, garde-fous, transfert humain, arrêt d'urgence.
- Prompts, versionnement, variables injectées, contexte, taille et qualité des sorties structurées.
- Hallucinations : interdiction d'inventer prix, dates, conditions et disponibilités (NF-10).
- Prompt injection et séparation instructions/données non fiables.
- Données personnelles : minimisation avant envoi au LLM, logs et conservation.
- Fallback fournisseur, retries, quotas, coût, latence et comportement d'indisponibilité.
- RAG : ingestion, chunking, embeddings, pertinence, seuil, provenance, fraîcheur et suppression.

## Intégrations
Inventorier séparément email IMAP/SMTP, Google Calendar, Zoom, Meta Lead Ads, LLM, embeddings et tout connecteur présent. Pour chaque connecteur : statut de branchement, authentification, scopes, configuration, webhook/polling, validation, retries, rate limits, idempotence, observabilité, tests simulés et tests réels.
LinkedIn est documenté comme non branché ; ne pas le présenter comme actif sans preuve sur dev. Vérifier toute mention d'Apify : la règle de sécurité du dépôt impose les API officielles des plateformes et interdit le scraping ; signaler toute contradiction au responsable, ne pas recommander de contourner cette règle.

## Effets externes
Ne jamais envoyer de vrai email, créer un rendez-vous, appeler un webhook réel ou utiliser un compte tiers pendant l'audit. Vérifier les chemins d'effet de bord statiquement et via fakes/mocks.

## Livrable
Matrice connecteur/capacité/statut/preuve/risque ; cartographie du graphe ; analyse des garde-fous et du RAG ; coûts/quotas observables si documentés ; scénarios d'échec et recommandations.
