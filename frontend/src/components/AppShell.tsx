"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError, getToken, setToken } from "@/lib/api";
import { canAccessSettings, canUseSimulator } from "@/lib/access";
import { pageSubtitle, pageTitle } from "@/lib/labels";
import AgentModeCard from "./AgentModeCard";
import { ReplyDraftsProvider, ReplyLogoutButton } from "./ReplyDrafts";
import { WORK_QUEUE_CHANGED } from "@/lib/workQueue";
import type { User } from "@/lib/types";

const UserContext = createContext<User | null>(null);
export const useCurrentUser = () => useContext(UserContext);
const ROLE_LABELS = {
  ADMIN: "Administrateur",
  ADVISOR: "Conseiller",
  VIEWER: "Observateur",
};
type NavItem = {
  href?: string;
  label: string;
  badge?: boolean;
  /** Écran prévu par la maquette, pas encore développé : affiché grisé, sans lien. */
  soon?: boolean;
  adminOnly?: boolean;
};
const NAV_GROUPS: { name: string; items: NavItem[] }[] = [
  {
    name: "Travail",
    items: [
      { href: "/", label: "Aujourd’hui" },
      { href: "/todo", label: "À traiter", badge: true },
      { href: "/conversations", label: "Conversations" },
      { href: "/appointments", label: "Rendez-vous" },
      { href: "/prospects", label: "Prospects" },
    ],
  },
  {
    name: "Pilotage",
    items: [
      { href: "/campaigns", label: "Campagnes" },
      { label: "Dashboard", soon: true },
      { label: "Analytics", soon: true },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { label: "Agent", soon: true },
      { href: "/knowledge", label: "Knowledge Base" },
    ],
  },
  {
    name: "Administration",
    items: [
      { href: "/team", label: "Équipe", adminOnly: true },
      { href: "/integrations", label: "Intégrations", adminOnly: true },
      { href: "/settings", label: "Paramètres" },
    ],
  },
];

/** Prénom affichable à partir de l'identifiant (« nadia.cohen » → « Nadia »). */
export const firstNameOf = (username: string) => {
  const first = username.split(/[.\s_@-]+/).filter(Boolean)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
};
const displayNameOf = (username: string) =>
  username
    .split("@")[0]
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

const initialsOf = (name: string) => {
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  return (
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
      : name.slice(0, 2)
  ).toUpperCase();
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) {
      setUser(null);
      return;
    }
    let cancelled = false;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setError(null);
    api<User>("/auth/me")
      .then((value) => {
        if (!cancelled) setUser(value);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof ApiError ? err.message : "Connexion impossible",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [isLogin, router, attempt]);

  // Nombre d'éléments à traiter (badge du menu) : brouillons, transferts, incidents.
  useEffect(() => {
    if (!user || user.must_change_password) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      api<{ total: number }>("/todo?limit=1")
        .then((page) => { if (active && current === request) setWaiting(page.total); })
        .catch(() => { if (active && current === request) setWaiting(null); });
    };
    refresh();
    window.addEventListener(WORK_QUEUE_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(WORK_QUEUE_CHANGED, refresh);
    };
  }, [user, pathname]);

  // Mot de passe temporaire : seul « Mon compte » est accessible tant qu'il n'est pas changé.
  const mustChange = !!user?.must_change_password;
  useEffect(() => {
    if (mustChange && pathname !== "/account") router.replace("/account");
  }, [mustChange, pathname, router]);

  // Menu du compte : fermé au clic extérieur, à Échap et au changement de page.
  useEffect(() => {
    if (!accountOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node))
        setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);
  useEffect(() => setAccountOpen(false), [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navOpen]);

  if (isLogin) return <>{children}</>;
  if (!user)
    return (
      <main className="center">
        <div className="card" role={error ? "alert" : "status"}>
          {error ? (
            <>
              <p className="error">{error}</p>
              <button onClick={() => setAttempt((v) => v + 1)}>
                Réessayer
              </button>
            </>
          ) : (
            "Chargement de votre espace…"
          )}
        </div>
      </main>
    );

  const isAdmin = user.role === "ADMIN";
  const inSimulator = pathname === "/simulator" && canUseSimulator(user.role);
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        i.href &&
        (isAdmin || !i.adminOnly) &&
        (i.href !== "/settings" || canAccessSettings(user.role)),
    ),
  })).filter((g) => g.items.length > 0);
  // Écrans prévus mais pas encore développés : regroupés dans une seule ligne repliée.
  const upcoming = NAV_GROUPS.flatMap((g) => g.items.filter((i) => i.soon));
  const title = pageTitle(pathname);
  const subtitle =
    pathname === "/settings" && !isAdmin && canUseSimulator(user.role)
      ? "Tests et démonstration"
      : pageSubtitle(pathname);
  return (
    <UserContext.Provider value={user}>
      <ReplyDraftsProvider key={user.id}>
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <div className={`app-layout ${navOpen ? "nav-open" : ""}`}>
        <button
          className="nav-scrim"
          aria-label="Fermer le menu"
          aria-hidden={!navOpen}
          tabIndex={navOpen ? 0 : -1}
          onClick={() => setNavOpen(false)}
        />
        <aside className="sidebar" id="app-navigation">
          <Link href="/" className="brand" onClick={() => setNavOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              ▪
            </span>
            IAGORA<span className="version">2.0</span>
          </Link>
          <nav aria-label="Navigation principale">
            {groups.map((group) => (
              <div key={group.name}>
                <p className="nav-group">
                  {group.name === "Administration" && !isAdmin
                    ? "Réglages"
                    : group.name}
                </p>
                {group.items.map((link) => {
                  if (!link.href) return null;
                  const active =
                    pathname === link.href ||
                    (link.href !== "/" &&
                      pathname.startsWith(`${link.href}/`)) ||
                    (link.href === "/settings" && inSimulator);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`nav-item ${active ? "active" : ""}`}
                      onClick={() => setNavOpen(false)}
                    >
                      {link.label}
                      {link.badge && waiting ? (
                        <span
                          className="nav-count"
                          aria-label={`${waiting} en attente`}
                        >
                          {waiting}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
            {upcoming.length > 0 && (
              <details className="nav-upcoming">
                <summary>
                  À venir
                  <span className="nav-upcoming-count">{upcoming.length}</span>
                </summary>
                <ul aria-label="Écrans prévus, pas encore disponibles">
                  {upcoming.map((item) => (
                    <li key={item.label}>{item.label}</li>
                  ))}
                </ul>
              </details>
            )}
          </nav>
          {!mustChange && (
            <AgentModeCard
              readOnly={user.role === "VIEWER"}
              refreshKey={pathname}
            />
          )}
        </aside>
        <div className="workspace">
          <header className="app-header">
            <button
              className="nav-toggle"
              aria-label={navOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={navOpen}
              aria-controls="app-navigation"
              onClick={() => setNavOpen(!navOpen)}
            >
              ☰
            </button>
            <strong>{title}</strong>
            {subtitle && (
              <span className="header-subtitle muted">{subtitle}</span>
            )}
            <span className="spacer" />
            <form
              className="header-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = search.trim();
                router.push(
                  q ? `/prospects?q=${encodeURIComponent(q)}` : "/prospects",
                );
                setNavOpen(false);
              }}
            >
              <input
                type="search"
                aria-label="Rechercher un prospect"
                placeholder="Nom ou email du prospect…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            {inSimulator ? (
              <span
                className="simulation-header-badge"
                role="status"
                aria-label="Mode du simulateur"
              >
                Test · données fictives
              </span>
            ) : (
              waiting !== null && (
                <Link href="/todo" className="todo-pill">
                  <span
                    className={`dot ${waiting > 0 ? "warn" : ""}`}
                    aria-hidden="true"
                  />
                  {waiting > 0 ? `${waiting} à traiter` : "Rien à traiter"}
                </Link>
              )
            )}
            <div className="account-menu" ref={accountRef}>
              <button
                className="account-trigger"
                aria-label={`Menu du compte : ${displayNameOf(user.username)}, ${ROLE_LABELS[user.role]}`}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                onClick={() => setAccountOpen(!accountOpen)}
              >
                <span className="user-avatar" aria-hidden="true">
                  {initialsOf(user.username)}
                </span>
                <span className="account-who">
                  <span className="account-name">
                    {displayNameOf(user.username)}
                  </span>
                  <span className="account-role">{ROLE_LABELS[user.role]}</span>
                </span>
                <span className="account-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {accountOpen && (
                <div className="account-popover" id="account-menu" role="menu">
                  <p className="account-popover-head">
                    <strong>{user.username}</strong>
                    <span className="muted">{user.email}</span>
                  </p>
                  <Link role="menuitem" href="/account">
                    Mon compte
                  </Link>
                  <ReplyLogoutButton
                    onLogout={() => {
                      setToken(null);
                      setUser(null);
                      setNavOpen(false);
                      setAccountOpen(false);
                      router.replace("/login");
                    }}
                  />
                </div>
              )}
            </div>
          </header>
          <main
            id="main-content"
            className={`page-content ${["/conversations", "/todo"].includes(pathname) ? "workspace-page" : ""}`}
          >
            {children}
          </main>
        </div>
      </div>
      </ReplyDraftsProvider>
    </UserContext.Provider>
  );
}
