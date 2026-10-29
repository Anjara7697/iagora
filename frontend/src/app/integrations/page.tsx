"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { CalendarSettings } from "@/components/CalendarSettings";
import { ConnectorIcon } from "@/components/ConnectorIcons";
import { Drawer } from "@/components/Drawer";
import { EmailConnector } from "@/components/EmailConnector";
import { LeadSources } from "@/components/LeadSources";
import { ZoomSettings } from "@/components/ZoomSettings";
import { Loading } from "@/components/ui";
import {
  CATEGORIES,
  CONNECTORS,
  calendarView,
  emailView,
  leadsView,
  zoomView,
  type ConnectorDef,
  type ConnectorId,
  type ConnectorView,
} from "@/lib/connectors";
import { useApi } from "@/lib/useApi";
import type {
  CalendarSettings as CalendarConfig,
  EmailStatus,
  ServiceToken,
  ZoomSettings as ZoomConfig,
} from "@/lib/types";

type Filter = "all" | "configured" | "todo" | "soon";
const FILTERS: [Filter, string][] = [
  ["all", "Tous"],
  ["configured", "Configurés"],
  ["todo", "À configurer"],
  ["soon", "Bientôt"],
];

function Pill({ view }: { view: ConnectorView }) {
  return <span className={`badge integ-${view.tone}`}>{view.label}</span>;
}

const SOON_TEXT: Partial<Record<ConnectorId, string[]>> = {
  meta: [
    "Aucun webhook actif : les messages privés ne sont pas relevés automatiquement.",
    "Dépend de la validation de l’application Meta ; la fenêtre de réponse est limitée à 24 h.",
  ],
  linkedin: [
    "Aucune synchronisation : les leads LinkedIn passent par le formulaire externe.",
    "Dépend des accès à l’API LinkedIn, non obtenus à ce jour.",
  ],
};

function Catalog() {
  const user = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isAdmin = user?.role === "ADMIN";
  // keepPrevious : recharger l'état après un enregistrement ne démonte pas le formulaire.
  const email = useApi<EmailStatus>(isAdmin ? "/integrations/email" : null, {
    keepPrevious: true,
  });
  const calendar = useApi<CalendarConfig>(
    isAdmin ? "/integrations/calendar" : null,
    { keepPrevious: true },
  );
  const zoom = useApi<ZoomConfig>(isAdmin ? "/integrations/zoom" : null, {
    keepPrevious: true,
  });
  const tokens = useApi<ServiceToken[]>(
    isAdmin ? "/integrations/tokens" : null,
    { keepPrevious: true },
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  if (user && !isAdmin)
    return (
      <p className="card warnbox" role="alert">
        Cette page est réservée aux administrateurs.
      </p>
    );

  const views: Record<ConnectorId, ConnectorView> = {
    email: emailView(email.data ?? undefined),
    calendar: calendarView(calendar.data ?? undefined),
    zoom: zoomView(zoom.data ?? undefined),
    leads: leadsView(tokens.data ?? undefined),
    csv: { tone: "ok", label: "Disponible", configured: true },
    meta: { tone: "off", label: "Bientôt", configured: false },
    linkedin: { tone: "off", label: "Bientôt", configured: false },
  };

  const openId = params.get("c") as ConnectorId | null;
  const open = CONNECTORS.find((c) => c.id === openId && !c.href) ?? null;

  function openConnector(id: ConnectorId) {
    router.replace(`${pathname}?c=${id}`, { scroll: false });
  }
  function closeConnector() {
    router.replace(pathname, { scroll: false });
    // L'état des cartes peut avoir changé pendant la configuration.
    email.reload();
    calendar.reload();
    zoom.reload();
    tokens.reload();
  }

  const text = query.trim().toLowerCase();
  const visible = (c: ConnectorDef) => {
    const v = views[c.id];
    if (filter === "soon" && !c.soon) return false;
    if (filter === "configured" && !(v.configured && !c.soon)) return false;
    if (filter === "todo" && !(!v.configured && !c.soon)) return false;
    return !text || `${c.name} ${c.description}`.toLowerCase().includes(text);
  };
  const shown = CONNECTORS.filter(visible);
  const loading = isAdmin && (email.loading || calendar.loading) && !email.data;
  const failed = email.error || calendar.error || zoom.error || tokens.error;

  return (
    <div className="connector-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Intégrations</span>
          <h1>Intégrations</h1>
          <p className="muted">
            Reliez votre messagerie, les agendas et les sources de prospects.
            Les identifiants sont chiffrés sur le serveur et ne sont jamais
            réaffichés.
          </p>
        </div>
      </div>

      <div className="connector-toolbar">
        <input
          type="search"
          className="connector-search"
          placeholder="Rechercher un connecteur"
          aria-label="Rechercher un connecteur"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          className="segmented"
          role="group"
          aria-label="Filtrer les connecteurs"
        >
          {FILTERS.map(([id, text]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <Loading
        loading={loading}
        shape="cards"
        error={failed}
        onRetry={() => {
          email.reload();
          calendar.reload();
          zoom.reload();
          tokens.reload();
        }}
      />

      {shown.length === 0 && !loading && (
        <p className="muted" role="status">
          Aucun connecteur ne correspond à cette recherche.
        </p>
      )}

      {CATEGORIES.map((category) => {
        const items = shown.filter((c) => c.category === category.id);
        if (items.length === 0) return null;
        return (
          <section
            key={category.id}
            className="connector-group"
            aria-label={category.label}
          >
            <h2 className="section-label">{category.label}</h2>
            <div className="connector-grid">
              {items.map((c) => {
                const v = views[c.id];
                const cta = c.soon
                  ? "En savoir plus"
                  : c.href
                    ? "Ouvrir"
                    : v.configured
                      ? "Gérer"
                      : "Configurer";
                return (
                  <article
                    key={c.id}
                    className={`connector-card${c.soon ? " is-soon" : ""}`}
                    aria-label={c.name}
                  >
                    <div className="connector-head">
                      <span className="connector-icon" aria-hidden="true">
                        <ConnectorIcon name={c.icon} />
                      </span>
                      <h3 className="connector-name">{c.name}</h3>
                      <Pill view={v} />
                    </div>
                    <p className="connector-desc">{c.description}</p>
                    <div className="connector-foot">
                      <span className="connector-meta">{v.meta ?? " "}</span>
                      {c.href ? (
                        <Link
                          href={c.href}
                          className="button-link connector-open"
                          aria-label={`${cta} ${c.name}`}
                        >
                          {cta}
                        </Link>
                      ) : (
                        <button
                          className={`connector-open${
                            !c.soon && !v.configured ? " primary" : ""
                          }`}
                          aria-label={`${cta} ${c.name}`}
                          onClick={() => openConnector(c.id)}
                        >
                          {cta}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <Drawer
        open={open !== null}
        onClose={closeConnector}
        title={open?.name ?? ""}
        eyebrow={
          open
            ? CATEGORIES.find((c) => c.id === open.category)?.label
            : undefined
        }
        icon={open ? <ConnectorIcon name={open.icon} /> : undefined}
        aside={open ? <Pill view={views[open.id]} /> : undefined}
      >
        {open?.id === "email" && email.data && (
          <EmailConnector status={email.data} onReload={email.reload} />
        )}
        {open?.id === "email" && !email.data && (
          <Loading
            loading={email.loading}
            error={email.error}
            onRetry={email.reload}
          />
        )}
        {open?.id === "calendar" && <CalendarSettings embedded />}
        {open?.id === "zoom" && <ZoomSettings embedded />}
        {open?.id === "leads" && <LeadSources embedded />}
        {open?.soon && (
          <div className="settings-stack">
            {SOON_TEXT[open.id]?.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense>
      <Catalog />
    </Suspense>
  );
}
