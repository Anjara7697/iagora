"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        form: { username, password },
      });
      setToken(token.access_token);
      router.replace("/prospects");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▪
          </span>
          IAGORA<span className="version">2.0</span>
        </div>
        <div>
          <span className="eyebrow">Agent intelligent commercial</span>
          <h1>
            Chaque échange,
            <br />
            une nouvelle possibilité.
          </h1>
          <p>
            Retrouvez vos prospects, suivez leurs parcours et accompagnez-les vers la bonne
            formation.
          </p>
        </div>
        <span className="eyebrow">DATUM Academy</span>
      </section>
      <section className="login-panel">
        <form className="login" onSubmit={submit} aria-busy={busy}>
          <span className="eyebrow">Votre espace de travail</span>
          <h2>Bienvenue sur IAGORA</h2>
          <p className="muted">Connectez-vous avec votre compte professionnel.</p>
          <label>
            Email ou nom d&apos;utilisateur
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              disabled={busy}
            />
          </label>
          <label>
            Mot de passe
            <input
              name="password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Connexion…" : "Se connecter →"}
          </button>
          <p className="muted">Besoin d’un accès ? Contactez votre administrateur.</p>
        </form>
      </section>
    </main>
  );
}
