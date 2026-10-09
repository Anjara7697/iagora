# Base de connaissances (RAG)

Le RAG (*Retrieval-Augmented Generation*) donne à l'agent des faits **vérifiés** au lieu de les laisser deviner par le
modèle (F-14, NF-10). Pour chaque message du prospect : on cherche les extraits de documents les plus proches de sa
question, on les donne au modèle comme seule source de faits, puis le code vérifie que la réponse n'avance aucun
chiffre absent de ces extraits.

## Parcours d'une question

```
question du prospect
  → embedding (vecteur de 768 nombres)                 [port EmbeddingModel : Gemini, remplaçable]
  → recherche des extraits les plus proches (cosinus)  [PostgreSQL + pgvector, filtre par programme]
  → seuil de pertinence (RAG_MIN_SCORE)                [en dessous : l'extrait est écarté]
  → aucun extrait ? question précise ⇒ transfert au conseiller (question_hors_base)
  → extraits ⇒ le modèle rédige ; le code vérifie les chiffres ; la source est tracée dans le message
```

## Documents

Un document est un fichier Markdown :

```markdown
---
title: Programme eBIHAR
target: ebihar_students      (omis ou « all » : valable pour tous les programmes)
---
## Durée et rythme
Le programme dure 18 mois…

## Conditions d'admission
…
```

Découpage : une section `##` = un extrait (coupé par paragraphes au-delà de ~900 caractères). Chaque extrait est
préfixé du titre du document et de sa section (« Programme eBIHAR — Durée et rythme : … »), ce qui améliore la
recherche et fournit la source citée. **Un fait par phrase claire** donne de meilleures réponses qu'un long texte.

L'agent ne cherche que dans les documents de la **cible du prospect** et dans ceux marqués « toutes ».

## Commandes (`python -m app.cli …`, via `docker compose exec backend`)

| Commande | Rôle |
|---|---|
| `kb-ingest <fichier ou dossier>` | Ajoute ou met à jour des documents `.md` ; idempotent (un document inchangé n'est pas recalculé) |
| `kb-list` | Liste les documents, leur cible, leur nombre d'extraits, leur modèle d'embedding |
| `kb-search "question" [--target …]` | Affiche les extraits trouvés, leur score et s'ils passent le seuil |
| `kb-reindex` | Recalcule tous les vecteurs (après un changement de `EMBEDDING_MODEL` / fournisseur) |
| `kb-delete <slug>` / `kb-delete --demo` | Supprime un document / tous les documents fictifs |
| `kb-eval` | (dev) Mesure la recherche sur des questions types et aide à régler le seuil |

`seed-demo` charge aussi une base **fictive** (`backend/app/devtools/demo_kb/`) marquée `is_demo`. Ces documents ne
sont **jamais servis en production** (`ENVIRONMENT=production`) et se retirent avec `kb-delete --demo`.

## Régler le seuil de pertinence

`RAG_MIN_SCORE` (défaut 0,6) est la similarité cosinus minimale. Trop bas : l'agent s'appuie sur des extraits peu
liés à la question ; trop haut : il transfère des questions auxquelles la base sait répondre. Après tout changement
de modèle ou de documents, lancer `kb-eval` : il affiche le score le plus bas des questions pertinentes et le plus
haut des questions hors sujet ; le bon seuil se situe entre les deux.

## Garde-fous

- Seuil de pertinence : un extrait peu pertinent n'est jamais transmis au modèle.
- Les vecteurs d'un autre modèle d'embedding sont ignorés (ils ne sont pas comparables) : après un changement de
  modèle, `kb-list` signale « RÉINDEXER » et la recherche ne renvoie rien tant que `kb-reindex` n'a pas été lancé.
- Panne ou quota des embeddings, ou clé absente : aucun extrait, donc transfert au conseiller (jamais de réponse devinée).
- Documents fictifs exclus en production ; aucun secret ni donnée personnelle dans les documents.

## Limites actuelles

- La recherche utilise le texte du dernier message du prospect seul : une question de suivi très courte
  (« et le prix ? ») manque de contexte. À améliorer en réécrivant la requête avec l'historique.
- Les documents officiels de DATUM Academy restent à fournir ; la base de démonstration est fictive.
- Le chargement se fait en ligne de commande ; une page d'administration viendra avec le tableau de bord.
