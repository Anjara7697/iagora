"use client";

import { SearchField } from "@heroui/react";
import { ArrowRight, Plug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef } from "react";
import { useCurrentUser } from "@/lib/session";
import { CalendarSettings } from "@/components/CalendarSettings";
import { ConnectorIcon } from "@/components/ConnectorIcons";
import { Drawer } from "@/components/Drawer";
import { EmailConnector } from "@/components/EmailConnector";
import { LeadSources } from "@/components/LeadSources";
import { MetaLeadSettings } from "@/components/MetaLeadSettings";
import { ZoomSettings } from "@/components/ZoomSettings";
import { Btn, LinkButton, Notice, Segmented } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, PageHeader, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { StatePill } from "@/components/ds/settings";
import { Loading, Skeleton } from "@/components/ui";
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
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";
import type {
  CalendarSettings as CalendarConfig,
  EmailStatus,
  MetaSettings,
  ServiceToken,
  ZoomSettings as ZoomConfig,
} from "@/lib/types";
import { Box } from "@/components/ds/card";

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

const isFilter = (value: string | null): value is Filter => FILTERS.some(([id]) => id === value);

/** Recherche, filtre, connecteur ouvert (et onglet de la messagerie) dans l'adresse, sans entrée d'historique (règle 6). */
function updateUrl(patch: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  replaceUrl(`/integrations${query ? `?${query}` : ""}`);
}

function Catalog() {
  const user = useCurrentUser();
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
  const query = params.get("q") ?? "";
  const requestedFilter = params.get("f");
  const filter: Filter = isFilter(requestedFilter) ? requestedFilter : "all";
  const openId = params.get("c") as ConnectorId | null;
  const open = CONNECTORS.find((c) => c.id === openId && !c.href) ?? null;
  // Saisie non enregistrée dans le panneau ouvert : fermer demande confirmation (règle 14).
  const dirty = useRef(false);
  const reportDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const { guard, dialog: discardDialog } = useDiscardGuard(() => open !== null && dirty.current);

  if (user && !isAdmin)
    return (
      <Screen>
        <Notice tone="warning">Cette page est réservée aux administrateurs.</Notice>
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

  function openConnector(id: ConnectorId) {
    updateUrl({ c: id, tab: null });
  }
  function closeConnector() {
    dirty.current = false;
    updateUrl({ c: null, tab: null });
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
  const filtered = text !== "" || filter !== "all";
  const loading = isAdmin && (email.loading || calendar.loading) && !email.data;
  const failed =
    email.error || calendar.error || zoom.error || tokens.error || meta.error;

  return (
    <Screen>
      {discardDialog}
      <PageHeader
        {...reveal(0)}
        title="Intégrations"
        subtitle="Reliez votre messagerie, les agendas et les sources de prospects. Les identifiants sont chiffrés sur le serveur et ne sont jamais réaffichés."
      />

      {/* Règle 5 : recherche et filtre à gauche, compteur à droite. */}
      <div className={cx("flex flex-wrap items-center gap-3", reveal(1).className)} style={reveal(1).style}>
        <SearchField
          aria-label="Rechercher un connecteur"
          value={query}
          onChange={(value) => updateUrl({ q: value || null })}
          className="w-full sm:w-80"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Rechercher un connecteur" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Segmented
          className="max-w-full sm:[&_[role=tab]]:whitespace-nowrap"
          label="Filtrer les connecteurs"
          value={filter}
          options={FILTERS.map(([id, text]) => ({ value: id, text }))}
          onChange={(value) => updateUrl({ f: value === "all" ? null : value })}
        />
        <span className="ml-auto text-[13px] text-muted tabular-nums" role="status">
          {`${shown.length} connecteur${shown.length > 1 ? "s" : ""}${filtered ? ` sur ${CONNECTORS.length}` : ""}`}
        </span>
      </div>

      {loading ? (
        <Skeleton shape="cards" />
      ) : (
        failed && (
          <ErrorState
            message={`État des intégrations indisponible : ${failed.message}`}
            onRetry={() => {
              email.reload();
              calendar.reload();
              zoom.reload();
              tokens.reload();
              meta.reload();
            }}
          />
        )
      )}

      {shown.length === 0 && !loading && (
        <Box as="section" className="p-0" role="status">
          <EmptyPanel
            icon={Plug}
            title="Aucun connecteur ne correspond"
            description={[text && `Recherche « ${query.trim()} »`, filter !== "all" && FILTERS.find(([id]) => id === filter)?.[1]]
              .filter(Boolean)
              .join(" · ")}
            action={
              <Btn variant="secondary" onClick={() => updateUrl({ q: null, f: null })}>
                Afficher tous les connecteurs
              </Btn>
            }
          />
        </Box>
      )}

      {CATEGORIES.map((category, index) => {
        const items = shown.filter((c) => c.category === category.id);
        if (items.length === 0) return null;
        return (
          <section
            key={category.id}
            className={cx("flex flex-col gap-3", reveal(2 + index).className)}
            style={reveal(2 + index).style}
            aria-label={category.label}
          >
            <h2 className="type-caption tracking-[0.06em] text-muted uppercase">{category.label}</h2>
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
                  <Box
                    as="article"
                    key={c.id}
                    className={`gap-3 p-5 transition-shadow hover:shadow-overlay ${c.soon ? "border border-dashed border-border bg-surface-secondary/50 shadow-none" : ""}`}
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
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">{v.meta ?? " "}</span>
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
                  </Box>
                );
              })}
            </div>
          </section>
        );
      })}

      <Drawer
        open={open !== null}
        onClose={() => guard(closeConnector)}
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
          <EmailConnector status={email.data} onReload={email.reload} onDirtyChange={reportDirty} />
        )}
        {open?.id === "email" && !email.data && (
          <Loading
            loading={email.loading}
            error={email.error}
            onRetry={email.reload}
          />
        )}
        {open?.id === "calendar" && <CalendarSettings embedded onDirtyChange={reportDirty} />}
        {open?.id === "zoom" && <ZoomSettings embedded onDirtyChange={reportDirty} />}
        {open?.id === "leads" && <LeadSources embedded onDirtyChange={reportDirty} />}
        {open?.id === "meta" && <MetaLeadSettings embedded onDirtyChange={reportDirty} />}
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
