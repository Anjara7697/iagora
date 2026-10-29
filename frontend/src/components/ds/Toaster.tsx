"use client";

import { Toast } from "@heroui/react";

/** Zone des notifications (toasts), montée une seule fois à la racine : en bas à droite. */
export function Toaster() {
  return <Toast.Provider placement="bottom end" />;
}
