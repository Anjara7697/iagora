import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { Providers } from "@/components/ds/Providers";
import { Toaster } from "@/components/ds/Toaster";
import "./heroui.css";

export const metadata: Metadata = {
  title: "Commercial 2.0 - DATUM Academy",
  description: "Console de l'Agent Intelligent Commercial 2.0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="light">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
