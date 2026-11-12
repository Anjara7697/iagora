"use client";

/** Détail d'un élément à traiter : demande, éléments pour décider et panneau de décision adapté au type. */

import { Alert } from "@heroui/react";
import { AlertTriangle, BookOpen, ExternalLink, ShieldAlert, Sparkles } from "lucide-react";
import { LinkButton, Notice, Tag, TextLink } from "@/components/ds/controls";
import { Eyebrow } from "@/components/ds/layout";
import { Collapse } from "@/components/ds/collapse";
import { reveal } from "@/components/ds/motion";
import { DemoBadge, ScoreBadge, StageBadge } from "@/components/ui";
import { qs } from "@/lib/api";
import { CHANNELS, HANDOFF_REASONS, PRIORITIES, RISKS, formatDate, label, EXECUTION } from "@/lib/labels";
import { Box } from "@/components/ds/card";
import { KindFilter, revealed, PanelProps, TASK_LABELS, itemName, KIND_TONE, PRIORITY_TONE, RISK_TONE, Confidence, DetailHead } from "@/components/todo/shared";
import { DraftPanel } from "@/components/todo/DraftPanel";
import { ApplicationReview, EnrollmentReview, OptOutReview } from "@/components/todo/ReviewPanels";

export function TodoDetail({
  kind,
  autoFocus,
  ...panel
}: PanelProps & { kind: KindFilter; autoFocus: boolean }) {
  const { item } = panel;
  const name = itemName(item);
  const rec = item.recommendation;
  return (
    <section className="mx-auto flex w-full max-w-[980px] min-w-0 flex-1 flex-col gap-4" aria-label={`À traiter : ${name}`}>
      <DetailHead
        name={name}
        autoFocus={autoFocus}
        incident={item.kind === "incident"}
        chips={
          <>
            <Tag tone={KIND_TONE[item.kind]}>{TASK_LABELS[item.kind]}</Tag>
            <Tag tone={PRIORITY_TONE[item.priority] ?? "neutral"}>
              Priorité {label(PRIORITIES, item.priority).toLowerCase()}
            </Tag>
            {!rec && item.prospect?.stage && <StageBadge stage={item.prospect.stage} />}
            {!rec && item.prospect?.total_score != null && (
              <ScoreBadge total={item.prospect.total_score} level={item.prospect.level} />
            )}
            <DemoBadge email={item.prospect?.email} />
          </>
        }
        action={
          item.prospect && (
            <LinkButton
              variant="outline"
              size="sm"
              href={`/prospects/${item.prospect.id}${qs({ task: item.id, kind })}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ouvrir la fiche prospect dans un nouvel onglet"
            >
              Ouvrir la fiche
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </LinkButton>
          )
        }
      />

      <Box as="div" {...revealed(1, "gap-2 p-5")}>
        <span className="sr-only">La demande à examiner</span>
        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
        {item.detail && (
          <blockquote className="rounded-lg border-l-2 border-border bg-surface-secondary px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
            « {item.detail} »
          </blockquote>
        )}
        <span className="text-xs text-muted">
          {label(CHANNELS, item.channel)} · {formatDate(item.created_at)}
        </span>
      </Box>

      <div className="flex flex-col gap-4">
        {rec && (
          <Box
            as="section"
            aria-label="Éléments pour décider"
            {...revealed(
              2,
              "gap-0 overflow-hidden p-0 shadow-[var(--surface-shadow),inset_0_0_0_1px_color-mix(in_oklab,var(--agent)_22%,transparent)]",
            )}
          >
            <div className="flex flex-col gap-3 bg-agent-soft px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground" aria-hidden="true">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="text-xs font-medium text-agent-soft-foreground">Prochaine action recommandée</span>
              </div>
              <h3 className="text-base font-semibold text-foreground">{rec.action}</h3>
              {(() => {
                // Recommandation et fiche de transfert se recoupent souvent : on
                // n'affiche qu'une fois le texte le plus complet.
                const reason = rec.reason ?? "";
                const summary = item.handoff?.summary ?? "";
                const merged = summary.includes(reason) ? summary : reason;
                const extra =
                  summary && !summary.includes(reason) && !reason.includes(summary);
                return (
                  <>
                    {merged && <p className="text-sm text-foreground/85">{merged}</p>}
                    {extra && item.handoff && (
                      <p className="text-sm text-foreground/85">
                        <span className="text-muted">
                          {label(HANDOFF_REASONS, item.handoff.reason)} :
                        </span>{" "}
                        {summary}
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={RISK_TONE[rec.risk] ?? "neutral"} icon={<ShieldAlert className="size-3" aria-hidden="true" />}>
                  Risque : {label(RISKS, rec.risk).toLowerCase()}
                </Tag>
                {rec.sources.length === 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    Aucune source de la base de connaissances.
                  </span>
                )}
              </div>
            </div>
            <Collapse
  title="Sources, confiance et contexte"
  triggerClassName="w-full px-5 py-3 hover:bg-surface-secondary focus-visible:ring-inset"
>
              <div className="grid grid-cols-1 gap-5 border-t border-separator px-5 py-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Eyebrow>Sources utilisées</Eyebrow>
                  {rec.sources.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {rec.sources.map((s) => (
                        <li key={s} className="flex items-start gap-2 text-sm text-foreground">
                          <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Aucune source disponible.</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Eyebrow>Confiance de l&apos;agent</Eyebrow>
                  <Confidence value={rec.confidence} />
                  {item.draft && (
                    <>
                      <Eyebrow className="pt-2">Exécution</Eyebrow>
                      <div>
                        <Tag tone="warning">{label(EXECUTION, "pending")}</Tag>
                      </div>
                    </>
                  )}
                </div>
                {item.prospect && (
                  <div className="flex flex-col gap-2">
                    <Eyebrow>Contexte commercial</Eyebrow>
                    <div className="flex flex-wrap gap-1.5">
                      {item.prospect.stage && <StageBadge stage={item.prospect.stage} />}
                      {item.prospect.total_score != null && (
                        <ScoreBadge total={item.prospect.total_score} level={item.prospect.level} />
                      )}
                    </div>
                  </div>
                )}
              </div>
</Collapse>
          </Box>
        )}

        {item.draft && (
          <div {...reveal(3)}>
            <DraftPanel key={item.id} {...panel} />
          </div>
        )}
      </div>

      {item.kind === "application" && (
        <div {...reveal(3)}>
          <ApplicationReview {...panel} />
        </div>
      )}

      {item.kind === "opt_out_check" && (
        <div {...reveal(3)}>
          <OptOutReview {...panel} />
        </div>
      )}

      {item.kind === "enrollment" && (
        <div {...reveal(3)}>
          <EnrollmentReview {...panel} />
        </div>
      )}

      {item.handoff && rec && (
        <p {...reveal(4)}>
          <TextLink href={`/conversations?id=${item.conversation_id}`}>
            Répondre dans la conversation →
          </TextLink>
        </p>
      )}

      {item.handoff && !rec && (
        <Notice tone="warning" {...reveal(3)}>
          <Alert.Title>Fiche de transfert — {label(HANDOFF_REASONS, item.handoff.reason)}</Alert.Title>
          <Alert.Description className="flex flex-col items-start gap-2">
            <span>{item.handoff.summary}</span>
            <TextLink href={`/conversations?id=${item.conversation_id}`}>Répondre dans la conversation →</TextLink>
          </Alert.Description>
        </Notice>
      )}
    </section>
  );
}
