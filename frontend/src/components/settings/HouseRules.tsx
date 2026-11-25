"use client";

import { toast } from "@heroui/react";
import { FlaskConical, History, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, ErrorText, Field, LinkButton, TextBox, TextInput } from "@/components/ds/controls";
import { EmptyText } from "@/components/ds/layout";
import { ActionsBar, SettingsCard } from "@/components/ds/settings";
import { Loading } from "@/components/ds/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { Analytics, HouseRules } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STYLE_MAX = 2000;
const BANNED_MAX = 30;
const PHRASE_MAX = 80;

const STYLE_PLACEHOLDER = `ex. Phrases courtes, un paragraphe par idée.
Parler de « parcours » plutôt que de « cursus ».
Terminer par « Belle journée » plutôt que par « Cordialement ».`;

const SAFETY = [
  "Vouvoiement",
  "Une question au plus par message",
  "Aucun prix, date ni condition hors sources validées",
  "Pas de rendez-vous proposé par l’agent lui-même",
  "Transparence : l’agent ne se fait jamais passer pour un humain",
];

type Draft = { style: string; banned: string[] };

const same = (a: Draft, b: Draft) =>
  a.style.trim() === b.style.trim() && a.banned.join("\n") === b.banned.join("\n");

/**
 * Consignes maison (D-53) : ton, règles de style et formules de l'école, et expressions que l'agent n'écrit jamais
 * (vérifiées par le code). Enregistrées à part des autres paramètres : chaque enregistrement est une version.
 */
export function HouseRulesSection({ hidden, onDirty }: { hidden: boolean; onDirty: (dirty: boolean) => void }) {
  const current = useApi<HouseRules>("/settings/house-rules");
  const history = useApi<HouseRules[]>("/settings/house-rules/history");
  const reasons = useApi<Analytics>(hidden ? null : "/analytics?days=30");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved: Draft | null = current.data ? { style: current.data.style, banned: current.data.banned } : null;
  useEffect(() => {
    if (current.data) setDraft({ style: current.data.style, banned: current.data.banned });
  }, [current.data]);
  const dirty = !!draft && !!saved && !same(draft, saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const trimmed = phrase.split(/\s+/).filter(Boolean).join(" ");
  const duplicate = !!draft && draft.banned.some((p) => p.toLocaleLowerCase("fr") === trimmed.toLocaleLowerCase("fr"));
  const full = !!draft && draft.banned.length >= BANNED_MAX;
  const phraseError =
    trimmed.length === 1 ? "Deux caractères au moins." : duplicate ? "Cette expression est déjà dans la liste." : undefined;

  function addPhrase() {
    if (!draft || trimmed.length < 2 || duplicate || full) return;
    setDraft({ ...draft, banned: [...draft.banned, trimmed] });
    setPhrase("");
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<HouseRules>("/settings/house-rules", {
        method: "PUT",
        body: { style: draft.style.trim(), banned: draft.banned },
      });
      toast.success(`Consignes maison enregistrées (version ${next.version})`, {
        description: "L’agent les suit dès son prochain message.",
      });
      current.reload();
      history.reload();
    } catch (e) {
      setError(`Enregistrement impossible${e instanceof ApiError ? ` : ${e.message}` : "."}`);
    } finally {
      setBusy(false);
    }
  }

  const versions = (history.data ?? []).filter((v) => v.version !== current.data?.version);
  const rejects = reasons.data?.reject_reasons ?? [];

  return (
    <div hidden={hidden} className="flex flex-col gap-4">
      <SettingsCard
        region="Consignes maison"
        label="Paramètres"
        title="Consignes maison"
        intro="Le ton, les règles de style et les formules de l’école, que l’agent suit dans chaque message qu’il rédige. Elles s’appliquent dès l’enregistrement, sans développeur."
        aside={
          current.data && current.data.version > 0 ? (
            <span className="type-caption text-muted">
              Version {current.data.version}
              {current.data.updated_at ? `, modifiée le ${formatDate(current.data.updated_at)}` : ""}
            </span>
          ) : undefined
        }
      >
        <Loading loading={current.loading} error={current.error} onRetry={current.reload} />
        {draft && (
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-3 rounded-lg bg-surface-secondary px-4 py-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="type-body-sm font-medium text-foreground">
                  Les règles de sécurité de l’agent passent toujours avant ces consignes
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-muted">
                  {SAFETY.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="type-caption text-muted">
                  Une consigne qui les contredit est ignorée. Un fait écrit ici (prix, date) n’est jamais une source : il se
                  met dans la base de connaissances ou la fiche de la campagne.
                </p>
              </div>
            </div>

            <Field
              label="Ton et règles de style"
              hint={`Une consigne par ligne : ton, longueur, vocabulaire, formules à privilégier. ${draft.style.length} / ${STYLE_MAX} caractères.`}
            >
              <TextBox
                rows={7}
                value={draft.style}
                maxLength={STYLE_MAX}
                placeholder={STYLE_PLACEHOLDER}
                onChange={(e) => setDraft({ ...draft, style: e.target.value })}
              />
            </Field>

            <div className="flex flex-col gap-3">
              <Field
                label="Expressions interdites"
                hint={`Vérifiées dans chaque message, sans tenir compte des majuscules ni des accents : un message qui en contient une n’est jamais envoyé, il revient au conseiller. ${draft.banned.length} / ${BANNED_MAX}.`}
                error={phraseError}
              >
                <TextInput
                  value={phrase}
                  maxLength={PHRASE_MAX}
                  placeholder="ex. n’hésitez pas"
                  disabled={full}
                  onChange={(e) => setPhrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPhrase();
                    }
                  }}
                />
              </Field>
              <Btn
                size="sm"
                variant="secondary"
                className="w-fit"
                disabled={trimmed.length < 2 || duplicate || full}
                onClick={addPhrase}
              >
                Ajouter l’expression
              </Btn>
              {draft.banned.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Liste des expressions interdites">
                  {draft.banned.map((p) => (
                    <li
                      key={p}
                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-danger-soft py-0.5 pr-1 pl-3 type-body-sm text-danger-soft-foreground"
                    >
                      <span className="min-w-0 break-words">{p}</span>
                      <button
                        type="button"
                        aria-label={`Retirer « ${p} »`}
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none hover:bg-danger/15 focus-visible:ring-2 focus-visible:ring-focus"
                        onClick={() => setDraft({ ...draft, banned: draft.banned.filter((b) => b !== p) })}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-separator pt-4">
              <ActionsBar>
                <Btn variant="primary" onClick={() => void save()} disabled={busy || !dirty}>
                  Enregistrer les consignes
                </Btn>
                {dirty && saved && (
                  <Btn variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>
                    Annuler les modifications
                  </Btn>
                )}
                {dirty ? (
                  <span className="inline-flex items-center gap-1.5 type-caption font-medium text-warning-soft-foreground">
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                    Modifications non enregistrées
                  </span>
                ) : (
                  <LinkButton size="sm" variant="outline" href="/simulator">
                    <FlaskConical className="size-4" aria-hidden="true" />
                    Essayer dans le simulateur →
                  </LinkButton>
                )}
              </ActionsBar>
              {error && <ErrorText>{error}</ErrorText>}
            </div>
          </div>
        )}
      </SettingsCard>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          region="Motifs de refus"
          title="Motifs de refus des 30 derniers jours"
          intro="Ce que les conseillers reprochent aux brouillons refusés. Une remarque qui revient peut devenir une consigne."
        >
          <Loading loading={reasons.loading} error={reasons.error} onRetry={reasons.reload} />
          {reasons.data && rejects.length === 0 && <EmptyText>Aucun brouillon refusé avec un motif sur la période.</EmptyText>}
          {rejects.length > 0 && (
            <ul className="flex flex-col divide-y divide-separator">
              {rejects.map((r) => (
                <li key={r.reason} className="flex items-baseline gap-3 py-2">
                  <span className="min-w-0 flex-1 type-body-sm break-words text-foreground">{r.reason}</span>
                  <span className="type-caption text-muted tabular-nums">{r.count} fois</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        <SettingsCard
          region="Versions précédentes"
          title="Versions précédentes"
          intro="Chaque enregistrement est gardé : la trace de chaque message indique la version suivie."
        >
          <Loading loading={history.loading} error={history.error} onRetry={history.reload} />
          {history.data && versions.length === 0 && <EmptyText>Aucune version précédente.</EmptyText>}
          {versions.length > 0 && draft && (
            <ul className="flex flex-col divide-y divide-separator">
              {versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center gap-3 py-2">
                  <History className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 type-body-sm text-foreground">
                    Version {v.version}
                    {v.updated_at ? ` · ${formatDate(v.updated_at)}` : ""}
                    <span className="block type-caption text-muted">
                      {v.style.trim() ? `${v.style.trim().split("\n").length} ligne(s) de style` : "Sans consigne de style"}
                      {` · ${v.banned.length} expression(s) interdite(s)`}
                    </span>
                  </span>
                  <Btn size="sm" variant="ghost" onClick={() => setDraft({ style: v.style, banned: v.banned })}>
                    Reprendre
                  </Btn>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}
