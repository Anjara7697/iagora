"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eyebrow } from "./ds/layout";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Panneau latéral modal : Échap et clic sur le voile ferment, le focus reste dans le panneau et
 *  revient à l'élément qui l'a ouvert, le défilement de la page est bloqué. */
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
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !panel.current.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div>
      <div
        className="fixed inset-0 z-[60] bg-foreground/30 backdrop-blur-[2px] animate-in fade-in-0 duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-[640px] flex-col bg-background shadow-overlay animate-in slide-in-from-right-8 duration-200 sm:rounded-l-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center gap-3 border-b border-separator bg-surface px-5 py-4 sm:rounded-tl-3xl">
          {icon && (
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-foreground [&_svg]:size-5">
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
          </div>
          {aside}
          <button
            ref={closeButton}
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted outline-none transition-colors hover:bg-default hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
