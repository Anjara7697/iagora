"use client";

import { CheckCircle2, CircleSlash, Gauge, MessagesSquare, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Drawer } from "@/components/ds/Drawer";
import { FilterChipGroup, Tag } from "@/components/ds/controls";
import { EmptyPanel, cx } from "@/components/ds/layout";
import { CompactList, CompactRow, DataTable, Table } from "@/components/ds/table";
import { ListToolbar, countLabel } from "@/components/ds/toolbar";
import { NARROW, useMediaQuery } from "@/lib/useMediaQuery";
import type { CaseRow, ConversationRow, EvalRun, QuestionRow } from "@/lib/evaluation";

/** Résultat d'un élément : écrit (« Conforme », « Écart », « Ignoré »), l'icône et la couleur ne font que l'appuyer. */
function Verdict({ ok, skipped }: { ok: boolean | null | undefined; skipped?: boolean }) {
  if (skipped || ok === null || ok === undefined)
    return (
      <Tag tone="muted" icon={<CircleSlash className="size-3.5" aria-hidden="true" />}>
        {skipped ? "Ignoré" : "Mesuré"}
      </Tag>
    );
  return ok ? (
    <Tag tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}>
      Conforme
    </Tag>
  ) : (
    <Tag tone="danger" icon={<XCircle className="size-3.5" aria-hidden="true" />}>
      Écart
    </Tag>
  );
}

const turnMarks = (row: ConversationRow) => row.turns.map((t) => (t.ok ? "✓" : "✗")).join(" ");

function Toolbar({ total, shown, noun, onlyGaps, onOnlyGaps }: { total: number; shown: number; noun: string; onlyGaps: boolean; onOnlyGaps: (v: boolean) => void }) {
  return (
    <ListToolbar label={`Filtre des ${noun}s`} count={countLabel(shown, noun, onlyGaps ? total : null)}>
      <FilterChipGroup
        label="Résultat"
        options={[
          { value: "", text: "Tous" },
          { value: "gaps", text: "Écarts seulement" },
        ]}
        value={onlyGaps ? "gaps" : ""}
        onChange={(v) => onOnlyGaps(v === "gaps")}
      />
    </ListToolbar>
  );
}

/** Un échange, message par message, avec le résultat de chaque tour devant le message du prospect. */
function Transcript({ row }: { row: ConversationRow }) {
  let turn = -1;
  const lines = row.transcript ?? [];
  if (lines.length === 0) return <p className="type-body text-muted">Échange non enregistré dans ce rapport.</p>;
  return (
    <ol className="flex flex-col gap-3" aria-label="Échange">
      {lines.map((line, i) => {
        const isProspect = line.role === "prospect";
        if (isProspect) turn += 1;
        const t = isProspect ? row.turns[turn] : undefined;
        return (
          <li key={i} className={cx("flex flex-col gap-1", isProspect ? "items-start" : "items-end")}>
            <span className="flex items-center gap-2 type-caption text-muted">
              {isProspect ? `Prospect · tour ${turn + 1}` : "Agent"}
              {t && <Verdict ok={t.ok} />}
            </span>
            <p
              className={cx(
                "max-w-[85%] rounded-lg px-3 py-2 type-body-sm whitespace-pre-line text-foreground",
                isProspect ? "bg-surface-secondary" : "bg-accent-soft",
              )}
            >
              {line.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Issues({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="type-body-sm text-muted">Aucun écart relevé.</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 type-body-sm text-foreground">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function Conversations({ rows, item, onItem, onlyGaps, onOnlyGaps }: { rows: ConversationRow[] } & Shared) {
  const narrow = useMediaQuery(NARROW);
  const shown = onlyGaps ? rows.filter((r) => !r.ok && !r.skipped) : rows;
  const open = rows.find((r) => r.id === item) ?? null;
  return (
    <>
      <Toolbar total={rows.length} shown={shown.length} noun="conversation" onlyGaps={onlyGaps} onOnlyGaps={onOnlyGaps} />
      {narrow ? (
        <CompactList label="Conversations jouées">
          {shown.map((r) => (
            <CompactRow key={r.id} onPress={() => onItem(r.id)} title={r.title ?? r.id} aside={<Verdict ok={r.ok} skipped={!!r.skipped} />}>
              <span className="type-caption text-muted">
                {r.id} · tours {turnMarks(r) || "-"}
              </span>
            </CompactRow>
          ))}
        </CompactList>
      ) : (
        <DataTable
          label="Conversations jouées"
          minWidth={720}
          columns={[
            { id: "conv", label: "Conversation", className: "min-w-[260px]" },
            { id: "turns", label: "Tours" },
            { id: "issues", label: "Écarts" },
            { id: "result", label: "Résultat" },
          ]}
          emptyState={<EmptyPanel icon={MessagesSquare} title="Aucune conversation" description="Aucune ne correspond au filtre." />}
        >
          {shown.map((r) => (
            <Table.Row key={r.id} id={r.id} onAction={() => onItem(r.id)} className="cursor-pointer">
              <Table.Cell>
                <span className="flex flex-col gap-0.5">
                  <strong className="type-body font-medium text-foreground">{r.title ?? r.id}</strong>
                  <span className="type-caption text-muted">{r.skipped ?? r.id}</span>
                </span>
              </Table.Cell>
              <Table.Cell className="font-mono whitespace-nowrap">{turnMarks(r) || "-"}</Table.Cell>
              <Table.Cell className="tabular-nums">{r.issues?.length ?? "-"}</Table.Cell>
              <Table.Cell>
                <Verdict ok={r.ok} skipped={!!r.skipped} />
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
      <Drawer open={open !== null} onClose={() => onItem(null)} eyebrow="Conversation" title={open?.title ?? open?.id ?? ""} icon={<MessagesSquare aria-hidden="true" />}>
        {open && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Verdict ok={open.ok} skipped={!!open.skipped} />
              <span className="type-caption text-muted">{open.id}</span>
            </div>
            {open.error && <p className="type-body-sm text-danger">{`Erreur technique : ${open.error}`}</p>}
            <section aria-label="Écarts" className="flex flex-col gap-2">
              <h3 className="type-body font-semibold">Écarts</h3>
              <Issues items={open.issues ?? []} />
            </section>
            <section aria-label="Échange complet" className="flex flex-col gap-2">
              <h3 className="type-body font-semibold">Échange</h3>
              <Transcript row={open} />
            </section>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Cases({ rows, item, onItem, onlyGaps, onOnlyGaps }: { rows: CaseRow[] } & Shared) {
  const narrow = useMediaQuery(NARROW);
  const shown = onlyGaps ? rows.filter((r) => !r.ok) : rows;
  const open = rows.find((r) => r.id === item) ?? null;
  const detail = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="break-words text-foreground">{value ?? "-"}</dd>
    </>
  );
  return (
    <>
      <Toolbar total={rows.length} shown={shown.length} noun="cas" onlyGaps={onlyGaps} onOnlyGaps={onOnlyGaps} />
      {narrow ? (
        <CompactList label="Cas joués">
          {shown.map((r) => (
            <CompactRow key={r.id} onPress={() => onItem(r.id)} title={r.id} aside={<Verdict ok={r.ok} />}>
              <span className="type-caption text-muted">
                {r.category} · {r.action ?? "-"}
              </span>
            </CompactRow>
          ))}
        </CompactList>
      ) : (
        <DataTable
          label="Cas joués"
          minWidth={760}
          columns={[
            { id: "case", label: "Cas", className: "min-w-[260px]" },
            { id: "category", label: "Catégorie" },
            { id: "intent", label: "Intention" },
            { id: "action", label: "Décision" },
            { id: "result", label: "Résultat" },
          ]}
          emptyState={<EmptyPanel icon={Gauge} title="Aucun cas" description="Aucun ne correspond au filtre." />}
        >
          {shown.map((r) => (
            <Table.Row key={r.id} id={r.id} onAction={() => onItem(r.id)} className="cursor-pointer">
              <Table.Cell>
                <span className="flex flex-col gap-0.5">
                  <strong className="type-body font-medium text-foreground">{r.id}</strong>
                  {r.message && <span className="line-clamp-1 type-caption text-muted">{r.message}</span>}
                </span>
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">{r.category}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">{r.intent ?? "-"}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">{r.action ?? "-"}</Table.Cell>
              <Table.Cell>
                <Verdict ok={r.ok} />
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
      <Drawer open={open !== null} onClose={() => onItem(null)} eyebrow="Cas" title={open?.id ?? ""} icon={<Gauge aria-hidden="true" />}>
        {open && (
          <div className="flex flex-col gap-5">
            <Verdict ok={open.ok} />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 type-body-sm">
              {detail("Catégorie", open.category)}
              {detail("Intention lue", open.intent)}
              {detail("Décision", open.action)}
              {detail("Transfert", open.handoff_reason)}
              {open.error && detail("Erreur technique", open.error)}
            </dl>
            <section aria-label="Écarts" className="flex flex-col gap-2">
              <h3 className="type-body font-semibold">Écarts</h3>
              <Issues items={open.gaps ?? []} />
            </section>
            <section aria-label="Échange" className="flex flex-col gap-2">
              <h3 className="type-body font-semibold">Échange</h3>
              <Transcript
                row={{
                  id: open.id,
                  ok: open.ok,
                  turns: [{ id: open.id, ok: open.ok }],
                  transcript: [
                    ...(open.message ? [{ role: "prospect" as const, text: open.message }] : []),
                    ...(open.reply ? [{ role: "agent" as const, text: open.reply }] : []),
                  ],
                }}
              />
            </section>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Questions({ rows, onlyGaps, onOnlyGaps }: { rows: QuestionRow[] } & Omit<Shared, "item" | "onItem">) {
  const narrow = useMediaQuery(NARROW);
  const shown = onlyGaps ? rows.filter((r) => r.ok === false) : rows;
  const found = (r: QuestionRow) => `${r.found ?? "-"} (${r.score.toFixed(3)}${r.retained ? "" : ", écarté"})`;
  return (
    <>
      <Toolbar total={rows.length} shown={shown.length} noun="question" onlyGaps={onlyGaps} onOnlyGaps={onOnlyGaps} />
      {narrow ? (
        <CompactList label="Questions jouées">
          {shown.map((r) => (
            <li key={r.question} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex items-start justify-between gap-2">
                <span className="type-body font-medium">{r.question}</span>
                <Verdict ok={r.ok} />
              </span>
              <span className="type-caption text-muted">
                Attendu {r.expect ?? "rien"} · trouvé {found(r)}
              </span>
            </li>
          ))}
        </CompactList>
      ) : (
        <DataTable
          label="Questions jouées"
          minWidth={760}
          columns={[
            { id: "question", label: "Question", className: "min-w-[280px]" },
            { id: "expect", label: "Attendu" },
            { id: "found", label: "Trouvé (score)" },
            { id: "result", label: "Résultat" },
          ]}
        >
          {shown.map((r) => (
            <Table.Row key={r.question} id={r.question}>
              <Table.Cell>
                <span className="flex flex-col gap-0.5">
                  <span className="type-body text-foreground">{r.question}</span>
                  {r.same_topic && <span className="type-caption text-muted">Même sujet, sans réponse : l’agent doit transférer</span>}
                </span>
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">{r.expect ?? "rien (hors sujet)"}</Table.Cell>
              <Table.Cell className="whitespace-nowrap tabular-nums">{found(r)}</Table.Cell>
              <Table.Cell>
                <Verdict ok={r.ok} />
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
    </>
  );
}

type Shared = { item: string | null; onItem: (id: string | null) => void; onlyGaps: boolean; onOnlyGaps: (v: boolean) => void };


/** Détail d'un passage selon sa suite ; l'élément ouvert dans le panneau est dans l'adresse (`?tab=details&item=…`). */
export default function RunItems({ run, item, onItem }: { run: EvalRun; item: string | null; onItem: (id: string | null) => void }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const report = run.report;
  const shared = { item, onItem, onlyGaps, onOnlyGaps: setOnlyGaps };
  return (
    <section aria-label="Détail du passage" className="flex flex-col gap-3">
      {report?.conversations && <Conversations rows={report.conversations} {...shared} />}
      {report?.cases && <Cases rows={report.cases} {...shared} />}
      {report?.questions && <Questions rows={report.questions} onlyGaps={onlyGaps} onOnlyGaps={setOnlyGaps} />}
    </section>
  );
}
