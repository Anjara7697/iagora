"use client";

import Link from "next/link";
import {
  ArrowRight,
  FlaskConical,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Upload,
  UserRound,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canUseSimulator } from "@/lib/access";
import { useSession } from "@/lib/session";
import { useWorkQueueCount } from "@/lib/useWorkQueueCount";
import { Button, Card, Chip, Drawer, Spinner, Tooltip } from "@heroui/react";
import AccountMenu from "./shell/AccountMenu";
import AppNav from "./shell/AppNav";
import { visibleGroups } from "./shell/navigation";
import { LinkButton } from "./ds/controls";
import { Brand } from "./ds/Brand";
import { CommandPalette, type Command } from "./ds/CommandPalette";
import { ReplyDraftsProvider } from "./ReplyDrafts";

const NAV_COLLAPSED_KEY = "iagora.nav.collapsed";

/**
 * Mise en page de la console : menu, barre du haut, zone de l'écran. La session (utilisateur, mot de passe temporaire,
 * déconnexion) vient de `SessionProvider` ; le compteur de la file, de `useWorkQueueCount`.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, error, retry, blocked, signOut } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const waiting = useWorkQueueCount(user, pathname);
  const isLogin = pathname === "/login";
  const mustChange = !!user?.must_change_password;

  // Menu réduit (bureau) : préférence de ce navigateur, sans effet si le stockage est indisponible.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === "1");
    } catch {
      /* stockage indisponible : menu complet */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        /* préférence non mémorisée */
      }
      return !value;
    });

  if (isLogin) return <>{children}</>;
  if (!user)
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6">
        <Card className="w-full max-w-sm items-center gap-4 p-8 text-center" role={error ? "alert" : "status"}>
          <Brand />
          {error ? (
            <>
              <p className="text-sm text-danger-soft-foreground">{error}</p>
              <Button variant="tertiary" onPress={retry}>
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
  const groups = visibleGroups(user);
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
    <ReplyDraftsProvider key={user.id}>
      <a
        className="fixed top-[-80px] left-3 z-[100] rounded-xl bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-overlay focus:top-3"
        href="#main-content"
      >
        Aller au contenu
      </a>
      <div className="flex min-h-dvh bg-background">
        {/* Bureau : menu fixe, réductible à ses icônes ; le choix est mémorisé dans le navigateur. */}
        <aside
          id="app-navigation"
          aria-label="Menu"
          className={`sticky top-0 hidden h-dvh shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 transition-[width] duration-200 ease-out lg:flex ${collapsed ? "w-16" : "w-[240px]"}`}
        >
          {/* Marque et bouton de réduction en haut du menu (le bas reste libre pour le défilement). */}
          <div className={`flex items-center gap-2 pt-2 pb-3 ${collapsed ? "flex-col" : "justify-between pl-2"}`}>
            <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Brand compact={collapsed} />
            </Link>
            <Tooltip delay={200} closeDelay={0}>
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                className="text-muted"
                aria-label={collapsed ? "Agrandir le menu" : "Réduire le menu"}
                aria-expanded={!collapsed}
                aria-controls="app-navigation"
                onPress={toggleCollapsed}
              >
                {collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
              </Button>
              <Tooltip.Content placement="right" showArrow>
                <Tooltip.Arrow />
                {collapsed ? "Agrandir le menu" : "Réduire le menu"}
              </Tooltip.Content>
            </Tooltip>
          </div>
          <AppNav groups={groups} pathname={pathname} inSimulator={inSimulator} waiting={waiting} collapsed={collapsed} />
        </aside>
        {/* Mobile et tablette : Drawer HeroUI (focus gardé dans le menu, Échap, voile et bouton Fermer). */}
        <Drawer.Backdrop isOpen={navOpen} onOpenChange={setNavOpen}>
          <Drawer.Content placement="left" className="w-[280px] max-w-[85vw]">
            <Drawer.Dialog aria-label="Menu" className="flex h-full flex-col gap-3 p-3">
              <Drawer.Header className="flex flex-row items-center justify-between gap-2 px-2 pt-2 pb-1">
                <Link href="/" onClick={() => setNavOpen(false)} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <Brand />
                </Link>
                <Drawer.CloseTrigger aria-label="Fermer le menu" />
              </Drawer.Header>
              <AppNav groups={groups} pathname={pathname} inSimulator={inSimulator} waiting={waiting} onNavigate={() => setNavOpen(false)} />
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4 lg:px-7"
          >
            <Button
              variant="ghost"
              isIconOnly
              className="lg:hidden"
              aria-label="Ouvrir le menu"
              aria-expanded={navOpen}
              onPress={() => setNavOpen(true)}
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            {/* Recherche et commandes à gauche (la palette : prospects, pages, actions) ; icône seule sur téléphone. */}
            <div role="search" className="flex min-w-0 md:w-[300px] xl:w-[340px]">
              <CommandPalette commands={commands} />
            </div>
            <span className="flex-1" />
            {inSimulator ? (
              <Chip
                color="warning"
                variant="soft"
                role="status"
                aria-label="Mode du simulateur"
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                <Chip.Label>
                  Test<span className="hidden sm:inline"> · données fictives</span>
                </Chip.Label>
              </Chip>
            ) : (
              waiting !== null && (
                <LinkButton
                  href="/todo"
                  variant="tertiary"
                  className="h-9 shrink-0 gap-2 px-3"
                  aria-label={waiting > 0 ? `${waiting} à traiter` : "Rien à traiter"}
                >
                  <span className={`size-2 rounded-full ${waiting > 0 ? "bg-warning" : "bg-success"}`} aria-hidden="true" />
                  {waiting > 0 ? (
                    <>
                      {waiting}
                      <span className="hidden sm:inline">à traiter</span>
                    </>
                  ) : (
                    <span className="hidden sm:inline">Rien à traiter</span>
                  )}
                </LinkButton>
              )
            )}
            <AccountMenu
              user={user}
              refreshKey={pathname}
              showAgent={!mustChange}
              onLogout={async () => {
                setNavOpen(false);
                await signOut();
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
  );
}
