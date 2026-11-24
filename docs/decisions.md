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

## D-34 — Finitions de la technique de vente : promesse tenue, question non reposée

*17 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** L'évaluation de conversations après D-33 confirme les progrès (questions ouvertes et alternatives,
messages deux fois plus courts, rendez-vous proposé à temps, plus d'offre de conseiller spontanée) mais montre
trois défauts : le modèle écrit « je préfère laisser un conseiller vous apporter cette précision » sans le signal
`[CONSEILLER]`, si bien que personne n'est prévenu (la consigne l'y invitait) ; la question de qualification
restée sans réponse revient à chaque message (trois fois de suite) ; un avis d'admission adouci passe encore
(« ce qui correspond au profil recherché »).

**Décision.**
- Un renvoi vers un conseiller écrit en toutes lettres (« laisser un conseiller… », « un conseiller vous
  précisera… », « je n'ai pas cette information ») vaut le signal : le message n'est pas envoyé et la question
  est transférée (`question_hors_base`). Exceptions : quand des créneaux suivent la réponse dans le même message,
  et en réponse à « je parle à un robot ? ». La consigne du modèle ne l'invite plus à écrire cette phrase.
- Quand le dernier message de l'agent posait une question et que le prospect répond par une autre question,
  sans rien dire de nouveau sur lui, l'agent répond sans poser de question ; la grille reprend au message
  suivant.
- La consigne interdit aussi « correspond au profil recherché » et « adapté », et de rapprocher les conditions
  citées du parcours du prospect.

**Mesure.** `eval-conversations` : nouvel indicateur « questions reposées » (objectif 0), avis d'admission
élargi à la formule adoucie, transferts manqués.

## D-35 — Page Évaluation : lancer, suivre et comparer les évaluations depuis l'application

*17 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Les trois évaluations (cas un par un, conversations, base de connaissances) se lancent en ligne de
commande et produisent des fichiers à copier hors du conteneur ; la comparaison avant/après se fait à la main. Pour
le suivi du projet et le mémoire, il faut un historique lisible et des comparaisons directes.

**Décision.**
- Une page **Évaluation**, sur le modèle du Simulateur : outil de recette, **réservée aux administrateurs** (un
  passage avec le vrai modèle consomme du quota), **refusée en production** par l'API elle-même.
- Un passage joue les mêmes fonctions que la ligne de commande (mêmes chiffres), en tâche de fond dans l'API,
  **un seul à la fois**, annulable (les résultats déjà obtenus sont gardés). Tous les réglages de la ligne de
  commande sont proposés : suite, faux ou vrai modèle, recherche lexicale ou réelle, pause, cas ou conversations
  choisis, catégories, variante d'ablation, prix par million de jetons, seuil de recherche essayé, nettoyage.
- Les passages sont gardés dans MongoDB (`eval_runs`) avec le rapport complet (échanges compris) et des
  **indicateurs normalisés** (valeur, affichage, sens du progrès), identiques pour un passage lancé depuis la
  page et pour un rapport `--json` **importé** : l'historique part de la première mesure.
- Seules des données fictives (`@demo.example.com`) sont créées ; elles sont supprimées à la fin si demandé.

**Suite.** L'interface (partie 1b), puis les prospects simulés par un second modèle (partie 2), branchés sur la
même page comme une suite supplémentaire, entièrement réglable.


## D-36 — Démonstration eBIHAR jumelle de la campagne

*18 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Les efforts portent sur la campagne eBIHAR à venir. Ses documents officiels restent hors de Git
(D-28), mais les tests du dépôt jouaient un eBIHAR fictif très différent (alternance, rentrée et candidatures à date
fixe, tarifs réservés au conseiller) : ils n'exerçaient pas les réflexes que la campagne demande.

**Décision.**
- La fiche eBIHAR de démonstration est **jumelle** des vrais documents : mêmes sujets et même forme (master en ligne,
  accès selon le diplôme, rentrée et date limite d'inscription, coût et tarif réduit pour les salariés d'un
  partenaire, certifications, examens surveillés), **valeurs inventées** (10 mois, 6200 euros, novembre, partenaire
  « Nuvola Systems »…), et **mêmes manques** (financement, CPF, paiement en plusieurs fois, admission avec une
  licence) : l'agent doit y répondre ou passer la main exactement comme sur la vraie campagne.
- Le prix est donné quand le prospect le demande et que la base le contient ; la FAQ de démonstration ne renvoie
  plus les tarifs au conseiller.
- Les cas et conversations eBIHAR du dépôt suivent la même grille que le jeu de cas local de la campagne ; la mesure
  de la campagne elle-même se fait sur les vrais documents avec ce jeu local (`--cas`).
- Les vrais faits ne passent jamais dans la démonstration (D-28).

**Conséquences.** Les mesures faites sur l'ancienne démonstration ne sont plus comparables aux nouvelles : une
nouvelle mesure de référence est faite avant toute modification de l'agent. Les démonstrations Les Compagnons et
Master en alternance sont revues avec la liste des programmes.

## D-37 — Agent adapté à la campagne eBIHAR (master en ligne)

*19 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Mesure de la campagne eBIHAR sur les vrais documents (jeu de cas local, `--cas`, modèle
`gemini-3.5-flash-lite` seul) : après import des fiches, 27 cas sur 29 et 5 conversations sur 7 conformes, aucun
chiffre inventé envoyé. Écarts restants : transferts inutiles quand une fiche donne plusieurs cas (durée selon le
diplôme) ou un tarif indicatif, niveau d'études redemandé à un prospect qui avait donné son diplôme, esquive ou
contenu de programme déduit de la seule liste des formations, « gratuites » refusé quand la source dit « gratuit ».

**Décision.**
- **Grille eBIHAR** : projet, diplôme, situation actuelle (en études ou en poste), rentrée visée. eBIHAR se suit
  en ligne : la question sur le lieu ou le format est retirée.
- **Liste des programmes** : seule la ligne eBIHAR change (« Master of Science en ligne en intelligence
  artificielle et big data, pour les étudiants ») ; Les Compagnons et le Master en alternance restent tels quels
  jusqu'à confirmation par DATUM.
- **Réponse selon les cas** : quand les extraits donnent plusieurs cas ou une information indicative, l'agent
  répond avec le cas du prospect ou cite les cas, au lieu de signaler une question sans réponse.
- **Pas de contenu déduit de la liste des formations** : sans extrait, l'agent ne décrit ni cours ni matières ;
  une question sur le contenu n'est pas une demande de catalogue.
- **Profil connu** : les informations déjà données sont rappelées au modèle comme à ne jamais redemander, même
  sous une autre forme.
- **Garde-fou** : un terme qui engage l'école est sourcé si sa forme de base figure dans les sources
  (« gratuites » par « gratuit ») ; sans source, il reste bloqué.

**Mesure.** Même jeu de cas local et même modèle qu'avant ce changement ; démonstration jumelle (D-36) pour la
non-régression.

## D-38 — Premier contact selon le canal : objet d'email et longueur

*19 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Le premier contact était écrit de la même façon quel que soit le canal, et chaque email de
prospection partait avec l'objet fixe « DATUM Academy ». Un email de prospection et un message de messagerie
n'ont ni la même longueur ni la même forme ; l'objet décide de l'ouverture de l'email.

**Décision.**
- **Consigne de canal** donnée au modèle : email de premier contact avec une ligne « Objet : … » (10 mots au
  plus, personnalisé), une accroche liée à ce que l'on sait du prospect, puis une question, en 120 à 180 mots ;
  réponse par email en 80 mots au plus ; messagerie (Messenger, Instagram, LinkedIn…) en 2 ou 3 phrases,
  50 mots au plus, sans objet. Un canal inconnu est traité comme une messagerie.
- **Objet écrit par l'agent** : la ligne « Objet : » est séparée du message, nettoyée et bornée, vérifiée par le
  garde-fou avec le message (NF-10), puis utilisée à l'envoi ; sans objet, l'objet de secours « DATUM Academy ».
  Une campagne pourra imposer son propre objet (PR des ressources de campagne).
- **Personnalisation** : l'accroche s'appuie sur le profil et la source du contact ; si l'on ne sait rien, le
  message reste général, sans rien supposer.
- **Mesure** : les cas indiquent leur canal ; l'évaluation contrôle l'objet attendu et la longueur
  (indicateur « Forme selon le canal »).

**Suite.** Ressources de campagne (fichiers et liens validés, garde-fou des liens), puis design de l'email DATUM et
pièces jointes.

## D-39 — Ressources de campagne : liens validés et objet imposé

*19 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Un email de prospection contient souvent un lien (inscription, programme, webinaire). Rien
n'empêchait le modèle d'inventer une adresse, et chaque campagne doit pouvoir fixer ce qu'elle partage.

**Décision.**
- Chaque campagne porte ses **liens validés** (nom, adresse en https, quand le proposer ; 20 au plus) et un
  **objet imposé** facultatif pour le premier email (« {prénom} » remplacé par le prénom), réglés par
  l'administrateur dans Réglages → « Pour l'agent ».
- L'agent reçoit ces liens avec la consigne de n'en proposer un que s'il répond au besoin du prospect, en
  recopiant l'adresse exacte ; il choisit lui-même, et en mode assisté le conseiller voit le lien dans le
  brouillon.
- **Garde-fou** : un lien qui ne figure ni dans les liens de la campagne ni dans les sources validées est traité
  comme une information non sourcée (nouvel essai plus strict, puis transfert) : jamais envoyé.
- L'objet imposé remplace celui de l'agent ; sans objet imposé, l'objet de l'agent (D-38), sinon l'objet de
  secours.

**Suite.** Fichiers joints (brochure…) avec le design de l'email DATUM, dans la PR suivante.

## D-40 — Design des emails de l'école (modèle DATUM)

*20 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Les emails de l'agent avaient une mise en page simple (nom, liseré). DATUM a un modèle d'email :
bandeau sombre avec le logo et une phrase d'accroche, corps clair, signature de l'équipe avec contact, adresse et
liens des réseaux.

**Décision.**
- **Gabarit dans le code**, sur ce modèle : bandeau (image https de l'école si renseignée, sinon bandeau dessiné
  aux couleurs de l'école avec le nom ou le logo et la phrase d'accroche, lisible sans images), corps, signature
  de l'école (équipe, établissement, email de contact, adresse, liens « Libellé | https://… »), puis mention IA et
  désinscription. Le texte brut reprend la signature et les liens.
- **Contenu dans Paramètres → Emails** (base de données, hors Git, D-28) ; l'aperçu de Paramètres le montre avec
  les valeurs saisies.
- Sécurité inchangée : tout texte est échappé, seules les adresses https et un email de contact valide sont
  repris, la couleur est validée.

**Suite.** Image du bandeau intégrée à l'email (sans hébergement) et fichiers joints de campagne (PR suivante).

## D-41 — Bandeau chargé dans Paramètres et intégré à l'email

*20 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Le bandeau de l'école est une image. Une image hébergée (D-40) demande une adresse https publique,
et beaucoup de messageries bloquent les images distantes par défaut. L'école n'a pas forcément d'hébergement.

**Décision.**
- **Chargement dans Paramètres → Emails** : PNG ou JPEG, 400 ko au plus, vérifié sur son contenu (pas seulement
  l'extension). Gardé en base de données (hors Git, D-28), remplaçable et retirable.
- **Intégré à chaque email** comme image liée au message (`multipart/related`, `cid:`) : rien à héberger, et
  l'image s'affiche sans téléchargement distant dans la plupart des messageries.
- Ordre de priorité du bandeau : image chargée, sinon image https, sinon bandeau dessiné (D-40).
- L'aperçu de Paramètres montre l'email avec le bandeau chargé. Seules les sources `cid:` et les images PNG/JPEG
  intégrées sont acceptées ; toute autre source est ignorée.

**Suite.** Fichiers joints de campagne (brochure), joints par l'agent selon le besoin et visibles dans les
brouillons (PR suivante).

## D-42 — Documents de campagne joints par l'agent

*20 novembre 2026 · Adoptée par le responsable du projet.*

**Contexte.** Le premier email de prospection doit pouvoir porter la brochure du programme. Les ressources se
règlent par campagne (D-39), et l'agent décide quand les utiliser.

**Décision.**
- **Documents par campagne**, chargés dans l'onglet Réglages de la campagne (administrateur) : PDF, PNG ou JPEG,
  vérifiés sur leur contenu, 4 Mo au plus (sous la taille maximale d'une requête), 5 documents au plus, un nom
  unique pour l'agent et « quand le joindre ». Gardés en base de données (hors Git, D-28) ; chacun peut les
  télécharger pour les relire.
- **L'agent choisit** : sur l'email seulement, il reçoit la liste des documents et en joint un (deux au plus)
  quand il répond au besoin du prospect, par une ligne « Pièce jointe : <nom exact> » retirée du message. Un nom
  inconnu n'est jamais joint. Sur la messagerie, aucune pièce jointe.
- **Garde-fou** : un message qui annonce un document (« ci-joint », « en pièce jointe ») sans document joint est
  refusé comme une information non sourcée (nouvel essai plus strict, puis transfert au conseiller).
- **Visible avant validation** : en mode assisté, le brouillon montre la pièce jointe et permet de la relire ; le
  fil de la conversation l'indique sous le message.
- **À l'envoi**, le document est rechargé et joint à l'email. S'il a été retiré de la campagne entre-temps, le
  message est bloqué (il l'annonce peut-être) au lieu de partir sans lui.

**Suite.** Mesurer le premier contact avec la brochure ; retirer une pièce jointe depuis le brouillon si le besoin
apparaît.

## D-43 — Recherche documentaire avec le contexte du prospect

**Contexte.** La recherche (RAG) n'utilisait que le dernier message du prospect. Une question de suivi très courte
(« et le prix ? ») n'a pas de sens seule : rien n'était trouvé et l'agent transférait au conseiller à tort.

**Décision.**
- Quand le prospect pose une question de moins de six mots, la requête de recherche est complétée par ses deux
  messages précédents. Une question plus longue est cherchée seule.
- Sans appel supplémentaire au modèle : règle déterministe (`policy.retrieval_query`), donc sans coût ni latence en plus.
- Seuls les messages du prospect sont ajoutés : ce que l'agent a écrit n'est pas une source. Le seuil de pertinence et
  les garde-fous (D-34, NF-10) ne changent pas.

**Suite.** Mesurer l'effet avec `eval-conversations` sur des questions de suivi ; une réécriture de la requête par le
modèle reste possible si la règle ne suffit pas.

