"use client";

import { Button, Drawer as HeroDrawer } from "@heroui/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Eyebrow } from "./ds/layout";

/**
 * Panneau latéral (règle 2) sur le `Drawer` HeroUI (ARCH-03, A11Y-02) : piège à focus, reste de la page inerte, Échap
 * et clic sur le voile, retour du focus à l'élément qui l'a ouvert, empilement correct d'une confirmation ouverte
 * par-dessus (« Abandonner les modifications ? ») sont assurés par React Aria.
 * Le panneau est piloté : Échap, le voile et « Fermer » appellent `onClose`, qui peut refuser de fermer (garde de
 * saisie) ; il reste alors ouvert.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  icon,
  aside,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <HeroDrawer.Backdrop
      isOpen={open}
      isDismissable
      variant="opaque"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <HeroDrawer.Content placement="right">
        <HeroDrawer.Dialog aria-label={title} className="w-full max-w-[640px] gap-0 bg-background p-0 sm:w-[640px]">
          <HeroDrawer.Header className="flex flex-row items-center gap-3 border-b border-separator bg-surface px-5 py-4">
            {icon && (
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground [&_svg]:size-5">
                {icon}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
              <HeroDrawer.Heading level={2} className="truncate type-title-sm font-semibold text-foreground">
                {title}
              </HeroDrawer.Heading>
            </div>
            {aside}
            <Button autoFocus variant="ghost" isIconOnly className="text-muted" onPress={onClose} aria-label="Fermer">
              <X className="size-5" aria-hidden="true" />
            </Button>
          </HeroDrawer.Header>
          <HeroDrawer.Body className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</HeroDrawer.Body>
        </HeroDrawer.Dialog>
      </HeroDrawer.Content>
    </HeroDrawer.Backdrop>
  );
}
