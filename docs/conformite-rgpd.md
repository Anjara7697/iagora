# Conformité : RGPD, transparence IA et sécurité

L'agent contacte et répond à des **personnes** : IAGORA traite des données personnelles et prend des
décisions automatisées (score, routage). Cette page fait l'inventaire de ce qui est traité, de ce qui est
déjà protégé dans le code et de ce que DATUM doit encore décider.

> Ce document est une base de travail technique. Il ne remplace pas l'avis du DPO ou d'un juriste.

## 1. Données traitées

| Donnée | Stockage | Finalité | Source |
|---|---|---|---|
| Prénom, nom, email, téléphone | PostgreSQL `prospects` | Identifier, recontacter, dédupliquer | Formulaire, email reçu, saisie |
| Identifiants LinkedIn, Facebook, Instagram | PostgreSQL `prospects` | Déduplication entre canaux | Connecteurs (non branchés) |
| Profil de qualification (niveau, domaine, projet, disponibilités, besoin entreprise) | PostgreSQL `prospects.profile` | Ne pas redemander une information, orienter | Messages du prospect |
| Consentement : statut (`unknown`, `granted`, `opted_out`), source, dates ; historique `consent_events` | PostgreSQL | Prouver le droit de contacter, respecter l'opposition | Entrée, STOP, action administrateur |
| Scores, étapes, auteur et motif de chaque changement | PostgreSQL `score_events`, `stage_events` | Traçabilité des décisions (OB-05) | Agent, conseillers |
| Texte des conversations | MongoDB `conversations` | Historique des échanges | Prospect, agent, conseiller |
| Traces d'exécution de l'agent | MongoDB `agent_runs` | Expliquer chaque décision | Agent |
| Rendez-vous | PostgreSQL `appointments`, agenda Google du conseiller | Organiser l'échange | Agent |
| Comptes des utilisateurs internes | PostgreSQL `users` | Accès à la console | Administrateur |

### Destinataires et sous-traitants

| Sous-traitant | Données reçues | Remarque |
|---|---|---|
| Google (Gemini) | Prénom, cible, campagne, profil de qualification, 12 derniers messages, extraits du RAG | **Jamais** email, téléphone ni identifiants (test `test_known_contact_data_never_reaches_the_prompts`) |
| Google (Calendar) | Créneau, email et lien de réunion dans l'événement du conseiller | Si `CALENDAR_PROVIDER=google` |
| Zoom | Sujet et horaire de la réunion | Si configuré |
| Fournisseur de la boîte email | Emails entrants et sortants | IONOS prévu |
| Hébergeur du serveur | Toutes les données (bases) | À confirmer |

## 2. Mesures en place

| Exigence | Mesure | Où |
|---|---|---|
| Droit d'opposition (S-03) | « STOP » détecté **sans modèle**, à l'arrivée de chaque message, sur toutes les entrées (API, email) ; brouillons et relances annulés | `services/inbound.py`, `graph/policy.py` |
| Opposition facile | Phrase STOP et en-tête `List-Unsubscribe` dans chaque email | `services/email_sync.py`, `integrations/email/imap_smtp.py` |
| Respect de l'opposition | Le service d'envoi refuse tout message sortant vers un prospect désinscrit, même validé | `services/email_sync.py` |
| Lever une opposition | Réservé aux administrateurs, tracé ; les anciens messages bloqués restent bloqués | API `/prospects/{id}/consent` |
| Pas de décision exclusivement automatisée (art. 22) | Le score sert à prioriser et router ; aucun prospect n'est exclu automatiquement ; mode assisté par défaut | `graph/policy.py`, [agent-workflow.md](agent-workflow.md) |
| Traçabilité | Chaque décision de l'agent est journalisée avec sa justification ; chaque changement de score ou d'étape a un auteur | `agent_runs`, `score_events`, `stage_events` |
| Minimisation vers le modèle | Pas de coordonnées envoyées au LLM | `graph/prompts.py` |
| Exactitude | Aucun prix, date ou durée inventés : vérification par le code, sinon transfert | `policy.py::ungrounded_claims` |
| Transparence | L'agent se présente comme assistant virtuel et ne se fait jamais passer pour un humain ; la **mention IA** est ajoutée par le code à chaque email rédigé par l'agent, sans pouvoir être supprimée | `prompts.py::IDENTITY`, `services/email_format.py` |
| Pas de scraping (S-08) | Uniquement les API officielles | [decisions.md](decisions.md) D-11 |
| Sécurité | JWT, rôles, argon2, limitation des connexions, garde-fous de production, bases non exposées, secrets hors Git | [architecture.md](architecture.md) |
| Données de test | Domaine réservé `@demo.example.com`, jamais d'envoi réel, purge possible, refus en production | [demo-mode.md](demo-mode.md) |

## 3. Écarts à corriger avant une mise en production réelle

### 3.1 Mention IA systématique (AI Act, art. 50 ; tâche 27 du cahier des charges) : faite

Tout email rédigé par l'agent porte, dans son pied de message, une mention IA ajoutée **par le code** à
l'envoi (`services/email_format.py`), après validation éventuelle du conseiller : l'agent n'a donc pas à
y penser et un conseiller ne peut pas l'oublier. Elle ne peut pas être désactivée ; sa formulation se règle
dans Paramètres → Emails. Les messages écrits à la main par un conseiller ne la portent pas. Des tests
vérifient sa présence dans l'email envoyé (texte et HTML) et son absence sur un message humain.
**À faire valider par DATUM** : la formulation exacte.

### 3.2 Droit à l'effacement et durée de conservation

- Pas d'action pour **supprimer ou anonymiser** un prospect réel avec ses conversations MongoDB, ses
  traces et ses rendez-vous. (`reset-prospect` existe mais est réservé aux adresses de test et refusé en
  production.) Les clés étrangères `ON DELETE CASCADE` depuis `prospects` facilitent la partie SQL ; la
  partie MongoDB reste à écrire.
- Pas de **purge automatique** des prospects inactifs ni des conversations anciennes.

### 3.3 Authentification des emails

Un email dont l'authentification échoue (`dmarc=fail`) est conservé mais sans réponse automatique : c'est
voulu. Les pièces jointes ne sont pas lues.

## 4. Décisions à prendre par DATUM

| Sujet | État actuel | À décider |
|---|---|---|
| Premier contact avec un consentement « inconnu » | Autorisé | Base légale (intérêt légitime ? consentement ?) selon le canal |
| Durée de conservation | Illimitée | Durée pour un prospect inactif, pour les conversations, pour les traces |
| Registre des traitements | — | Ajouter le traitement « prospection assistée par IA » |
| Information des personnes | — | Mention d'information (politique de confidentialité, lien dans les emails) |
| Clé Gemini | À confirmer | Offre payante : les conditions de l'offre gratuite peuvent permettre à Google d'utiliser les données envoyées |
| Lieu d'hébergement | À confirmer | Hébergement dans l'UE, contrats de sous-traitance (Google, Zoom, hébergeur) |
| LinkedIn / Meta | Non branchés | Rester dans les produits API accordés ; leurs conditions encadrent strictement la messagerie automatisée |
| Dépôt public | Public | Le passer en privé au transfert si DATUM le souhaite |

## 5. Sécurité : points à durcir

- Jeton de connexion dans `localStorage` : passer à un cookie `HttpOnly` avant une exposition publique.
- Limitation des connexions en mémoire, par processus : un compteur partagé (Redis) si plusieurs instances.
- Identifiants non sensibles à la casse et changement de mot de passe par l'utilisateur : non faits.
- Jetons de service : faits (`iag_…`, stockés hachés, révocables) ; webhooks LinkedIn et Meta non faits.
