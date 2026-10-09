import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commercial 2.0 - DATUM Academy",
  description: "Tableau de bord de l'Agent Intelligent Commercial 2.0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
