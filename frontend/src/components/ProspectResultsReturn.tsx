"use client";

import { useSearchParams } from "next/navigation";
import { campaignReturnHref } from "@/lib/campaignNav";
import { prospectReturnHref } from "@/lib/prospectResults";
import { BackLink } from "./ds/controls";

export default function ProspectResultsReturn() {
  const params = useSearchParams();
  const from = params.get("from");
  const results = prospectReturnHref(from);
  // Ouverte depuis l'onglet Prospects d'une campagne : retour à cette campagne (onglet, étape et page conservés).
  const campaign = results ? null : campaignReturnHref(from);
  return (
    <BackLink href={results ?? campaign ?? "/prospects"}>
      {results ? "Retour aux résultats" : campaign ? "Retour à la campagne" : "Tous les prospects"}
    </BackLink>
  );
}
