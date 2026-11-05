"use client";

import { AlertDialog, Button } from "@heroui/react";
import type { ReactElement, ReactNode } from "react";

type ConfirmProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  status?: "default" | "accent" | "success" | "warning" | "danger";
  onConfirm: () => void;
  /** Contenu sous la description (ex. un champ « Motif » à remplir avant de confirmer). */
  children?: ReactNode;
  /** Bouton de confirmation inactif tant que le contenu n'est pas valide. */
  confirmDisabled?: boolean;
};

/**
 * Confirmation d'une action sensible : `AlertDialog` HeroUI. `onConfirm` n'est appelé qu'après le clic sur le
 * bouton de confirmation ; Annuler et un clic sur le voile ferment sans rien faire.
 * - avec `trigger` : le bouton qui l'ouvre ;
 * - sans `trigger` : ouverture pilotée par `isOpen` et `onOpenChange` (ex. confirmation avant de quitter une saisie).
 * `children` ajoute un contenu sous la description (un champ à remplir), `confirmDisabled` bloque la confirmation.
 */
export function ConfirmDialog({
  trigger,
  isOpen,
  onOpenChange,
  ...content
}: ConfirmProps & { trigger?: ReactElement; isOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  if (!trigger) return <ConfirmBackdrop {...content} isOpen={isOpen ?? false} onOpenChange={onOpenChange} />;
  return (
    <AlertDialog>
      {trigger}
      <ConfirmBackdrop {...content} />
    </AlertDialog>
  );
}

function ConfirmBackdrop({
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  status = "danger",
  onConfirm,
  children,
  confirmDisabled = false,
  isOpen,
  onOpenChange,
}: ConfirmProps & { isOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <AlertDialog.Backdrop isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[420px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status={status} />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{description}</p>
            {children}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              {cancelLabel}
            </Button>
            <Button
              slot="close"
              variant={status === "danger" ? "danger" : "primary"}
              isDisabled={confirmDisabled}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
