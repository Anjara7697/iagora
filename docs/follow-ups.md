# Relances après conversion et changement de contexte

## Règles

Les étapes `converted` et `lost` terminent le parcours de relance d’un rattachement
prospect/source/campagne. Lors d’un changement manuel (API) ou système, ses relances
encore programmées sont annulées dans la même transaction SQL que le changement
d’étape. Les relances des autres rattachements sont conservées. Revenir à une étape
antérieure ne réactive pas les relances annulées.

Une nouvelle relance est toujours rattachée au contexte commercial courant, même
si l’appelant ne fournit pas d’identifiant. Sa programmation refuse un contexte
absent, terminé ou différent de celui demandé. Le verrou SQL du rattachement
sérialise la programmation avec le changement d’étape.

Avant une exécution, l’agent recontrôle le rattachement d’origine et son étape.
Une ancienne relance ne peut donc pas produire un message pour une nouvelle
campagne devenue le contexte courant. Les anciennes relances SQL sans rattachement
sont contrôlées sur le contexte courant ; leur parcours d’origine est inconnu.

Les messages produits par une relance portent `metadata.follow_up.membership_id`.
Le transport email recontrôle ce contexte avant SMTP et bloque un message devenu
inapproprié, même si son brouillon a été approuvé. Les réponses normales et les
messages des conseillers ne sont pas bloqués par cette règle.

## Limites et recette

- Le contrôle SMTP concerne les nouveaux messages portant cette métadonnée. Avant
  la première recette IONOS, vérifier manuellement les anciens brouillons et
  messages prêts à envoyer, dont l’origine ne peut pas être déterminée sûrement.
- Un brouillon de relance peut rester visible après conversion ; sa validation
  ne contourne pas le contrôle au moment de l’envoi.
- Un SMTP déjà commencé ne peut pas être rappelé. Le contrôle reflète l’état lu
  avant la transmission, comme pour le consentement et l’arrêt d’urgence.
- La conversion d’un rattachement ne signifie pas automatiquement la conversion
  des autres sources ou campagnes du même prospect.

Les régressions de `tests/test_auto_agent.py` couvrent les changements API et
système, les états anciens, les prospects multicampagnes, le changement de
contexte, les messages entrants après conversion et le blocage avant SMTP en
mode automatique et après validation en mode assisté. Elles utilisent SQLite,
MongoDB simulé, un modèle et un transport email fictifs en local ; la CI utilise
également PostgreSQL et MongoDB réels pour les tests backend.
