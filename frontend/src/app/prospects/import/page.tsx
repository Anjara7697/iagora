"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft, Check as CheckIcon, Eye, FileSpreadsheet, Upload } from "lucide-react";
import { useCurrentUser } from "@/components/AppShell";
import { CampaignSourcePicker } from "@/components/CampaignSourcePicker";
import { FirstContacts } from "@/components/campaign/FirstContacts";
import { Btn, FileInput, LinkButton, Tag } from "@/components/ds/controls";
import { PageHeader, Screen, cx } from "@/components/ds/layout";
import { ActionsBar, Feedback, InfoRow, SettingRow as Field, SettingsCard as Section, Stats, Toggle } from "@/components/ds/settings";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, ImportReport } from "@/lib/types";

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
  consent: "Consentement (oui / non)",
};
const STEPS = ["Fichier", "Destination", "Aperçu", "Import"];

/** Campagne d'origine (`?campaign=` depuis sa fiche) : pour le lien de retour seulement. */
function idParam(value: string | null): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function ImportPage() {
  return (
    <Suspense>
      <Import />
    </Suspense>
  );
}

function Import() {
  const user = useCurrentUser();
  const params = useSearchParams();
  const fromCampaign = idParam(params.get("campaign"));
  const [file, setFile] = useState<File | null>(null);
  const [dest, setDest] = useState<{
    campaign_id: number | null;
    source_id: number | null;
  }>({ campaign_id: null, source_id: null }); // pré-rempli par `CampaignSourcePicker` (lien d'une campagne)
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Après l'import dans une campagne : ses premiers contacts se préparent ici, sans changer d'écran.
  const imported = report && !report.dry_run ? dest.campaign_id : null;
  const campaign = useApi<Campaign>(imported ? `/campaigns/${imported}` : null);
  const back = fromCampaign
    ? { href: `/campaigns/${fromCampaign}?tab=prospects`, text: "Retour à la campagne" }
    : { href: "/prospects", text: "Retour aux prospects" };

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
    if (dest.campaign_id && !dest.source_id) {
      setError("Choisissez une source pour cette campagne avant l’aperçu ou l’import.");
      return;
    }
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
          <LinkButton variant="ghost" href={back.href}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {back.text}
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
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
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
          note="Colonnes reconnues par leur intitulé : prénom, nom, email, téléphone, programme, ville, entreprise, consentement (oui / non)… Séparateur ; ou , — UTF-8 ou Windows."
        >
          <FileInput
            accept=".csv,text/csv"
            file={file}
            onChange={(f) => {
              setFile(f ?? null);
              setReport(null);
            }}
          />
        </Field>
        {file && (
          <p className="flex items-center gap-2 text-[13px] text-foreground">
            <FileSpreadsheet className="size-4 text-success" aria-hidden="true" />
            <span className="font-medium">{file.name}</span>
            <span className="text-xs text-muted">{Math.max(1, Math.round(file.size / 1024))} Ko</span>
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
          note={
            report?.consent_by_column
              ? "Le fichier a une colonne « consentement » : elle décide ligne par ligne, cette case n’est pas utilisée."
              : "Par exemple les inscrits d’un événement qui ont accepté d’être recontactés. Sinon, le consentement reste à recueillir : l’agent ne leur écrit pas en premier."
          }
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
              { value: report.consented, caption: "avec consentement" },
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
          {!report.dry_run && campaign.data && <FirstContacts campaign={campaign.data} showImport={false} />}
          {!report.dry_run && (
            <ActionsBar>
              <LinkButton variant={imported ? "outline" : "primary"} href={imported ? `/campaigns/${imported}?tab=prospects` : "/prospects"}>
                {imported ? "Voir la campagne" : "Voir les prospects"}
              </LinkButton>
            </ActionsBar>
          )}
        </Section>
      )}
    </Screen>
  );
}
