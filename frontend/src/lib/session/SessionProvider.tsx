"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, forgetLegacyToken, logout } from "@/lib/api";
import type { User } from "@/lib/types";

type Session = {
  /** Utilisateur connecté ; `null` pendant le chargement, en erreur et sur la page de connexion. */
  user: User | null;
  /** Échec du chargement de la session (serveur injoignable…) ; une 401 renvoie plutôt à la connexion. */
  error: string | null;
  retry: () => void;
  /** Mot de passe temporaire pas encore changé, hors de « Mon compte » : l'écran demandé n'est pas affiché. */
  blocked: boolean;
  /** Ferme la session côté serveur, puis ouvre la page de connexion (sans adresse de retour). */
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/**
 * Session de la console (ARCH-01), séparée de la mise en page : charge l'utilisateur (`/auth/me`), sauf sur la page de
 * connexion, et le rend disponible à tous les écrans ; tant que le mot de passe est temporaire, seul « Mon compte »
 * est accessible. Sans session (témoin absent ou expiré), l'API répond 401 et `api` renvoie vers la connexion.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isLogin) {
      setUser(null);
      return;
    }
    let cancelled = false;
    forgetLegacyToken();
    setError(null);
    api<User>("/auth/me")
      .then((value) => {
        if (!cancelled) setUser(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Connexion impossible");
      });
    return () => {
      cancelled = true;
    };
  }, [isLogin, attempt]);

  const blocked = !!user?.must_change_password && pathname !== "/account";
  useEffect(() => {
    if (!blocked) return;
    router.replace("/account");
    // Une navigation déjà en cours peut absorber la redirection : on la redemande.
    const retry = window.setInterval(() => router.replace("/account"), 1000);
    return () => window.clearInterval(retry);
  }, [blocked, router]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    router.replace("/login");
  }, [router]);

  return (
    <SessionContext.Provider value={{ user, error, retry, blocked, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider manquant");
  return session;
}

/** Utilisateur connecté (`null` tant que la session n'est pas chargée). */
export const useCurrentUser = () => useSession().user;
