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
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Commercial 2.0</h1>
        <p className="muted">Console de l&apos;agent commercial — DATUM Academy</p>
        <label>
          Email ou nom d&apos;utilisateur
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
