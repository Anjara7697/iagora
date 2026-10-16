# Conformité à la maquette IA GORA

## Référence et méthode

Référence visuelle : fichier utilisateur `IA GORA.html`, SHA-256
`421407a8cd12363b1948448f1cdc9572564423635c0bc44481fcdf25bfdac799`.
L'export contient ses propres données et interactions simulées. Il sert de
référence d'interface, sans autoriser d'opération, imposer des droits ou prouver
la disponibilité d'une intégration. Ses prix, personnes et indicateurs ne sont
pas copiés dans les données de l'application.

Comparaison : rendu de l'export dans Chromium, lecture des composants Next.js et
des contrats API, captures de contrôle sur données de test, tests navigateur sur
bureau et mobile. Ces tests emploient une API simulée ; les tests backend et la
CI vérifient séparément les données, migrations et services SQL/MongoDB réels.
Ce travail rapproche les écrans existants ; il ne constitue pas une validation
complète de tous les modules dessinés dans l'export.

## Écarts traités dans cette PR

| Écran | Écart constaté | Résultat |
|---|---|---|
| Cadre commun | En-tête trop haut, filtres en pilules, carte agent très encadrée | En-tête compact, filtres rectangulaires, état de l'agent dans le pied du menu ; confirmation d'arrêt conservée. |
| Aujourd'hui | Les quatre familles ouvraient la même file sans sélection | Chaque carte ouvre son filtre `kind` ; compteurs fournis par l'API. |
| Conversations | Titre dupliqué, marge et cartes séparant liste et échange | Panneaux continus, information de communication séparée, métadonnées d'auteur hors des bulles, distinction prospect/agent/conseiller. |
| À traiter | Panneaux flottants, recommandation sans bandeau, brouillon encadré en pointillé | Panneaux continus, bandeau violet de recommandation, aperçu et pied de message structurés, actions existantes conservées. |
| Conversations / À traiter mobile | Liste et détail empilés obligeant à parcourir la page | Détail sélectionné et bouton explicite de retour ; filtre de la file À traiter préservé dans l’URL. |
| Fiche prospect | Long formulaire au premier plan, action de l'agent enfouie, champs techniques bruts | Deux colonnes : recommandation/profil/échanges et identité/parcours/décisions ; édition du suivi dépliable ; libellés connus traduits. |
| Fiche prospect | Contexte campagne/source/score peu visible | Badges dans l'en-tête, conseiller dans le parcours, scores par source conservés ; décision de l'agent datée quand disponible. |
| Prospects | Filtre source disponible dans l'API mais absent de l'écran | Sélection d'une source après choix de campagne, remise à zéro et export avec les mêmes critères. |
| Prospects / CSV | Filtrer une campagne sélectionnait les personnes mais affichait/exportait aussi leurs autres parcours | Projection des rattachements selon campagne/source/étape/intérêt/conseiller ; `source_id` exposé dans les rattachements des listes/fiches pour éviter de le confondre avec `campaign_source_id`. |
| Traités | Libellé « aujourd'hui » pour une fenêtre API glissante de 24 h | Libellé explicite « Traités (24 h) ». |
| Entonnoir | Risque de lire une répartition actuelle comme des passages cumulés | La vue annonce « Répartition par étape actuelle » ; aucun taux historique inventé. |

Les erreurs, états vides, désinscriptions et accès observateur restent pris en
charge. Aucun compteur manquant, confiance, priorité ou statut de livraison n'est
créé pour reproduire les chiffres d'exemple de la maquette.

## Écarts fonctionnels et décisions à prendre

| Sujet de la maquette | État constaté dans l'application | Suite nécessaire |
|---|---|---|
| Doublons à arbitrer | Déduplication technique existante, sans file de comparaison/fusion humaine | Définir les décisions de rapprochement et leur audit, puis développer API et interface ; pas de cinquième compteur fictif. |
| Dashboard / Analytics | Synthèse actuelle et statistiques de campagnes disponibles ; pages de pilotage distinctes et séries historiques absentes | Définir les périodes, dénominateurs et indicateurs communs, fournir les agrégations puis les vues. |
| Rendez-vous | Port calendrier non configuré ; parcours Calendar/Zoom réel absent | Accès de test, adaptateurs, réservation, confirmation, rappel et recette de bout en bout. |
| Agent / Paramètres / équipe / audit / RGPD | Quelques commandes API existent, pas de module complet équivalent à la maquette | Délimiter chaque écran selon les API réelles ; traiter notamment gestion des comptes et effacement/conservation. |
| SLA, priorité commerciale, intention et confiance par dimension | Certaines priorités de tâches et confiances de brouillon existent ; pas les six dimensions complètes de la maquette | Modéliser et tracer les données avant d'ajouter les filtres/badges correspondants. |
| Relances arrêtées après conversion | Pas d'annulation explicite dans le changement manuel d'étape ni de garde sur l'étape terminale dans l'exécuteur de relances | Vérifier et corriger ce parcours avec une régression avant la recette SMTP réelle ; ne pas annoncer l'annulation dans l'interface actuelle. |
| Email et autres canaux | Code email disponible ; recette IONOS réelle en attente ; autres connecteurs non validés | Accès IONOS, destinataire autorisé et documents métier ; recette réelle puis second canal. |

## Contradictions entre sources

1. **Observateur.** La maquette réserve principalement l'observateur au pilotage
   (certaines descriptions internes de l'export divergent aussi). L'API actuelle
   autorise une consultation plus large des prospects, échanges et connaissances.
   Cette PR conserve les contrôles serveur actuels. Une restriction de périmètre
   demandera une décision explicite et une modification API avec tests d'accès.
2. **Désinscription.** L'export parle d'un verrouillage définitif « aucune
   dérogation humaine ». L'API permet à un administrateur de consigner un nouveau
   consentement explicite ; les anciens messages bloqués restent bloqués. La PR
   conserve ce comportement vérifié et sa confirmation ; elle ne transforme pas
   une différence de présentation en changement de politique de consentement.
3. **Mesures.** Les données statiques de la maquette montrent des passages cumulés,
   taux et SLA. L'API expose principalement des états actuels et des fenêtres de
   24 h/30 jours. Les libellés suivent la mesure réellement calculée.

## Plan de continuation recommandé

1. Valider les écrans de cette PR avec les rôles ADMIN/ADVISOR/VIEWER et appliquer
   les vérifications bureau/mobile avant fusion.
2. Traiter les garde-fous de relance après conversion, puis reprendre le lot 3
   IONOS dès réception des accès et documents validés. Cela conditionne une
   démonstration réelle du parcours commercial.
3. Développer le pilotage sur des indicateurs définis et des données persistées,
   puis les rendez-vous réels selon la disponibilité des accès Calendar/Zoom.
4. Compléter les modules d'administration et RGPD, après arbitrage des droits
   et des règles de conservation.
