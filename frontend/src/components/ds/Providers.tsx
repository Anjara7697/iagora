"use client";

import { RouterProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

type NavigateOptions = Parameters<ComponentProps<typeof RouterProvider>["navigate"]>[1];

/** Les liens HeroUI (`Link`) naviguent côté client via le routeur de Next.js, sans recharger la page. */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={(to: string, options?: NavigateOptions) => router.push(to, options as never)}>
      {children}
    </RouterProvider>
  );
}
