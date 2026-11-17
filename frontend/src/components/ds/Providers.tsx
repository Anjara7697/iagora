"use client";

import { I18nProvider, RouterProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Options de navigation du routeur de Next.js, déclarées à React Aria (liens et boutons HeroUI) : sans conversion
 * forcée (TS-01). L'interface vit dans `@react-types/shared`, installé avec HeroUI ; l'étendre par
 * `react-aria-components` est ignoré par le compilateur (vérifié).
 */
type NextRouterOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
declare module "@react-types/shared" {
  interface RouterConfig {
    routerOptions: NextRouterOptions;
  }
}

/** Langue française pour les composants HeroUI (dates, nombres) ; les liens HeroUI naviguent côté client via le routeur de Next.js. */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <I18nProvider locale="fr-FR">
      <RouterProvider navigate={(to, options) => router.push(to, options)}>
        {children}
      </RouterProvider>
    </I18nProvider>
  );
}
