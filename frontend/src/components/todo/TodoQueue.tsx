"use client";

/** File de travail d'« À traiter » : onglets, filtres, liste des éléments et pagination. */

import { useState } from "react";
import { FilterChip, FilterChipGroup, Notice, Segmented, Tag, RowButton } from "@/components/ds/controls";
import { Loading } from "@/components/ui";
import { qs } from "@/lib/api";
import { CHANNELS, PRIORITIES, formatDate, fullName, label, relativeTime, EXECUTION } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { TodoItem, TodoKind, TodoPage, TreatedPage } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { ListScroll } from "@/components/ds/layout";
import { TablePagination } from "@/components/ds/table";
import type { RefObject } from "react";
import { KindFilter, revealed, PAGE_SIZE, TASK_LABELS, KIND_ORDER, itemName, KIND_TONE, PRIORITY_TONE, EXECUTION_TONE, PersonMark } from "@/components/todo/shared";

function Row({
  item,
  selected,
  onSelect,
}: {
  item: TodoItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = itemName(item);
  return (
    <li>
      <RowButton selected={selected} onClick={onSelect} className="py-2.5">
        <PersonMark name={name} incident={item.kind === "incident"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</strong>
            <span className="shrink-0 text-xs text-muted">{relativeTime(item.created_at)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Tag tone={KIND_TONE[item.kind]}>{TASK_LABELS[item.kind]}</Tag>
            <Tag tone={PRIORITY_TONE[item.priority] ?? "neutral"}>
              {label(PRIORITIES, item.priority)}
            </Tag>
            <span>{label(CHANNELS, item.channel)}</span>
          </span>
          <span className="line-clamp-2 text-[13px]/[18px] text-foreground/80">
            {item.detail ? `« ${item.detail} »` : item.title}
          </span>
        </span>
      </RowButton>
    </li>
  );
}


/**
 * File de travail (colonne de gauche), posée sur la page : titre et compteur, onglets « À traiter » et
 * « Traités 24 h », filtres par type, liste sur sa surface et pagination. Sur bureau, seule la liste défile
 * (`ListScroll`). Toute navigation passe par `onNavigate`,
 * qui protège une saisie en cours dans le détail.
 */
export function TodoQueue({
  tab,
  kind,
  selectedId,
  page,
  list,
  treated,
  total: knownTotal,
  counts,
  titleRef: queueTitle,
  onNavigate: go,
  onKindChange: setKind,
}: {
  tab: "todo" | "treated";
  kind: KindFilter;
  selectedId: string | null;
  page: number;
  list: ReturnType<typeof useApi<TodoPage>>;
  treated: ReturnType<typeof useApi<TreatedPage>>;
  /** Total en attente (tous types), `null` tant qu'il n'est pas chargé. */
  total: number | null;
  counts: Partial<Record<TodoKind, number>>;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onNavigate: (url: string) => void;
  onKindChange: (kind: KindFilter) => void;
}) {
  const [showAllKinds, setShowAllKinds] = useState(false);
  const total = knownTotal ?? 0;
  const items = list.data?.items ?? [];
  const treatedItems = treated.data?.items ?? [];
  const pageParam = page > 1 ? page : undefined;
  return (
    <aside
      aria-label="Éléments à traiter"
      {...revealed(
        1,
        `w-full shrink-0 flex-col gap-3 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-9rem)] lg:w-[360px] lg:overflow-hidden lg:pb-2 ${selectedId ? "hidden" : "flex"}`,
      )}
    >
      <header className="flex items-baseline gap-2">
        <h2 ref={queueTitle} tabIndex={-1} className="flex-1 text-base font-semibold text-foreground outline-none">
          Votre file de travail
        </h2>
        <span className="text-[13px] text-muted tabular-nums" role="status">
          {tab === "treated"
            ? treated.data
              ? `${treated.data.total} décision${treated.data.total > 1 ? "s" : ""} sur 24 h`
              : ""
            : knownTotal !== null
              ? `${total} en attente`
              : ""}
        </span>
      </header>
      <Segmented
        label="Affichage"
        className="w-full"
        value={tab}
        onChange={(v) => go(v === "treated" ? "/todo?tab=treated" : `/todo${qs({ kind })}`)}
        options={[
          { value: "todo", text: `À traiter · ${knownTotal ?? "—"}` },
          { value: "treated", text: `Traités 24 h · ${treated.data?.total ?? "—"}` },
        ]}
      />
      {tab === "treated" ? (
        <>
          <Loading loading={treated.loading && !treated.data} error={treated.error} onRetry={treated.reload} />
          {treated.data?.truncated && (
            <Notice tone="warning">Liste incomplète : seules les conversations les plus récentes sont affichées.</Notice>
          )}
          {treated.data && treatedItems.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted">
              Rien de traité pour l’instant. Chaque élément traité vient ici avec sa trace : qui a agi, quand, et ce
              qui est parti.
            </p>
          )}
          {treatedItems.length > 0 && (
            <ListScroll>
              <Box as="ul" className="gap-0.5 p-1.5">
                {treatedItems.map((t) => {
                  const name = t.prospect ? fullName(t.prospect) || t.prospect.email || "Prospect" : "Prospect";
                  return (
                    <li key={t.id}>
                      <RowButton
                        selected={t.id === selectedId}
                        className="py-2.5"
                        onClick={() => go(`/todo${qs({ tab: "treated", id: t.id })}`)}
                      >
                        <PersonMark name={name} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-baseline gap-2">
                            <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</strong>
                            <span className="shrink-0 text-xs text-muted">{formatDate(t.decided_at)}</span>
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            <Tag tone={t.decision === "approved" ? "success" : "neutral"}>
                              {t.decision === "approved" ? "Validé" : "Refusé"}
                            </Tag>
                            <Tag tone={EXECUTION_TONE[t.execution] ?? "neutral"}>{label(EXECUTION, t.execution)}</Tag>
                          </span>
                        </span>
                      </RowButton>
                    </li>
                  );
                })}
              </Box>
            </ListScroll>
          )}
        </>
      ) : (
        <>
          <FilterChipGroup
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "" as KindFilter, text: `Tout (${total})` },
              ...KIND_ORDER.filter((k) => showAllKinds || kind === k || (counts[k] ?? 0) > 0).map((k) => ({
                value: k as KindFilter,
                text: `${TASK_LABELS[k]} (${counts[k] ?? 0})`,
              })),
            ]}
            trailing={
              KIND_ORDER.some((k) => (counts[k] ?? 0) === 0 && kind !== k) && (
                <FilterChip
                  className="rounded-lg"
                  pressed={false}
                  aria-expanded={showAllKinds}
                  onClick={() => setShowAllKinds(!showAllKinds)}
                >
                  {showAllKinds ? "Masquer les types vides" : "Autres types"}
                </FilterChip>
              )
            }
          />
          <Loading loading={list.loading} error={list.error} onRetry={list.reload} shape="rows" />
          {list.data?.truncated && (
            // AUDIT-DATA-005 : au-delà du volume lu par l'API, les demandes les plus anciennes manquent.
            <Notice tone="warning">
              Liste incomplète : seules les conversations les plus récentes sont lues. Traitez les demandes affichées
              pour voir les suivantes.
            </Notice>
          )}
          {list.data && items.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted">Rien à traiter pour le moment.</p>
          )}
          {items.length > 0 && (
            <ListScroll>
              <Box as="ul" className="gap-0.5 p-1.5">
                {items.map((i) => (
                  <Row
                    key={i.id}
                    item={i}
                    selected={i.id === selectedId}
                    onSelect={() => go(`/todo${qs({ kind, page: pageParam, id: i.id })}`)}
                  />
                ))}
              </Box>
            </ListScroll>
          )}
          {list.data && (list.data.total > PAGE_SIZE || page > 1) && (
            <TablePagination
              className="flex-wrap justify-center gap-2"
              total={list.data.total}
              pageSize={PAGE_SIZE}
              page={page}
              onChange={(next) => go(`/todo${qs({ kind, page: next > 1 ? next : undefined })}`)}
            />
          )}
        </>
      )}
    </aside>
  );
}
