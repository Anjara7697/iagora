"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { prospectReturnHref } from "@/lib/prospectResults";

export default function ProspectResultsReturn() {
  const params = useSearchParams();
  const href = prospectReturnHref(params.get("from"));
  return (
    <Link href={href ?? "/prospects"} className="profile-back">
      {href ? "← Retour aux résultats" : "← Tous les prospects"}
    </Link>
  );
}
