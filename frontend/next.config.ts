import type { NextConfig } from "next";

// En-têtes de sécurité de la console (AUDIT-SEC-003). HSTS est posé par le proxy HTTPS (Caddy).
// Pas de CSP restreignant les scripts ici : le script de thème est intégré à la page (voir `app/layout.tsx`),
// une CSP stricte demandera une empreinte ou un nonce.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Image de production minimale (voir frontend/Dockerfile) : serveur Node autonome.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
