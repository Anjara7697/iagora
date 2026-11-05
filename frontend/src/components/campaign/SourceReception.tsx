"use client";

import { LinkButton, TextLink } from "@/components/ds/controls";
import { sourceDestinationUrl, sourceReception } from "@/lib/campaignSources";
import type { Campaign } from "@/lib/types";

export function SourceReception({ campaign, canEdit }: { campaign: Campaign; canEdit: boolean }) {
  return <section className="flex flex-col gap-3" aria-label="Mise en service des sources">
    <p className="text-sm text-muted">Une source indique d’où viennent les contacts. L’ajouter ne crée ni publicité, ni formulaire, ni connexion automatique. Choisissez ensuite son mode de réception.</p>
    {campaign.status !== "active" && <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      La campagne n’est pas active. Vous pouvez préparer ses branchements ; activez-la avant de recevoir ou importer des contacts.
    </p>}
    <div className="grid gap-3 lg:grid-cols-2">
      {campaign.sources.map((s) => {
        const reception = sourceReception(s);
        return <section key={s.id} aria-label={`Réception · ${s.name}`} className="flex flex-col gap-3 rounded-lg border border-separator p-4">
          <div><h3 className="text-sm font-semibold">{s.name}</h3><p className="text-xs text-muted">{reception.label}</p></div>
          <p className="text-sm text-muted">{reception.description}</p>
          {canEdit && <div className="mt-auto flex flex-wrap gap-2">
            {reception.connector && <LinkButton size="sm" href={sourceDestinationUrl(`/integrations?c=${reception.connector}`, campaign.id, s.id)}>
              {reception.connector === "meta" ? "Associer un formulaire Meta" : reception.connector === "email" ? "Configurer la boîte email" : "Brancher le formulaire"}
            </LinkButton>}
            <LinkButton size="sm" variant="outline" href={sourceDestinationUrl("/prospects/import", campaign.id, s.id)}>Importer dans cette source</LinkButton>
          </div>}
          <TextLink href={`/prospects?campaign=${campaign.id}&source=${s.id}`} className="text-sm">Voir les contacts reçus</TextLink>
        </section>;
      })}
    </div>
  </section>;
}
