import { formatDate } from "./labels";
import type {
  CalendarSettings,
  EmailStatus,
  MetaSettings,
  ServiceToken,
  Tone,
  ZoomSettings,
} from "./types";

export type ConnectorId =
  | "email"
  | "meta"
  | "calendar"
  | "zoom"
  | "leads"
  | "csv"
  | "linkedin";

export type ConnectorDef = {
  id: ConnectorId;
  name: string;
  category: "channels" | "appointments" | "leads";
  icon: string;
  description: string;
  /** Pas encore branché : la carte explique pourquoi au lieu de proposer un réglage. */
  soon?: boolean;
  /** Ouvre une page plutôt qu'un panneau. */
  href?: string;
};

export const CATEGORIES: { id: ConnectorDef["category"]; label: string }[] = [
  { id: "channels", label: "Canaux de messagerie" },
  { id: "appointments", label: "Rendez-vous" },
  { id: "leads", label: "Sources de prospects" },
];

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "email",
    name: "Messagerie email",
    category: "channels",
    icon: "mail",
    description:
      "Reçoit les emails des prospects et envoie les réponses validées. Fonctionne avec toute boîte IMAP/SMTP.",
  },
  {
    id: "meta",
    name: "Meta Lead Ads",
    category: "leads",
    icon: "chat",
    description:
      "Reçoit les formulaires instantanés Facebook et Instagram et rattache chaque prospect à la bonne campagne.",
  },
  {
    id: "calendar",
    name: "Agenda des conseillers",
    category: "appointments",
    icon: "calendar",
    description:
      "Propose des créneaux réellement libres et réserve le rendez-vous dans l’agenda du conseiller (Google Agenda).",
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "appointments",
    icon: "video",
    description:
      "Crée le lien de visioconférence de chaque rendez-vous réservé par l’agent.",
  },
  {
    id: "leads",
    name: "Formulaire du site et outils",
    category: "leads",
    icon: "plug",
    description:
      "Un jeton par formulaire ou outil (n8n…) pour envoyer des prospects vers une campagne, sans compte utilisateur.",
  },
  {
    id: "csv",
    name: "Import de fichier CSV",
    category: "leads",
    icon: "upload",
    href: "/prospects/import",
    description:
      "Importe une liste de prospects (salon, export Excel) avec un aperçu avant toute création.",
  },
  {
    id: "linkedin",
    name: "LinkedIn Lead Gen",
    category: "leads",
    icon: "users",
    soon: true,
    description:
      "Leads LinkedIn. En attendant l’accès à l’API, ils passent par le formulaire externe.",
  },
];

/** État d'une carte : couleur, libellé court, ligne d'information et « déjà réglé ? ». */
export type ConnectorView = {
  tone: Tone;
  label: string;
  meta?: string;
  configured: boolean;
};

export function calendarBadge(cfg: CalendarSettings) {
  if (cfg.provider === "none")
    return { tone: "off" as Tone, label: "Non branché" };
  if (cfg.provider === "demo")
    return { tone: "warn" as Tone, label: "Démonstration" };
  return {
    tone: "ok" as Tone,
    label: `${cfg.connections.length} agenda(s) connecté(s)`,
  };
}

export function zoomBadge(cfg: ZoomSettings) {
  if (cfg.mode === "none") return { tone: "off" as Tone, label: "Non branché" };
  if (cfg.mode === "account")
    return { tone: "ok" as Tone, label: "Compte de l’école" };
  return {
    tone: "ok" as Tone,
    label: `${cfg.connections.length} compte(s) connecté(s)`,
  };
}

const LOADING: ConnectorView = {
  tone: "off",
  label: "Chargement…",
  configured: false,
};

export function emailView(s: EmailStatus | undefined): ConnectorView {
  if (!s) return LOADING;
  if (!s.configured)
    return { tone: "off", label: "À configurer", configured: false };
  if (s.last_error)
    return {
      tone: "err",
      label: "Erreur de relève",
      meta: s.sender ?? undefined,
      configured: true,
    };
  return {
    tone: s.enabled ? "ok" : "warn",
    label: s.enabled ? "Configurée" : "Réception désactivée",
    meta: s.last_run_at
      ? `Dernière relève ${formatDate(s.last_run_at)}`
      : (s.sender ?? undefined),
    configured: true,
  };
}

export function calendarView(cfg: CalendarSettings | undefined): ConnectorView {
  if (!cfg) return LOADING;
  const badge = calendarBadge(cfg);
  const connected = cfg.connections.length;
  if (cfg.provider === "google" && connected === 0)
    return {
      tone: "warn",
      label: "À connecter",
      meta: "Aucun conseiller n’a encore connecté son agenda",
      configured: true,
    };
  return { ...badge, configured: cfg.provider !== "none" };
}

export function zoomView(cfg: ZoomSettings | undefined): ConnectorView {
  if (!cfg) return LOADING;
  const badge = zoomBadge(cfg);
  if (cfg.mode === "advisor" && cfg.connections.length === 0)
    return {
      tone: "warn",
      label: "À connecter",
      meta: "Aucun conseiller n’a encore connecté son compte",
      configured: true,
    };
  return { ...badge, configured: cfg.mode !== "none" };
}

export function leadsView(tokens: ServiceToken[] | undefined): ConnectorView {
  if (!tokens) return LOADING;
  const active = tokens.filter((t) => !t.revoked_at);
  if (active.length === 0)
    return { tone: "off", label: "Aucun jeton", configured: false };
  const last = active
    .map((t) => t.last_used_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  return {
    tone: "ok",
    label: `${active.length} jeton(s) actif(s)`,
    meta: last ? `Dernier envoi ${formatDate(last)}` : "Jamais utilisé",
    configured: true,
  };
}

export function metaView(cfg: MetaSettings | undefined): ConnectorView {
  if (!cfg) return LOADING;
  if (cfg.last_success_at)
    return {
      tone: "ok",
      label: "Testé avec un lead réel",
      meta: `Dernier succès ${formatDate(cfg.last_success_at)}`,
      configured: true,
    };
  if (!cfg.configured)
    return { tone: "off", label: "Non configuré", configured: false };
  return {
    tone: "warn",
    label: cfg.enabled ? "Actif, à tester" : "Configuré, inactif",
    meta: cfg.last_error ?? `${cfg.mappings.length} formulaire(s) associé(s)`,
    configured: true,
  };
}
