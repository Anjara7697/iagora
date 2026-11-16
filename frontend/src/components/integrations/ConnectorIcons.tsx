import type { ReactNode } from "react";

/** Pictogrammes génériques (trait, 24 px) : pas de logos de marque, seulement l'idée du service. */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ICONS: Record<string, () => ReactNode> = {
  mail: () => (
    <Svg>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7.5 8 6 8-6" />
    </Svg>
  ),
  calendar: () => (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="m9.5 15 1.8 1.8L15 13" />
    </Svg>
  ),
  video: () => (
    <Svg>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="m15.5 11 5-3v8l-5-3" />
    </Svg>
  ),
  plug: () => (
    <Svg>
      <path d="M9 3v4M15 3v4" />
      <path d="M6.5 7h11v3a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 15.5V21" />
    </Svg>
  ),
  upload: () => (
    <Svg>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Svg>
  ),
  chat: () => (
    <Svg>
      <path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12z" />
      <path d="M9 11h6M9 14h3.5" />
    </Svg>
  ),
  users: () => (
    <Svg>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6a3 3 0 0 1 0 5.8M17.5 14a5.5 5.5 0 0 1 3 5" />
    </Svg>
  ),
};

export function ConnectorIcon({ name }: { name: string }) {
  const icon = ICONS[name] ?? ICONS.plug;
  return <>{icon()}</>;
}
