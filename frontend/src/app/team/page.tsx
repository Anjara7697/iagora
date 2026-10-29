"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { Btn, Field, NativeSelect, Tag, TextInput } from "@/components/ds/controls";
import { PageHeader, Screen, cx, initialsOf as initials } from "@/components/ds/layout";
import { ActionsBar, Feedback, SecretOnce, SettingsCard as Section } from "@/components/ds/settings";
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
    ? { label: "Désactivé", tone: "neutral" as const }
    : member.must_change_password
      ? { label: "Mot de passe à choisir", tone: "warning" as const }
      : { label: "Actif", tone: "success" as const };

  return (
    <div
      className="flex flex-wrap items-start gap-4 border-t border-separator py-4 first:border-t-0 first:pt-0 last:pb-0"
      role="listitem"
      aria-label={`Membre ${member.username}`}
    >
      <span
        className={cx(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
          member.is_active ? "bg-accent-soft text-accent-soft-foreground" : "bg-surface-tertiary text-muted",
        )}
        aria-hidden="true"
      >
        {initials(member.username)}
      </span>
      <span className="flex min-w-[240px] flex-1 flex-col gap-2">
        {editing ? (
          <span className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TextInput aria-label="Nom d’utilisateur" value={username} onChange={(e) => setUsername(e.target.value)} />
            <TextInput aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
        ) : (
          <span className="flex flex-col">
            <strong className="text-sm font-semibold text-foreground">
              {member.username}
              {self && <span className="font-normal text-muted"> · vous</span>}
            </strong>
            <span className="text-[13px] text-muted">{member.email}</span>
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={`Rôle de ${member.username}`}
            value={member.role}
            disabled={self}
            onChange={(e) => patch({ role: e.target.value })}
            className="w-44"
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
          <Tag tone={state.tone}>{state.label}</Tag>
          <span className="text-xs text-muted">Membre depuis le {formatDate(member.created_at ?? null)}</span>
        </span>
        {error && (
          <span className="text-[13px] text-danger" role="alert">
            {error}
          </span>
        )}
      </span>
      <ActionsBar className="justify-end">
        {editing ? (
          <>
            <Btn size="sm" variant="primary" onClick={() => patch({ username, email })}>
              Enregistrer
            </Btn>
            <Btn size="sm" onClick={() => setEditing(false)}>
              Annuler
            </Btn>
          </>
        ) : (
          <Btn size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Modifier
          </Btn>
        )}
        {!self && (
          <>
            <Btn size="sm" variant="ghost" onClick={reset}>
              <KeyRound className="size-3.5" aria-hidden="true" />
              Réinitialiser le mot de passe
            </Btn>
            <Btn
              size="sm"
              variant={member.is_active ? "danger-soft" : "outline"}
              onClick={() => patch({ is_active: !member.is_active })}
            >
              {member.is_active ? "Désactiver" : "Réactiver"}
            </Btn>
          </>
        )}
      </ActionsBar>
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
      <Screen>
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          Cette page est réservée aux administrateurs.
        </p>
      </Screen>
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
    <Screen className="max-w-[1100px]">
      <PageHeader
        eyebrow="Administration · Équipe"
        title="Équipe"
        subtitle="Les conseillers s’ajoutent ici, sans passer par le serveur. Chaque nouveau membre reçoit un mot de passe temporaire et choisit le sien à la première connexion."
      />

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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 flex min-w-0 flex-col gap-4 xl:order-1">
          <Loading
            loading={members.loading && !members.data}
            error={members.error}
            onRetry={members.reload}
            shape="rows"
          />
          {members.data && (
            <Section
              region="Membres de l’équipe"
              label="Membres"
              title={`${active} actif(s) sur ${members.data.total}`}
            >
              <div role="list" className="flex flex-col border-t border-separator pt-4">
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

        <Section
          region="Ajouter un membre"
          label="Nouveau membre"
          title="Ajouter un membre"
          intro="Trois rôles : Administrateur (accès complet), Conseiller (file, conversations, prospects), Observateur (consultation seule)."
          className="order-1 xl:sticky xl:top-24 xl:order-2"
        >
          <form onSubmit={create} className="flex flex-col gap-4 border-t border-separator pt-4">
            <Field label="Nom d’utilisateur" hint="3 caractères minimum.">
              <TextInput value={username} minLength={3} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="Email" hint="Sert aussi d’identifiant de connexion.">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Rôle">
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} — {ROLE_HELP[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ActionsBar className="border-t border-separator pt-4">
              <Btn variant="primary" type="submit" disabled={busy || username.trim().length < 3 || !email}>
                <UserPlus className="size-4" aria-hidden="true" />
                Créer le membre
              </Btn>
            </ActionsBar>
            <Feedback error={error} />
          </form>
        </Section>
      </div>
    </Screen>
  );
}
