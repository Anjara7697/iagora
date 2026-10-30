"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, ErrorText, Field, NativeSelect, Notice } from "@/components/ds/controls";
import { Eyebrow, initialsOf } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, Page } from "@/lib/types";

export default function CampaignOwnership({
  campaign: c,
  onDone,
}: {
  campaign: Campaign;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const canEdit = user?.role === "ADMIN";
  const [offset, setOffset] = useState(0);
  const advisors = useApi<Page<{ id: number; username: string }>>(
    canEdit ? `/advisors?limit=50&offset=${offset}` : null,
  );
  const [advisor, setAdvisor] = useState(
    String(c.responsible_advisor_id ?? ""),
  );
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current =
    c.responsible_advisor_name ??
    (c.responsible_advisor_id ? `Conseiller #${c.responsible_advisor_id}` : "Aucun responsable");
  return (
    <section
     
      className="card card--default gap-4 p-5"
      aria-label="Responsable de campagne"
    >
      <div className="flex flex-col gap-1">
        <Eyebrow>Affectation</Eyebrow>
        <h2 className="text-base font-semibold text-foreground">Responsable de campagne</h2>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3">
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-foreground"
          aria-hidden="true"
        >
          {c.responsible_advisor_id ? initialsOf(current) : <UserRound className="size-4" />}
        </span>
        <strong className="text-sm font-semibold text-foreground">{current}</strong>
      </div>
      <p className="text-[13px]/[20px] text-muted">
        Les nouveaux prospects suivent le responsable de la campagne. Une
        exception individuelle reste possible depuis leur fiche.
      </p>
      {c.responsible_advisor_active === false && (
        <Notice tone="warning">
          Ce responsable est indisponible. Choisissez un compte actif : les
          nouveaux prospects sans exception restent non affectés.
        </Notice>
      )}
      {canEdit && (
        <form
          aria-label="Affectation de la campagne"
          className="flex flex-col gap-4 border-t border-separator pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api(`/campaigns/${c.id}/responsible`, {
                method: "PUT",
                body: {
                  advisor_id: advisor ? Number(advisor) : null,
                  existing_prospects: policy,
                },
              });
              onDone();
            } catch (err) {
              setError(
                err instanceof ApiError
                  ? err.message
                  : "Affectation impossible",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Loading
            loading={advisors.loading}
            error={advisors.error}
            onRetry={advisors.reload}
          />
          <Field label="Conseiller responsable de la campagne">
            <NativeSelect
              disabled={busy || advisors.loading || !!advisors.error}
              value={advisor}
              onChange={(e) => {
                setAdvisor(e.target.value);
                setPolicy("");
              }}
            >
              <option value="">Aucun responsable</option>
              {advisor &&
                !advisors.data?.items.some((a) => String(a.id) === advisor) && (
                  <option value={advisor}>
                    Conseiller #{advisor} (hors de cette page ou indisponible)
                  </option>
                )}
              {advisors.data?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {advisors.data && advisors.data.total > 50 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Btn
                size="sm"
                disabled={busy || advisors.loading || offset === 0}
                onClick={() => setOffset(offset - 50)}
              >
                Conseillers précédents
              </Btn>
              <span className="text-xs tabular-nums">
                {offset + 1}–{Math.min(offset + 50, advisors.data.total)} /{" "}
                {advisors.data.total}
              </span>
              <Btn
                size="sm"
                disabled={
                  busy || advisors.loading || offset + 50 >= advisors.data.total
                }
                onClick={() => setOffset(offset + 50)}
              >
                Conseillers suivants
              </Btn>
            </div>
          )}
          <Field label="Prospects déjà présents">
            <NativeSelect
              required
              value={policy}
              disabled={busy}
              onChange={(e) => setPolicy(e.target.value)}
            >
              <option value="">
                Choisir le traitement des prospects existants
              </option>
              <option value="transfer_inherited">
                Transférer ceux qui suivent la règle de campagne
              </option>
              <option value="keep">
                Conserver toutes les affectations actuelles
              </option>
            </NativeSelect>
          </Field>
          {policy === "transfer_inherited" && (
            <p className="rounded-xl bg-accent-soft px-4 py-3 text-[13px]/[20px] text-accent-soft-foreground">
              Les exceptions individuelles sont conservées. Les autres prospects
              suivront le nouveau responsable
              {advisor ? "." : " et deviendront non affectés."}
            </p>
          )}
          {policy === "keep" && (
            <p className="rounded-xl bg-accent-soft px-4 py-3 text-[13px]/[20px] text-accent-soft-foreground">
              Les affectations actuelles deviennent des exceptions, y compris
              les prospects sans conseiller. Seuls les nouveaux prospects sans
              exception suivront le nouveau responsable.
            </p>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <Btn
            variant="primary"
            type="submit"
            className="w-fit"
            disabled={
              busy ||
              advisors.loading ||
              !!advisors.error ||
              !policy ||
              advisor === String(c.responsible_advisor_id ?? "")
            }
          >
            Enregistrer le responsable
          </Btn>
        </form>
      )}
    </section>
  );
}
