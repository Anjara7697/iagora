import type { Metadata } from "next";
import type { ReactNode } from "react";
import { documentTitle } from "@/lib/labels";

/** Titre du document de cet écran (« Évaluation · IAGORA ») ; l'écran lui-même est rendu par `page.tsx`. */
export const metadata: Metadata = { title: { absolute: documentTitle("/evaluation") } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
