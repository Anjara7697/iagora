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
import AgentModeCard from "./AgentModeCard";
import type { User } from "@/lib/types";

const UserContext = createContext<User | null>(null);
export const useCurrentUser = () => useContext(UserContext);
const ROLE_LABELS = {
  ADMIN: "Administrateur",
  ADVISOR: "Conseiller",
  VIEWER: "Observateur",
};
const INTELLIGENCE_LINKS = [
  { href: "/knowledge", label: "Base de connaissances", icon: "❖" },
  { href: "/integrations", label: "Intégrations", icon: "⇄" },
];
const LINKS = [
  { href: "/", label: "Aujourd’hui", icon: "◷" },
  { href: "/todo", label: "À traiter", icon: "✓", badge: true },
  { href: "/conversations", label: "Conversations", icon: "✉" },
  { href: "/prospects", label: "Prospects", icon: "▦" },
  { href: "/campaigns", label: "Campagnes", icon: "◎" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
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

  const links = SIMULATOR_ENABLED
    ? [...LINKS, { href: "/simulator", label: "Simulateur", icon: "◇" }]
    : LINKS;
  const groups = [
    { name: "Travail", items: links },
    { name: "Intelligence", items: INTELLIGENCE_LINKS },
  ];
  const title = pathname.startsWith("/prospects/")
    ? "Fiche prospect"
    : (links.find((l) => l.href === pathname)?.label ?? "IAGORA");
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
                      <span aria-hidden="true">{link.icon}</span>
                      {link.label}
                      {"badge" in link && link.badge && waiting ? (
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
          <div className="sidebar-footer">
            <span className="eyebrow">DATUM Academy</span>
            <p>Votre espace de suivi commercial.</p>
            <span className="badge">{ROLE_LABELS[user.role]}</span>
          </div>
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
            <span className="header-subtitle muted">Agent commercial 2.0</span>
            <span className="spacer" />
            <span className="user-avatar" aria-hidden="true">
              {user.username.slice(0, 2).toUpperCase()}
            </span>
            <span className="user-name">{user.username}</span>
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
          <main id="main-content" className="page-content">
            {children}
          </main>
        </div>
      </div>
    </UserContext.Provider>
  );
}
