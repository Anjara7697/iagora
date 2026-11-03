"use client";

import { Alert } from "@heroui/react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Btn, LinkButton } from "@/components/ds/controls";
import { reveal } from "@/components/ds/motion";

/** Alerte HeroUI : icône, titre, explication, actions à droite (en dessous sur mobile). */
function KnowledgeAlert({
  status,
  icon,
  title,
  children,
  actions,
  className,
  index,
}: {
  status: "accent" | "warning" | "danger";
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Rang dans la cascade d'apparition (règle des parcours). */
  index: number;
}) {
  const motion = reveal(index);
  return (
    // État durable de la base, pas une urgence : annoncé poliment (`status`) et non comme une alerte.
    <Alert role="status" status={status} className={`flex-wrap ${motion.className} ${className ?? ""}`} style={motion.style}>
      <Alert.Indicator>{icon}</Alert.Indicator>
      <Alert.Content className="min-w-[220px] flex-1">
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </Alert>
  );
}

/**
 * Ce qui demande une action sur la base, du plus bloquant au moins bloquant : service non configuré, documents à
 * recalculer (ignorés par l'agent tant qu'ils ne le sont pas), questions transmises faute de source.
 */
export default function KnowledgeAlerts({
  isAdmin,
  configured,
  toReindex,
  reindexing,
  showingReindex,
  gapCount,
  onReindex,
  onShowReindex,
}: {
  isAdmin: boolean;
  configured: boolean | null;
  toReindex: number;
  reindexing: boolean;
  showingReindex: boolean;
  gapCount: number;
  onReindex: () => void;
  onShowReindex: () => void;
}) {
  return (
    <>
      {configured === false && (
        <KnowledgeAlert
          index={1}
          status="warning"
          title="Recherche indisponible"
          actions={
            isAdmin && (
              <LinkButton variant="secondary" size="sm" href="/settings?section=ia">
                Configurer dans les paramètres
              </LinkButton>
            )
          }
        >
          Le service de recherche n’est pas configuré : l’ajout de documents et le test sont désactivés, et l’agent
          transmet les questions factuelles à un conseiller.{!isAdmin && " Contactez un administrateur pour l’activer."}
        </KnowledgeAlert>
      )}
      {toReindex > 0 && (
        <KnowledgeAlert
          index={2}
          status="warning"
          title={`${toReindex} document${toReindex > 1 ? "s" : ""} à recalculer`}
          actions={
            <>
              {!showingReindex && (
                <Btn variant="tertiary" size="sm" onClick={onShowReindex}>
                  Afficher {toReindex > 1 ? "ces documents" : "ce document"}
                </Btn>
              )}
              {isAdmin && configured && (
                <Btn variant="secondary" size="sm" disabled={reindexing} onClick={onReindex}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {reindexing ? "Recalcul…" : "Recalculer"}
                </Btn>
              )}
            </>
          }
        >
          {toReindex > 1
            ? "Le modèle de recherche a changé : l’agent ne les utilise pas tant qu’ils ne sont pas recalculés."
            : "Le modèle de recherche a changé : l’agent ne l’utilise pas tant qu’il n’est pas recalculé."}
          {!isAdmin && " Demandez à un administrateur de lancer le recalcul."}
        </KnowledgeAlert>
      )}
      {gapCount > 0 && (
        <KnowledgeAlert
          index={3}
          status="accent"
          className="border border-agent/25 bg-agent-soft/60"
          icon={<Sparkles className="size-4 text-agent" />}
          title={`${gapCount} question${gapCount > 1 ? "s" : ""} sans source fiable`}
          actions={
            <LinkButton variant="secondary" size="sm" href="/todo?kind=kb_gap">
              {gapCount > 1 ? "Traiter les demandes" : "Traiter la demande"}
            </LinkButton>
          }
        >
          L’agent {gapCount > 1 ? "les a transmises" : "l’a transmise"} à un conseiller faute de document suffisant.
          Ajouter la réponse dans un document évite d’autres transferts.
        </KnowledgeAlert>
      )}
    </>
  );
}
