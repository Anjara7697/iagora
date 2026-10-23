"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
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
  ADMIN: "tout, dont équipe et intégrations",
  ADVISOR: "prospects, conversations, validations",
  VIEWER: "lecture seule",
};

/** Mot de passe à transmettre au membre : affiché une seule fois. */
function OneTimePassword({
  who,
  password,
  onClose,
}: {
  who: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="card warnbox"
      role="status"
      aria-label="Mot de passe temporaire"
    >
      <p>
        Mot de passe temporaire de <strong>{who}</strong> :{" "}
        <code>{password}</code>{" "}
        <button
          onClick={() =>
            navigator.clipboard
              ?.writeText(password)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </p>
      <p className="muted">
        Transmettez-le au membre par un canal sûr. Il ne sera plus affiché ; le
        membre devra choisir son propre mot de passe à la première connexion.
      </p>
      <button onClick={onClose}>J’ai transmis le mot de passe</button>
    </div>
  );
}

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

  return (
    <tr aria-label={`Membre ${member.username}`}>
      <td>
        {editing ? (
          <input
            aria-label="Nom d’utilisateur"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        ) : (
          <>
            {member.username}
            {self && <span className="muted"> (vous)</span>}
          </>
        )}
      </td>
      <td>
        {editing ? (
          <input
            aria-label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          member.email
        )}
      </td>
      <td>
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
      </td>
      <td>
        <span className={`badge ${member.is_active ? "" : "warn"}`}>
          {member.is_active
            ? member.must_change_password
              ? "Mot de passe à choisir"
              : "Actif"
            : "Désactivé"}
        </span>
      </td>
      <td className="muted">{formatDate(member.created_at ?? null)}</td>
      <td>
        <div className="row">
          {editing ? (
            <>
              <button onClick={() => patch({ username, email })}>
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
              <button onClick={() => patch({ is_active: !member.is_active })}>
                {member.is_active ? "Désactiver" : "Réactiver"}
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
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

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Équipe</span>
          <h1>Équipe</h1>
          <p className="muted">
            Ajoutez les conseillers sans passer par le serveur. Chaque nouveau
            membre reçoit un mot de passe temporaire et choisit le sien à la
            première connexion.
          </p>
        </div>
      </div>

      {secret && (
        <OneTimePassword
          who={secret.who}
          password={secret.password}
          onClose={() => setSecret(null)}
        />
      )}

      <section className="card" aria-label="Ajouter un membre">
        <h2>Ajouter un membre</h2>
        <form onSubmit={create}>
          <div className="form-row">
            <label>
              Nom d’utilisateur
              <input
                value={username}
                minLength={3}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Rôle
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
            </label>
          </div>
          <div className="row">
            <button
              className="primary"
              type="submit"
              disabled={busy || username.trim().length < 3 || !email}
            >
              Créer le membre
            </button>
          </div>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <Loading
        loading={members.loading && !members.data}
        error={members.error}
        onRetry={members.reload}
      />
      {members.data && (
        <section className="card" aria-label="Membres de l’équipe">
          <h2>Membres ({members.data.total})</h2>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Créé le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.data.items.map((m) => (
                <MemberRow
                  key={`${m.id}-${m.username}-${m.email}`}
                  member={m}
                  self={m.id === user?.id}
                  onChanged={members.reload}
                  onPassword={(who, password) => setSecret({ who, password })}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
