"use client";

import { Disclosure } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./layout";

/**
 * Zone repliable HeroUI (`Disclosure`) : un titre cliquable, un chevron, un contenu.
 * `open`/`onOpenChange` pour la piloter ; `triggerProps` pour des attributs `data-*` de test.
 */
export function Collapse({
  title,
  icon,
  open,
  defaultOpen,
  onOpenChange,
  className,
  triggerClassName,
  bodyClassName,
  triggerProps,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  triggerClassName?: string;
  bodyClassName?: string;
  triggerProps?: Record<`data-${string}`, string | number>;
  children: ReactNode;
}) {
  return (
    <Disclosure
      isExpanded={open}
      defaultExpanded={defaultOpen}
      onExpandedChange={onOpenChange}
      className={className}
    >
      <Disclosure.Heading>
        <Disclosure.Trigger
          {...(triggerProps as ComponentProps<typeof Disclosure.Trigger>)}
          className={cx(
            "flex cursor-pointer items-center gap-2 rounded-lg text-left type-body-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus",
            triggerClassName,
          )}
        >
          {icon}
          <span className="min-w-0 flex-1">{title}</span>
          <Disclosure.Indicator>
            <ChevronDown className="size-4 text-muted" aria-hidden="true" />
          </Disclosure.Indicator>
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className={bodyClassName}>{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
