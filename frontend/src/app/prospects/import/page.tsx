"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/components/AppShell";
import { CampaignSourcePicker } from "@/components/CampaignSourcePicker";
import { Feedback, Field, Section, Stats, Toggle } from "@/components/forms";
import { api, ApiError } from "@/lib/api";
import type { ImportReport } from "@/lib/types";

const FIELDS: Record<string, string> = {
  first_name: "Prénom",
  last_name: "Nom",
  email: "Email",
  phone: "Téléphone",
  target_code: "Programme",
  external_id: "Identifiant externe",
  "profile.city": "Ville",
  "profile.company": "Entreprise",
  "profile.education_level": "Niveau d’études",
};
const STEPS = ["Fichier", "Destination", "Aperçu", "Import"];

export default function ImportPage() {
  const user = useCurrentUser();
  const [file, setFile] = useState<File | null>(null);
  const [dest, setDest] = useState<{
    campaign_id: number | null;
    source_id: number | null;
  }>({ campaign_id: null, source_id: null });
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user?.role === "VIEWER")
    return (
      <p className="card warnbox" role="alert">
        L’import est réservé aux conseillers et administrateurs.
      </p>
    );

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("dry_run", String(dryRun));
    form.append("consent", String(consent));
    if (dest.campaign_id && dest.source_id) {
      form.append("campaign_id", String(dest.campaign_id));
      form.append("source_id", String(dest.source_id));
    }
    try {
      setReport(
        await api<ImportReport>("/prospects/import", {
          method: "POST",
          multipart: form,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const step = !file ? 0 : !report ? 1 : report.dry_run ? 2 : 3;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Prospects · Import</span>
          <h1>Importer des prospects (CSV)</h1>
          <p className="muted">
            Export Excel, liste d’un salon, export LinkedIn… Aucune fiche n’est
            créée avant la dernière étape, et l’agent n’écrit à personne tant
            qu’un conseiller ne l’a pas décidé.
          </p>
        </div>
        <Link href="/prospects">Retour aux prospects</Link>
      </div>

      <div className="settings-stack">
        <ol className="stepper" aria-label="Étapes de l’import">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={i < step ? "done" : ""}
            >
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        <Section region="Fichier à importer" label="Fichier et destination">
          <Field
            label="Fichier CSV (2 Mo, 5000 lignes maximum)"
            note="Colonnes reconnues par leur intitulé : prénom, nom, email, téléphone, programme, ville, entreprise… Séparateur ; ou , — UTF-8 ou Windows."
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </Field>
          <div className="field-row">
            <span className="field-label">Destination</span>
            <div className="field-control">
              <div className="form-row">
                <CampaignSourcePicker
                  value={dest}
                  onChange={(v) => {
                    setDest(v);
                    setReport(null);
                  }}
                />
              </div>
              <p className="field-note">
                Facultatif : les prospects sans campagne restent « à rattacher
                ».
              </p>
            </div>
          </div>
          <Toggle
            checked={consent}
            onChange={(v) => {
              setConsent(v);
              setReport(null);
            }}
            title="Ces personnes ont consenti à être contactées"
            note="Sinon, le consentement reste à recueillir : aucun envoi possible avant."
          />
          <div className="actions-bar">
            <button onClick={() => send(true)} disabled={busy || !file}>
              Aperçu
            </button>
            <button
              className="primary"
              onClick={() => send(false)}
              disabled={busy || !file || !report?.dry_run}
              title={report?.dry_run ? "" : "Faites d’abord un aperçu"}
            >
              Importer
            </button>
            <Feedback error={error} />
          </div>
        </Section>

        {report && (
          <Section
            region={
              report.dry_run ? "Aperçu de l’import" : "Résultat de l’import"
            }
            label={
              report.dry_run
                ? "Aperçu — rien n’est enregistré"
                : "Import terminé"
            }
          >
            <Stats
              items={[
                { value: report.total, caption: "lignes lues" },
                {
                  value: report.created,
                  caption: report.dry_run ? "à créer" : "créés",
                },
                { value: report.existing, caption: "déjà connus" },
                { value: report.invalid.length, caption: "invalides" },
              ]}
            />
            <div>
              {Object.entries(report.columns).map(([col, field]) => (
                <div className="item-row" key={col}>
                  <span className="section-label" style={{ minWidth: 160 }}>
                    {col}
                  </span>
                  <span className={field in FIELDS ? "" : "status-text"}>
                    {FIELDS[field] ?? "ignorée"}
                  </span>
                </div>
              ))}
            </div>
            {report.invalid.length > 0 && (
              <div className="field-row">
                <span className="field-label">Lignes invalides</span>
                <ul
                  className="plain field-control"
                  aria-label="Lignes invalides"
                >
                  {report.invalid.slice(0, 50).map((e) => (
                    <li key={e.row}>
                      Ligne {e.row} : {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!report.dry_run && (
              <div className="actions-bar">
                <Link href="/prospects">Voir les prospects</Link>
              </div>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
