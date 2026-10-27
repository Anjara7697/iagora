# Confirmer une inscription

La réception d'un dossier place le parcours à **Candidature déposée** après vérification par le conseiller. Elle ne prouve pas que l'école a accepté l'inscription.

Lorsque l'école confirme l'admission, un conseiller ou administrateur ouvre la fiche prospect, déplie **Suivi du parcours · Affectation et étape**, puis remplit **Confirmer l'inscription** sur le bon parcours de campagne. Il choisit la nature de la preuve, saisit une référence permettant de la retrouver (par exemple l'email du service admissions et sa date), et peut ajouter une note. Il vérifie la preuve dans sa source avant de confirmer.

La confirmation passe le parcours de **Candidature déposée** à **Converti**, conserve le type et la référence de preuve dans l'historique avec l'identifiant du conseiller, puis annule les relances de ce parcours. Les observateurs ne peuvent pas confirmer. Une nouvelle confirmation d'un parcours déjà converti est refusée. Le changement d'étape générique ne permet plus de choisir directement **Converti** ; l'API dédiée est `POST /api/v1/campaign-prospects/{id}/confirm-enrollment`.

Ce lot constitue une attestation humaine traçable. IAGORA ne contacte pas encore le système d'admission de l'école pour contrôler automatiquement la preuve. Ne placer aucune clé ni donnée sensible inutile dans la référence ou la note.
