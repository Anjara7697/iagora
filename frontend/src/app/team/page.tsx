"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import {
  Feedback,
  Field,
  SecretOnce,
  Section,
  initials,
} from "@/components/forms";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { CreatedUser, Page, Role, User } from "@/lib/types";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  ADVISOR: "Conseiller",
  VIEWER: "Observateur",
};
const ROLE_HELP: Record<Role, string> = {
  ADMIN: "accès complet, dont Équipe, Intégrations et Paramètres",
  ADVISOR: "file, conversations, prospects, validations",
  VIEWER: "consultation seule",
};

function MemberRow({
  member,
  self,
  onChanged,
  onPassword,
}: {
  member: User;
  self: boolean;
  onChanged: () => void;
  onPassword: (who: string, password: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(member.username);
  const [email, setEmail] = useState(member.email);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/users/${member.id}`, { method: "PATCH", body });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    }
  }

  async function reset() {
    if (
      !window.confirm(
        `Réinitialiser le mot de passe de ${member.username} ? Ses sessions ouvertes seront fermées.`,
      )
    )
      return;
    setError(null);
    try {
      const r = await api<{ temporary_password: string }>(
        `/users/${member.id}/reset-password`,
        { method: "POST" },
      );
      onPassword(member.username, r.temporary_password);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    }
  }

  const state = !member.is_active
    ? { label: "Désactivé", cls: "badge integ-off" }
    : member.must_change_password
      ? { label: "Mot de passe à choisir", cls: "badge integ-warn" }
      : { label: "Actif", cls: "badge integ-ok" };

  return (
    <div
      className="item-row"
      role="listitem"
      aria-label={`Membre ${member.username}`}
    >
      <span className={`avatar-36 ${member.is_active ? "" : "off"}`}>
        {initials(member.username)}
      </span>
      <span className="item-main">
        {editing ? (
          <span className="field-inline">
            <input
              aria-label="Nom d’utilisateur"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              aria-label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </span>
        ) : (
          <>
            <strong>
              {member.username}
              {self && <span className="status-text"> · vous</span>}
            </strong>
            <span className="item-meta">{member.email}</span>
          </>
        )}
        <span className="row">
          <select
            aria-label={`Rôle de ${member.username}`}
            value={member.role}
            disabled={self}
            onChange={(e) => patch({ role: e.target.value })}
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <span className={state.cls}>{state.label}</span>
          <span className="status-text">
            Membre depuis le {formatDate(member.created_at ?? null)}
          </span>
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="item-actions">
        {editing ? (
          <>
            <button
              className="primary"
              onClick={() => patch({ username, email })}
            >
              Enregistrer
            </button>
            <button onClick={() => setEditing(false)}>Annuler</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}>Modifier</button>
        )}
        {!self && (
          <>
            <button onClick={reset}>Réinitialiser le mot de passe</button>
            <button
              className={member.is_active ? "danger" : ""}
              onClick={() => patch({ is_active: !member.is_active })}
            >
              {member.is_active ? "Désactiver" : "Réactiver"}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

export default function TeamPage() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const members = useApi<Page<User>>(isAdmin ? "/users?limit=200" : null, {
    keepPrevious: true,
  });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ADVISOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{
    who: string;
    password: string;
  } | null>(null);

  if (user && !isAdmin)
    return (
      <p className="card warnbox" role="alert">
        Cette page est réservée aux administrateurs.
      </p>
    );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<CreatedUser>("/users", {
        method: "POST",
        body: { username, email, role },
      });
      if (created.temporary_password)
        setSecret({
          who: created.username,
          password: created.temporary_password,
        });
      setUsername("");
      setEmail("");
      setRole("ADVISOR");
      members.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const active = members.data?.items.filter((m) => m.is_active).length ?? 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Équipe</span>
          <h1>Équipe</h1>
          <p className="muted">
            Les conseillers s’ajoutent ici, sans passer par le serveur. Chaque
            nouveau membre reçoit un mot de passe temporaire et choisit le sien
            à la première connexion.
          </p>
        </div>
      </div>

      <div className="settings-stack">
        {secret && (
          <SecretOnce
            label="Mot de passe temporaire"
            intro={
              <>
                Mot de passe temporaire de <strong>{secret.who}</strong>, à
                transmettre par un canal sûr :
              </>
            }
            secret={secret.password}
            doneLabel="J’ai transmis le mot de passe"
            onDone={() => setSecret(null)}
          />
        )}

        <Section
          region="Ajouter un membre"
          label="Ajouter un membre"
          intro="Trois rôles : Administrateur (accès complet), Conseiller (file, conversations, prospects), Observateur (consultation seule)."
        >
          <form onSubmit={create} className="settings-stack">
            <Field label="Nom d’utilisateur" note="3 caractères minimum.">
              <input
                value={username}
                minLength={3}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Email" note="Sert aussi d’identifiant de connexion.">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Rôle">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} — {ROLE_HELP[r]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="actions-bar">
              <button
                className="primary"
                type="submit"
                disabled={busy || username.trim().length < 3 || !email}
              >
                Créer le membre
              </button>
              <Feedback error={error} />
            </div>
          </form>
        </Section>

        <Loading
          loading={members.loading && !members.data}
          error={members.error}
          onRetry={members.reload}
        />
        {members.data && (
          <Section
            region="Membres de l’équipe"
            label={`Membres · ${active} actif(s) sur ${members.data.total}`}
          >
            <div role="list">
              {members.data.items.map((m) => (
                <MemberRow
                  key={`${m.id}-${m.username}-${m.email}-${m.role}-${m.is_active}`}
                  member={m}
                  self={m.id === user?.id}
                  onChanged={members.reload}
                  onPassword={(who, password) => setSecret({ who, password })}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
