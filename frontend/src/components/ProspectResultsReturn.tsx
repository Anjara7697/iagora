"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { campaignReturnHref } from "@/lib/campaignNav";
import { prospectReturnHref } from "@/lib/prospectResults";

export const backLinkClass =
  "inline-flex w-fit items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus";

export default function ProspectResultsReturn() {
  const params = useSearchParams();
  const from = params.get("from");
  const results = prospectReturnHref(from);
  // Ouverte depuis l'onglet Prospects d'une campagne : retour à cette campagne (onglet, étape et page conservés).
  const campaign = results ? null : campaignReturnHref(from);
  return (
    <Link href={results ?? campaign ?? "/prospects"} className={backLinkClass}>
      {results ? "← Retour aux résultats" : campaign ? "← Retour à la campagne" : "← Tous les prospects"}
    </Link>
  );
}
