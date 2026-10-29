"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="drawer-head">
          {icon && <span className="connector-icon">{icon}</span>}
          <div className="drawer-title">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          {aside}
          <button
            ref={closeButton}
            className="drawer-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
