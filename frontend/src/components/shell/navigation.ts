import {
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumnBig,
  FlaskConical,
  Gauge,
  LayoutDashboard,
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
import { canAccessSettings, canUseSimulator } from "@/lib/access";
import { canUseEvaluation } from "@/lib/evaluation";
import type { User } from "@/lib/types";

type NavItem = {
  href?: string;
  label: string;
  /** Pictogramme Lucide, décoratif : le libellé porte le sens (infobulle quand le menu est réduit). */
  icon?: LucideIcon;
  badge?: boolean;
  /** Écran prévu, pas encore développé : affiché grisé, sans lien. */
  soon?: boolean;
  adminOnly?: boolean;
  /** Outil de test : visible seulement si le simulateur est activé et permis à ce rôle (`canUseSimulator`). */
  simulator?: boolean;
  /** Outil de recette : administrateurs, quand le simulateur est activé (`canUseEvaluation`, D-35). */
  evaluation?: boolean;
};

export type NavGroup = { name: string; items: NavItem[] };

/** Menu de la console : intitulés en français, identiques aux titres des pages. */
const NAV_GROUPS: NavGroup[] = [
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
      { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/analytics", label: "Analyses", icon: ChartColumnBig },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { href: "/agent", label: "Agent", icon: Bot },
      { href: "/knowledge", label: "Base de connaissances", icon: BookOpen },
    ],
  },
  {
    name: "Administration",
    items: [
      { href: "/team", label: "Équipe", icon: UsersRound, adminOnly: true },
      { href: "/integrations", label: "Intégrations", icon: Plug, adminOnly: true },
      { href: "/settings", label: "Paramètres", icon: Settings },
      // Entrée propre (NAV-02) : dans le Simulateur, le menu le surligne lui, et non « Paramètres ».
      { href: "/simulator", label: "Simulateur", icon: FlaskConical, simulator: true },
      { href: "/evaluation", label: "Évaluation", icon: Gauge, evaluation: true },
    ],
  },
];

/** Groupes et liens visibles pour ce rôle (« Administration » devient « Réglages » hors administrateur). */
export function visibleGroups(user: User): NavGroup[] {
  const isAdmin = user.role === "ADMIN";
  return NAV_GROUPS.map((g) => ({
    name: g.name === "Administration" && !isAdmin ? "Réglages" : g.name,
    items: g.items.filter(
      (i) =>
        i.href &&
        (isAdmin || !i.adminOnly) &&
        (i.href !== "/settings" || canAccessSettings(user.role)) &&
        (!i.simulator || canUseSimulator(user.role)) &&
        (!i.evaluation || canUseEvaluation(user.role)),
    ),
  })).filter((g) => g.items.length > 0);
}

/** Écrans prévus mais pas encore développés : regroupés dans une seule ligne repliée. */
export const UPCOMING = NAV_GROUPS.flatMap((g) => g.items.filter((i) => i.soon));
