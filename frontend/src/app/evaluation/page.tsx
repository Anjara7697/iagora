"use client";

import { Tabs, toast } from "@heroui/react";
import { Play, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, Notice, TabListContainer } from "@/components/ds/controls";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { ErrorState, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ds/ui";
import CompareView from "@/components/evaluation/CompareView";
import EvolutionView from "@/components/evaluation/EvolutionView";
import ImportPanel from "@/components/evaluation/ImportPanel";
import LaunchForm from "@/components/evaluation/LaunchForm";
import RunsTable from "@/components/evaluation/RunsTable";
import { SIMULATOR_ENABLED, api, failure } from "@/lib/api";
import {
  EVALUATION_TABS,
  canUseEvaluation,
  evaluationHref,
  readEvaluationView,
  runHref,
  type Catalog,
  type EvalRun,
  type EvaluationTab,
  type EvaluationView,
} from "@/lib/evaluation";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";

export default function EvaluationPage() {
  return (
    <Suspense>
      <Evaluation />
    </Suspense>
  );
}

/** Pendant un passage, la page relit l'historique à ce rythme (avancement, fin). */
const POLL_MS = 2000;

function Evaluation() {
  const user = useCurrentUser();
  const allowed = canUseEvaluation(user?.role);
  const view = readEvaluationView(useSearchParams());
  const navigate = (patch: Partial<EvaluationView>) =>
    replaceUrl(evaluationHref({ ...readEvaluationView(new URLSearchParams(window.location.search)), ...patch }));
  const runs = useApi<EvalRun[]>(allowed ? "/evaluations" : null, { keepPrevious: true });
  const catalog = useApi<Catalog>(allowed ? "/evaluations/catalog" : null, { keepPrevious: true });
  const [importing, setImporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const running = runs.data?.find((r) => r.status === "running");
  const reloadRuns = runs.reload;
  const reloadCatalog = catalog.reload;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(reloadRuns, POLL_MS);
    return () => {
      window.clearInterval(timer);
      reloadCatalog(); // fin du passage : le lancement redevient possible
    };
  }, [running, reloadRuns, reloadCatalog]);

  if (!allowed) {
    return (
      <Screen>
        <PageHeader title="Évaluation" />
        <Notice tone="warning">
          {SIMULATOR_ENABLED
            ? "L’évaluation de l’agent est réservée aux administrateurs."
            : "Les outils de test sont désactivés sur cet environnement."}
        </Notice>
      </Screen>
    );
  }

  const cancel = async (id: string) => {
    try {
      await api(`/evaluations/${id}/cancel`, { method: "POST" });
      toast.success("Passage annulé", { description: "Les résultats déjà obtenus sont gardés." });
    } catch (err) {
      toast.danger(failure("Annulation impossible", err));
    } finally {
      runs.reload();
      catalog.reload();
    }
  };

  return (
    <Screen scroll>
      <PageHeader
        {...reveal(0)}
        title="Évaluation"
        subtitle="Mesurer l’agent avant et après chaque changement : lancer une évaluation, suivre l’historique, comparer deux passages."
        actions={
          <>
            <Btn variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Importer un rapport
            </Btn>
            {/* Une seule action principale par écran : dans l'onglet Lancer, c'est le bouton du formulaire. */}
            {view.tab !== "launch" && (
              <Btn variant="primary" onClick={() => navigate({ tab: "launch" })}>
                <Play className="size-4" aria-hidden="true" />
                Lancer une évaluation
              </Btn>
            )}
          </>
        }
      />

      {running && (
        <Notice tone="info" {...reveal(1)}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="min-w-0 flex-1">
              {`Passage en cours : ${running.label} (${running.progress ? `${running.progress.done} sur ${running.progress.total}` : "démarrage"}).`}
            </span>
            <Link href={runHref(running.id)} className="type-body-sm font-medium text-accent underline-offset-2 hover:underline">
              Suivre le passage
            </Link>
            <Btn size="sm" variant="tertiary" onClick={() => setCancelling(true)}>
              Annuler
            </Btn>
          </div>
        </Notice>
      )}

      <Tabs
        variant="secondary"
        align="start"
        {...reveal(2)}
        selectedKey={view.tab}
        onSelectionChange={(key) => navigate({ tab: key as EvaluationTab })}
      >
        <TabListContainer>
          <Tabs.List aria-label="Sections de l’évaluation">
            {Object.entries(EVALUATION_TABS).map(([key, title]) => (
              <Tabs.Tab key={key} id={key}>
                {title}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </TabListContainer>

        <Tabs.Panel id="history" className="pt-4">
          {runs.error ? (
            <ErrorState message={`Impossible de charger les passages : ${runs.error.message}`} onRetry={runs.reload} />
          ) : (
            <RunsTable
              runs={runs.data ?? []}
              isLoading={runs.loading && !runs.data}
              suite={view.suite}
              onSuite={(suite) => navigate({ suite })}
              emptyAction={
                <div className="flex flex-wrap justify-center gap-2">
                  <Btn variant="secondary" onClick={() => setImporting(true)}>
                    Importer un rapport
                  </Btn>
                  <Btn variant="secondary" onClick={() => navigate({ tab: "launch" })}>
                    Lancer une évaluation
                  </Btn>
                </div>
              }
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel id="launch" className="pt-4">
          {catalog.error ? (
            <ErrorState message={`Impossible de charger les réglages : ${catalog.error.message}`} onRetry={catalog.reload} />
          ) : catalog.data ? (
            <LaunchForm
              catalog={catalog.data}
              onLaunched={() => {
                runs.reload();
                catalog.reload();
              }}
            />
          ) : (
            <Skeleton />
          )}
        </Tabs.Panel>

        <Tabs.Panel id="compare" className="pt-4">
          {runs.data ? <CompareView runs={runs.data} view={view} onChange={navigate} /> : <Skeleton />}
        </Tabs.Panel>

        <Tabs.Panel id="evolution" className="pt-4">
          {runs.data ? <EvolutionView runs={runs.data} view={view} onChange={navigate} /> : <Skeleton />}
        </Tabs.Panel>
      </Tabs>

      <ImportPanel
        open={importing}
        onClose={() => setImporting(false)}
        onImported={() => {
          navigate({ tab: "history" });
          runs.reload();
        }}
      />
      {running && (
        <ConfirmDialog
          isOpen={cancelling}
          onOpenChange={setCancelling}
          status="warning"
          title="Annuler le passage en cours ?"
          description="Le passage s’arrête après l’élément en cours. Les résultats déjà obtenus sont gardés et restent comparables."
          confirmLabel="Annuler le passage"
          cancelLabel="Continuer"
          onConfirm={() => {
            setCancelling(false);
            void cancel(running.id);
          }}
        />
      )}
    </Screen>
  );
}
