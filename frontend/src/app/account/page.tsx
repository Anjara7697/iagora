"use client";

import { useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, TextInput } from "@/components/ds/controls";
import { PageHeader, Screen } from "@/components/ds/layout";
import { ActionsBar, Feedback, SettingRow as Field, SettingsCard as Section } from "@/components/ds/settings";
import { MyCalendar } from "@/components/MyCalendar";
import { MyZoom } from "@/components/MyZoom";
import { api, ApiError } from "@/lib/api";

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
      await api("/auth/password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      // Les autres sessions sont fermées ; celle-ci repart avec un témoin renouvelé par l'API.
      setDone(true);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen className="max-w-[960px]">
      {/* En-tête commun (règle 1), titre identique au menu du compte et à l'onglet. */}
      <PageHeader
        title="Mon compte"
        subtitle={
          <>
            <span className="font-medium text-foreground">{user.username}</span> · {user.email} · {ROLE_LABELS[user.role]}
          </>
        }
      />
      {user.must_change_password && (
        <p className="rounded-lg bg-warning-soft px-4 py-3 type-body text-warning-soft-foreground" role="alert">
          Votre mot de passe est temporaire : choisissez le vôtre pour accéder
          à la console.
        </p>
      )}
      <Section
        region="Changer de mot de passe"
        label="Sécurité"
        title="Mot de passe"
        intro="12 caractères minimum. Vos autres sessions ouvertes seront fermées."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Mot de passe actuel">
            <TextInput
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="Nouveau mot de passe (12 caractères minimum)"
            note={tooShort ? <span className="text-danger">12 caractères minimum.</span> : undefined}
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field
            label="Confirmer le nouveau mot de passe"
            note={mismatch ? <span className="text-danger">Les deux saisies sont différentes.</span> : undefined}
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <ActionsBar className="border-t border-separator pt-4">
            <Btn
              variant="primary"
              type="submit"
              disabled={busy || !current || next.length < 12 || confirm !== next}
            >
              Enregistrer le mot de passe
            </Btn>
          </ActionsBar>
          <Feedback notice={done ? "Mot de passe changé." : null} error={error} />
        </form>
      </Section>
      {!user.must_change_password && user.role !== "VIEWER" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MyCalendar />
          <MyZoom />
        </div>
      )}
    </Screen>
  );
}
