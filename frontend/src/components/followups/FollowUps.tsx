"use client";

/**
 * Relances programmées par l'agent (F-16) : la prochaine, sur la conversation et la fiche prospect, et ses
 * actions Décaler et Annuler. L'heure montrée est celle du départ prévu (`expected_at`) : une relance programmée
 * hors des heures d'envoi part à leur ouverture.
 */

import { Button, Dropdown, toast } from "@heroui/react";
import { CalendarClock, ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, Field, TextInput } from "@/components/ds/controls";
import { EmptyText } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { api, ApiError } from "@/lib/api";
import { CHANNELS, label } from "@/lib/labels";
import type { Page, PlannedFollowUp } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const DAY = 24 * 60 * 60 * 1000;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** « 10 h », « 10 h 30 ». */
function hourOf(d: Date) {
  const m = d.getMinutes();
  return `${d.getHours()} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

/** « aujourd'hui à 10 h », « demain à 10 h », « jeudi 26 novembre à 10 h » (heure locale du navigateur). */
export function followUpTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = sameDay(d, now)
    ? "aujourd’hui"
    : sameDay(d, new Date(now.getTime() + DAY))
      ? "demain"
      : d.toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
        });
  return `${day} à ${hourOf(d)}`;
}

/** Valeur d'un champ `datetime-local` (heure locale, à la minute). */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SHIFTS = [
  { id: "1", days: 1, label: "De 1 jour" },
  { id: "3", days: 3, label: "De 3 jours" },
  { id: "7", days: 7, label: "D’une semaine" },
] as const;

/** Décaler (menu : 1 jour, 3 jours, une semaine, ou date et heure au choix) et Annuler (après confirmation). */
export function FollowUpActions({
  followUp: f,
  onChanged,
  size = "sm",
}: {
  followUp: PlannedFollowUp;
  onChanged: () => void;
  size?: "sm" | "md";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"cancel" | "pick" | null>(null);
  const [picked, setPicked] = useState("");

  async function run(what: string, action: () => Promise<unknown>, done: string) {
    setPending(true);
    setError(null);
    try {
      await action();
      toast.success(done, { description: f.prospect_name });
      onChanged();
    } catch (err) {
      setError(`${what} : ${err instanceof ApiError ? err.message : "échec"}`);
      // Partie ou annulée entre-temps : la liste relue le montre.
      if (err instanceof ApiError && err.status === 409) onChanged();
    } finally {
      setPending(false);
    }
  }

  const moveTo = (at: Date) =>
    void run(
      "Relance non décalée",
      () => api(`/follow-ups/${f.id}/reschedule`, { method: "POST", body: { scheduled_at: at.toISOString() } }),
      `Relance décalée à ${followUpTime(at.toISOString())}`,
    );

  function shift(days: number) {
    // Décalée à partir de l'heure prévue ; une relance en retard (hors fenêtre) part de maintenant.
    const base = Math.max(new Date(f.scheduled_at).getTime(), Date.now());
    moveTo(new Date(base + days * DAY));
  }

  const pickedDate = picked ? new Date(picked) : null;
  const pickedError =
    pickedDate && pickedDate.getTime() <= Date.now()
      ? "Choisissez une heure à venir."
      : pickedDate && pickedDate.getTime() > Date.now() + 90 * DAY
        ? "90 jours au plus."
        : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown>
          <Button size={size} variant="secondary" isDisabled={pending} aria-label={`Décaler la relance de ${f.prospect_name}`}>
            Décaler
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
          <Dropdown.Popover placement="bottom start">
            <Dropdown.Menu
              aria-label="Décaler la relance"
              onAction={(key) => {
                const preset = SHIFTS.find((s) => s.id === key);
                if (preset) shift(preset.days);
                else {
                  setPicked(localInput(new Date(Math.max(new Date(f.scheduled_at).getTime(), Date.now()) + DAY)));
                  setDialog("pick");
                }
              }}
            >
              {[
                ...SHIFTS.map((s) => (
                  <Dropdown.Item key={s.id} id={s.id} textValue={s.label}>
                    {s.label}
                  </Dropdown.Item>
                )),
                <Dropdown.Item key="pick" id="pick" textValue="Choisir la date et l’heure">
                  Choisir la date et l’heure…
                </Dropdown.Item>,
              ]}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button
          size={size}
          variant="tertiary"
          isDisabled={pending}
          onPress={() => setDialog("cancel")}
          aria-label={`Annuler la relance de ${f.prospect_name}`}
        >
          <X className="size-4" aria-hidden="true" />
          Annuler
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <ConfirmDialog
        isOpen={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Annuler cette relance ?"
        description="Elle ne partira pas. Si l’agent écrit de nouveau à ce prospect, il pourra en programmer une autre."
        confirmLabel="Annuler la relance"
        cancelLabel="Garder la relance"
        status="danger"
        onConfirm={() =>
          void run("Relance non annulée", () => api(`/follow-ups/${f.id}/cancel`, { method: "POST" }), "Relance annulée")
        }
      />
      <ConfirmDialog
        isOpen={dialog === "pick"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Décaler la relance"
        description="Elle partira à cette heure, ou à l’ouverture des heures d’envoi si elle tombe en dehors."
        confirmLabel="Décaler"
        cancelLabel="Retour"
        status="accent"
        confirmDisabled={!pickedDate || !!pickedError}
        onConfirm={() => pickedDate && moveTo(pickedDate)}
      >
        <Field label="Nouvelle date et heure" error={pickedError}>
          <TextInput type="datetime-local" value={picked} onChange={(e) => setPicked(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/** Détail sous l'heure : motif, canal, heure demandée si elle tombe hors des heures d'envoi. */
export function FollowUpDetails({ followUp: f }: { followUp: PlannedFollowUp }) {
  const delayed = new Date(f.expected_at).getTime() - new Date(f.scheduled_at).getTime() > 60_000;
  return (
    <>
      {(f.reason || f.channel) && (
        <span className="type-body-sm text-foreground">
          {[f.reason, f.channel ? label(CHANNELS, f.channel) : null].filter(Boolean).join(" · ")}
        </span>
      )}
      {delayed && (
        <span className="type-caption text-muted">
          Programmée {followUpTime(f.scheduled_at)}, hors des heures d’envoi{"\u00a0"}: elle partira à leur ouverture.
        </span>
      )}
    </>
  );
}

/** « Prochaine relance : jeudi 26 novembre à 10 h », avec Décaler et Annuler. Rien quand aucune n'est prévue. */
export function NextFollowUp({
  prospectId,
  readOnly,
  revision = 0,
  onChanged,
  className,
}: {
  prospectId: number;
  readOnly: boolean;
  /** Change après une action qui a pu programmer ou annuler une relance : la liste est relue. */
  revision?: string | number;
  onChanged?: () => void;
  className?: string;
}) {
  const list = useApi<PlannedFollowUp[]>(`/prospects/${prospectId}/follow-ups`, { keepPrevious: true });
  const seen = useRef(revision);
  const { reload } = list;
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    reload();
  }, [revision, reload]);
  const next = list.data?.[0];
  if (!next) return null;
  const others = (list.data?.length ?? 1) - 1;
  return (
    <Box
      as="section"
      aria-label="Prochaine relance"
      className={`flex-row flex-wrap items-start gap-3 p-4 ${reveal(1).className} ${className ?? ""}`}
      style={reveal(1).style}
    >
      <span
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted"
        aria-hidden="true"
      >
        <CalendarClock className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <p className="type-body font-medium text-foreground">
          Prochaine relance{"\u00a0"}: <span className="tabular-nums">{followUpTime(next.expected_at)}</span>
        </p>
        <FollowUpDetails followUp={next} />
        <span className="type-caption text-muted">
          Annulée si le prospect répond, se désinscrit ou est transféré.
          {others > 0 ? ` ${others} autre${others > 1 ? "s" : ""} relance${others > 1 ? "s" : ""} prévue${others > 1 ? "s" : ""} ensuite.` : ""}
        </span>
      </div>
      {!readOnly && (
        <FollowUpActions
          followUp={next}
          onChanged={() => {
            list.reload();
            onChanged?.();
          }}
        />
      )}
    </Box>
  );
}

const PAGE = 5;

/** Relances à venir (Aujourd'hui) : la plus proche d'abord, 5 par 5, avec Décaler et Annuler. */
export function UpcomingFollowUps({ readOnly, onTotal }: { readOnly: boolean; onTotal?: (total: number) => void }) {
  const [limit, setLimit] = useState(PAGE);
  const list = useApi<Page<PlannedFollowUp>>(`/follow-ups?limit=${limit}`, { keepPrevious: true });
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined) onTotal?.(total);
  }, [total, onTotal]);
  if (list.error && !list.data) return <ErrorText>Relances non chargées : {list.error.message}</ErrorText>;
  if (!list.data) return null;
  const { items } = list.data;
  if (items.length === 0) return <EmptyText>Aucune relance programmée.</EmptyText>;
  const rest = list.data.total - items.length;
  return (
    <>
      <ul className="flex flex-col divide-y divide-separator">
        {items.map((f) => (
          <li key={f.id} className="flex flex-wrap gap-3 py-3">
            <span
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted"
              aria-hidden="true"
            >
              <CalendarClock className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2">
                <Link
                  href={`/prospects/${f.prospect_id}`}
                  className="rounded type-body font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {f.prospect_name}
                </Link>
                <span className="flex-1" />
                <span className="type-caption text-muted tabular-nums">{followUpTime(f.expected_at)}</span>
              </span>
              <FollowUpDetails followUp={f} />
            </span>
            {!readOnly && <FollowUpActions followUp={f} onChanged={list.reload} />}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <div className="border-t border-separator py-3">
          <Btn size="sm" variant="tertiary" disabled={list.loading} onClick={() => setLimit((l) => l + 20)}>
            Afficher {Math.min(rest, 20)} relance{Math.min(rest, 20) > 1 ? "s" : ""} de plus ({rest} restante{rest > 1 ? "s" : ""})
          </Btn>
        </div>
      )}
    </>
  );
}
