# Consignes données au modèle (prompts)

Toutes les consignes envoyées au modèle de langage sont dans **`backend/app/graph/prompts.py`**.
Aucune n'est stockée en base ni dans un outil externe : les modifier = modifier ce fichier, avec une
Pull Request et les tests.

Principe (voir [decisions.md](decisions.md), D-02) : les consignes **orientent** le modèle, mais les
règles importantes sont **aussi vérifiées par du code**. On ne se fie jamais au prompt seul.

## Les blocs

| Nom | Type | Rôle | Utilisé par |
|---|---|---|---|
| `IDENTITY` | Texte fixe | L'agent est l'assistant virtuel de DATUM Academy ; c'est une IA qui ne se fait jamais passer pour un humain | `reply_system` |
| `RULES` | Texte fixe | Vouvoiement, ton, interdiction d'inventer (prix, dates, durées…), une seule question, 120 mots maximum, ne pas parler du fonctionnement interne | `reply_system` |
| `CATALOGUE` | Texte fixe | Liste validée des trois programmes : noms et publics, **aucun chiffre** | `reply_system` |
| `PROGRAMS` | Dictionnaire | Libellé du sujet d'intérêt selon la cible du prospect | les deux prompts système |
| `qualification_system()` | Prompt système | Lire le **dernier** message et remplir le schéma `Qualification` : intention, `asks_catalogue`, `needs_human`, confiance, créneau choisi, champs de profil | nœud `qualify_prospect` (sortie structurée) |
| `reply_system()` | Prompt système | Rédiger la réponse : identité, règles, contexte, profil connu, catalogue, extraits du RAG, mission selon le cas | nœud `generate_response` |
| `strict_retry_note()` | Ajout | Second essai quand la réponse contenait des chiffres absents des sources | nœud `generate_response` |
| `to_chat()` | Mémoire courte | Les 12 derniers messages, rôles convertis pour le modèle | les deux appels |
| `known_profile()` | Contexte | Ce que l'on sait déjà du prospect, pour ne jamais le redemander | les deux prompts |

### Les missions de `reply_system()`

| Cas | Consigne |
|---|---|
| Premier message (aucun historique) | Se présenter brièvement, rappeler le sujet, poser une question simple |
| Réponse normale | Répondre au dernier message de façon utile et personnalisée |
| `nurture` (prospect peu engagé, relance) | Message court et chaleureux, un élément utile, aucune demande de rendez-vous |
| Conversation déjà engagée | Ne pas resaluer, ne pas se représenter, ne pas répéter qu'on est une IA sauf si on le demande |
| Champ de profil manquant | Terminer, si c'est naturel, par **une** question sur ce champ (`FIELD_LABELS` dans `policy.py`) |

### Textes qui ne passent pas par le modèle

| Texte | Où | Pourquoi |
|---|---|---|
| Accusé de transfert (`HANDOFF_MESSAGE`) | `graph/nodes.py` | Toujours identique ; exempté de validation en mode assisté |
| Proposition de créneaux | `nodes.py::propose_meeting` | Les créneaux viennent uniquement de l'agenda réel (NF-10) |
| Pied des emails (`email_footer`) | `config.py` | Mention STOP ; à compléter par une mention IA (voir [conformite-rgpd.md](conformite-rgpd.md)) |

## Ce que le code vérifie après le modèle

| Règle du prompt | Vérification | Où |
|---|---|---|
| Ne rien inventer de chiffré | Tout prix, durée, pourcentage ou date de la réponse doit figurer dans les extraits, la conversation ou les créneaux ; sinon nouvel essai strict, puis transfert | `policy.py::ungrounded_claims` |
| Respecter un STOP | Détection par expressions régulières, sans modèle | `policy.py` (`_OPT_OUT`), `services/inbound.py` |
| Repérer les situations sensibles | Liste de motifs, transfert obligatoire | `policy.py` (`_SENSITIVE`) |
| Ne pas envoyer de coordonnées au modèle | Le contexte ne contient que le prénom et la qualification | `known_profile()`, test dédié |

## Données envoyées au modèle

Prénom, cible, nom de la campagne, champs de qualification, extraits du RAG et les 12 derniers messages.
**Jamais** l'email, le téléphone ni les identifiants de réseaux sociaux (test
`test_known_contact_data_never_reaches_the_prompts`).

## Modifier une consigne sans casse

1. Modifier `prompts.py` (ou `FIELD_LABELS` / les listes de motifs dans `policy.py`).
2. Lancer les tests : `cd backend && pytest tests/test_prompts.py tests/test_policy.py tests/test_agent_workflow.py`.
3. Rejouer les scénarios hors ligne : `python -m app.cli scenario`.
4. Rejouer avec le vrai modèle (consomme du quota) : `python -m app.cli scenario --live`, puis quelques
   échanges dans le simulateur de la console.
5. Décrire dans la Pull Request l'effet attendu et les exemples testés.

Tests qui protègent les consignes (`tests/test_prompts.py`) : catalogue sans chiffre, français correct,
pas de fonctionnement interne exposé, pas de double salutation, distinction rendez-vous / humain,
coordonnées jamais envoyées.

## À faire valider par DATUM

- Le ton et la longueur des messages (120 mots maximum aujourd'hui).
- La structure du « mail de référence » prévue au cahier des charges (F-17) : non reprise à ce jour.
- La liste des programmes et leurs publics (`CATALOGUE`, `PROGRAMS`).
