"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Btn, ErrorText, Field, Notice, SelectBox, Tag, TextInput } from "@/components/ds/controls";
import { EmptyText, Panel } from "@/components/ds/layout";
import { api, ApiError } from "@/lib/api";
import { TARGETS } from "@/lib/labels";
import type { KnowledgeStatus, SearchResult } from "@/lib/types";

function ScoreBar({ score, threshold, retained }: { score: number; threshold: number; retained: boolean }) {
  return (
    <div className="relative h-1.5 rounded-full bg-surface-tertiary" aria-hidden="true">
      <div
        className={`h-full rounded-full ${retained ? "bg-success" : "bg-muted/50"}`}
        style={{ width: `${Math.round(score * 100)}%` }}
      />
      <span
        className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground"
        style={{ left: `${Math.round(threshold * 100)}%` }}
      />
    </div>
  );
}


/** Score de pertinence en notation française, deux décimales (0,85). */
const score = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Teste une question : extraits trouvés, score et passage ou non du seuil de pertinence. Par défaut sur tous les
 * programmes ; choisir celui du prospect reproduit la recherche de l'agent.
 */
export default function SearchTester({ status }: { status: KnowledgeStatus }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api<SearchResult>("/knowledge/search", {
          method: "POST",
          body: { query, target_code: target || null, limit: 6 },
        }),
      );
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Échec de la recherche");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Tester une question" label="Tester une question" bodyClassName="gap-4 px-5 py-4">
      <p className="text-[13px]/[20px] text-muted">
        Vérifiez quelles sources l’agent peut utiliser avant de répondre à un
        prospect. Les extraits trop peu pertinents sont écartés.
      </p>
      {!status.configured && (
        <Notice tone="warning">
          Test indisponible : le service de recherche n’est pas configuré.
        </Notice>
      )}
      <form className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-end" onSubmit={run}>
        <Field label="Question du prospect">
          <TextInput
            variant="secondary"
            placeholder="Ex. Combien de temps dure le programme ?"
            value={query}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        <Field label="Programme du prospect">
          <SelectBox
            variant="secondary"
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              setResult(null);
            }}
          >
            <option value="">Tous les programmes</option>
            {Object.entries(TARGETS).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Btn
          variant="primary"
          type="submit"
          className="w-fit rounded-lg"
          disabled={busy || query.trim().length < 2 || !status.configured}
        >
          <Search className="size-4" aria-hidden="true" />
          {busy ? "Recherche…" : "Tester"}
        </Btn>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {result && result.results.length === 0 && (
        <EmptyText>
          Aucun extrait : la base est vide pour ce programme, ou ses documents sont à recalculer. Pour une question de ce
          type, l’agent la transmettrait à un conseiller.
        </EmptyText>
      )}
      {result && result.results.length > 0 && (
        <p className="text-[13px] text-muted" role="status">
          {result.results.length} extrait{result.results.length > 1 ? "s" : ""} trouvé{result.results.length > 1 ? "s" : ""} ·{" "}
          {result.results.filter((h) => h.retained).length} retenu{result.results.filter((h) => h.retained).length > 1 ? "s" : ""}{" "}
          (seuil de pertinence {score(result.threshold)})
          {!result.results.some((h) => h.retained) &&
            " : aucun n’atteint le seuil, l’agent transmettrait cette question à un conseiller."}
        </p>
      )}
      {result && result.results.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {result.results.map((hit, i) => (
            <li
              key={i}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${hit.retained ? "border-success/30 bg-success-soft/40" : "border-separator bg-surface-secondary/60"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="min-w-0 flex-1 text-sm font-semibold break-words text-foreground">{hit.source}</strong>
                <Tag tone={hit.retained ? "success" : "neutral"}>
                  {hit.retained ? "Retenu" : "Écarté (sous le seuil)"}
                </Tag>
                <span className="text-xs text-muted tabular-nums">
                  <span className="sr-only">Pertinence </span>
                  {score(hit.score)}
                </span>
              </div>
              <ScoreBar score={hit.score} threshold={result.threshold} retained={hit.retained} />
              <p className="text-[13px]/[20px] text-muted">{hit.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
