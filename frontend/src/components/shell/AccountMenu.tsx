"use client";

import { Avatar, Button, Popover, Separator } from "@heroui/react";
import { ChevronDown, LogOut, Monitor, UserRound } from "lucide-react";
import { useState } from "react";
import { AGENT_COPY, AgentDot, useAgentControl } from "@/components/AgentStatus";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { LinkButton } from "@/components/ds/controls";
import { useHasUnsentReplies } from "@/components/ReplyDrafts";
import type { User } from "@/lib/types";
import ThemeSwitcher from "./ThemeSwitcher";

const ROLE_LABELS = { ADMIN: "Administrateur", ADVISOR: "Conseiller", VIEWER: "Observateur" };

export const displayNameOf = (username: string) =>
  username
    .split("@")[0]
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

const initialsOf = (name: string) => {
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map((p) => p[0]).join("") : name.slice(0, 2)).toUpperCase();
};

/** Ligne du menu : même hauteur, rayon et survol que les liens du menu latéral ; icônes sans la marge négative
 *  des boutons HeroUI (`mx-0`), pour s'aligner sur les lignes Agent et Thème. */
const ROW = "h-9 w-full justify-start gap-3 rounded-lg px-2 text-sm font-normal";

/**
 * Menu du compte (Popover HeroUI : il contient des contrôles, pas seulement des actions). Identité, Mon compte,
 * état et contrôle de l'agent, thème, Déconnexion. Le point sur l'avatar rappelle l'état de l'agent depuis la
 * barre ; la déconnexion avec des réponses non envoyées demande confirmation.
 */
export default function AccountMenu({
  user,
  refreshKey,
  showAgent,
  onLogout,
}: {
  user: User;
  refreshKey: string;
  /** Faux tant que le mot de passe temporaire n'est pas changé. */
  showAgent: boolean;
  onLogout: () => void;
}) {
  const hasUnsentReplies = useHasUnsentReplies();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const agent = useAgentControl({ refreshKey, readOnly: user.role === "VIEWER", onAsk: () => setOpen(false) });
  const name = displayNameOf(user.username);
  const mode = showAgent ? agent.mode : null;

  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          className="h-10 shrink-0 gap-2 px-1.5 sm:px-2"
        >
          {/* Nom accessible tiré du contenu (WCAG 2.5.3) : nom et rôle (lus aussi sur mobile, où ils ne sont pas
              affichés), puis ce que le bouton ouvre et l'état de l'agent, lus seulement. */}
          <span className="relative inline-flex" aria-hidden="true">
            <Avatar size="sm" variant="soft" color="accent">
              <Avatar.Fallback>{initialsOf(user.username)}</Avatar.Fallback>
            </Avatar>
            {mode && (
              <span className="absolute -right-0.5 -bottom-0.5 inline-flex rounded-full bg-surface p-0.5">
                <AgentDot mode={mode} />
              </span>
            )}
          </span>
          <span className="flex-col items-start leading-tight max-sm:sr-only sm:flex">
            <span className="text-sm font-medium text-foreground">{name}</span>
            <span className="sr-only"> </span>
            <span className="text-xs font-normal text-muted">{ROLE_LABELS[user.role]}</span>
          </span>
          <span className="sr-only">
            {` — Menu du compte${mode ? ` — agent : ${AGENT_COPY[mode].short.toLowerCase()}` : ""}`}
          </span>
          <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden="true" />
        </Button>
        <Popover.Content placement="bottom end" offset={8} className="w-[300px]">
          <Popover.Dialog aria-label="Menu du compte" className="flex flex-col p-2">
            <div className="flex items-center gap-3 px-2 pt-1.5 pb-2.5">
              <Avatar size="md" variant="soft" color="accent">
                <Avatar.Fallback>{initialsOf(user.username)}</Avatar.Fallback>
              </Avatar>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                <span className="truncate text-xs text-muted">{user.email}</span>
              </span>
            </div>
            <Separator className="my-1" />
            <LinkButton
              href="/account"
              variant="ghost"
              className={ROW}
              onClick={() => setOpen(false)}
            >
              <UserRound className="mx-0 size-4 text-muted" aria-hidden="true" />
              Mon compte
            </LinkButton>
            {showAgent && agent.row}
            <div className="flex h-11 items-center gap-3 px-2">
              <Monitor className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="flex-1 text-sm text-foreground" aria-hidden="true">Thème</span>
              <ThemeSwitcher />
            </div>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              className={`${ROW} text-danger hover:bg-danger-soft`}
              onPress={() => {
                setOpen(false);
                // Des réponses non envoyées seraient effacées : confirmation HeroUI d'abord.
                if (hasUnsentReplies()) setConfirmLogout(true);
                else onLogout();
              }}
            >
              <LogOut className="mx-0 size-4" aria-hidden="true" />
              Déconnexion
            </Button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      {agent.dialog}
      <ConfirmDialog
        isOpen={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Se déconnecter ?"
        description="Vous avez des réponses non envoyées : la déconnexion les efface."
        cancelLabel="Rester connecté"
        confirmLabel="Se déconnecter"
        onConfirm={onLogout}
      />
    </>
  );
}
