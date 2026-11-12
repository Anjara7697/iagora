"use client";

import { ArrowRight, FlaskConical, MessagesSquare } from "lucide-react";
import { useCurrentUser } from "@/components/AppShell";
import { LinkButton, Notice, TextLink } from "@/components/ds/controls";
import { Eyebrow, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { canUseSimulator } from "@/lib/access";
import { SIMULATOR_ENABLED } from "@/lib/api";
import { Box } from "@/components/ds/card";

export default function TestingPage() {
  const user = useCurrentUser();
  if (!canUseSimulator(user?.role))
    return (
      <Screen className="max-w-[960px]">
        <PageHeader title="Tests et démonstration" />
        <Notice tone="warning">
          {!SIMULATOR_ENABLED
            ? "Le simulateur est désactivé sur cet environnement."
            : "Cet espace est réservé aux conseillers et aux administrateurs."}
        </Notice>
      </Screen>
    );
  return (
    <Screen className="max-w-[960px]">
      <TextLink href="/settings" className="w-fit text-sm">
        ← Paramètres
      </TextLink>
      <PageHeader
        {...reveal(0)}
        eyebrow="Paramètres · Outils de test"
        title="Tests et démonstration"
        subtitle="Préparez une démonstration ou vérifiez le comportement de l’agent avant de reprendre vos échanges."
      />
      <div
        className={`flex items-start gap-3 rounded-2xl border border-agent/25 bg-agent-soft/60 px-5 py-4 ${reveal(1).className}`}
        style={reveal(1).style}
        role="note"
      >
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-agent" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-semibold text-foreground">Environnement de test — données fictives</strong>
          <p className="text-[13px]/[20px] text-muted">
            Les essais utilisent le modèle, le mode et les réglages enregistrés de
            l’application. Les prospects et les échanges du simulateur sont
            fictifs.
          </p>
        </div>
      </div>
      <Box as="section"
        className={`flex-row flex-wrap items-center gap-5 p-6 ${reveal(2).className}`}
        style={reveal(2).style}
        aria-label="Simulateur de conversation"
      >
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-foreground" aria-hidden="true">
          <MessagesSquare className="size-6" />
        </span>
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <Eyebrow>Essayer l’agent</Eyebrow>
          <h2 className="text-lg font-semibold text-foreground">Simulateur de conversation</h2>
          <p className="text-[13px]/[20px] text-muted">
            Jouez un prospect, suivez les décisions de l’agent et relisez ses
            réponses. Vous pouvez explorer librement ou choisir un parcours guidé.
          </p>
        </div>
        <LinkButton variant="primary" href="/simulator">
          Ouvrir le simulateur
          <ArrowRight className="size-4" aria-hidden="true" />
        </LinkButton>
      </Box>
    </Screen>
  );
}
