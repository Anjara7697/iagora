# Tester l'agent

Cinq outils, du plus rapide au plus rigoureux. Ils ne s'exécutent **jamais en production**
(`ENVIRONMENT=production` les refuse) et ne créent que des données fictives en `@demo.example.com`.

| Outil | Commande | Usage |
|---|---|---|
| Jeu de données de démo | `python -m app.cli seed-demo` | Peupler la base (14 prospects à tous les stades, conversations, transfert, rendez-vous, relance, opt-out) pour le développement du tableau de bord et les démonstrations |
| Scénarios de recette | `python -m app.cli scenario` | Rejouer des cas complets et vérifier le comportement de l'agent ; produit un rapport |
| Simulateur de conversation | `python -m app.cli chat` | Jouer le prospect à la main et voir la décision de l'agent à chaque message |
| Évaluation quantitative | `python -m app.cli eval-agent` | Mesurer l'agent sur un jeu de cas annotés : intention, décision, transferts, réponses sourcées, chiffres inventés, latence |
| Évaluation de conversations | `python -m app.cli eval-conversations` | Mesurer l'agent sur des conversations de plusieurs messages : contexte suivi, informations redemandées, ton tenu, parcours mené au bout |

Avec Docker : `docker compose exec backend python -m app.cli <commande>`.

## Jeu de données de démo

```bash
python -m app.cli seed-demo            # idempotent : ne recrée rien s'il existe déjà
python -m app.cli seed-demo --reset    # supprime puis recrée les données de démo
```

Construit via les services métier : scores, étapes et historiques sont donc cohérents et justifiés comme en usage
réel. Les campagnes sont préfixées `[DÉMO]`. Aucun compte utilisateur n'est créé. `--reset` ne supprime que les lignes
de démo (adresses `@demo.example.com`, campagnes `[DÉMO]`), jamais de vraies données.

## Scénarios de recette

```bash
python -m app.cli scenario                         # tous, avec un faux modèle (hors ligne, déterministe)
python -m app.cli scenario opt_out cold_prospect   # certains seulement
python -m app.cli scenario --live                  # avec le vrai modèle configuré (clé requise)
python -m app.cli scenario --live --report rapport.md --cleanup
```

Deux usages d'un même catalogue (`backend/app/devtools/scenarios.py`) :

- **Hors ligne (par défaut)** : un faux modèle scripté, déterministe. Aucun appel externe. Ces scénarios sont aussi
  exécutés par les tests automatiques (CI) : le catalogue est lui-même vérifié.
- **`--live`** : le vrai modèle. Sa réponse varie d'un appel à l'autre : on ne compare **pas le texte**, on vérifie des
  *propriétés* (bonne décision, motif de transfert, étape, consentement, aucun chiffre inventé). Le rapport (`--report`)
  liste les réponses rédigées pour que l'on juge le ton à la main.

Le catalogue couvre les cinq scénarios du cahier des charges (§12.2) et d'autres cas : question couverte par la base de
connaissances, question sur la liste des formations, piège du prix inventé, situation sensible, demande d'un conseiller,
« rendez-vous avec un conseiller », relance annulée quand le prospect répond, désintérêt, premier contact, qualification
progressive.

> **Leçon de la première recette avec un vrai modèle.** Deux scénarios ont échoué parce que le faux modèle scripte une
> lecture (« autre », « rendez-vous ») que le vrai modèle ne fait pas toujours. Les attentes sont donc écrites sur ce qui
> compte (aucun transfert à tort, un message rédigé, une relance annulée) plutôt que sur une étiquette précise : voir
> `Expect.action_in` / `stage_in`. Tout écart observé en `--live` doit devenir un scénario hors ligne qui le reproduit. Le scénario « modèle indisponible » exige d'injecter une panne : il est ignoré avec `--live`.

Vérifications appliquées à **tous** les scénarios : décision justifiée, trace présente, et aucun chiffre non sourcé dans
ce que le modèle a rédigé (NF-10).

> Avec un quota limité (formule gratuite), un scénario peut échouer en `llm_indisponible` : l'agent transfère, comme prévu.
> Relancer les scénarios un par un.

### Ajouter un scénario

```python
Scenario(
    name="mon_cas",
    title="Description courte",
    cdc_ref="F-xx",
    turns=[
        Turn(
            says="Message du prospect",
            qualification=Qualification(intent="question"),   # comportement du faux modèle (ignoré en --live)
            reply="Réponse du faux modèle",
            expect=Expect(action="continue_conversation", handoff_reason=None, reply=True),
        )
    ],
)
```

`Expect` accepte : `action`, `handoff_reason`, `reply`, `reply_includes`, `reply_excludes`, `stage_after`, `consent`,
`conversation`, `appointment`, `follow_up`, `profile_keys`. Un champ omis n'est pas vérifié.

## Simulateur de conversation

```bash
python -m app.cli chat                  # vrai modèle
python -m app.cli chat --fake           # sans clé (réponses fixes : sert surtout à voir le fonctionnement)
python -m app.cli chat --target compagnons_pros --trace
```

Écrivez comme le prospect. Commandes : `/trace` (détail des étapes du graphe), `/state` (étape, scores, consentement,
profil), `/reset` (nouveau prospect), `/quit`. L'agenda y est une **doublure** (créneaux fictifs). Avec le vrai
modèle, la base de connaissances est le vrai RAG interrogé sur les documents **fictifs** chargés par `seed-demo` ;
avec `--fake`, un seul fait fictif.

## Évaluation quantitative

```bash
python -m app.cli eval-agent                                   # tous les cas, faux modèle (hors ligne)
python -m app.cli eval-agent --live --pause 4 --report eval.md --json eval.json --cleanup
python -m app.cli eval-agent --live --categorie question_hors_base --categorie prix_sans_source
python -m app.cli eval-agent --live --ablation sans-garde-chiffres --report eval-sans-garde.md
python -m app.cli eval-agent --live --prix-entree 0.30 --prix-sortie 2.50   # prix par million de jetons
```

Les scénarios vérifient des cas un par un ; l'évaluation **mesure**. Le jeu de cas annotés
(`backend/app/devtools/eval_cases.json`, plus de 40 cas en 12 catégories) indique pour chaque message les intentions et
décisions acceptables, si un transfert est attendu (et pour quel motif), et le fait que la réponse doit citer. Chaque
cas est joué sur un prospect fictif neuf (`eval.*@demo.example.com`) avec le vrai workflow ; rien n'est envoyé.

| Mesure | Ce qui est compté |
|---|---|
| Intention lue | l'intention lue par le modèle fait partie des intentions annotées |
| Décision | l'action décidée fait partie des actions annotées |
| Transfert juste | transfert quand il est attendu (bon motif), aucun sinon ; transferts manqués et inutiles comptés à part |
| Réponses sourcées | la réponse contient le fait attendu de la base de connaissances |
| Chiffres non sourcés | dans le texte brut du modèle (avant les garde-fous) et dans les messages réellement enregistrés (après) |
| Latence, appels, jetons | durée du workflow complet par cas ; jetons **estimés** (≈ 4 caractères par jeton) ; coût seulement si les prix sont passés |

- **Hors ligne (par défaut)**, le faux modèle rejoue l'annotation : 100 % attendu. Cela vérifie l'outil, le jeu de cas
  et les règles du workflow (ces cas sont aussi joués par la CI), **pas** le modèle. Seul `--live` mesure le modèle.
- **Base de connaissances** : par défaut, la base FICTIVE de démonstration (`demo_kb/`) avec une recherche lexicale,
  déterministe et sans clé ; `--rag-reel` utilise la vraie recherche sur les documents de démonstration chargés par
  `seed-demo`. La qualité de la recherche elle-même se mesure avec `kb-eval`.
- **Variantes d'ablation** : `sans-rag` (aucun extrait) et `sans-garde-chiffres` (vérification des chiffres désactivée
  pendant le cas) montrent ce qu'apporte chaque garde-fou. Pour comparer deux modèles, relancer avec un autre
  `LLM_MODEL` : le rapport indique le modèle utilisé.
- Un cas où le modèle est indisponible (quota, clé, réseau) est compté **à part** et exclu des taux : une panne de quota
  n'est pas une erreur de jugement. `--pause` espace les cas pour les formules gratuites.
- Le rapport Markdown donne la synthèse, le détail par catégorie et chaque écart (message, attendu, observé, réponse) ;
  le JSON garde les résultats bruts pour comparer plusieurs passages.

## Évaluation de conversations

```bash
python -m app.cli eval-conversations                                   # faux modèle (hors ligne)
python -m app.cli eval-conversations --live --rag-reel --pause 4 --report conv.md --json conv.json --cleanup
python -m app.cli eval-conversations --live parcours_rdv_ebihar arret_en_cours
```

`eval-agent` mesure un message à la fois, sur un prospect neuf. `eval-conversations` joue des conversations de
plusieurs messages (`backend/app/devtools/conversation_cases.json`) sur un même prospect fictif
(`evalconv.*@demo.example.com`), avec le vrai workflow ; rien n'est envoyé. Chaque tour reprend exactement les
vérifications de `eval-agent` (intention, décision, transfert, fait attendu, chiffres non sourcés) ; s'y ajoute
ce qui ne se voit qu'à la longue :

| Mesure | Ce qui est compté |
|---|---|
| Contexte suivi | questions de suivi (« et ça dure combien ? ») justes, sans répéter le sujet |
| Informations redemandées | l'agent demande une information de profil que le prospect a déjà donnée |
| Ton tenu | nouvelle salutation après le premier message, présentation comme IA sans qu'on le demande (D-32), plus d'une question par message |
| Parcours mené au bout | état final attendu : rendez-vous réservé, désinscription, transfert, conversation ouverte |
| Profil lu juste | après un tour annoté (`profile_after`), les informations de qualification extraites (niveau, projet, situation…) sont les bonnes |
| Arrêts prématurés | transfert ou clôture avant le dernier message prévu |

Les 9 conversations couvrent : un parcours complet jusqu'au rendez-vous réservé, un prospect engagé qui ne demande
pas de rendez-vous, des informations à ne pas redemander, deux conversations de suivi du contexte, une
désinscription en cours de route, une question mêlant connu et inconnu, « je parle à un robot ? » et un prospect
peu engagé. Le rapport Markdown reprend les échanges complets pour juger le ton à la lecture.

**Qualification et technique de vente** : des indicateurs, hors conformité, décrivent la façon de prospecter et
se comparent d'un passage à l'autre :

| Indicateur | Ce qui est compté |
|---|---|
| Rendez-vous proposé à temps | l'agent propose un rendez-vous de lui-même au plus tard au tour prévu (`meeting_by`) |
| Questions posées | par type : exploration (projet, motivation), information (un fait), alternative (X ou Y), fermée (oui/non) |
| Reformulations | l'agent reprend ce que le prospect vient de dire avant d'enchaîner (écoute active) |
| Longueur des messages | médiane, et messages au-delà de 120 mots (la consigne) |
| Offres de conseiller | « voulez-vous un conseiller ? » posé par le modèle (D-33 : jamais de lui-même), et combien de fois reposé |
| Avis d'admission donnés | « votre profil correspond aux conditions » : l'admission revient à l'école |
| Salutations dans les messages fixes | « Bonjour » en tête des créneaux ou de la confirmation, en pleine conversation |

- **Hors ligne**, le faux modèle rejoue l'annotation de chaque tour : 100 % attendu, vérifié par la CI. Les
  conversations de suivi du contexte (`live_only`) ne sont jouées qu'avec `--live` : le faux modèle ne sait pas
  simuler la compréhension d'une question courte.
- Les messages du prospect sont écrits d'avance : la mesure est comparable d'un passage à l'autre, mais si
  l'agent répond de façon inattendue, la suite peut ne plus coller. Une conversation transférée ou close avant
  le dernier message est comptée comme arrêtée.
- Informations redemandées, salutations et présentation comme IA sont repérées par des expressions courantes :
  un écart signalé se relit dans les échanges du rapport.

## Page Évaluation (API)

Les trois évaluations se lancent aussi depuis l'application (D-35), avec les mêmes fonctions et donc les mêmes
chiffres que la ligne de commande. Réservé aux administrateurs, refusé en production.

| Route | Rôle |
|---|---|
| `GET /evaluations/catalog` | Suites, cas, conversations et questions disponibles ; vrai modèle et embeddings utilisables ou non |
| `POST /evaluations` | Lance un passage en tâche de fond (un seul à la fois, `409` sinon) ; réglages : `suite`, `label`, `notes`, `live`, `real_rag`, `pause`, `ids`, `categories`, `ablation`, `price_in`, `price_out`, `min_score`, `cleanup` |
| `GET /evaluations` | Historique, du plus récent au plus ancien, avec les indicateurs (sans le rapport détaillé) |
| `GET /evaluations/{id}` | Passage complet : réglages, avancement (`progress`) pendant qu'il tourne, rapport, indicateurs |
| `POST /evaluations/{id}/cancel` | Arrête le passage ; les résultats déjà obtenus sont gardés (`cancelled`) |
| `POST /evaluations/import` | Ajoute un rapport `--json` de la ligne de commande (`eval-agent`, `eval-conversations`, `kb-eval`) ; l'échange des anciens rapports de conversations est reconstitué |
| `PATCH /evaluations/{id}`, `DELETE /evaluations/{id}` | Renommer, dater, annoter ; supprimer |

États d'un passage : `running`, `done`, `cancelled`, `failed` (erreur affichée), `interrupted` (API redémarrée
pendant le passage). Les indicateurs normalisés (`key`, `label`, `group`, `value`, `display`, `better`) servent à
comparer deux passages et à tracer l'évolution ; une valeur absente d'un rapport plus ancien vaut `n/a`.

`kb-eval --json <chemin>` écrit maintenant lui aussi ses résultats, importables dans la page.

## Nettoyage

`--cleanup` (scénarios, évaluations) supprime les prospects créés par la recette sans toucher au jeu de démo.
