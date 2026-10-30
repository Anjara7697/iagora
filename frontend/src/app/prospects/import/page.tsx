"use client";

import { useState } from "react";
import { ArrowLeft, Check as CheckIcon, Eye, FileSpreadsheet, Upload } from "lucide-react";
import { useCurrentUser } from "@/components/AppShell";
import { CampaignSourcePicker } from "@/components/CampaignSourcePicker";
import { Btn, LinkButton, Tag } from "@/components/ds/controls";
import { PageHeader, Screen, cx } from "@/components/ds/layout";
import { ActionsBar, Feedback, InfoRow, SettingRow as Field, SettingsCard as Section, Stats, Toggle } from "@/components/ds/settings";
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
      <Screen>
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          L’import est réservé aux conseillers et administrateurs.
        </p>
      </Screen>
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
    <Screen className="max-w-[1000px]">
      <PageHeader
        eyebrow="Prospects · Import"
        title="Importer des prospects (CSV)"
        subtitle="Export Excel, liste d’un salon, export LinkedIn… Aucune fiche n’est créée avant la dernière étape, et l’agent n’écrit à personne tant qu’un conseiller ne l’a pas décidé."
        actions={
          <LinkButton variant="ghost" href="/prospects">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Retour aux prospects
          </LinkButton>
        }
      />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Étapes de l’import">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={cx(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] font-medium",
                current
                  ? "border-accent/40 bg-accent-soft text-accent-soft-foreground"
                  : done
                    ? "border-separator bg-surface text-foreground"
                    : "border-dashed border-border text-muted",
              )}
            >
              <span
                className={cx(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs",
                  current ? "bg-accent text-accent-foreground" : done ? "bg-success text-success-foreground" : "bg-surface-tertiary",
                )}
                aria-hidden="true"
              >
                {done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              {i + 1}. {label}
            </li>
          );
        })}
      </ol>

      <Section region="Fichier à importer" label="Étapes 1 et 2" title="Fichier et destination">
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
            className="w-full cursor-pointer rounded-xl border border-dashed border-border bg-surface-secondary px-3 py-3 text-[13px] text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-accent-foreground"
          />
        </Field>
        {file && (
          <p className="flex items-center gap-2 text-[13px] text-foreground">
            <FileSpreadsheet className="size-4 text-success" aria-hidden="true" />
            <span className="font-medium">{file.name}</span>
            <span className="font-mono text-xs text-muted">{Math.max(1, Math.round(file.size / 1024))} Ko</span>
          </p>
        )}
        <InfoRow label="Destination" note="Facultatif : les prospects sans campagne restent « à rattacher ».">
          <div className="flex flex-wrap gap-3">
            <CampaignSourcePicker
              value={dest}
              onChange={(v) => {
                setDest(v);
                setReport(null);
              }}
            />
          </div>
        </InfoRow>
        <Toggle
          checked={consent}
          onChange={(v) => {
            setConsent(v);
            setReport(null);
          }}
          title="Ces personnes ont consenti à être contactées"
          note="Sinon, le consentement reste à recueillir : aucun envoi possible avant."
        />
        <ActionsBar className="border-t border-separator pt-4">
          <Btn variant="outline" onClick={() => send(true)} disabled={busy || !file}>
            <Eye className="size-4" aria-hidden="true" />
            Aperçu
          </Btn>
          <Btn
            variant="primary"
            onClick={() => send(false)}
            disabled={busy || !file || !report?.dry_run}
            aria-describedby={report?.dry_run ? undefined : "import-hint"}
          >
            <Upload className="size-4" aria-hidden="true" />
            Importer
          </Btn>
          {!report?.dry_run && (
            <span id="import-hint" className="text-xs text-muted">
              Faites d’abord un aperçu
            </span>
          )}
        </ActionsBar>
        <Feedback error={error} />
      </Section>

      {report && (
        <Section
          region={report.dry_run ? "Aperçu de l’import" : "Résultat de l’import"}
          label={report.dry_run ? "Étape 3" : "Étape 4"}
          title={report.dry_run ? "Aperçu — rien n’est enregistré" : "Import terminé"}
          aside={report.dry_run ? <Tag tone="warning">Simulation</Tag> : <Tag tone="success">Enregistré</Tag>}
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
          <div className="overflow-hidden rounded-xl border border-separator">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-surface-secondary px-4 py-2 text-xs font-medium text-muted">
              <span>Colonne du fichier</span>
              <span>Champ IAGORA</span>
            </div>
            {Object.entries(report.columns).map(([col, field]) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-t border-separator px-4 py-2.5 text-[13px]" key={col}>
                <span className="truncate font-mono text-foreground">{col}</span>
                <span className={field in FIELDS ? "text-foreground" : "text-muted italic"}>{FIELDS[field] ?? "ignorée"}</span>
              </div>
            ))}
          </div>
          {report.invalid.length > 0 && (
            <InfoRow label="Lignes invalides">
              <ul className="flex flex-col gap-1 text-[13px] text-danger" aria-label="Lignes invalides">
                {report.invalid.slice(0, 50).map((e) => (
                  <li key={e.row}>
                    Ligne {e.row} : {e.error}
                  </li>
                ))}
              </ul>
            </InfoRow>
          )}
          {!report.dry_run && (
            <ActionsBar>
              <LinkButton variant="primary" href="/prospects">
                Voir les prospects
              </LinkButton>
            </ActionsBar>
          )}
        </Section>
      )}
    </Screen>
  );
}
