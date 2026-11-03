"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, readThemePreference, saveThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Clair", icon: Sun },
  { id: "dark", label: "Sombre", icon: Moon },
  { id: "system", label: "Système", icon: Monitor },
];

/** Préférence de thème du navigateur ; « Système » suit le réglage de l'appareil, même quand il change. */
export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  useEffect(() => setPreference(readThemePreference()), []);
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [preference]);
  const choose = (next: ThemePreference) => {
    setPreference(next);
    saveThemePreference(next);
  };
  return [preference, choose] as const;
}

/** Choix du thème : `ToggleButtonGroup` HeroUI à sélection unique, trois boutons icônes nommés. */
export default function ThemeSwitcher() {
  const [preference, choose] = useThemePreference();
  return (
    <ToggleButtonGroup
      aria-label="Thème"
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[preference]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next) choose(next as ThemePreference);
      }}
    >
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <ToggleButton key={id} id={id} isIconOnly aria-label={label}>
          <Icon className="size-4" aria-hidden="true" />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
