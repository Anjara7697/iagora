"use client";

import { Avatar, AvatarGroup } from "@heroui/react";
import { Globe, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { label as labelOf, PLATFORMS } from "@/lib/labels";

/*
 * Logos officiels des plateformes (tracés du projet Simple Icons, licence CC0 ; les marques restent
 * la propriété de leurs détenteurs). Site web et email : pictogrammes génériques.
 */
const LINKEDIN =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";
const META =
  "M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z";

function Brand({ path, color }: { path: string; color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4/5" fill={color} aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

const LOGOS: Record<string, () => ReactNode> = {
  linkedin: () => <Brand path={LINKEDIN} color="#0A66C2" />,
  meta: () => <Brand path={META} color="#0467DF" />,
  web: () => <Globe className="size-3/5" aria-hidden="true" />,
  email: () => <Mail className="size-3/5" aria-hidden="true" />,
};

/** Avatar HeroUI d'une plateforme de source (logo officiel, ou pictogramme pour site web et email). Fond blanc et
 *  pictogramme sombre fixes, quel que soit le thème : les logos officiels sont prévus sur fond clair. */
export function SourceAvatar({ platform, name }: { platform: string | null | undefined; name?: string }) {
  const logo = LOGOS[platform ?? ""];
  return (
    <Avatar size="sm" title={name ?? labelOf(PLATFORMS, platform)}>
      <Avatar.Fallback className="bg-white text-zinc-900">{logo ? logo() : "•"}</Avatar.Fallback>
    </Avatar>
  );
}

/** Pile d'avatars des sources d'une campagne (`AvatarGroup` HeroUI, au plus `max` visibles). */
export function SourceAvatars({
  sources,
  max = 3,
}: {
  sources: { id: number | string; name: string; platform?: string | null }[];
  max?: number;
}) {
  return (
    <AvatarGroup size="sm" max={max} aria-hidden="true">
      {sources.map((s) => (
        <SourceAvatar key={s.id} platform={s.platform} name={s.name} />
      ))}
    </AvatarGroup>
  );
}
