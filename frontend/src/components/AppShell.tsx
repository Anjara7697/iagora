"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FlaskConical,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Upload,
  UserRound,
  ListChecks,
  Megaphone,
  MessageSquare,
  Plug,
  Settings,
  Sun,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, ApiError, getToken, setToken } from "@/lib/api";
import { canAccessSettings, canUseSimulator } from "@/lib/access";
import { pageTitle } from "@/lib/labels";
import { Avatar, Button, Card, Chip, Dropdown, Label, SearchField, Spinner } from "@heroui/react";
import AgentModeCard from "./AgentModeCard";
import { Brand } from "./ds/Brand";
import { CommandPalette, type Command } from "./ds/CommandPalette";
import { ReplyDraftsProvider, confirmLogoutWithDrafts, useHasUnsentReplies } from "./ReplyDrafts";
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
  /** Pictogramme Lucide, décoratif : le libellé porte le sens. */
  icon?: LucideIcon;
  badge?: boolean;
  /** Écran prévu par la maquette, pas encore développé : affiché grisé, sans lien. */
  soon?: boolean;
  adminOnly?: boolean;
};
const NAV_GROUPS: { name: string; items: NavItem[] }[] = [
  {
    name: "Travail",
    items: [
      { href: "/", label: "Aujourd’hui", icon: Sun },
      { href: "/todo", label: "À traiter", icon: ListChecks, badge: true },
      { href: "/conversations", label: "Conversations", icon: MessageSquare },
      { href: "/appointments", label: "Rendez-vous", icon: CalendarDays },
      { href: "/prospects", label: "Prospects", icon: Users },
    ],
  },
  {
    name: "Pilotage",
    items: [
      { href: "/campaigns", label: "Campagnes", icon: Megaphone },
      { label: "Dashboard", soon: true },
      { label: "Analytics", soon: true },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { label: "Agent", soon: true },
      { href: "/knowledge", label: "Knowledge Base", icon: BookOpen },
    ],
  },
  {
    name: "Administration",
    items: [
      { href: "/team", label: "Équipe", icon: UsersRound, adminOnly: true },
      { href: "/integrations", label: "Intégrations", icon: Plug, adminOnly: true },
      { href: "/settings", label: "Paramètres", icon: Settings },
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
  const blocked = mustChange && pathname !== "/account";
  useEffect(() => {
    if (!blocked) return;
    router.replace("/account");
    // Une navigation déjà en cours peut absorber la redirection : on la redemande.
    const retry = window.setInterval(() => router.replace("/account"), 1000);
    return () => window.clearInterval(retry);
  }, [blocked, router]);

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
      <main className="grid min-h-dvh place-items-center bg-background p-6">
        <Card className="w-full max-w-sm items-center gap-4 p-8 text-center" role={error ? "alert" : "status"}>
          <Brand />
          {error ? (
            <>
              <p className="text-sm text-danger-soft-foreground">{error}</p>
              <Button variant="tertiary" onPress={() => setAttempt((v) => v + 1)}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Réessayer
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" />
              Chargement de votre espace…
            </span>
          )}
        </Card>
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
  const commands: Command[] = [
    ...groups.flatMap((g) =>
      g.items.map((i) => ({
        id: `go:${i.href}`,
        label: i.label,
        group: "Aller à",
        href: i.href as string,
        icon: i.icon ?? ArrowRight,
      })),
    ),
    ...(isAdmin
      ? [
          { id: "new-campaign", label: "Nouvelle campagne", group: "Actions", href: "/campaigns/new", icon: Plus },
          { id: "import", label: "Importer des prospects (CSV)", group: "Actions", href: "/prospects/import", icon: Upload },
        ]
      : []),
    { id: "account", label: "Mon compte", group: "Actions", href: "/account", icon: UserRound },
  ];

  return (
    <UserContext.Provider value={user}>
      <ReplyDraftsProvider key={user.id}>
      <a
       
        className="fixed top-[-80px] left-3 z-[100] rounded-xl bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-overlay focus:top-3"
        href="#main-content"
      >
        Aller au contenu
      </a>
      <div className="flex min-h-dvh bg-background">
        <button
         
          className={`fixed inset-0 z-40 bg-backdrop transition-opacity duration-200 lg:hidden ${navOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
          aria-label="Fermer le menu"
          aria-hidden={!navOpen}
          tabIndex={navOpen ? 0 : -1}
          onClick={() => setNavOpen(false)}
        />
        <aside
         
          id="app-navigation"
          className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col gap-3 border-r border-border bg-surface p-3 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${navOpen ? "translate-x-0 shadow-overlay" : "-translate-x-full"}`}
        >
          <div className="px-2 pt-2">
            <Link href="/" onClick={() => setNavOpen(false)} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Brand />
            </Link>
          </div>
          <CommandPalette commands={commands} />
          <nav aria-label="Navigation principale" className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
            {groups.map((group) => (
              <div key={group.name} className="flex flex-col gap-0.5">
                <p className="px-2 pb-1 font-mono text-xs tracking-[0.06em] text-muted uppercase">
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
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${active ? "bg-accent-soft font-medium text-accent-soft-foreground" : "text-foreground hover:bg-surface-secondary"}`}
                      onClick={() => setNavOpen(false)}
                    >
                      {Icon && <Icon className={`size-4 shrink-0 ${active ? "text-accent" : "text-muted"}`} aria-hidden="true" />}
                      <span className="flex-1">{link.label}</span>
                      {link.badge && waiting ? (
                        <span
                          className={`rounded-md px-1.5 font-mono text-[11px] tabular-nums ${active ? "bg-accent text-accent-foreground" : "bg-warning-soft text-warning-soft-foreground"}`}
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
              <details className="group rounded-lg border-t border-separator pt-2">
                <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm text-muted hover:bg-surface-secondary [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">À venir</span>
                  <span className="rounded-md bg-surface-secondary px-1.5 font-mono text-[11px]">{upcoming.length}</span>
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
                </summary>
                <ul aria-label="Écrans prévus, pas encore disponibles" className="flex flex-col gap-0.5 py-1">
                  {upcoming.map((item) => (
                    <li key={item.label} className="flex h-8 items-center gap-2.5 px-2 text-sm text-muted">
                      <CircleDashed className="size-4" aria-hidden="true" />
                      <span>{item.label}</span>
                      <span className="ms-auto text-[11px]" aria-hidden="true">Bientôt</span>
                    </li>
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
        <div className="flex min-w-0 flex-1 flex-col">
          <header
           
            className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-md lg:px-7"
          >
            <Button
              variant="ghost"
              isIconOnly
              className="lg:hidden"
              aria-label={navOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={navOpen}
              aria-controls="app-navigation"
              onPress={() => setNavOpen(!navOpen)}
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            <strong className="min-w-0 truncate text-base font-semibold text-foreground lg:hidden">
              {title}
            </strong>
            <span className="flex-1" />
            <form
              className="hidden w-full max-w-[320px] md:block"
              role="search"
              onSubmit={(e) => e.preventDefault()}
            >
              <SearchField
                aria-label="Rechercher un prospect"
                value={search}
                onChange={setSearch}
                onSubmit={() => {
                  const q = search.trim();
                  router.push(q ? `/prospects?q=${encodeURIComponent(q)}` : "/prospects");
                }}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Nom ou email du prospect…" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </form>
            {inSimulator ? (
              <Chip
                color="warning"
                variant="soft"
                role="status"
                aria-label="Mode du simulateur"
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                <Chip.Label>Test · données fictives</Chip.Label>
              </Chip>
            ) : (
              waiting !== null && (
                <Link
                  href="/todo"
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-surface px-3 text-sm font-medium text-foreground shadow-surface outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span
                    className={`size-2 rounded-full ${waiting > 0 ? "bg-warning" : "bg-success"}`}
                    aria-hidden="true"
                  />
                  {waiting > 0 ? `${waiting} à traiter` : "Rien à traiter"}
                </Link>
              )
            )}
            <AccountMenu
              user={user}
              onAccount={() => router.push("/account")}
              onLogout={() => {
                setToken(null);
                setUser(null);
                setNavOpen(false);
                router.replace("/login");
              }}
            />
          </header>
          <main
            id="main-content"
            className="min-w-0 flex-1 px-4 pt-5 pb-12 min-[601px]:px-6 min-[601px]:pt-7 min-[601px]:pb-16 lg:px-7"
          >
            {blocked ? (
              <p className="mx-auto max-w-[560px] rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="status">
                Votre mot de passe est temporaire : changez-le dans{" "}
                <Link href="/account" className="font-medium underline">
                  Mon compte
                </Link>{" "}
                avant de continuer.
              </p>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
      </ReplyDraftsProvider>
    </UserContext.Provider>
  );
}

/** Menu du compte (avatar) : identité, Mon compte, Déconnexion (avec garde des réponses en cours). */
function AccountMenu({
  user,
  onAccount,
  onLogout,
}: {
  user: User;
  onAccount: () => void;
  onLogout: () => void;
}) {
  const hasUnsentReplies = useHasUnsentReplies();
  const [open, setOpen] = useState(false);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        className="h-10 gap-2 px-1.5 sm:px-2"
        aria-label={`Menu du compte : ${displayNameOf(user.username)}, ${ROLE_LABELS[user.role]}`}
      >
        <Avatar size="sm" variant="soft" color="accent">
          <Avatar.Fallback>{initialsOf(user.username)}</Avatar.Fallback>
        </Avatar>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-sm font-medium text-foreground">{displayNameOf(user.username)}</span>
          <span className="text-xs font-normal text-muted">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden="true" />
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-[240px]">
        <div className="flex flex-col gap-0.5 border-b border-separator px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">{user.username}</span>
          <span className="text-xs text-muted">{user.email}</span>
        </div>
        <Dropdown.Menu
          aria-label="Compte"
          onAction={(key) => {
            if (key === "account") {
                  setOpen(false);
                  onAccount();
                }
            // Déconnexion annulée : le menu reste ouvert, comme la saisie.
                if (key === "logout" && confirmLogoutWithDrafts(hasUnsentReplies())) {
                  setOpen(false);
                  onLogout();
                }
          }}
        >
          <Dropdown.Item id="account" textValue="Mon compte">
            <UserRound className="size-4 text-muted" aria-hidden="true" />
            <Label>Mon compte</Label>
          </Dropdown.Item>
          <Dropdown.Item id="logout" textValue="Déconnexion" variant="danger" shouldCloseOnSelect={false}>
            <LogOut className="size-4" aria-hidden="true" />
            <Label>Déconnexion</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
