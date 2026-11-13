"use client";

import { Button } from "@heroui/react";
import { useEffect } from "react";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./heroui.css";

/**
 * Erreur dans la structure même de la console (menu, session), là où `error.tsx` ne peut pas s'afficher : page
 * autonome, sans le menu, qui remplace tout le document. Même message, sans détail technique à l'écran.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="fr" data-theme="light" suppressHydrationWarning>
      <head>
        <title>Erreur · IAGORA</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <main className="grid min-h-dvh place-items-center bg-background p-6">
          <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="text-xl font-semibold text-foreground">La console n’a pas pu s’afficher</h1>
            <p className="text-sm text-muted">
              Une erreur inattendue s’est produite. Les données déjà enregistrées ne sont pas touchées. Réessayez ; si le
              problème continue, prévenez l’administrateur.
            </p>
            <Button variant="primary" onPress={reset}>
              Réessayer
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
