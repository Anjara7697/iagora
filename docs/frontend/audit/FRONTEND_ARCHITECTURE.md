# Architecture du frontend — existant et cible

Complète le [rapport général](FRONTEND_AUDIT.md). Tous les constats de ce document viennent de la lecture du
code, sauf mention contraire.

## 1. Existant

```
frontend/
  src/
    app/                 22 routes, un layout, un fichier de thème (heroui.css)
    components/
      *.tsx              29 composants à la racine (connecteurs, réglages, panneaux, ui.tsx…)
      ds/                couche design system au-dessus de HeroUI (17 fichiers)
      shell/             menu, menu du compte, thème
      todo/ conversations/ prospect/ prospects/ campaign/ knowledge/
      appointments/ settings/ simulator/ team/
    lib/
      api.ts             fetch, erreurs lisibles, téléchargement
      useApi.ts          chargement d'une ressource GET
      api/               openapi.json, schema.d.ts (généré), contract.ts
      types.ts           54 types écrits à la main
      labels.ts          libellés et formats
      *Nav.ts, url.ts    état des écrans dans l'adresse
      theme.ts, access.ts, kpi.ts, workQueue.ts…
  tests/                 18 fichiers Playwright, API simulée
  tests-api/             un parcours contre le vrai backend
```

### 1.1 Rendu

- App Router. `app/layout.tsx` est le seul composant serveur utile ; il monte `Providers`, `AppShell`,
  `Toaster`.
- 100 fichiers sur 128 portent `"use client"`, dont toutes les pages. Les cinq composants sans la directive
  (`Brand`, `SimulationNotice`, `ConversationView`, `TraceView`, `ConnectorIcons`) sont importés par des
  composants clients : ils sont donc clients aussi.
- Le build prérend 20 routes en statique (coquille vide) et 2 à la demande (`[id]`).
- Ce choix est cohérent avec le produit : console derrière authentification, session dans un témoin `HttpOnly`
  posé par l'API, données propres à l'utilisateur, aucun besoin de référencement. **Il n'y a pas lieu de
  déplacer les pages vers des composants serveur.**

### 1.2 Session et droits

- `AppShell` appelle `/auth/me` au montage (`components/AppShell.tsx:51`), expose l'utilisateur par contexte
  (`useCurrentUser`), redirige vers Mon compte tant que le mot de passe est temporaire (avec un
  `setInterval` de rattrapage, ligne 101).
- Une 401 sur n'importe quel appel renvoie à `/login` (`lib/api.ts:137`).
- Les droits affichés sont déduits du rôle (`lib/access.ts`) ; le backend reste la barrière.
- En-tête anti-CSRF sur toutes les requêtes ; aucun jeton lisible par la page.

### 1.3 Données

- `api<T>()` : un seul point de passage, `cache: "no-store"`, erreurs traduites (`humanError`).
- `useApi<T>(path)` : état `data / error / loading`, `keepPrevious`, `reload`, garde contre les réponses
  tardives. 76 usages ; 87 appels directs à `api()` pour les écritures.
- Synchronisation : événement `iagora:work-queue-changed` pour rafraîchir les compteurs de la file.
- Pas de cache partagé, de déduplication, d'annulation ni de mise à jour optimiste.

### 1.4 État

- Local (`useState`) partout ; deux contextes : utilisateur, réponses en cours de saisie (`ReplyDrafts`).
- État d'écran dans l'adresse par `replaceUrl` et un module par parcours. C'est le point fort de
  l'architecture : liens partageables, retour fidèle.
- `localStorage` : thème, menu réduit, nettoyage d'un ancien jeton. Rien de sensible.

## 2. Constats

**ARCH-01 — `AppShell` cumule quatre responsabilités** · P2 · effort M
- Fichier : `components/AppShell.tsx` (310 lignes, quatre `useEffect`).
- Contenu : session et écran d'attente, contexte utilisateur, compteur de la file, redirection de mot de
  passe, préférence de menu, commandes de la palette, mise en page.
- Conséquence : tout changement de mise en page touche le code de session ; `useCurrentUser` et `firstNameOf`
  s'importent depuis un composant de mise en page.
- Solution : `SessionProvider` (session, contexte, redirections), `useWorkQueueCount`, `AppLayout` (mise en
  page pure). Aucun changement de comportement.

**ARCH-02 — Aucune frontière d'erreur** · P1 · effort S
- Preuve : aucun `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` sous `app/`.
- Conséquence : une exception de rendu remplace toute la console par l'écran d'erreur par défaut de Next.js,
  en anglais, sans menu ni « Réessayer » ; une adresse inconnue donne la 404 par défaut.
- Solution : `app/error.tsx` (dans la coquille, avec `ErrorState` et « Réessayer »), `app/global-error.tsx`,
  `app/not-found.tsx` avec retour à Aujourd'hui.

**ARCH-03 — Deux panneaux latéraux** · P2 · effort M
- `components/Drawer.tsx` : portail, voile, piège à focus et Échap écrits à la main ; 7 écrans l'utilisent
  (filtres de prospects, équipe, parcours, documents, fiche prospect, intégrations, fiche campagne).
- `Drawer` de HeroUI : utilisé pour le menu mobile (`AppShell.tsx`).
- Conséquence : deux comportements d'ouverture, de focus et d'animation ; le premier ne rend pas la page
  inerte (A11Y-02).
- Solution : garder l'interface de `components/Drawer.tsx` (`open`, `onClose`, `title`, `eyebrow`, `icon`,
  `aside`) et la brancher sur le `Drawer` HeroUI. Les 7 appelants ne changent pas.
- Risque : la garde de saisie superposée (dialogue par-dessus le panneau) a un traitement particulier
  (lignes 43-45) ; à vérifier par les tests existants.

**ARCH-04 — Organisation de `components/`** · P3 · effort M
- 29 fichiers à la racine mêlent des domaines (`EmailSettings`, `MetaLeadSettings`, `ZoomSettings`,
  `CalendarSettings`, `CampaignForm`, `ErasePanel`…) et des primitives (`ui.tsx`, `Drawer.tsx`).
- `components/ui.tsx` réexporte des badges de `ds/` et contient `Skeleton`, `Loading`, `Pager`.
- Solution : déplacements seuls, par domaine, dans le dernier lot (§3).

**ARCH-05 — Accès contrôlé côté client** · P3 · effort M · hypothèse
- Sans session, la coquille s'affiche, puis `/auth/me` échoue et renvoie à la connexion.
- Un contrôle dans un middleware éviterait cet aller-retour, à condition que le témoin de session soit
  visible du serveur Next.js. En production, console et API partagent le domaine (Caddy) ; à vérifier pour le
  développement local, où elles sont sur deux ports.
- Non prioritaire : aucune donnée n'est exposée, l'API refuse la requête.

Suspense : chaque page qui lit `useSearchParams` est enveloppée d'un `<Suspense>`, comme Next.js l'exige. Les
replis diffèrent (`Skeleton` ou rien) ; à uniformiser dans le lot 2.

## 3. Cible

Principe : **garder l'architecture, clarifier les frontières**. Pas de bibliothèque d'état ni de requêtes
ajoutée ; pas de migration vers des composants serveur.

```
src/
  app/                   routes ; error.tsx, global-error.tsx, not-found.tsx ajoutés
  features/              un dossier par domaine : composants, navigation d'URL, libellés propres
    todo/ conversations/ prospects/ campaigns/ appointments/ knowledge/
    integrations/ settings/ team/ simulator/ account/ agent/
  components/
    ds/                  design system : seuls ces fichiers importent @heroui/react
    shell/               AppLayout, AppNav, AccountMenu, CommandPalette
  lib/
    api/                 client, erreurs, schema généré, contrat
    session/             SessionProvider, useCurrentUser, droits
    data/                useApi (annulation, déduplication), useDebouncedValue, événements
    format/              dates, noms, initiales, rôles
```

Règles de dépendance :

1. `app/` importe `features/` et `components/` ; jamais l'inverse.
2. Une `feature` n'importe pas une autre `feature` ; ce qui est partagé monte dans `components/ds` ou `lib`.
3. Seul `components/ds` importe `@heroui/react` (aujourd'hui : 43 fichiers hors `ds` l'importent, dont
   une partie pour `toast` seulement). Exception admise : `toast`, réexporté par `ds`.
4. Les pages ne contiennent que la lecture de l'adresse, les appels et l'assemblage.

Couche de données cible, dans `useApi` (détail dans la [dette technique](FRONTEND_TECHNICAL_DEBT.md) §2) :

- annulation par `AbortController` au changement de chemin et au démontage ;
- déduplication des GET identiques en cours ;
- `useDebouncedValue` pour les recherches ;
- interface inchangée (`data`, `error`, `loading`, `reload`) : aucun écran à réécrire.

Si, après ces ajouts, le besoin de cache entre écrans se confirme (retour de fiche vers liste), une
bibliothèque de requêtes pourra être évaluée dans un lot séparé. Ce n'est pas proposé aujourd'hui.

## 4. Ce qui ne change pas

- Le client `api()` et la traduction des erreurs.
- L'état des écrans dans l'adresse et ses modules.
- Le contrat de types vérifié à la compilation.
- Les gardes de saisie et les confirmations.
- Le script de thème dans `<head>` et les en-têtes de sécurité de `next.config.ts`.
- Les contrats d'API : toute demande au backend (tri, compteurs) est une proposition à coordonner, pas un
  prérequis.
