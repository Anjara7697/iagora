"use client";

import { toast } from "@heroui/react";
import { History, ListChecks } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Btn, LinkButton, TextLink } from "@/components/ds/controls";
import { EmptyPanel, Eyebrow, PageHeader, Screen } from "@/components/ds/layout";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { Loading, Skeleton } from "@/components/ui";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { TodoItem, TodoKind, TodoPage, TreatedPage } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { KIND_ORDER, PAGE_SIZE, type KindFilter } from "@/components/todo/shared";
import { TodoQueue } from "@/components/todo/TodoQueue";
import { TodoDetail } from "@/components/todo/TodoDetail";
import { TreatedDetail } from "@/components/todo/TreatedDetail";

/**
 * « À traiter » : file de travail à gauche, détail de l'élément ouvert à droite (maître-détail). La page tient
 * l'état de l'URL (type, page, onglet, élément), la garde des saisies non enregistrées et l'enchaînement après
 * une décision ; la file et les panneaux sont dans `components/todo/`.
 */

/** Cible du focus quand la file est vide après une décision. */
const QUEUE = "queue";

function Todo() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const kind: KindFilter = KIND_ORDER.includes(params.get("kind") as TodoKind)
    ? (params.get("kind") as TodoKind)
    : "";
  // Page de la file dans l'URL (comme le filtre et l'élément ouvert) : lien partageable, retour arrière fidèle.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const pageParam = page > 1 ? page : undefined;
  // Saisie non enregistrée dans le panneau ouvert : changer d'élément, d'onglet ou de filtre demande confirmation.
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const { guard, dialog: discardDialog } = useDiscardGuard(() => dirty.current);
  // Après une décision, le focus va au titre de l'élément suivant, ou à celui de la file quand elle est vide.
  const [focusId, setFocusId] = useState<string | null>(null);
  const queueTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusId !== QUEUE || selectedId) return;
    queueTitle.current?.focus({ preventScroll: true });
    setFocusId(null);
  }, [focusId, selectedId]);
  function go(url: string, then?: () => void) {
    guard(() => {
      dirty.current = false;
      setFocusId(null);
      then?.();
      router.replace(url, { scroll: false });
    });
  }
  function setKind(value: KindFilter) {
    go(`/todo${qs({ kind: value, id: selectedId })}`);
  }
  const list = useApi<TodoPage>(`/todo${qs({ kind, limit: PAGE_SIZE, offset })}`);
  const all = useApi<TodoPage>("/todo?limit=1");
  const tab = params.get("tab") === "treated" ? "treated" : "todo";
  const treated = useApi<TreatedPage>("/todo/treated", { keepPrevious: true });
  const treatedItems = treated.data?.items ?? [];
  const selectedTreated = treatedItems.find((i) => i.id === selectedId) ?? null;

  const items = list.data?.items ?? [];
  const inPage = items.find((i) => i.id === selectedId) ?? null;
  const direct = useApi<TodoItem>(
    tab === "todo" && selectedId && !inPage
      ? `/todo/item${qs({ id: selectedId })}`
      : null,
  );
  const selected =
    inPage ?? (direct.data?.id === selectedId ? direct.data : null);
  const counts = all.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const refresh = () => {
    list.reload();
    all.reload();
    treated.reload();
    direct.reload();
  };

  const placeholderTitle =
    tab === "treated"
      ? "Retrouvez vos décisions"
      : list.loading
        ? "Chargement de votre file…"
        : list.error
          ? "La file est indisponible."
          : items.length
            ? "Faisons avancer vos échanges."
            : kind
              ? "Aucune demande de ce type."
              : "Votre file est à jour.";
  const placeholderText =
    tab === "treated"
      ? "Sélectionnez un message pour consulter la décision et son état d’envoi."
      : list.loading
        ? "Nous récupérons les demandes à examiner."
        : list.error
          ? "Réessayez depuis la liste pour retrouver vos demandes."
          : items.length
            ? "Choisissez une demande à gauche. Vous retrouverez son contexte, la réponse proposée et les éléments pour décider."
            : "Les nouvelles demandes apparaîtront ici. Vous pouvez retrouver les échanges en cours dans les conversations.";

  return (
    <Screen wide className="gap-4">
      <PageHeader
        eyebrow="Travail · Décisions"
        title="À traiter"
        subtitle={
          // Sur mobile, un élément ouvert prend la place : la réponse à relire apparaît sans défiler.
          <span className={selectedId ? "max-lg:hidden" : undefined}>
            Examinez le contexte préparé par l’agent, puis validez la prochaine action.
          </span>
        }
      />
      {selectedId && (
        <div className="lg:hidden">
          <Btn
            variant="ghost"
            onClick={() =>
              go(`/todo${qs(tab === "treated" ? { tab: "treated" } : { kind, page: pageParam })}`)
            }
          >
            ← Liste des éléments
          </Btn>
        </div>
      )}
      <div className="flex items-start gap-5">
        <TodoQueue
          tab={tab}
          kind={kind}
          selectedId={selectedId}
          page={page}
          list={list}
          treated={treated}
          total={all.data ? total : null}
          counts={counts}
          titleRef={queueTitle}
          onNavigate={go}
          onKindChange={setKind}
          guard={guard}
          onBatchDone={() => {
            dirty.current = false;
            router.replace(`/todo${qs({ kind })}`, { scroll: false });
            refresh();
          }}
        />
        <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {tab === "treated" && selectedTreated ? (
            <TreatedDetail
              key={selectedTreated.id}
              item={selectedTreated}
              onChanged={treated.reload}
              refreshing={treated.loading}
            />
          ) : tab === "treated" && selectedId ? (
            <Box as="section"
              className="flex-1 gap-4 p-6"
              aria-label="Décision recherchée"
            >
              <Loading
                loading={treated.loading}
                error={treated.error}
                onRetry={treated.reload}
              />
              {!treated.loading && !treated.error && treated.data && (
                <div className="flex flex-col items-start gap-3">
                  <h2 className="text-lg font-semibold text-foreground">Cette décision n’est pas dans la liste.</h2>
                  <p className="text-sm text-muted">
                    Les décisions affichées couvrent les dernières 24 heures.
                    Retrouvez l’échange dans les conversations ou actualisez la liste.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={treated.reload}>Actualiser les décisions</Btn>
                    <LinkButton variant="outline" href="/conversations">
                      Consulter les conversations
                    </LinkButton>
                  </div>
                </div>
              )}
            </Box>
          ) : tab === "todo" && selected ? (
            <TodoDetail
              key={selected.id}
              item={selected}
              kind={kind}
              autoFocus={focusId === selected.id}
              onDirtyChange={onDirtyChange}
              guard={guard}
              onDone={(result) => {
                // La décision est enregistrée : Toast, puis l'élément suivant de la file s'ouvre pour enchaîner.
                const rest = items.filter((i) => i.id !== selected.id);
                const index = items.findIndex((i) => i.id === selected.id);
                const next = rest[Math.max(0, index)] ?? rest[rest.length - 1] ?? null;
                const treatedId = result.treatedId;
                toast.success(result.title, {
                  description: result.description,
                  actionProps: treatedId
                    ? { children: "Voir la décision", onPress: () => go(`/todo${qs({ tab: "treated", id: treatedId })}`) }
                    : undefined,
                });
                dirty.current = false;
                setFocusId(next?.id ?? QUEUE);
                router.replace(`/todo${qs({ kind, page: pageParam, id: next?.id })}`, { scroll: false });
                refresh();
              }}
            />
          ) : tab === "todo" && selectedId ? (
            <Box as="section" className="flex-1 gap-4 p-6">
              <Loading
                loading={direct.loading}
                error={direct.error}
                onRetry={direct.reload}
              />
              {direct.error?.status === 404 && (
                <TextLink href="/conversations">Consulter les conversations</TextLink>
              )}
            </Box>
          ) : (
            <Box as="section" className="flex-1 p-0">
              <EmptyPanel
                icon={tab === "treated" ? History : ListChecks}
                title={placeholderTitle}
                description={
                  <>
                    <Eyebrow className="mb-2 block">Un regard humain, au bon moment</Eyebrow>
                    {placeholderText}
                  </>
                }
                action={
                  <>
                    {tab === "todo" && items[0] && (
                      <Btn
                        variant="primary"
                        onClick={() => go(`/todo${qs({ kind, page: pageParam, id: items[0].id })}`)}
                      >
                        Examiner la première demande →
                      </Btn>
                    )}
                    {tab === "todo" && !list.loading && !list.error && !items.length && (
                      <LinkButton variant="outline" href="/conversations">
                        Voir les conversations
                      </LinkButton>
                    )}
                  </>
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

export default function TodoPageRoute() {
  return (
    <Suspense fallback={<Skeleton shape="rows" />}>
      <Todo />
    </Suspense>
  );
}
