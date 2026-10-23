"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/components/AppShell";
import { CampaignSourcePicker } from "@/components/CampaignSourcePicker";
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

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Prospects · Import</span>
          <h1>Importer des prospects (CSV)</h1>
          <p className="muted">
            Export Excel, liste d’un salon, export LinkedIn… Colonnes reconnues
            par leur intitulé (prénom, nom, email, téléphone, ville,
            entreprise…). Les doublons sont reconnus ; l’agent n’écrit à
            personne tant qu’un conseiller ne l’a pas décidé.
          </p>
        </div>
      </div>
      <section className="card" aria-label="Fichier à importer">
        <div className="form-row">
          <label>
            Fichier CSV (2 Mo, 5000 lignes maximum)
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </label>
          <CampaignSourcePicker value={dest} onChange={setDest} />
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Ces personnes ont consenti à être contactées (sinon, le consentement
          reste à recueillir)
        </label>
        <div className="row">
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
          <Link href="/prospects">Retour aux prospects</Link>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      {report && (
        <section
          className="card"
          aria-label={
            report.dry_run ? "Aperçu de l’import" : "Résultat de l’import"
          }
        >
          <h2>
            {report.dry_run
              ? "Aperçu (rien n’est enregistré)"
              : "Import terminé"}
          </h2>
          <p>
            {report.total} ligne(s) : <strong>{report.created}</strong>{" "}
            {report.dry_run ? "à créer" : "créé(s)"},{" "}
            <strong>{report.existing}</strong> déjà connu(s),{" "}
            <strong>{report.invalid.length}</strong> invalide(s).
          </p>
          <h3>Colonnes</h3>
          <ul className="plain">
            {Object.entries(report.columns).map(([col, field]) => (
              <li key={col}>
                <code>{col}</code> → {FIELDS[field] ?? "ignorée"}
              </li>
            ))}
          </ul>
          {report.invalid.length > 0 && (
            <>
              <h3>Lignes invalides</h3>
              <ul className="plain" aria-label="Lignes invalides">
                {report.invalid.slice(0, 50).map((e) => (
                  <li key={e.row}>
                    Ligne {e.row} : {e.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
