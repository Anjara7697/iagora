"use client";

import { AlertDialog, Button } from "@heroui/react";
import type { ReactElement, ReactNode } from "react";

/**
 * Confirmation d'une action sensible : `AlertDialog` HeroUI. `trigger` est le bouton qui l'ouvre ;
 * `onConfirm` n'est appelé qu'après le clic sur le bouton de confirmation (Annuler et Échap ferment sans rien faire).
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  status = "danger",
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  status?: "default" | "accent" | "success" | "warning" | "danger";
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      {trigger}
      <AlertDialog.Backdrop isDismissable>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status={status} />
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{description}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {cancelLabel}
              </Button>
              <Button slot="close" variant={status === "danger" ? "danger" : "primary"} onPress={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
