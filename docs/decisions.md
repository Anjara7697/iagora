# Décisions techniques

Les choix qui structurent le projet, avec leur raison. Le but : qu'un successeur sache **pourquoi** avant
de changer quelque chose. Format : contexte, décision, conséquences. Ajouter une entrée à chaque choix
important (numéro suivant, date, statut).

Statuts : **Adoptée** · **À revoir** (encore valable, mais à réexaminer) · **Remplacée**.

---

## D-01 — Python, FastAPI et LangGraph

*Septembre 2026 · Adoptée*

**Contexte.** Le cahier des charges (§9.1) demande un backend Python et un workflow agentique traçable.

**Décision.** FastAPI + Pydantic v2 + SQLAlchemy 2 asynchrone pour l'API ; LangGraph pour le workflow,
LangChain uniquement comme couche d'accès aux modèles.

**Conséquences.** Le graphe est explicite (nœuds et transitions visibles, graphe Mermaid généré depuis
le code) et chaque exécution est traçable. LangChain reste confiné à `integrations/llm/`.

## D-02 — Le modèle lit et rédige, les règles décident

*Octobre 2026 · Adoptée*

**Contexte.** Un modèle de langage peut se tromper ou inventer. Les décisions commerciales (transfert,
rendez-vous, clôture) doivent être justifiables (OB-05) et ne jamais exclure un prospect de façon
autonome (art. 22 RGPD).

**Décision.** Le modèle produit une **sortie structurée** (intention, profil, confiance) et rédige le
texte. Le choix de l'action est fait par du code (`graph/policy.py::decide`), avec une justification
pour chaque décision. STOP et cas sensibles sont détectés par mots-clés, sans modèle.

**Conséquences.** Comportement prévisible et testable ; les seuils sont des valeurs de conception à
valider avec DATUM (en tête de `policy.py` et `services/scoring.py`).

## D-03 — Ports et adaptateurs

*Octobre 2026 · Adoptée*

**Contexte.** Plusieurs connecteurs étaient incertains (LinkedIn, Meta, agenda IONOS ou Google) et le
fournisseur de modèle devait rester interchangeable (NF-01, NF-02).

**Décision.** Le graphe ne dépend que d'interfaces (`graph/ports.py`). Chaque service est un adaptateur
choisi par configuration.

**Conséquences.** Changer Gemini pour OpenAI = une variable d'environnement. Le parcours complet se
teste avec des doublures. Coût : un peu plus de code de « plomberie ».

## D-04 — Gemini 2.5 Flash par défaut

*Octobre 2026 · Adoptée*

**Contexte.** Besoin d'un modèle rapide, peu coûteux, bon en français et en sortie structurée, avec
des embeddings chez le même fournisseur.

**Décision.** `gemini-2.5-flash` pour le texte, `gemini-embedding-001` pour le RAG, une seule clé.

**Conséquences.** Une seule dépendance externe pour l'IA. À vérifier avant la production : offre
payante (conditions d'utilisation des données) et quotas réels. Changer de modèle d'embeddings impose
`kb-reindex`.

## D-05 — PostgreSQL pour le métier, MongoDB pour les conversations

*Octobre 2026 · Adoptée*

**Contexte.** Le cahier des charges (§9.5) prévoit les conversations dans MongoDB.

**Décision.** Tables métier dans PostgreSQL ; un document MongoDB par conversation, messages embarqués.
Le contenu d'un message n'existe qu'à un seul endroit.

**Conséquences.** Pas de transaction entre les deux bases : toutes les écritures sont idempotentes
(identifiants externes) et réparables par rejeu. Limite de 16 Mo par conversation, largement suffisante.

## D-06 — RAG dans PostgreSQL (pgvector) plutôt qu'une base vectorielle dédiée

*Octobre 2026 · Adoptée*

**Contexte.** Quelques dizaines de documents, filtrage par programme, besoin de simplicité d'exploitation.

**Décision.** Extension pgvector dans la base existante, similarité cosinus, seuil de pertinence
`RAG_MIN_SCORE`.

**Conséquences.** Une base de moins à exploiter et à sauvegarder. À revoir seulement si le volume
devient très important.

## D-07 — Mode assisté par défaut

*Octobre 2026 · Adoptée*

**Contexte.** L'agent écrit à de vraies personnes au nom de DATUM.

**Décision.** Trois modes globaux : **assisté** (défaut, brouillons validés par un conseiller),
**auto** (administrateurs) et **manuel** (arrêt d'urgence accessible à tout conseiller).

**Conséquences.** Aucun message ne part sans validation humaine tant que l'auto n'est pas activé.
Charge de validation pour les conseillers : c'est voulu pendant la mise en route.

## D-08 — Tâches de fond dans le processus de l'API, protégées par un bail

*Octobre 2026 · À revoir*

**Contexte.** Le cahier des charges évoquait APScheduler ou Celery + Redis. Le volume attendu est faible.

**Décision.** Trois boucles `asyncio` dans le processus FastAPI (file de l'agent, relances, email). Un
bail MongoDB garantit une seule exécution par boucle et par conversation, même avec plusieurs instances.

**Conséquences.** Pas de broker à exploiter. Recommandation : un seul processus API. À revoir si la
charge augmente : extraire un worker dédié.

## D-09 — Email par IMAP/SMTP standard, réglable depuis la console

*Octobre 2026 · Adoptée*

**Contexte.** La boîte IONOS dédiée n'était pas encore disponible, et DATUM pourrait changer de fournisseur.

**Décision.** Bibliothèque standard Python (`imaplib`, `smtplib`), détection automatique des serveurs,
réglage depuis la console (mot de passe chiffré), sécurité par défaut : relève et envoi désactivés,
bac à sable de destinataires.

**Conséquences.** Fonctionne avec n'importe quelle boîte IMAP/SMTP. Microsoft 365 en OAuth n'est pas
géré. Recette sur la vraie boîte encore à faire.

## D-10 — Google Calendar par conseiller + Zoom

*Octobre 2026 · À revoir*

**Contexte.** Question ouverte avec DATUM : agenda Google ou IONOS ?

**Décision.** Google Calendar (compte de service, agenda partagé par chaque conseiller) et Zoom
Server-to-Server OAuth, derrière le port `Calendar`. Sans agenda : transfert au conseiller.

**Conséquences.** À confirmer avec DATUM. Si l'agenda est IONOS, il suffit d'écrire un autre adaptateur
du port `Calendar` (CalDAV par exemple), sans toucher au graphe.

## D-11 — Uniquement les API officielles

*Septembre 2026 · Adoptée*

**Contexte.** LinkedIn et Meta encadrent strictement l'automatisation (S-08).

**Décision.** Aucun scraping, aucune automatisation de navigateur sur les plateformes sociales.

**Conséquences.** Les connecteurs LinkedIn et Meta attendent des accès API officiels ; ils sont bloqués
tant qu'ils ne sont pas accordés.

## D-12 — Documentation dans le dépôt, version courte dans Notion

*Octobre 2026 · Adoptée*

**Contexte.** La documentation doit suivre le code et être livrée avec lui.

**Décision.** Documentation technique en Markdown dans `docs/`, mise à jour dans la même Pull Request
que le code. Notion porte l'accueil du projet, le suivi des tâches et le guide utilisateur.

**Conséquences.** En cas de désaccord, `docs/` fait foi.

## D-13 à D-28 — Décisions du 12 novembre 2026 (fin de la feuille de route d'audit)

*12 novembre 2026 · Adoptées par le responsable du projet. Celles marquées **DPO** sont des propositions à faire
valider par le DPO avant un pilote avec de vrais prospects.*

**Contexte.** La feuille de route issue de l'audit ([audit/reports/MODERNIZATION_ROADMAP.md](audit/reports/MODERNIZATION_ROADMAP.md)
§5) attendait ces arbitrages pour les lots 6, 7 et 10 et pour plusieurs règles métier.

| N° | Sujet | Décision | Mise en œuvre |
|---|---|---|---|
| D-13 | Sauvegardes hors serveur | Copie chiffrée vers un stockage objet S3 (Scaleway, OVH, Backblaze B2…) avec `rclone` ; l'accès et la clé de chiffrement sont configurés sur le serveur par le responsable, jamais dans Git | Lot 6 |
| D-14 | Alertes | Healthchecks.io (sauvegarde manquante ou en échec) et UptimeRobot (API injoignable), alertes par email | Lot 6 |
| D-15 | Environnement du pilote | Une instance `prod` séparée (`ENVIRONMENT=production`, simulateur coupé, documents fictifs exclus) ; `dev` reste l'instance d'essai | Lot 6, `deploiement.md` |
| D-16 | Mode automatique | Refusé en production pendant le pilote : chaque réponse est validée par un conseiller | Lot 6 |
| D-17 | **DPO** Conservation des prospects | Effacement automatique 3 ans après le dernier contact venant du prospect, purge planifiée chaque semaine | Lot 7 |
| D-18 | **DPO** Traces techniques | Décisions de l'agent (`agent_runs`) gardées 12 mois ; événements déjà traités (`agent_events`) 30 jours | Lot 7 |
| D-19 | **DPO** Rétention des sauvegardes | 7 jours sur le serveur, 30 jours hors serveur : un prospect effacé disparaît de toutes les copies en 30 jours au plus | Lot 6 |
| D-20 | Rétablir un consentement | Réservé à l'administrateur (déjà le cas) avec un **motif obligatoire** (preuve écrite, ex. « email du 12/11 ») enregistré dans `consent_events` | Règles métier |
| D-21 | Fuseau horaire | Le fuseau des Paramètres (Europe/Paris par défaut) s'applique partout (créneaux, relances) et l'heure proposée au prospect le précise | Règles métier (BIZ-003) |
| D-22 | Conseiller qui quitte l'équipe | Un conseiller désactivé compte comme « non affecté » : le rendez-vous va au responsable de campagne, sinon à l'agenda par défaut, sinon transfert | Règles métier (BIZ-002) |
| D-23 | Visibilité des prospects | Cloisonnement : un conseiller voit les prospects des campagnes dont il est responsable et ceux qui lui sont affectés ; la file « À attribuer » est réservée à l'administrateur ; administrateur et observateur voient tout. Filtrage côté serveur | Cloisonnement (SEC-006) |
| D-24 | **DPO** Personne effacée qui réécrit | Confirmé : sa fiche est recréée en consentement retiré ; un conseiller peut lui répondre, l'agent ne la relance jamais sans nouvel accord | Existant |
| D-25 | Modèle de langage | Clé Gemini **payante** obligatoire avant tout prospect réel (données non réutilisées) et accord de sous-traitance inscrit au registre (**DPO**) | Check-list de mise en production |
| D-26 | **DPO** Base légale des leads Meta | Consentement coché dans le formulaire Meta ; sans lui, le lead est créé sans consentement et l'agent ne lui écrit pas avant confirmation par un conseiller | Règles métier |
| D-27 | Seuils et termes sensibles | Réglables par l'administrateur dans Paramètres (bornés, valeurs actuelles par défaut) ; les valeurs restent à confirmer par DATUM | Seuils réglables |
| D-28 | Sessions et accès | Lot 10 fait avant la soutenance, en dernier et dans une PR à part ; double authentification des administrateurs reportée (évolution) ; documents officiels de la base de connaissances fournis et importés par le responsable | Lot 10, `rag.md` |

**Conséquences.** Les lots 6, 7 et 10 et le cloisonnement sont réalisés dans des PR séparées. Tant que le DPO n'a
pas validé D-17, D-18, D-19, D-24, D-25 et D-26, aucun prospect réel n'est traité en production.

## D-29 — Prospection sortante : premiers contacts après un import

*13 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Les listes importées (salons, webinaires, événements de DATUM) réunissent des personnes qui ont
accepté d'être recontactées. Le responsable veut qu'elles soient abordées dans le contexte de leur campagne,
sans préparer chaque premier message à la main.

**Décision.**
- L'agent n'écrit **en premier** (premier contact) qu'à une personne dont le consentement est **accordé** : case
  de l'import, colonne « consentement » du fichier (oui / non, ligne par ligne), case d'un formulaire, accord
  enregistré par un conseiller. Une personne qui écrit d'elle-même reçoit toujours sa réponse ; un désinscrit
  n'est jamais contacté.
- Depuis la campagne (onglet Prospects) ou à la fin d'un import, « Préparer les premiers contacts » met en file
  un premier message pour chaque personne éligible : consentement accordé, adresse email, étape « Nouveau » de
  cette campagne, jamais contactée. En mode assisté, chacun devient un brouillon « Premier contact » dans
  « À traiter », validable un par un ou par page après relecture.
- Les premiers contacts validés partent dans la fenêtre d'envoi des Paramètres, cinq par passage de la boîte
  (environ 300 par heure), pour ménager sa réputation et ses limites d'envoi.

**À confirmer avec le DPO.** La mention ou la case d'accord du formulaire d'inscription à l'événement : c'est elle
qui permet de cocher le consentement à l'import.

## D-30 — Remise à zéro des données d'une instance d'essai

*13 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Avant une réunion ou une démonstration, `dev` doit repartir d'une console vide (prospects,
campagnes, base de connaissances), sans perdre comptes, connecteurs ni réglages.

**Décision.** Commande `python -m app.cli reset-dev-data` : aperçu par défaut, effacement avec `--apply`,
refusée en production, sauvegarde faite juste avant par le responsable (`deploiement.md` §7 bis). C'est un outil
d'exploitation de l'instance d'essai, qui ne contient que des données de test : il efface toutes ses données
métier, pas seulement les fiches en `@demo.example.com`.

## D-31 — Mises à jour automatiques des dépendances : mensuelles, sans version majeure

*16 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Dependabot (AUDIT-OPS-004) ouvrait chaque lundi une PR par écosystème, plus une PR séparée pour
chaque version majeure (pytest, types Node, icônes) : huit PR en une journée, dont plusieurs à refuser.

**Décision.** Une PR groupée par écosystème le 1er de chaque mois (pip, npm, images Docker, actions), une seule
ouverte à la fois, versions majeures ignorées ; pour les images Docker, versions mineures aussi
(`python:3.12` → `3.15`). Une version majeure, ou de Python et de Node, se décide à la main, dans une PR dédiée. Les
failles connues restent signalées à chaque PR par la tâche CI `audit` (`pip-audit`, `npm audit`).

## D-32 — Transparence IA : mention selon la relecture, pas d'auto-présentation dans le texte

*17 novembre 2026 · Adoptée par le responsable du projet ; formulations à faire valider par DATUM et le DPO.*

**Contexte.** L'agent se présentait comme une IA dans le texte (« je suis l'assistant virtuel », « je suis une
intelligence artificielle et… »), en plus de la mention IA ajoutée en pied de chaque email. En production, chaque
message est relu et validé par un conseiller (D-16) : la phrase dans le texte était redondante, maladroite et
inexacte quand c'est un conseiller qui envoie.

**Décision.**
- Dans le texte, l'agent écrit au nom de DATUM Academy, ne se présente pas comme une IA de lui-même, ne se fait
  jamais passer pour un humain (ni prénom, ni « je suis conseiller ») et répond franchement s'il est interrogé.
- La mention IA reste obligatoire sous tout email rédigé par l'agent (AI Act, art. 50), avec deux formulations
  réglables dans Paramètres → Emails : « Message préparé avec l'aide d'un assistant IA et relu par un conseiller
  de DATUM Academy. » pour un brouillon validé ; « Ce message a été rédigé par un assistant virtuel (IA) de
  DATUM Academy. » pour un message parti sans relecture (mode automatique). Aucune des deux ne peut être vidée.
- Un message écrit à la main par un conseiller ne porte aucune mention, comme avant.

**Écarté pour l'instant.** Supprimer la mention des messages validés : l'exception de l'article 50 pour un contenu
relu sous responsabilité éditoriale vise les textes publiés pour informer le public, pas une conversation
commerciale, et une validation rapide (par lot) n'est pas une relecture éditoriale. À rouvrir seulement sur avis
écrit du DPO.

## D-33 — Technique de vente de l'agent : grille de qualification et entonnoir

*17 novembre 2026 · Adoptée par le responsable du projet ; grille et prérequis à confirmer par DATUM.*

**Contexte.** L'évaluation de conversations du 17/11 et l'étude des méthodes commerciales (CHAMP, SPIN,
questionnement en entonnoir, SONCAS, profil progressif) montrent un agent qui comprend et décide bien, mais
qualifie peu : deux informations seulement par programme, messages qui déroulent toute la fiche, conseiller
proposé à chaque message, avis d'admission (« votre profil correspond aux conditions »), question de
qualification toujours fermée, rendez-vous rarement proposé de lui-même.

**Décision.**
- **Grille de qualification**, recueillie une question à la fois, dans l'ordre de l'entonnoir : projet
  (question ouverte), niveau d'études ou situation professionnelle, rentrée visée, ville ou format (sur place,
  à distance) ; pour les entreprises, besoin et échéance. L'agent ne demande ni l'entreprise d'alternance ni le
  besoin de financement.
- **Façon de poser les questions** : ouverte sur le projet, alternative sur l'échéance et le format ; courte
  reformulation de ce que le prospect vient de dire ; messages de 80 mots au plus qui répondent à la question
  posée ; aucun avis d'admission ; pas d'offre de conseiller spontanée.
- **Rendez-vous** : quand la grille est complète et que le prospect pose une question qui annonce une décision
  (admission, rentrée, candidature), l'agent répond puis propose de vrais créneaux dans le même message, une
  seule fois. Sans agenda, la réponse part seule. Le seuil de score (D-27) reste une seconde voie.
- **« Je parle à un robot ? »** : une question sur l'interlocuteur, à laquelle l'agent répond franchement
  (D-32), pas une demande de conseiller, sauf demande explicite d'un humain.
- Messages écrits par le code (créneaux, confirmation) : « Bonjour » seulement au premier message de l'agent.
- **Prérequis**, pour orienter et pour le score, jamais pour annoncer une admission : Bachelor eBIHAR dès le Bac ;
  Master eBIHAR en M1 dès un Bac+3, en M2 dès un M1 ; Les Compagnons pour les personnes en poste, sans diplôme
  exigé. Si le profil correspond mieux à un autre programme, l'agent le suggère en une phrase, sans insister.
  Ces deux points (orientation, score fondé sur les prérequis) font l'objet d'une PR suivante.

**Mesure.** `eval-conversations` (profil lu, rendez-vous proposé à temps, types de questions, reformulations,
offres répétées, avis d'admission), avant et après.

