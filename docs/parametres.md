# Paramètres de la console

**Paramètres** (administrateur) regroupe les réglages de l'agent qui demandaient auparavant de modifier le
`.env` du serveur. Ils s'appliquent **sans redémarrage** : l'API les relit à chaque requête et les tâches
de fond (relances, relève email, file des réponses) à chaque passage. Les valeurs du `.env` restent la
valeur de départ ; « Revenir aux valeurs du serveur » efface les réglages de la console.

| Section | Réglages |
|---|---|
| Intelligence artificielle | fournisseur (Gemini, OpenAI), modèle principal, **modèle de secours**, clé d'API (chiffrée, jamais réaffichée), créativité ; bouton **Tester le modèle** (réglages saisis, non enregistrés) |
| Agent et relances | réponse automatique à chaque nouveau message, fenêtre horaire des relances, semaine seulement, nombre maximum de relances sans réponse |
| Emails | mention de désinscription en bas des messages, fréquence de relève, création d'un prospect pour un expéditeur inconnu |
| Disponibilités des rendez-vous | jours ouvrés, début/fin de journée, durée d'un rendez-vous, délai minimum, horizon, marge entre rendez-vous, fuseau horaire |

**Modèle de secours.** Si le modèle principal reste indisponible (surcharge 503, quota) après ses nouveaux
essais, la même demande part sur le modèle de secours (même fournisseur, même clé) avant tout transfert au
conseiller. Une clé refusée ne déclenche pas le secours (le problème n'est pas la charge).

Restent côté serveur : le modèle d'**embeddings** de la base de connaissances (en changer impose
`kb-reindex`), les connexions aux bases, `JWT_SECRET_KEY` / `CONNECTORS_SECRET_KEY`, `CORS_ORIGINS` et les
réglages de déploiement.

Voir aussi : `docs/email.md` (boîte email), `docs/calendar.md` (agenda et Zoom), Équipe (comptes).
