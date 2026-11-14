"use client";

/**
 * Conversations : liste posée sur la page à gauche, conversation ouverte à droite (maître-détail, règle 20). Sur
 * bureau, seule la liste défile (`ListScroll`) : titre, filtres et pagination restent visibles. L'état
 * de la liste est dans l'adresse (`lib/conversationNav.ts`) ; le détail est dans `components/conversations/`.
 */

import { ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, FilterChipGroup, LinkButton, SelectBox, TextInput } from "@/components/ds/controls";
import { EmptyPanel, ListScroll, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { TablePagination } from "@/components/ds/table";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { Loading, Skeleton } from "@/components/ui";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { OWNER_FILTERS, STATUS_FILTERS, conversationHref, isFiltered, readConversationView, type ConversationView as InboxView } from "@/lib/conversationNav";
import { replaceUrl } from "@/lib/url";
import type { ConversationSummary, Page } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { CHANNEL_FILTERS } from "@/components/conversations/shared";
import { ConversationRow } from "@/components/conversations/ConversationRow";
import { ConversationDetail } from "@/components/conversations/ConversationDetail";

/** Conversations par page de la liste. */
const LIMIT = 30;

function Inbox() {
  const user = useCurrentUser();
  // État de la liste dans l'adresse (règle 6) : recherche, filtres, page et conversation ouverte.
  const view = readConversationView(useSearchParams());
  const selectedId = view.id;

  // Brouillon de l'agent modifié dans le détail : changer de conversation demande confirmation.
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const { guard, dialog: discardDialog } = useDiscardGuard(() => dirty.current);
  const navigate = (patch: Partial<InboxView>) =>
    replaceUrl(conversationHref({ ...readConversationView(new URLSearchParams(window.location.search)), ...patch }));
  // Changer de filtre revient à la page 1 ; la conversation ouverte reste affichée.
  const filter = (patch: Partial<InboxView>) => navigate({ ...patch, page: 1 });
  const select = (id: string | null) => {
    if (id === selectedId) return;
    guard(() => {
      dirty.current = false;
      navigate({ id });
    });
  };

  const offset = (view.page - 1) * LIMIT;
  // Recherche envoyée une fois la frappe arrêtée (DATA-01) ; le champ et l'adresse suivent la saisie sans délai.
  const searched = useDebouncedValue(view.q);
  const list = useApi<Page<ConversationSummary>>(
    `/conversations${qs({
      status: view.status,
      channel: view.channel,
      q: searched,
      advisor_id: view.owner === "me" ? user?.id : undefined,
      unassigned: view.owner === "none" ? "true" : undefined,
      limit: LIMIT,
      offset,
    })}`,
    { keepPrevious: true },
  );
  const filtered = isFiltered(view);
  // Total sans filtre, pour « N sur M » (règle 5).
  const all = useApi<Page<ConversationSummary>>(filtered ? "/conversations?limit=1" : null);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const inPage = items.find((c) => c.id === selectedId) ?? null;
  const direct = useApi<ConversationSummary>(
    selectedId
      ? `/conversations/${encodeURIComponent(selectedId)}/summary`
      : null,
    { keepPrevious: true },
  );
  const selected =
    inPage ?? (direct.data?.id === selectedId ? direct.data : null);
  const header = reveal(0);
  const queue = reveal(1);

  return (
    <Screen wide className="gap-4">
      <PageHeader
        title="Conversations"
        subtitle={
          // Sur mobile, une conversation ouverte prend la place.
          <span className={selectedId ? "max-lg:hidden" : undefined}>
            Tous les échanges des prospects avec l’agent et les conseillers, au même endroit.
          </span>
        }
        className={header.className}
        style={header.style}
      />
      {selectedId && (
        <div className="lg:hidden">
          <Btn variant="ghost" onClick={() => select(null)}>
            ← Liste des conversations
          </Btn>
        </div>
      )}
      <div className="flex items-start gap-5">
        {/* File posée sur la page (règle 20) : titre et compteur, recherche et filtres, liste sur sa surface,
            pagination. */}
        <aside
          aria-label="Liste des conversations"
          style={queue.style}
          className={`w-full shrink-0 flex-col gap-3 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-9rem)] lg:w-[360px] lg:overflow-hidden lg:pb-2 ${selectedId ? "hidden" : "flex"} ${queue.className}`}
        >
          <header className="flex items-baseline gap-2">
            <h2 className="flex-1 text-base font-semibold text-foreground">Boîte de réception</h2>
            <span className="text-[13px] text-muted tabular-nums" role="status">
              {list.data
                ? `${total} conversation${total > 1 ? "s" : ""}${filtered && all.data ? ` sur ${all.data.total}` : ""}`
                : ""}
            </span>
          </header>
          <TextInput
            type="search"
            aria-label="Rechercher une conversation"
            placeholder="Nom ou email…"
            value={view.q}
            onChange={(e) => filter({ q: e.target.value })}
          />
          <FilterChipGroup
            label="Statut"
            options={[...STATUS_FILTERS]}
            value={view.status}
            onChange={(status) => filter({ status })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterChipGroup
              label="Responsable"
              options={[...OWNER_FILTERS]}
              value={view.owner}
              onChange={(owner) => filter({ owner })}
            />
            <SelectBox
              aria-label="Canal"
              className="min-w-[150px] flex-1"
              value={view.channel}
              onChange={(e) => filter({ channel: e.target.value })}
            >
              {CHANNEL_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </SelectBox>
          </div>
          <Loading
            loading={list.loading && !list.data}
            error={list.error}
            onRetry={list.reload}
            shape="rows"
          />
          {list.data && items.length === 0 && (
            <div className="flex flex-col items-start gap-2 px-2 py-3">
              <p className="text-[13px] text-muted">
                {filtered ? "Aucune conversation ne correspond à ces filtres." : "Aucune conversation pour le moment."}
              </p>
              {filtered && (
                <Btn size="sm" variant="secondary" onClick={() => filter({ q: "", status: "", owner: "", channel: "" })}>
                  Afficher tout
                </Btn>
              )}
            </div>
          )}
          {items.length > 0 && (
            <ListScroll>
              <Box as="ul" className="gap-0.5 p-1.5">
                {items.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    selected={c.id === selectedId}
                    onSelect={() => select(c.id)}
                  />
                ))}
              </Box>
            </ListScroll>
          )}
          {list.data && (total > LIMIT || view.page > 1) && (
            <TablePagination
              className="flex-wrap justify-center gap-2"
              total={total}
              pageSize={LIMIT}
              page={view.page}
              onChange={(page) => navigate({ page })}
            />
          )}
        </aside>
        <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {selected ? (
            <ConversationDetail
              key={selected.id}
              summary={selected}
              onDirtyChange={onDirtyChange}
              guard={guard}
              onChanged={() => {
                list.reload();
                direct.reload();
                all.reload();
              }}
            />
          ) : selectedId ? (
            <Box as="section" className="flex-1 p-6">
              <Loading
                loading={direct.loading}
                error={direct.error}
                onRetry={direct.reload}
              />
            </Box>
          ) : (
            <Box as="section" className="flex-1 p-0">
              <EmptyPanel
                icon={InboxIcon}
                title="Choisissez une conversation"
                description="Sélectionnez une conversation pour lire l'échange et y répondre."
                action={
                  <LinkButton variant="outline" href="/todo">
                    Voir ce qui est à traiter
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </LinkButton>
                }
              />
            </Box>
          )}
        </div>
      </div>
      {discardDialog}
    </Screen>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<Skeleton shape="rows" />}>
      <Inbox />
    </Suspense>
  );
}
