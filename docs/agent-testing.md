# Tester l'agent

Quatre outils, du plus rapide au plus rigoureux. Ils ne s'exécutent **jamais en production**
(`ENVIRONMENT=production` les refuse) et ne créent que des données fictives en `@demo.example.com`.

| Outil | Commande | Usage |
|---|---|---|
| Jeu de données de démo | `python -m app.cli seed-demo` | Peupler la base (14 prospects à tous les stades, conversations, transfert, rendez-vous, relance, opt-out) pour le développement du tableau de bord et les démonstrations |
| Scénarios de recette | `python -m app.cli scenario` | Rejouer des cas complets et vérifier le comportement de l'agent ; produit un rapport |
| Simulateur de conversation | `python -m app.cli chat` | Jouer le prospect à la main et voir la décision de l'agent à chaque message |
| Évaluation quantitative | `python -m app.cli eval-agent` | Mesurer l'agent sur un jeu de cas annotés : intention, décision, transferts, réponses sourcées, chiffres inventés, latence |

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

## Nettoyage

`--cleanup` (scénarios, évaluation) supprime les prospects créés par la recette sans toucher au jeu de démo.
