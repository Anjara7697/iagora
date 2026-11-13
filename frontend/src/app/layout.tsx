import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { Providers } from "@/components/ds/Providers";
import { Toaster } from "@/components/ds/Toaster";
import { SessionProvider } from "@/lib/session";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./heroui.css";

export const metadata: Metadata = {
  // Chaque écran donne son titre complet (`layout.tsx` de sa route, d'après `documentTitle`) : « Prospects · IAGORA ».
  // L'accueil, seul écran sans titre propre, prend la valeur par défaut ; le gabarit sert à la page introuvable.
  title: { template: "%s · IAGORA", default: "Aujourd’hui · IAGORA" },
  description: "Console de l'Agent Intelligent Commercial 2.0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Le thème (clair, sombre, système) est posé par le script ci-dessous avant l'affichage : l'attribut de <html>
    // peut donc différer du rendu serveur.
    <html lang="fr" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
