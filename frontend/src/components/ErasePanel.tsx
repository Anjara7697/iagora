"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ErasureReport, Prospect } from "@/lib/types";
import { Btn, ErrorText, Field, LinkButton, Notice, SelectBox, TextInput } from "./ds/controls";
import { PageHeader, Screen } from "./ds/layout";
import { SettingsCard, Stats } from "./ds/settings";

/** Droit à l'effacement (RGPD, art. 17) : administrateur seulement, irréversible. Contenu du panneau latéral
 *  ouvert depuis le menu « ⋯ » de la fiche : motif, puis saisie de l'adresse (ou du numéro) pour confirmer. */
export function EraseForm({
  prospect,
  onErased,
  onCancel,
}: {
  prospect: Prospect;
  onErased: (report: ErasureReport) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<"request" | "other">("request");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = prospect.email ?? String(prospect.id);

  async function erase() {
    setBusy(true);
    setError(null);
    try {
      onErased(
        await api<ErasureReport>(`/prospects/${prospect.id}/erase`, {
          method: "POST",
          body: { reason, confirm },
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Effacement impossible");
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Effacement des données personnelles"
      onSubmit={(e) => {
        e.preventDefault();
        void erase();
      }}
    >
      <Notice tone="warning">
        Efface définitivement ce prospect : fiche, échanges, décisions de l’agent, rendez-vous et relances. Cette
        action est irréversible.
      </Notice>
      <Field
        label="Motif"
        hint="Une demande d’effacement garde une empreinte (illisible) de l’adresse pour ne plus jamais recontacter la personne."
      >
        <SelectBox
          value={reason}
          onChange={(e) => setReason(e.target.value as "request" | "other")}
        >
          <option value="request">Demande de la personne</option>
          <option value="other">Autre motif</option>
        </SelectBox>
      </Field>
      <Field
        label={prospect.email ? "Adresse email du prospect" : "Numéro de fiche du prospect"}
        hint={`Saisir « ${expected} » pour confirmer.`}
      >
        <TextInput
          value={confirm}
          autoComplete="off"
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      {error && <ErrorText>Effacement refusé : {error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" variant="danger" disabled={busy || !confirm.trim()}>
          <Trash2 className="size-4" aria-hidden="true" />
          Effacer définitivement
        </Btn>
        <Btn disabled={busy} onClick={onCancel}>
          Annuler
        </Btn>
      </div>
    </form>
  );
}

export function ErasureResult({ report }: { report: ErasureReport }) {
  return (
    <Screen className="max-w-[960px]">
      <PageHeader
        title="Prospect effacé"
        subtitle="La fiche n’existe plus dans IAGORA. Il reste deux choses à faire à la main, hors de l’application."
        actions={
          <LinkButton variant="outline" href="/prospects">
            Retour aux prospects
          </LinkButton>
        }
      />
      <SettingsCard region="Résultat de l’effacement" label="Effacé">
        <Stats
          label="Données effacées"
          items={[
            { value: report.conversations, caption: "conversation(s)" },
            { value: report.interactions, caption: "échange(s)" },
            { value: report.appointments, caption: "rendez-vous" },
          ]}
        />
        <p className="text-[13px] text-muted">
          {report.suppressed
            ? "Une empreinte illisible de son adresse est conservée : un import ou un nouveau message ne la fera pas recontacter."
            : "Aucune empreinte n’est conservée : si la personne se manifeste à nouveau, une nouvelle fiche sera créée."}
        </p>
      </SettingsCard>
      <SettingsCard
        region="À supprimer à la main"
        label="À supprimer à la main"
        intro="IAGORA n’efface pas ce qui se trouve hors de l’application."
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
          <li>
            Les emails de cette personne dans la boîte de l’école (dossier
            surveillé et envoyés).
          </li>
          {report.external_events.length === 0 ? (
            <li>Aucun événement d’agenda ni de visio à supprimer.</li>
          ) : (
            report.external_events.map((event, index) => (
              <li key={index}>
                Rendez-vous du {formatDate(event.start_at)}
                {event.advisor ? ` (agenda de ${event.advisor})` : ""} :
                supprimer l’événement
                {event.calendar_event_id
                  ? ` Google ${event.calendar_event_id}`
                  : ""}
                {event.zoom_meeting_id
                  ? `, réunion Zoom ${event.zoom_meeting_id}`
                  : ""}
                .
              </li>
            ))
          )}
        </ul>
      </SettingsCard>
    </Screen>
  );
}
