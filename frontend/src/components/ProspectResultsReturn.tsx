"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { prospectReturnHref } from "@/lib/prospectResults";

export const backLinkClass =
  "inline-flex w-fit items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus";

export default function ProspectResultsReturn() {
  const params = useSearchParams();
  const href = prospectReturnHref(params.get("from"));
  return (
    <Link data-ui="v2" href={href ?? "/prospects"} className={backLinkClass}>
      {href ? "← Retour aux résultats" : "← Tous les prospects"}
    </Link>
  );
}
