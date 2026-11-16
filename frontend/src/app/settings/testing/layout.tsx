import type { Metadata } from "next";
import type { ReactNode } from "react";
import { documentTitle } from "@/lib/labels";

/**
 * Titre du document de cet écran (« Prospects · IAGORA »), écrit en entier : le gabarit de titre de Next ne descend
 * pas aux routes imbriquées. L'écran lui-même est rendu par `page.tsx`.
 */
export const metadata: Metadata = { title: { absolute: documentTitle("/settings/testing") } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
