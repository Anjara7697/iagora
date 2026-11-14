"use client";

import { buttonVariants, toast, Tooltip } from "@heroui/react";
import { KeyRound, UserPlus, UsersRound } from "lucide-react";
import { useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Drawer } from "@/components/Drawer";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, Field, SelectBox, Tag, TextInput } from "@/components/ds/controls";
import { SecretOnce } from "@/components/ds/settings";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { CreatedUser, Role, User } from "@/lib/types";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  ADVISOR: "Conseiller",
  VIEWER: "Observateur",
};
const ROLE_HELP: Record<Role, string> = {
  ADMIN: "accès complet, dont Équipe, Intégrations et Paramètres",
  ADVISOR: "file, conversations, prospects, validations",
  VIEWER: "consultation seule",
};
const ROLES = Object.keys(ROLE_LABELS) as Role[];

export type Secret = { who: string; password: string };

export function memberState(member: User) {
  if (!member.is_active) return { label: "Désactivé", tone: "neutral" as const };
  if (member.must_change_password) return { label: "Mot de passe à choisir", tone: "warning" as const };
  return { label: "Actif", tone: "success" as const };
}

const failure = (what: string, e: unknown) => `${what}${e instanceof ApiError ? ` : ${e.message}` : "."}`;

/** Mot de passe temporaire affiché une seule fois, à transmettre par un canal sûr. */
export function TemporaryPassword({ secret, onDone }: { secret: Secret; onDone: () => void }) {
  return (
    <SecretOnce
      label="Mot de passe temporaire"
      intro={
        <>
          Mot de passe temporaire de <strong>{secret.who}</strong>, à transmettre par un canal sûr :
        </>
      }
      secret={secret.password}
      doneLabel="J’ai transmis le mot de passe"
      onDone={onDone}
    />
  );
}

/** Action impossible : visible, désactivée, avec sa raison en infobulle (règle 14). */
function Blocked({ reason, children, variant = "ghost" }: { reason: string; children: ReactNode; variant?: "ghost" | "danger-soft" | "outline" }) {
  return (
    <Tooltip delay={200}>
      {/* Désactivé mais focalisable (aria-disabled) : la raison reste lisible au survol et au clavier. */}
      <Tooltip.Trigger
        tabIndex={0}
        aria-disabled="true"
        className={buttonVariants({ variant, size: "sm", className: "pointer-events-auto! inline-flex cursor-not-allowed flex-row items-center gap-1.5 whitespace-nowrap rounded-lg opacity-60" })}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content showArrow className="max-w-64 break-normal">
        <Tooltip.Arrow />
        {reason}
      </Tooltip.Content>
    </Tooltip>
  );
}

/** Création d'un membre : panneau latéral (règle 1). */
export function CreateMemberPanel({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ADVISOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = username !== "" || email !== "" || role !== "ADVISOR";
  const { guard, dialog } = useDiscardGuard(() => open && dirty);
  const reset = () => {
    setUsername("");
    setEmail("");
    setRole("ADVISOR");
    setError(null);
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<CreatedUser>("/users", { method: "POST", body: { username, email, role } });
      reset();
      toast.success("Membre ajouté", { description: `${created.username} peut se connecter avec son mot de passe temporaire.` });
      onCreated(created);
    } catch (err) {
      setError(failure("Création du membre impossible", err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <Drawer
        open={open}
        onClose={() => guard(() => { reset(); onClose(); })}
        eyebrow="Nouveau membre"
        title="Ajouter un membre"
        icon={<UsersRound aria-hidden="true" />}
      >
        <form onSubmit={create} className="flex flex-col gap-4">
          <p className="text-[13px]/[20px] text-muted">
            Le nouveau membre reçoit un mot de passe temporaire et choisit le sien à la première connexion.
          </p>
          <Field label="Nom d’utilisateur" hint="3 caractères minimum.">
            <TextInput value={username} minLength={3} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Email" hint="Sert aussi d’identifiant de connexion.">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Rôle">
            <SelectBox value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} — {ROLE_HELP[r]}
                </option>
              ))}
            </SelectBox>
          </Field>
          <div className="flex flex-wrap gap-2 border-t border-separator pt-4">
            <Btn variant="primary" type="submit" disabled={busy || username.trim().length < 3 || !email}>
              <UserPlus className="size-4" aria-hidden="true" />
              Créer le membre
            </Btn>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Drawer>
    </>
  );
}

/** Fiche d'un membre : modification et accès, dans un panneau latéral (règles 1 et 2). */
export function MemberPanel({
  member,
  self,
  secret,
  onClose,
  onChanged,
  onPassword,
  onSecretDone,
}: {
  member: User | null;
  self: boolean;
  secret: Secret | null;
  onClose: () => void;
  onChanged: () => void;
  onPassword: (secret: Secret) => void;
  onSecretDone: () => void;
}) {
  // Une saisie en cours n'est pas perdue en fermant le panneau (règle 14).
  const dirty = useRef(false);
  const { guard, dialog } = useDiscardGuard(() => member !== null && dirty.current);
  return (
    <>
    {dialog}
    <Drawer
      open={member !== null}
      onClose={() => guard(onClose)}
      eyebrow="Membre"
      title={member?.username ?? ""}
      icon={<UsersRound aria-hidden="true" />}
    >
      {member && (
        <MemberForm
          // Un autre membre ou une donnée rechargée repart des valeurs enregistrées.
          key={`${member.id}-${member.username}-${member.email}-${member.role}-${member.is_active}`}
          member={member}
          self={self}
          secret={secret?.who === member.username ? secret : null}
          dirtyRef={dirty}
          onChanged={onChanged}
          onPassword={onPassword}
          onSecretDone={onSecretDone}
        />
      )}
    </Drawer>
    </>
  );
}

function MemberForm({
  member,
  self,
  secret,
  dirtyRef,
  onChanged,
  onPassword,
  onSecretDone,
}: {
  member: User;
  self: boolean;
  secret: Secret | null;
  dirtyRef: MutableRefObject<boolean>;
  onChanged: () => void;
  onPassword: (secret: Secret) => void;
  onSecretDone: () => void;
}) {
  const [username, setUsername] = useState(member.username);
  const [email, setEmail] = useState(member.email);
  const [role, setRole] = useState<Role>(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes: Record<string, unknown> = {};
  if (username !== member.username) changes.username = username;
  if (email !== member.email) changes.email = email;
  if (role !== member.role) changes.role = role;
  const dirty = Object.keys(changes).length > 0;
  dirtyRef.current = dirty;
  const state = memberState(member);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(failure(what, e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run("Enregistrement impossible", async () => {
      await api(`/users/${member.id}`, { method: "PATCH", body: changes });
      toast.success("Membre mis à jour", { description: `Les informations de ${username} sont enregistrées.` });
      onChanged();
    });
  const resetPassword = () =>
    run("Réinitialisation impossible", async () => {
      const r = await api<{ temporary_password: string }>(`/users/${member.id}/reset-password`, { method: "POST" });
      onPassword({ who: member.username, password: r.temporary_password });
      toast.success("Mot de passe réinitialisé", { description: "Transmettez le mot de passe temporaire par un canal sûr." });
      onChanged();
    });
  const setActive = (active: boolean) =>
    run(active ? "Réactivation impossible" : "Désactivation impossible", async () => {
      await api(`/users/${member.id}`, { method: "PATCH", body: { is_active: active } });
      toast.success(active ? "Membre réactivé" : "Membre désactivé", {
        description: active ? `${member.username} peut de nouveau se connecter.` : `${member.username} ne peut plus se connecter.`,
      });
      onChanged();
    });

  return (
    <div className="flex flex-col gap-6">
      {secret && <TemporaryPassword secret={secret} onDone={onSecretDone} />}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Tag tone={state.tone}>{state.label}</Tag>
        <span>Membre depuis le {formatDate(member.created_at ?? null)}</span>
        {self && <span>· votre compte</span>}
      </div>

      <form
        aria-label="Informations du membre"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Nom d’utilisateur">
          <TextInput value={username} minLength={3} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Rôle" hint={self ? "Vous ne pouvez pas modifier votre propre rôle." : ROLE_HELP[role]}>
          <SelectBox value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectBox>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" type="submit" disabled={busy || !dirty || username.trim().length < 3 || !email}>
            Enregistrer
          </Btn>
        </div>
      </form>

      <section aria-label="Accès" className="flex flex-col gap-3 border-t border-separator pt-4">
        <h3 className="text-sm font-semibold text-foreground">Accès</h3>
        <div className="flex flex-wrap gap-2">
          {self ? (
            <>
              <Blocked reason="Changez votre propre mot de passe depuis « Mon compte »." variant="outline">
                <KeyRound className="size-3.5" aria-hidden="true" />
                Réinitialiser le mot de passe
              </Blocked>
              <Blocked reason="Vous ne pouvez pas désactiver votre propre compte." variant="danger-soft">
                Désactiver
              </Blocked>
            </>
          ) : (
            <>
              <ConfirmDialog
                trigger={
                  <Btn size="sm" variant="outline" disabled={busy}>
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    Réinitialiser le mot de passe
                  </Btn>
                }
                title={`Réinitialiser le mot de passe de ${member.username} ?`}
                description="Ses sessions ouvertes seront fermées. Un mot de passe temporaire s’affichera une seule fois : il choisira le sien à la prochaine connexion."
                confirmLabel="Réinitialiser"
                status="warning"
                onConfirm={() => void resetPassword()}
              />
              {member.is_active ? (
                <ConfirmDialog
                  trigger={
                    <Btn size="sm" variant="danger-soft" disabled={busy}>
                      Désactiver
                    </Btn>
                  }
                  title={`Désactiver ${member.username} ?`}
                  description="Il ne pourra plus se connecter ni utiliser la console. Les rendez-vous de ses prospects iront au responsable de leur campagne (sinon à l’agenda par défaut, sinon un conseiller est prévenu). Son historique est conservé et vous pourrez le réactiver."
                  confirmLabel="Désactiver"
                  onConfirm={() => void setActive(false)}
                />
              ) : (
                <ConfirmDialog
                  trigger={
                    <Btn size="sm" variant="outline" disabled={busy}>
                      Réactiver
                    </Btn>
                  }
                  title={`Réactiver ${member.username} ?`}
                  description={`Il pourra de nouveau se connecter avec le rôle ${ROLE_LABELS[member.role]}.`}
                  confirmLabel="Réactiver"
                  status="accent"
                  onConfirm={() => void setActive(true)}
                />
              )}
            </>
          )}
        </div>
      </section>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
