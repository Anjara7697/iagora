"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken, setToken, SIMULATOR_ENABLED } from "@/lib/api";
import type { User } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Accueil" },
  { href: "/prospects", label: "Prospects" },
  { href: "/handoffs", label: "Transferts" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<User>("/auth/me").then(setUser).catch(() => undefined);
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!user) return <main className="center">Chargement…</main>;

  const links = SIMULATOR_ENABLED ? [...LINKS, { href: "/simulator", label: "Simulateur" }] : LINKS;
  return (
    <>
      <nav className="nav">
        <strong>Commercial 2.0</strong>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href)) ? "active" : ""}
          >
            {l.label}
          </Link>
        ))}
        <span className="spacer" />
        <span className="muted">
          {user.username} ({user.role})
        </span>
        <button
          className="link"
          onClick={() => {
            setToken(null);
            router.replace("/login");
          }}
        >
          Déconnexion
        </button>
      </nav>
      <main>{children}</main>
    </>
  );
}
