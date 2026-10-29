"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Feedback, Field, Section, initials } from "@/components/forms";
import { MyCalendar } from "@/components/MyCalendar";
import { MyZoom } from "@/components/MyZoom";
import { api, ApiError, setToken } from "@/lib/api";

const ROLE_LABELS = {
  ADMIN: "Administrateur",
  ADVISOR: "Conseiller",
  VIEWER: "Observateur",
};

export default function AccountPage() {
  const user = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!user) return null;

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ access_token: string }>("/auth/password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      // Les autres sessions sont fermées ; celle-ci repart avec le nouveau jeton.
      setToken(r.access_token);
      setDone(true);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div className="row">
          <span className="avatar-36" aria-hidden="true">
            {initials(user.username)}
          </span>
          <div>
            <span className="eyebrow">Mon compte</span>
            <h1>{user.username}</h1>
            <p className="muted">
              {user.email} · {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
      </div>
      <div className="settings-stack">
        {user.must_change_password && (
          <p className="ui-card warnbox" role="alert">
            Votre mot de passe est temporaire : choisissez le vôtre pour accéder
            à la console.
          </p>
        )}
        <Section
          region="Changer de mot de passe"
          label="Mot de passe"
          intro="12 caractères minimum. Vos autres sessions ouvertes seront fermées."
        >
          <form onSubmit={submit} className="settings-stack">
            <Field label="Mot de passe actuel">
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field
              label="Nouveau mot de passe (12 caractères minimum)"
              note={
                tooShort ? (
                  <span className="error">12 caractères minimum.</span>
                ) : undefined
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field
              label="Confirmer le nouveau mot de passe"
              note={
                mismatch ? (
                  <span className="error">
                    Les deux saisies sont différentes.
                  </span>
                ) : undefined
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <div className="actions-bar">
              <button
                className="primary"
                type="submit"
                disabled={
                  busy || !current || next.length < 12 || confirm !== next
                }
              >
                Enregistrer le mot de passe
              </button>
              <Feedback
                notice={done ? "Mot de passe changé." : null}
                error={error}
              />
            </div>
          </form>
        </Section>
        {!user.must_change_password && user.role !== "VIEWER" && <MyCalendar />}
        {!user.must_change_password && user.role !== "VIEWER" && <MyZoom />}
      </div>
    </>
  );
}
