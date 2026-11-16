"use client";

import { Kbd, Tooltip } from "@heroui/react";
import type { ReactNode } from "react";
import type { ShortcutKey } from "@/lib/shortcuts";
import { useIsMac } from "@/lib/useIsMac";

/** Touches d'un raccourci (`Kbd` HeroUI), décoratives : le nom accessible est porté par `aria-keyshortcuts`. */
export function ShortcutKbd({ shortcut, className }: { shortcut: ShortcutKey; className?: string }) {
  const mac = useIsMac();
  return (
    <Kbd variant="light" aria-hidden="true" className={className}>
      {shortcut.mod && (mac ? <Kbd.Abbr keyValue="command" /> : <Kbd.Content>Ctrl</Kbd.Content>)}
      {shortcut.key === "Enter" ? <Kbd.Abbr keyValue="enter" /> : <Kbd.Content>{shortcut.key.toUpperCase()}</Kbd.Content>}
    </Kbd>
  );
}

/** Infobulle d'un bouton qui a un raccourci : l'intitulé et les touches, au survol et au focus clavier. */
export function ShortcutTooltip({
  label,
  shortcut,
  disabled,
  children,
}: {
  label: string;
  shortcut: ShortcutKey;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip isDisabled={disabled} delay={500} closeDelay={0}>
      {children}
      <Tooltip.Content showArrow className="flex items-center gap-2">
        <Tooltip.Arrow />
        {label}
        <ShortcutKbd shortcut={shortcut} />
      </Tooltip.Content>
    </Tooltip>
  );
}
