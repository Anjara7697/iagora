# MISSION 05 — AUDIT SÉCURITÉ & PRIVACY

Réalise une revue défensive du code IAGORA sur `dev`. Ne tente aucune exploitation sur un service réel.

## Vérifications
- Authentification, hachage des mots de passe, sessions/tokens, expiration, révocation et limitation des tentatives.
- Autorisation côté serveur, rôles, accès aux campagnes/prospects/conversations et risque IDOR.
- Isolation des données par campagne, conseiller et éventuelle organisation ; ne pas supposer un modèle multi-tenant.
- CORS, CSRF si applicable, headers, cookies, TLS attendu, rate limiting et validation.
- Secrets : présence, stockage, chiffrement, rotation, logs et exposition frontend ; ne jamais imprimer leur valeur.
- Injection SQL/NoSQL, SSRF, path traversal, upload, désérialisation, XSS, open redirect et sécurité des dépendances.
- Webhooks Meta : signature, vérification, replay, idempotence et validation des événements.
- Jetons de service et intégrations OAuth : scopes, stockage, renouvellement et révocation.
- Données personnelles envoyées au LLM, emails, logs et outils tiers.
- Consentement, STOP/opt-out, désinscription, effacement, minimisation, conservation et auditabilité.
- Mode démo : impossibilité de contacter des personnes réelles ou d'altérer des données réelles.
- Prompt injection, contenu non fiable, outils agentiques et limites des actions automatiques.
- Contrôle humain, arrêt d'urgence et politique d'envoi.

## Méthode
Mapper les menaces aux actifs, acteurs, frontières et impacts. Référencer OWASP ASVS/Top 10 lorsque pertinent, sans produire une checklist artificielle. Toute vulnérabilité doit être démontrée par un chemin de code ou un test sûr.

## Livrable
Résumé des risques, matrice menace/contrôle/preuve, constats P0-P3, mesures déjà en place, décisions nécessitant DPO/responsable, recommandations défensives. Ce rapport ne constitue pas une certification juridique ou un pentest.
