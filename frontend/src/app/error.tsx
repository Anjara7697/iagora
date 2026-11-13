"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Btn, LinkButton } from "@/components/ds/controls";
import { EmptyPanel, Screen } from "@/components/ds/layout";

/** Référence d'une erreur rendue par le serveur, affichée seulement si elle a la forme attendue. */
const reference = (digest: string | undefined) => (digest && /^[A-Za-z0-9-]{1,64}$/.test(digest) ? digest : null);

/**
 * Erreur pendant l'affichage d'un écran (ARCH-02) : le menu et la barre restent en place, l'écran est remplacé par
 * ce message en français, avec « Réessayer » (qui réaffiche l'écran) et un retour à l'accueil. Le détail technique
 * part dans la console du navigateur, jamais à l'écran.
 */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const ref = reference(error.digest);
  return (
    <Screen>
      <div role="alert">
        <EmptyPanel
          icon={TriangleAlert}
          title="Cet écran n’a pas pu s’afficher"
          description={
            <>
              Une erreur inattendue s’est produite. Les données déjà enregistrées ne sont pas touchées. Réessayez ; si
              le problème continue, prévenez l’administrateur{ref ? ` (référence ${ref})` : ""}.
            </>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Btn variant="primary" onClick={reset}>
                Réessayer
              </Btn>
              <LinkButton href="/">Revenir à Aujourd’hui</LinkButton>
            </div>
          }
        />
      </div>
    </Screen>
  );
}
