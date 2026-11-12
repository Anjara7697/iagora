# Base de données

`IA GORA.sql` / `.png` / `.pdf` : schéma conceptuel d'origine (export dbdiagram), conservé tel quel.
Source de vérité du schéma réel : les modèles `backend/app/models/` et les migrations `backend/alembic/versions/`.

## Écarts par rapport au schéma d'origine, et pourquoi

| Changement | Raison (cahier des charges) |
|---|---|
| `prospects` : `consent_status`, `consent_source`, `consent_given_at`, `opted_out_at` + table `consent_events` | S-03 : statut, source, date du consentement, opt-out et sa date ; historique tracé (S-02, S-07) |
| `prospects` : `origin_channel_id`, `current_channel_id`, `target_id` | F-07 : canal d'origine et canal courant stockés séparément ; cible du prospect (§9.5) |
| `prospects.profile` (JSONB) | F-09 : conserver les réponses de qualification pour ne jamais les redemander |
| Unicité : `lower(email)`, `phone` (format international E.164, pays par défaut `PHONE_DEFAULT_REGION`, migration 0013), `linkedin_id`, `facebook_id`, `instagram_id`, `(channel_id, channel_identifier)` | F-05 : aucun doublon sur les identifiants disponibles |
| `campaign_prospects` : `first_seen_at`, `last_seen_at`, unicité `(campaign_source_id, prospect_id)` | F-03 : dates de première / dernière apparition |
| Table `stage_events` | F-13 : chaque changement d'étape est horodaté |
| `campaigns.start_date` / `end_date` | §9.5 : dates de début et de fin de campagne |
| `interactions.intent` / `sentiment` | §9.5 |
| `appointments.zoom_meeting_id` | §10.2 : annuler / consulter une réunion Zoom (`cancel_meeting`, `get_meeting`) |
| Unicité `(conversation_id, external_message_id)` et `(channel_id, external_id)` | NF-05 / §10.3 : idempotence (webhooks rejoués, relève IMAP répétée) |
| `users.is_active`, unicité `username` / `email` | Gestion des comptes (S-06) |
| Horodatages `timestamptz` (et non `timestamp`) | Rendez-vous et relances : éviter toute ambiguïté de fuseau |
| Tables `conversations` et `messages` supprimées de PostgreSQL ; `interactions.conversation_ref` ajouté | §9.5 : conversations dans MongoDB. Une seule source de vérité pour le contenu (voir ci-dessous) |
| `score_events.new_value` et `actor_user_id`, `stage_events.actor_user_id` | OB-05, F-11 : valeur résultante (« passe de 52 à 82 ») et auteur de chaque décision (`NULL` = automatique) |
| Énumérations en texte + contrainte CHECK | Valeurs de F-12, F-13, S-06 ; liste d'étapes modifiable par migration (F-13) |
| `ON DELETE CASCADE` depuis `prospects` ; `SET NULL` pour les conseillers | S-02 (effacement) ; F-22 (réaffectation sans perte d'historique) |
| Index des requêtes fréquentes : `follow_ups.prospect_id`, `interactions.conversation_ref`… (migration 0008) | Annulation des relances, entonnoir, journal d'une conversation |
| `campaigns.responsible_advisor_id` (`SET NULL`) et `campaign_prospects.assignment_is_override` (migration 0009) | F-22 : un responsable par campagne ; une affectation manuelle d'un prospect reste une exception visible |
| `users.must_change_password` et `password_changed_at` (migration 0010) | S-06 : mot de passe temporaire à changer à la première connexion ; sessions antérieures au changement refusées |
| Table `erasure_records` : empreintes SHA-256 de l'email et du téléphone, motif, `keep_suppressed`, auteur (migration 0011) | S-02 : trace d'un effacement RGPD sans conserver la donnée ; liste d'opposition qui empêche une réimportation |
| `follow_ups.attempts` (migration 0012) | AUDIT-BIZ-005 : une relance en erreur technique n'est plus retentée sans limite |
| Téléphones normalisés en E.164 (migration 0013) | F-05 : `06 11 22 33 44` et `+33611223344` désignent le même prospect |

## Conversations dans MongoDB

Collection `conversations`, un document par conversation :

```json
{
  "_id": "ObjectId", "prospect_id": 12, "channel": "email", "status": "open | handed_off | closed",
  "summary": null, "started_at": "...", "last_message_at": "...", "closed_at": null,
  "messages": [
    {"id": "uuid", "role": "prospect | agent | advisor", "content": "...",
     "external_message_id": null, "created_at": "...", "metadata": {}}
  ]
}
```

- Index : `(prospect_id, last_message_at)` ; unique partiel `(prospect_id, channel)` pour les statuts `open` et `handed_off`.
- Pas de transaction entre MongoDB et PostgreSQL : le message est écrit dans MongoDB (opération atomique, idempotente sur
  `external_message_id`), puis journalisé dans `interactions`. Un rejeu répare un journal manquant.
- Limite : les messages sont embarqués dans le document (16 Mo maximum par document). Largement suffisant pour une
  conversation commerciale ; à revoir si des conversations de plusieurs milliers de messages apparaissaient.

## Autres collections MongoDB

| Collection | Contenu | Index |
|---|---|---|
| `agent_runs` | Une décision de l'agent par exécution (trace, scores, action) | `(prospect_id, started_at)`, `(conversation_id, started_at)`, `event_id` |
| `agent_events` | File des réponses à préparer, reprise après redémarrage | `(completed, next_attempt_at)` |
| `meta_lead_events` | Leads Meta reçus (idempotence sur `leadgen_id`), en attente ou en échec | — |
| `service_tokens` | Jetons de service (formulaire, n8n) : seule l'empreinte SHA-256 est gardée | unique `hash` (AUDIT-DATA-009) |
| `settings` | Réglages de la console (mode de l'agent, paramètres, connecteurs chiffrés) | — |
| `leases` | Baux qui sérialisent les boucles de fond et la réservation d'un créneau | — |

L'authentification MongoDB est active en production (`deploy/compose.prod.yml`) ; elle reste désactivée en
développement local.

## Redis

Redis n'est utilisé que par le contrôle de santé (`/health/ready`), et seulement si `REDIS_URL` est renseigné :

- en développement local, `docker-compose.yml` le démarre ;
- en production, il n'est pas déployé (`REDIS_URL: ""` dans `deploy/compose.prod.yml`) : rien n'en dépend.

Il est gardé pour un usage prévu : partager entre processus la limitation des tentatives de connexion
(AUDIT-SEC-005, lot 10). D'ici là, aucune donnée n'y est écrite.

## Base de connaissances (RAG, migration 0006)

- `kb_documents` : un document source validé (`slug` unique = nom du fichier, `title`, `target_code` — NULL pour
  une information valable pour tous les programmes —, `content_hash`, `embedding_model`, `is_demo`).
- `kb_chunks` : les extraits d'un document (`heading`, `text`) et leur vecteur `embedding` (type pgvector
  `vector(768)`). Suppression en cascade avec le document.

La dimension 768 est fixée par le schéma : en changer exige une migration et `kb-reindex`. Les tests locaux sur SQLite
stockent le vecteur en JSON et calculent la similarité en Python ; PostgreSQL utilise l'opérateur `<=>` (cosinus).
