"use client";

import { Pencil, Users } from "lucide-react";
import { useState } from "react";
import MembershipActions from "@/components/MembershipActions";
import { Drawer } from "@/components/Drawer";
import { Btn, ErrorText, Field, Notice, SelectBox, Tag, TextLink } from "@/components/ds/controls";
import { Collapse } from "@/components/ds/collapse";
import { EmptyPanel, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { STAGES, formatDate, label } from "@/lib/labels";
import type { Campaign, History, Page, Prospect } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Advisor = { id: number; username: string };

/** Onglet « Parcours » : un bloc par rattachement (campagne et source) ; modifier ou attribuer passe par un panneau. */
export default function ProspectJourney({
  prospect: p,
  canWrite,
  revision,
  attributing,
  onAttributingChange,
  onSaved,
}: {
  prospect: Prospect;
  canWrite: boolean;
  revision: number;
  attributing: boolean;
  onAttributingChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const advisors = useApi<Page<Advisor>>("/advisors?limit=50&offset=0");
  const [editing, setEditing] = useState<number | null>(null);
  const edited = p.campaigns.find((m) => m.id === editing);
  const advisorName = (id: number | null) =>
    advisors.data?.items.find((a) => a.id === id)?.username ?? (id ? `Conseiller #${id}` : "Non affecté");

  return (
    <div className="flex flex-col gap-4">
      {p.campaigns.length === 0 ? (
        <EmptyPanel
          icon={Users}
          title="À attribuer"
          description="Choisissez une campagne et une source pour démarrer le traitement automatique."
          action={
            canWrite && (
              <Btn variant="primary" onClick={() => onAttributingChange(true)}>
                Attribuer une campagne
              </Btn>
            )
          }
        />
      ) : (
        <p className={cx("text-[13px] text-muted", reveal(1).className)} style={reveal(1).style}>
          {p.current_membership_id && "Contexte de l’agent : rattachement le plus récemment actif. "}
          Les scores de chaque source restent distincts ; ils servent à prioriser le suivi.
        </p>
      )}
      {p.campaigns.map((m, index) => (
        <section
          key={m.id}
          aria-label={m.campaign_name ?? `Parcours ${index + 1}`}
          className={cx("flex flex-col gap-2.5 rounded-lg border border-separator bg-surface p-4", reveal(index + 2).className)}
          style={reveal(index + 2).style}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h3 className="text-sm font-semibold text-foreground">
                {m.campaign_id ? (
                  <TextLink href={`/campaigns/${m.campaign_id}`}>{m.campaign_name ?? `Campagne ${m.campaign_id}`}</TextLink>
                ) : (
                  `Parcours ${index + 1}`
                )}
              </h3>
              {m.source_name && <p className="text-xs text-muted">Source : {m.source_name}</p>}
            </div>
            {canWrite && (
              <Btn size="sm" variant="outline" data-membership={m.id} onClick={() => setEditing(m.id)}>
                <Pencil className="size-4" aria-hidden="true" />
                Modifier l’affectation ou l’étape
              </Btn>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {m.id === p.current_membership_id && <Tag tone="agent">Contexte de l’agent</Tag>}
            <StageBadge stage={m.conversion_stage} />
            <ScoreBadge total={m.total_score} level={m.interest_status} />
          </div>
          <p className="text-xs text-muted tabular-nums">
            Intérêt {m.interest_score} · Adéquation {m.fit_score}
          </p>
          <p className="text-[13px] text-foreground">
            Conseiller responsable : <strong className="font-semibold">{advisorName(m.assigned_advisor_id)}</strong>
          </p>
          <MembershipHistory key={`${m.id}:${revision}`} id={m.id} index={index + 1} />
        </section>
      ))}

      <Drawer
        open={!!edited}
        onClose={() => setEditing(null)}
        title={edited?.campaign_name ?? "Parcours"}
        eyebrow="Modification"
        icon={<Users aria-hidden="true" />}
      >
        {edited && (
          <MembershipActions
            key={`${edited.id}:${edited.assigned_advisor_id}:${edited.assignment_is_override}:${edited.conversion_stage}`}
            membership={edited}
            onDone={onSaved}
          />
        )}
      </Drawer>
      <Drawer
        open={attributing}
        onClose={() => onAttributingChange(false)}
        title="Attribuer une campagne"
        eyebrow="Prospect"
        icon={<Users aria-hidden="true" />}
      >
        <CampaignAttribution
          id={p.id}
          onDone={() => {
            onAttributingChange(false);
            onSaved("Campagne attribuée : le suivi démarre.");
          }}
        />
      </Drawer>
    </div>
  );
}

function MembershipHistory({ id, index }: { id: number; index: number }) {
  const history = useApi<History>(`/campaign-prospects/${id}/history`);
  return (
    <>
      {history.data && (
        <Collapse title={`Historique du parcours ${index}`} triggerClassName="w-fit py-1">
          <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-separator pl-4 text-[13px] text-foreground">
            {history.data.stage_events.map((e) => (
              <li key={`s${e.id}`}>
                <span className="text-xs text-muted">{formatDate(e.created_at)}</span> — étape :{" "}
                {label(STAGES, e.from_stage)} → <b className="font-semibold">{label(STAGES, e.to_stage)}</b>{" "}
                {e.reason ? `(${e.reason})` : ""}
              </li>
            ))}
            {history.data.score_events.map((e) => (
              <li key={`p${e.id}`}>
                <span className="text-xs text-muted">{formatDate(e.created_at)}</span> — {e.score_type}{" "}
                {e.points >= 0 ? "+" : ""}
                {e.points} → {e.new_value} ({e.reason})
              </li>
            ))}
          </ul>
        </Collapse>
      )}
      <Loading loading={history.loading} error={history.error} onRetry={history.reload} />
    </>
  );
}

function CampaignAttribution({ id, onDone }: { id: number; onDone: () => void }) {
  const [offset, setOffset] = useState(0);
  const campaigns = useApi<Page<Campaign>>(`/campaigns?status=active&limit=50&offset=${offset}`);
  const [campaign, setCampaign] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = campaigns.data?.items.find((c) => c.id === Number(campaign));
  const page = (next: number) => {
    setOffset(next);
    setCampaign("");
    setSource("");
  };
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Attribution commerciale"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/prospects/${id}/campaigns`, {
            method: "POST",
            body: { campaign_id: Number(campaign), source_id: Number(source) },
          });
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Attribution impossible");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Loading loading={campaigns.loading} error={campaigns.error} onRetry={campaigns.reload} />
      {campaigns.data && campaigns.data.total > 50 && (
        <div className="flex items-center justify-between gap-2">
          <Btn size="sm" variant="ghost" disabled={offset === 0 || busy} onClick={() => page(offset - 50)}>
            Campagnes précédentes
          </Btn>
          <span className="text-xs text-muted tabular-nums">
            {offset + 1}–{Math.min(offset + 50, campaigns.data.total)} / {campaigns.data.total}
          </span>
          <Btn
            size="sm"
            variant="ghost"
            disabled={offset + 50 >= campaigns.data.total || busy}
            onClick={() => page(offset + 50)}
          >
            Campagnes suivantes
          </Btn>
        </div>
      )}
      <Field label="Campagne d’attribution">
        <SelectBox
          value={campaign}
          disabled={busy || campaigns.loading}
          onChange={(e) => {
            setCampaign(e.target.value);
            setSource("");
          }}
        >
          <option value="">Choisir une campagne active</option>
          {campaigns.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectBox>
      </Field>
      <Field label="Source d’attribution">
        <SelectBox value={source} disabled={busy || !selected} onChange={(e) => setSource(e.target.value)}>
          <option value="">Choisir une source</option>
          {selected?.sources?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectBox>
      </Field>
      {selected?.sources?.length === 0 && (
        <Notice tone="info">
          Aucune source pour cette campagne. Un administrateur doit en ajouter une depuis la fiche campagne.
        </Notice>
      )}
      {campaigns.data?.total === 0 && (
        <Notice tone="info">Aucune campagne active. Un administrateur doit en créer ou en activer une.</Notice>
      )}
      {error && <ErrorText>Attribution impossible : {error}</ErrorText>}
      <div>
        <Btn type="submit" variant="primary" disabled={busy || !campaign || !source}>
          Attribuer et démarrer le suivi
        </Btn>
      </div>
    </form>
  );
}
