# Tester l'agent

Trois outils, du plus rapide au plus rigoureux. Ils ne s'exécutent **jamais en production**
(`ENVIRONMENT=production` les refuse) et ne créent que des données fictives en `@demo.example.com`.

| Outil | Commande | Usage |
|---|---|---|
| Jeu de données de démo | `python -m app.cli seed-demo` | Peupler la base (14 prospects à tous les stades, conversations, transfert, rendez-vous, relance, opt-out) pour le développement du tableau de bord et les démonstrations |
| Scénarios de recette | `python -m app.cli scenario` | Rejouer des cas complets et vérifier le comportement de l'agent ; produit un rapport |
| Simulateur de conversation | `python -m app.cli chat` | Jouer le prospect à la main et voir la décision de l'agent à chaque message |

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
connaissances, piège du prix inventé, situation sensible, demande d'un conseiller, désintérêt, premier contact,
qualification progressive. Le scénario « modèle indisponible » exige d'injecter une panne : il est ignoré avec `--live`.

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
profil), `/reset` (nouveau prospect), `/quit`. L'agenda et la base de connaissances y sont des **doublures de
démonstration** (un créneau fictif, un seul fait fictif) : ce ne sont pas de vraies données.

## Nettoyage

`--cleanup` (scénarios) supprime les prospects créés par la recette sans toucher au jeu de démo.
