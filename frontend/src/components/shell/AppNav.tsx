"use client";

import { Chip, Disclosure, Link, ScrollShadow, Tooltip } from "@heroui/react";
import { ChevronDown, CircleDashed } from "lucide-react";
import { SCROLL_SHADOW_SIZE } from "@/components/ds/layout";
import { UPCOMING, type NavGroup } from "./navigation";

/**
 * Liens du menu. Réduit (bureau), il ne montre que les icônes : l'intitulé passe en infobulle HeroUI et reste le
 * nom accessible du lien. Le menu défile dans un `ScrollShadow` quand il dépasse la hauteur de l'écran.
 */
export default function AppNav({
  groups,
  pathname,
  inSimulator,
  waiting,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  inSimulator: boolean;
  waiting: number | null;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ScrollShadow size={SCROLL_SHADOW_SIZE} hideScrollBar className="-mx-1 min-h-0 flex-1 px-1">
      <nav aria-label="Navigation principale" className="flex flex-col gap-4">
        {groups.map((group, index) => (
          <div key={group.name} role="group" aria-label={group.name} className="flex flex-col gap-0.5">
            {collapsed ? (
              index > 0 && <span className="mx-2 mb-1 border-t border-separator" aria-hidden="true" />
            ) : (
              <p className="px-2 pb-1 text-xs tracking-[0.06em] text-muted uppercase">{group.name}</p>
            )}
            {group.items.map((item) => {
              if (!item.href) return null;
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(`${item.href}/`)) ||
                (item.href === "/settings" && inSimulator);
              const Icon = item.icon;
              const count = item.badge && waiting ? waiting : 0;
              return (
                <Tooltip key={item.href} isDisabled={!collapsed} delay={200} closeDelay={0}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? `${item.label}${count ? `, ${count} en attente` : ""}` : undefined}
                    onPress={onNavigate}
                    className={`relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-normal no-underline transition-colors duration-150 hover:no-underline ${
                      collapsed ? "justify-center" : ""
                    } ${active ? "bg-accent-soft font-medium text-accent-soft-foreground" : "text-foreground hover:bg-surface-secondary"}`}
                  >
                    {Icon && <Icon className={`size-4 shrink-0 ${active ? "text-accent" : "text-muted"}`} aria-hidden="true" />}
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {count > 0 &&
                      (collapsed ? (
                        <span className="absolute top-1 right-1.5 size-2 rounded-full bg-warning" aria-hidden="true" />
                      ) : (
                        <Chip size="sm" variant={active ? "primary" : "soft"} color={active ? "accent" : "warning"} aria-label={`${count} en attente`}>
                          <Chip.Label>{count}</Chip.Label>
                        </Chip>
                      ))}
                  </Link>
                  <Tooltip.Content placement="right" showArrow>
                    <Tooltip.Arrow />
                    {item.label}
                    {count ? ` · ${count} en attente` : ""}
                  </Tooltip.Content>
                </Tooltip>
              );
            })}
          </div>
        ))}
        {!collapsed && UPCOMING.length > 0 && (
          <Disclosure className="border-t border-separator pt-2">
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus">
                <span className="flex-1 text-left">À venir</span>
                <Chip size="sm" variant="soft">
                  <Chip.Label>{UPCOMING.length}</Chip.Label>
                </Chip>
                <Disclosure.Indicator>
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </Disclosure.Indicator>
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body>
                <ul aria-label="Écrans prévus, pas encore disponibles" className="flex flex-col gap-0.5 py-1">
                  {UPCOMING.map((item) => (
                    <li key={item.label} className="flex h-8 items-center gap-2.5 px-2 text-sm text-muted">
                      <CircleDashed className="size-4" aria-hidden="true" />
                      <span>{item.label}</span>
                      <span className="ms-auto text-[11px]" aria-hidden="true">
                        Bientôt
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        )}
      </nav>
    </ScrollShadow>
  );
}
