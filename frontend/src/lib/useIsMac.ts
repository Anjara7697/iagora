"use client";

import { useEffect, useState } from "react";

/** Mac ou iOS : la touche de commande s'affiche ⌘ au lieu de Ctrl. Lu après le rendu serveur (pas d'écart d'hydratation). */
export function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return mac;
}
