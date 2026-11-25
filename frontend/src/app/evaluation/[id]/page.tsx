"use client";

import { ProgressBar, Tabs, toast } from "@heroui/react";
import { GitCompareArrows, Pencil, Printer, Trash2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { BackLink, Btn, ErrorText, LinkButton, Notice, TabListContainer } from "@/components/ds/controls";
import { ErrorState, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ds/ui";
import IndicatorTable from "@/components/evaluation/IndicatorTable";
import RunItems from "@/components/evaluation/RunItems";
import RunEditPanel from "@/components/evaluation/RunEditPanel";
import { RunStatus } from "@/components/evaluation/RunsTable";
import { api, failure } from "@/lib/api";
import {
  canUseEvaluation,
  describeSettings,
  evaluationHref,
  formatDuration,
  formatRunDate,
  isRunId,
  type EvalRun,
} from "@/lib/evaluation";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";

const TABS = { indicators: "Indicateurs", details: "Détail" } as const;
type Tab = keyof typeof TABS;
const POLL_MS = 2000;

export default function RunPage() {
  return (
    <Suspense>
      <Run />
    </Suspense>
  );
}

/**
 * Un passage d'évaluation (règle 1 : page dédiée, plusieurs sections) : en-tête et actions, réglages, puis deux
 * onglets dans l'adresse (`?tab=details`) : les indicateurs regroupés, et le détail (échanges, cas, questions).
 * Pendant le passage, la page se relit seule et affiche l'avancement.
 */
function Run() {
  const user = useCurrentUser();
  const router = useRouter();
  const allowed = canUseEvaluation(user?.role);
  const params = useParams<{ id: string }>();
  const id = isRunId(params.id) ? params.id : null;
  const query = useSearchParams();
  const tab: Tab = query.get("tab") === "details" ? "details" : "indicators";
  const item = query.get("item");
  const runs = useApi<EvalRun[]>(allowed && id ? "/evaluations" : null);
  const run = useApi<EvalRun>(allowed && id ? `/evaluations/${id}` : null, { keepPrevious: true });
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = run.data;
  const isRunning = data?.status === "running";
  const reload = run.reload;
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isRunning, reload]);

  const setView = (patch: { tab?: Tab; item?: string | null }) => {
    const next = new URLSearchParams(window.location.search);
    const t = patch.tab ?? (next.get("tab") as Tab | null) ?? "indicators";
    if (t === "indicators") next.delete("tab");
    else next.set("tab", t);
    const it = patch.item === undefined ? next.get("item") : patch.item;
    if (it) next.set("item", it);
    else next.delete("item");
    const qs = next.toString();
    replaceUrl(`/evaluation/${id}${qs ? `?${qs}` : ""}`);
  };

  if (!allowed) {
    return (
      <Screen>
        <PageHeader title="Passage d’évaluation" />
        <Notice tone="warning">L’évaluation de l’agent est réservée aux administrateurs.</Notice>
      </Screen>
    );
  }
  if (!id || (run.error && run.error.status === 404)) {
    return (
      <Screen>
        <BackLink href="/evaluation">Évaluation</BackLink>
        {/* Titre de la page (h1), comme la page introuvable de la console. */}
        <PageHeader title="Passage introuvable" subtitle="Il a peut-être été supprimé de l’historique." />
      </Screen>
    );
  }

  // Passage précédent de la même suite, pour la comparaison en un clic.
  const previous = data && runs.data?.filter((r) => r.suite === data.suite && r.indicators.length > 0 && new Date(r.ran_at) < new Date(data.ran_at))[0];

  const cancel = async () => {
    setError(null);
    try {
      await api(`/evaluations/${id}/cancel`, { method: "POST" });
      toast.success("Passage annulé", { description: "Les résultats déjà obtenus sont gardés." });
    } catch (err) {
      setError(failure("Annulation impossible", err));
    } finally {
      run.reload();
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await api(`/evaluations/${id}`, { method: "DELETE" });
      toast.success("Passage supprimé", { description: data?.label });
      router.push("/evaluation");
    } catch (err) {
      setError(failure("Suppression impossible", err));
    }
  };

  return (
    <Screen scroll>
      <BackLink href="/evaluation" className="print:hidden">
        Évaluation
      </BackLink>
      {run.error && !data ? (
        <ErrorState message={`Impossible de charger le passage : ${run.error.message}`} onRetry={run.reload} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <PageHeader
            {...reveal(0)}
            title={
              <span className="flex flex-wrap items-center gap-3">
                {data.label}
                <RunStatus run={data} />
              </span>
            }
            subtitle={`${data.suite_label} · ${formatRunDate(data.ran_at)}${data.duration_seconds !== undefined ? ` · ${formatDuration(data.duration_seconds)}` : ""}`}
            actions={
              <div className="flex flex-wrap gap-2 print:hidden">
                {previous && (
                  <LinkButton
                    href={evaluationHref({ tab: "compare", suite: data.suite, a: previous.id, b: data.id, indicator: null })}
                    variant="secondary"
                  >
                    <GitCompareArrows className="size-4" aria-hidden="true" />
                    Comparer au précédent
                  </LinkButton>
                )}
                {isRunning ? (
                  <Btn variant="danger-soft" onClick={() => setCancelling(true)}>
                    Annuler le passage
                  </Btn>
                ) : (
                  <>
                    <Btn variant="tertiary" onClick={() => window.print()}>
                      <Printer className="size-4" aria-hidden="true" />
                      Imprimer
                    </Btn>
                    <Btn variant="tertiary" onClick={() => setEditing(true)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Modifier
                    </Btn>
                    <ConfirmDialog
                      trigger={
                        <Btn variant="danger-soft">
                          <Trash2 className="size-4" aria-hidden="true" />
                          Supprimer
                        </Btn>
                      }
                      title={`Supprimer « ${data.label} » ?`}
                      description="Le passage disparaît de l’historique, des comparaisons et de la courbe d’évolution. Cette action est définitive."
                      confirmLabel="Supprimer"
                      onConfirm={() => void remove()}
                    />
                  </>
                )}
              </div>
            }
          />

          {error && <ErrorText>{error}</ErrorText>}
          {isRunning && data.progress && (
            <Notice tone="info">
              <div className="flex w-full flex-col gap-2">
                <span>{`${data.progress.done} sur ${data.progress.total} joués, ${data.progress.ok} conformes. La page se met à jour seule.`}</span>
                <ProgressBar
                  aria-label="Avancement du passage"
                  value={data.progress.done}
                  maxValue={Math.max(1, data.progress.total)}
                  size="sm"
                >
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              </div>
            </Notice>
          )}
          {data.status === "failed" && <ErrorText>{`Le passage a échoué : ${data.error ?? "erreur inconnue"}`}</ErrorText>}
          {data.status === "interrupted" && (
            <Notice tone="warning">Le passage a été coupé par un redémarrage du serveur : relancez-le pour une mesure complète.</Notice>
          )}
          {data.status === "cancelled" && <Notice tone="warning">Passage annulé : seuls les éléments joués avant l’arrêt sont mesurés.</Notice>}

          <section aria-label="Réglages du passage" className="flex flex-col gap-2 type-body-sm">
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
              {describeSettings(data).map((s) => (
                <span key={s}>{s}</span>
              ))}
            </p>
            {data.notes && <p className="max-w-[72ch] whitespace-pre-line text-foreground">{data.notes}</p>}
          </section>

          <Tabs variant="secondary" align="start" {...reveal(2)} selectedKey={tab} onSelectionChange={(key) => setView({ tab: key as Tab, item: null })}>
            <TabListContainer className="print:hidden">
              <Tabs.List aria-label="Sections du passage">
                {Object.entries(TABS).map(([key, title]) => (
                  <Tabs.Tab key={key} id={key}>
                    {title}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </TabListContainer>
            <Tabs.Panel id="indicators" className="max-w-4xl pt-4">
              {data.indicators.length > 0 ? (
                <IndicatorTable runs={[data]} />
              ) : (
                <p className="type-body text-muted">Les indicateurs apparaissent à la fin du passage.</p>
              )}
            </Tabs.Panel>
            <Tabs.Panel id="details" className="pt-4">
              {data.report ? (
                <RunItems run={data} item={item} onItem={(next) => setView({ item: next })} />
              ) : (
                <p className="type-body text-muted">Le détail apparaît à la fin du passage.</p>
              )}
            </Tabs.Panel>
          </Tabs>

          <RunEditPanel
            run={data}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              run.reload();
            }}
          />
          <ConfirmDialog
            isOpen={cancelling}
            onOpenChange={setCancelling}
            status="warning"
            title="Annuler le passage ?"
            description="Le passage s’arrête après l’élément en cours. Les résultats déjà obtenus sont gardés."
            confirmLabel="Annuler le passage"
            cancelLabel="Continuer"
            onConfirm={() => {
              setCancelling(false);
              void cancel();
            }}
          />
        </>
      )}
    </Screen>
  );
}
