# Lot 3 — Recette email réelle

Statut : **préparée, non exécutée**. Aucun résultat de test unitaire ou de CI ne
constitue une preuve de réception ou de livraison chez IONOS.

## Demande à transmettre au responsable pédagogique

> Pour valider le parcours email d'IAGORA, nous avons besoin d'une boîte IONOS
> dédiée aux essais, d'une adresse destinataire réelle autorisée et d'un
> environnement de test isolé. Merci de préciser les hôtes et ports IMAP/SMTP,
> les droits d'utilisation et la personne qui configurera les identifiants par
> un canal sécurisé (aucun mot de passe dans le chat, Git ou le compte rendu).
> Il faut également un accès administrateur à l'application de test, un accès
> au fournisseur IA et aux embeddings, et les documents métier validés avec
> leur date/version : programmes, tarifs, admissions, calendrier et conditions.
> Merci de fournir quelques questions avec les réponses attendues et de
> désigner la personne qui validera les réponses et la clôture de la recette.

Les données manquantes dans ces documents doivent être identifiées comme telles :
elles serviront à vérifier le transfert au conseiller, sans inventer de réponse.

## Conditions de démarrage

- Noter le commit testé, l'URL de test, les versions de configuration et de la
  base documentaire. Utiliser PostgreSQL/pgvector, MongoDB et Redis disponibles.
- Utiliser une boîte dédiée vide et des comptes de test autorisés. Les commandes
  `seed-demo`, `scenario` et `chat` ne servent pas à cette recette réelle : elles
  sont réservées aux identités fictives `@demo.example.com`.
- Configurer les secrets hors Git ; garder TLS actif. Commencer avec
  `EMAIL_ENABLED=false` et `EMAIL_SEND_ENABLED=false`.
- Renseigner **explicitement** `EMAIL_SANDBOX_RECIPIENTS` avec les seules adresses
  de test autorisées avant d'activer tout envoi. Une liste vide ne restreint pas
  les destinataires. Ne pas utiliser une boîte ou une base de production.
- Autoriser les connexions TCP vers les hôtes IMAP/SMTP choisis (par défaut
  `imap.ionos.fr:993`, `smtp.ionos.fr:587`, STARTTLS), ainsi que les API du
  fournisseur IA et des embeddings. Une autorisation HTTP seule ne suffit pas
  pour IMAP/SMTP. Respecter le proxy et la politique réseau de l'environnement.
- Charger les documents validés via la Base de connaissances, vérifier les
  cibles et tester la recherche. Préparer une campagne/source actives et les
  comptes administrateur, conseiller et lecteur nécessaires.
- Exécuter `python -m app.cli email-check` : vérifier IMAP et SMTP sans lecture
  ni envoi. Ensuite activer la réception en mode **Assisté**. N'activer l'envoi
  qu'après vérification du destinataire et du brouillon.

Voir [configuration email](email.md), [attribution et reprise](intake.md) et
[base documentaire](rag.md). Le présent protocole ne déploie rien.

## Scénarios et preuves attendues

Utiliser un sujet unique par scénario. Pour chacun, conserver le résultat
attendu/obtenu, les horodatages UTC, les identifiants de conversation/message,
les traces utiles expurgées et le verdict `réussi`, `échoué` ou `non exécuté`.
Ne pas publier de secret ni de contenu personnel dans le rapport.

| ID | Action | Critère de réussite |
|---|---|---|
| E01 | Vérifier la connexion puis recevoir un premier email d'un expéditeur inconnu. | Email enregistré une seule fois ; prospect et conversation visibles ; file « À attribuer » ; aucune réponse commerciale avant attribution. |
| E02 | Attribuer la campagne et la source actives, puis poser une question couverte par les documents. | Contexte identique sur la fiche et la conversation ; brouillon fondé sur les extraits de la bonne cible ; validation métier de tous les faits. |
| E03 | Valider le brouillon et activer l'envoi vers le destinataire autorisé. | Un seul email effectivement reçu, contenu approuvé, fil conservé, mention STOP et en-tête List-Unsubscribe ; état `sent` cohérent. L'acceptation SMTP seule ne prouve pas la réception. |
| E04 | Répondre depuis la boîte destinataire puis faire une réponse conseiller. | Réponse entrante dans le même fil ; réponse conseiller livrée une seule fois ; auteur et historique cohérents. |
| E05 | Représenter le même email à la synchronisation. | Pas de nouveau prospect, message, brouillon ou envoi pour le même Message-ID ; reprise d'un traitement interrompu sans duplication visible. |
| E06 | Demander un prix ou une disponibilité absents des documents, puis une prise de rendez-vous. | Aucun fait inventé ; transfert explicite au conseiller si information ou calendrier indisponible. Aucun rendez-vous réel annoncé sans intégration. |
| E07 | Mettre un email agent validé en attente, passer en Manuel puis synchroniser ; reprendre en Assisté. | Aucun départ agent en Manuel, réception maintenue ; reprise unique du message validé. Vérifier séparément qu'un ancien message automatique non validé revient en brouillon. |
| E08 | Recevoir STOP en Manuel et dans une conversation transférée, avec brouillon, email et relance en attente. | Désinscription enregistrée sans LLM ; brouillon/relance annulés, messages en attente bloqués ; aucun nouvel envoi après traitement du STOP. Un envoi SMTP déjà commencé ne peut pas être rappelé. |
| E09 | Déclencher une relance sur un prospect de test consentant, puis répéter avec désinscription/Manuel. | Relance selon l'échéance et la fenêtre métier configurées ; aucune relance au prospect désinscrit ou en mode Manuel. |
| E10 | Simuler une indisponibilité contrôlée puis redémarrer le service. | Événements persistés repris ; erreurs visibles ; nombre d'essais borné ; aucun renvoi aveugle d'un message resté `sending`. Documenter sa vérification manuelle. |
| E11 | Tenter un envoi vers une adresse de test contrôlée hors de la liste autorisée. | Message `blocked`, aucune transmission SMTP pour cette adresse. |
| E12 | Mesurer plusieurs parcours représentatifs. | Distinguer délai réception IMAP, enregistrement, génération, validation humaine, SMTP et livraison ; consigner valeurs et écarts aux objectifs du cahier des charges. Ne pas inclure l'attente humaine dans le temps de génération. |

Les pannes contrôlées se provoquent uniquement sur l'environnement de test.
Les cas de crash partiel entre SQL, MongoDB, LLM et SMTP demandent une inspection
des traces : il n'existe pas de transaction distribuée garantissant toutes ces
opérations. Ne pas effacer un état `sending` pour forcer un nouvel envoi.

## Clôture

Le lot est terminé après exécution et validation des scénarios, correction des
anomalies bloquantes et contre-test sur le commit final. Toute exception doit
être explicitement acceptée par le responsable, avec sa conséquence opérationnelle.
Le compte rendu indique les scénarios non exécutés : ils restent à confirmer.
Arrêter les travailleurs de test et désactiver réception/envoi à la fin ; appliquer
la durée de conservation convenue aux données et preuves de recette.

Au 15 octobre 2026 : accès IONOS, destinataire et documents validés restent à
obtenir auprès du responsable pédagogique. Aucun test IONOS réel n'est attesté.
