"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
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
  return (
    <section
      className="ui-card membership-actions"
      aria-label="Responsable de campagne"
    >
      <h2>Responsable de campagne</h2>
      <p>
        <strong>
          {c.responsible_advisor_name ??
            (c.responsible_advisor_id
              ? `Conseiller #${c.responsible_advisor_id}`
              : "Aucun responsable")}
        </strong>
      </p>
      <p>
        Les nouveaux prospects suivent le responsable de la campagne. Une
        exception individuelle reste possible depuis leur fiche.
      </p>
      {c.responsible_advisor_active === false && (
        <p className="warnbox">
          Ce responsable est indisponible. Choisissez un compte actif : les
          nouveaux prospects sans exception restent non affectés.
        </p>
      )}
      {canEdit && (
        <form
          aria-label="Affectation de la campagne"
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
          <label>
            Conseiller responsable de la campagne
            <select
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
            </select>
          </label>
          {advisors.data && advisors.data.total > 50 && (
            <div className="row">
              <button
                type="button"
                disabled={busy || advisors.loading || offset === 0}
                onClick={() => setOffset(offset - 50)}
              >
                Conseillers précédents
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 50, advisors.data.total)} /{" "}
                {advisors.data.total}
              </span>
              <button
                type="button"
                disabled={
                  busy || advisors.loading || offset + 50 >= advisors.data.total
                }
                onClick={() => setOffset(offset + 50)}
              >
                Conseillers suivants
              </button>
            </div>
          )}
          <label>
            Prospects déjà présents
            <select
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
            </select>
          </label>
          {policy === "transfer_inherited" && (
            <p>
              Les exceptions individuelles sont conservées. Les autres prospects
              suivront le nouveau responsable
              {advisor ? "." : " et deviendront non affectés."}
            </p>
          )}
          {policy === "keep" && (
            <p>
              Les affectations actuelles deviennent des exceptions, y compris
              les prospects sans conseiller. Seuls les nouveaux prospects sans
              exception suivront le nouveau responsable.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            disabled={
              busy ||
              advisors.loading ||
              !!advisors.error ||
              !policy ||
              advisor === String(c.responsible_advisor_id ?? "")
            }
          >
            Enregistrer le responsable
          </button>
        </form>
      )}
    </section>
  );
}
