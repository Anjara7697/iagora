"use client";

import { ArrowRight, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/ds/Brand";
import { Btn, ErrorText, Field, TextInput } from "@/components/ds/controls";
import { Eyebrow } from "@/components/ds/layout";
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
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#0f1220] p-12 text-white lg:flex">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(122,61,240,0.45),transparent_65%)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -bottom-48 size-[560px] rounded-full bg-[radial-gradient(circle,rgba(31,79,216,0.5),transparent_65%)]"
        />
        <span className="relative flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
          <span
            aria-hidden="true"
            className="inline-flex size-6 items-center justify-center rounded-md bg-white text-[22px] leading-none text-[#7a3df0]"
          >
            ▪
          </span>
          IAGORA
          <span className="rounded-sm border border-white/25 px-1.5 font-mono text-[11px] font-normal text-white/70">2.0</span>
        </span>
        <div className="relative flex max-w-[520px] flex-col gap-5">
          <span className="font-mono text-xs tracking-[0.06em] text-white/60 uppercase">Agent intelligent commercial</span>
          <h1 className="text-[44px]/[50px] font-semibold tracking-[-0.03em]">
            Chaque échange,
            <br />
            une nouvelle possibilité.
          </h1>
          <p className="text-base/[26px] text-white/75">
            Retrouvez vos prospects, suivez leurs parcours et accompagnez-les vers la bonne
            formation.
          </p>
          <ul className="flex flex-col gap-3 pt-2 text-sm text-white/80">
            {[
              { icon: Sparkles, text: "L’agent prépare les réponses, vous gardez la main." },
              { icon: MessagesSquare, text: "Toutes les conversations au même endroit." },
              { icon: ShieldCheck, text: "Aucun prix, aucune date inventés : seulement la base de connaissances." },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10" aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <span className="relative font-mono text-xs tracking-[0.06em] text-white/60 uppercase">DATUM Academy</span>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-[420px] flex-col gap-6">
          <span className="lg:hidden">
            <Brand />
          </span>
          <form className="card card--default gap-5 p-6 sm:p-8" onSubmit={submit} aria-busy={busy} aria-labelledby="login-title">
            <div className="flex flex-col gap-1">
              <Eyebrow>Votre espace de travail</Eyebrow>
              <h2 id="login-title" className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                Bienvenue sur IAGORA
              </h2>
              <p className="text-sm text-muted">Connectez-vous avec votre compte professionnel.</p>
            </div>
            <Field label="Email ou nom d'utilisateur">
              <TextInput
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                disabled={busy}
              />
            </Field>
            <Field label="Mot de passe">
              <TextInput
                name="password"
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            <Btn variant="primary" type="submit" size="lg" fullWidth disabled={busy}>
              {busy ? "Connexion…" : (
                <>
                  Se connecter
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Btn>
          </form>
          <p className="text-center text-[13px] text-muted">Besoin d’un accès ? Contactez votre administrateur.</p>
        </div>
      </section>
    </main>
  );
}
