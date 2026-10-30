"use client";

import { SearchField } from "@heroui/react";
import { ArrowRight, Plug } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { CalendarSettings } from "@/components/CalendarSettings";
import { ConnectorIcon } from "@/components/ConnectorIcons";
import { Drawer } from "@/components/Drawer";
import { EmailConnector } from "@/components/EmailConnector";
import { LeadSources } from "@/components/LeadSources";
import { MetaLeadSettings } from "@/components/MetaLeadSettings";
import { ZoomSettings } from "@/components/ZoomSettings";
import { Btn, LinkButton, Segmented } from "@/components/ds/controls";
import { EmptyPanel, Eyebrow, PageHeader, Screen } from "@/components/ds/layout";
import { StatePill } from "@/components/ds/settings";
import { Loading } from "@/components/ui";
import {
  CATEGORIES,
  CONNECTORS,
  calendarView,
  emailView,
  leadsView,
  metaView,
  zoomView,
  type ConnectorDef,
  type ConnectorId,
  type ConnectorView,
} from "@/lib/connectors";
import { useApi } from "@/lib/useApi";
import type {
  CalendarSettings as CalendarConfig,
  EmailStatus,
  MetaSettings,
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
  return <StatePill tone={view.tone}>{view.label}</StatePill>;
}

const SOON_TEXT: Partial<Record<ConnectorId, string[]>> = {
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
  const meta = useApi<MetaSettings>(isAdmin ? "/integrations/meta" : null, {
    keepPrevious: true,
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  if (user && !isAdmin)
    return (
      <Screen>
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          Cette page est réservée aux administrateurs.
        </p>
      </Screen>
    );

  const views: Record<ConnectorId, ConnectorView> = {
    email: emailView(email.data ?? undefined),
    calendar: calendarView(calendar.data ?? undefined),
    zoom: zoomView(zoom.data ?? undefined),
    leads: leadsView(tokens.data ?? undefined),
    csv: { tone: "ok", label: "Disponible", configured: true },
    meta: metaView(meta.data ?? undefined),
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
    meta.reload();
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
  const failed =
    email.error || calendar.error || zoom.error || tokens.error || meta.error;

  return (
    <Screen>
      <PageHeader
        eyebrow="Administration · Intégrations"
        title="Intégrations"
        subtitle="Reliez votre messagerie, les agendas et les sources de prospects. Les identifiants sont chiffrés sur le serveur et ne sont jamais réaffichés."
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          aria-label="Rechercher un connecteur"
          value={query}
          onChange={setQuery}
          className="w-full sm:w-80"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Rechercher un connecteur" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <span className="flex-1" />
        <Segmented
          label="Filtrer les connecteurs"
          value={filter}
          options={FILTERS.map(([id, text]) => ({ value: id, text }))}
          onChange={setFilter}
        />
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
          meta.reload();
        }}
      />

      {shown.length === 0 && !loading && (
        <section className="card card--default p-0" role="status">
          <EmptyPanel
            icon={Plug}
            title="Aucun connecteur ne correspond à cette recherche."
            description="Essayez un autre mot ou un autre filtre."
          />
        </section>
      )}

      {CATEGORIES.map((category) => {
        const items = shown.filter((c) => c.category === category.id);
        if (items.length === 0) return null;
        return (
          <section key={category.id} className="flex flex-col gap-3" aria-label={category.label}>
            <Eyebrow>{category.label}</Eyebrow>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    className={`card card--default gap-3 p-5 transition-shadow hover:shadow-overlay ${c.soon ? "border border-dashed border-border bg-surface-secondary/50 shadow-none" : ""}`}
                    aria-label={c.name}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5 ${v.configured && !c.soon ? "bg-accent-soft text-accent-soft-foreground" : "bg-surface-secondary text-foreground"}`}
                        aria-hidden="true"
                      >
                        <ConnectorIcon name={c.icon} />
                      </span>
                      <h3 className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold text-foreground">{c.name}</h3>
                      <Pill view={v} />
                    </div>
                    <p className="flex-1 text-[13px]/[20px] text-muted">{c.description}</p>
                    <div className="flex items-center gap-3 border-t border-separator pt-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{v.meta ?? " "}</span>
                      {c.href ? (
                        <LinkButton href={c.href} size="sm" variant="outline" aria-label={`${cta} ${c.name}`}>
                          {cta}
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </LinkButton>
                      ) : (
                        <Btn
                          size="sm"
                          variant={!c.soon && !v.configured ? "primary" : "outline"}
                          aria-label={`${cta} ${c.name}`}
                          onClick={() => openConnector(c.id)}
                        >
                          {cta}
                        </Btn>
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
        {open?.id === "meta" && <MetaLeadSettings embedded />}
        {open?.soon && (
          <div className="flex flex-col gap-3">
            {SOON_TEXT[open.id]?.map((line) => (
              <p key={line} className="rounded-xl bg-surface-secondary px-4 py-3 text-sm text-foreground">
                {line}
              </p>
            ))}
          </div>
        )}
      </Drawer>
    </Screen>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense>
      <Catalog />
    </Suspense>
  );
}
