"use client";

import { I18nProvider, RouterProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

type NavigateOptions = Parameters<ComponentProps<typeof RouterProvider>["navigate"]>[1];

/** Langue française pour les composants HeroUI (dates, nombres) ; les liens HeroUI naviguent côté client via le routeur de Next.js. */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <I18nProvider locale="fr-FR">
      <RouterProvider navigate={(to: string, options?: NavigateOptions) => router.push(to, options as never)}>
        {children}
      </RouterProvider>
    </I18nProvider>
  );
}
