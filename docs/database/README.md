# Base de données

`IA GORA.sql` / `.png` / `.pdf` : schéma conceptuel d'origine (export dbdiagram), conservé tel quel.
Source de vérité du schéma réel : les modèles `backend/app/models/` et les migrations `backend/alembic/versions/`.

## Écarts par rapport au schéma d'origine, et pourquoi

| Changement | Raison (cahier des charges) |
|---|---|
| `prospects` : `consent_status`, `consent_source`, `consent_given_at`, `opted_out_at` + table `consent_events` | S-03 : statut, source, date du consentement, opt-out et sa date ; historique tracé (S-02, S-07) |
| `prospects` : `origin_channel_id`, `current_channel_id`, `target_id` | F-07 : canal d'origine et canal courant stockés séparément ; cible du prospect (§9.5) |
| `prospects.profile` (JSONB) | F-09 : conserver les réponses de qualification pour ne jamais les redemander |
| Unicité : `lower(email)`, `phone`, `linkedin_id`, `facebook_id`, `instagram_id`, `(channel_id, channel_identifier)` | F-05 : aucun doublon sur les identifiants disponibles |
| `campaign_prospects` : `first_seen_at`, `last_seen_at`, unicité `(campaign_source_id, prospect_id)` | F-03 : dates de première / dernière apparition |
| Table `stage_events` | F-13 : chaque changement d'étape est horodaté |
| `campaigns.start_date` / `end_date` | §9.5 : dates de début et de fin de campagne |
| `interactions.intent` / `sentiment` | §9.5 |
| `appointments.zoom_meeting_id` | §10.2 : annuler / consulter une réunion Zoom (`cancel_meeting`, `get_meeting`) |
| Unicité `(conversation_id, external_message_id)` et `(channel_id, external_id)` | NF-05 / §10.3 : idempotence (webhooks rejoués, relève IMAP répétée) |
| `users.is_active`, unicité `username` / `email` | Gestion des comptes (S-06) |
| Horodatages `timestamptz` (et non `timestamp`) | Rendez-vous et relances : éviter toute ambiguïté de fuseau |
| Énumérations en texte + contrainte CHECK | Valeurs de F-12, F-13, S-06 ; liste d'étapes modifiable par migration (F-13) |
| `ON DELETE CASCADE` depuis `prospects` ; `SET NULL` pour les conseillers | S-02 (effacement) ; F-22 (réaffectation sans perte d'historique) |

## Points à trancher (voir la PR)

1. **Conversations en double** : le cahier des charges place les conversations dans MongoDB (§9.5), le schéma d'origine dans PostgreSQL (`conversations`, `messages`). Les tables PostgreSQL sont conservées pour l'instant ; MongoDB reste disponible. À décider avant le workflow de conversation (S4).
2. **Authentification** : `users` n'a pas de mot de passe ni de jeton ; à traiter avec S-06 (étape dédiée).
