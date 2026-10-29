# Effacement des données d'un prospect et durée de conservation

Réponse technique au droit à l'effacement (RGPD, art. 17). Elle ne remplace pas l'avis du DPO ; voir
[conformite-rgpd.md](conformite-rgpd.md) pour le contexte.

## Effacer un prospect (console)

Réservé aux **administrateurs**. Sur la fiche prospect, bloc **Données personnelles** → « Effacer ce
prospect… » : choisir le motif (**demande de la personne** ou **autre motif**), saisir l'adresse email du
prospect pour confirmer (son numéro de fiche s'il n'en a pas), puis « Effacer définitivement ». L'action est
irréversible. API : `POST /api/v1/prospects/{id}/erase` (`{"reason": "request|other", "confirm": "…"}`).

Sont supprimés : la fiche, les échanges (`interactions`), les consentements, étapes et scores, les
rendez-vous et relances (PostgreSQL, par les clés `ON DELETE CASCADE`) ; la conversation, les décisions de
l'agent (`agent_runs`) et ses événements (MongoDB). Un second passage sur MongoDB suit la suppression SQL
pour rattraper un traitement de l'agent qui aurait écrit entre-temps. Si l'étape SQL échoue après MongoDB,
la fiche existe encore et l'action peut être relancée.

## Ce qui reste, volontairement

Une ligne `erasure_records` : numéro de l'ancienne fiche, motif, auteur, date. **Aucun nom, email ni
téléphone en clair.** Quand la personne était désinscrite (STOP) ou a demandé l'effacement, la ligne garde
aussi l'**empreinte SHA-256 salée** de son email et de son téléphone : un import, un formulaire ou un
nouveau message avec cette adresse crée alors un prospect **déjà désinscrit** au lieu de la recontacter
(`services/erasure.py`). Pour un autre motif et une personne jamais désinscrite, aucune empreinte n'est
gardée. Une empreinte est une pseudonymisation, pas une anonymisation : c'est le minimum nécessaire pour
respecter l'opposition.

Les événements de réception Meta (`meta_lead_events`) servent de marqueur anti-rejeu : ils ne sont pas
supprimés, mais leur lien avec la fiche (`prospect_id`, `interaction_id`) est retiré. Meta qui rejoue la
notification ne recrée donc pas la personne effacée. Ses données restent chez Meta : à effacer côté Meta.

## Ce qu'IAGORA n'efface pas (à faire à la main)

Le rapport affiché après l'effacement le rappelle :

- les **emails** de la personne dans la boîte de l'école (dossier surveillé, éléments envoyés) ;
- les **événements Google Agenda** et **réunions Zoom** déjà créés : le rapport liste leur date, le
  conseiller et leurs identifiants. IAGORA ne sait pas les supprimer (pas d'écriture de suppression dans
  les connecteurs d'agenda) ;
- les **sauvegardes** de bases de données, jusqu'à leur rotation ;
- les journaux techniques, qui ne contiennent pas de coordonnées (S-04).

## Durée de conservation

Aucune durée n'est décidée : c'est une décision de DATUM (voir [conformite-rgpd.md](conformite-rgpd.md) §4).
La commande suivante permet de l'appliquer quand elle le sera ; **rien ne se lance automatiquement** :

```bash
# Aperçu : numéros de fiche et dernière activité, jamais de nom ni d'adresse
docker compose exec backend python -m app.cli purge-inactive --older-than-days 730
# Effacement réel (motif « retention »)
docker compose exec backend python -m app.cli purge-inactive --older-than-days 730 --apply
```

Sont concernés les prospects sans aucun échange ni modification depuis N jours (minimum 30), **sans
rendez-vous à venir ni relance programmée**. Les prospects **convertis** sont gardés sauf
`--include-converted`. La commande affiche le nombre de rendez-vous à supprimer à la main.

## Limites

- Pas d'export des données d'une personne (droit d'accès / portabilité) : seul l'export CSV de la liste
  existe.
- Pas de planification de la purge (cron) ni d'alerte avant échéance.
- L'effacement d'un prospect ne retire pas ses éventuelles mentions dans le texte libre des notes d'un
  autre prospect ou dans des documents de la base de connaissances.
