"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import {
  api,
  ApiError,
  getToken,
  setToken,
  SIMULATOR_ENABLED,
} from "@/lib/api";
import { pageSubtitle, pageTitle } from "@/lib/labels";
import AgentModeCard from "./AgentModeCard";
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
      { label: "Rendez-vous", soon: true },
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
      { href: "/integrations", label: "Intégrations", adminOnly: true },
      { label: "Paramètres", soon: true },
    ],
  },
];

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
    if (!user) return;
    api<{ total: number }>("/todo?limit=1")
      .then((page) => setWaiting(page.total))
      .catch(() => setWaiting(null));
  }, [user, pathname]);

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
  const showSimulator = SIMULATOR_ENABLED && user.role !== "VIEWER";
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isAdmin || !i.adminOnly),
  })).filter((g) => g.items.length > 0);
  const title = pageTitle(pathname);
  const subtitle = pageSubtitle(pathname);
  return (
    <UserContext.Provider value={user}>
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <div className={`app-layout ${navOpen ? "nav-open" : ""}`}>
        {navOpen && (
          <button
            className="nav-scrim"
            aria-label="Fermer le menu"
            onClick={() => setNavOpen(false)}
          />
        )}
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
                <p className="nav-group">{group.name}</p>
                {group.items.map((link) => {
                  if (!link.href)
                    return (
                      <span
                        key={link.label}
                        className="nav-item soon"
                        aria-disabled="true"
                        title="Prévu, pas encore disponible"
                      >
                        {link.label}
                        <span className="nav-soon">Bientôt</span>
                      </span>
                    );
                  const active =
                    pathname === link.href ||
                    (link.href !== "/" && pathname.startsWith(`${link.href}/`));
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
          </nav>
          {showSimulator && (
            <div className="nav-demo">
              <Link
                href="/simulator"
                className={`nav-demo-link ${pathname === "/simulator" ? "active" : ""}`}
                onClick={() => setNavOpen(false)}
              >
                États de démo · Simulateur
              </Link>
            </div>
          )}
          <AgentModeCard
            readOnly={user.role === "VIEWER"}
            refreshKey={pathname}
          />
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
                placeholder="Nom, email ou campagne…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            {waiting !== null && (
              <Link href="/todo" className="todo-pill">
                <span
                  className={`dot ${waiting > 0 ? "warn" : ""}`}
                  aria-hidden="true"
                />
                {waiting > 0 ? `${waiting} à traiter` : "Rien à traiter"}
              </Link>
            )}
            <span
              className="user-avatar"
              title={`${user.username} · ${ROLE_LABELS[user.role]}`}
              aria-hidden="true"
            >
              {initialsOf(user.username)}
            </span>
            <span className="badge">{ROLE_LABELS[user.role]}</span>
            <button
              onClick={() => {
                setToken(null);
                setUser(null);
                setNavOpen(false);
                router.replace("/login");
              }}
            >
              Déconnexion
            </button>
          </header>
          <main
            id="main-content"
            className={`page-content ${["/conversations", "/todo"].includes(pathname) ? "workspace-page" : ""}`}
          >
            {children}
          </main>
        </div>
      </div>
    </UserContext.Provider>
  );
}
