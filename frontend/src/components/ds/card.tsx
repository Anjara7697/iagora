"use client";

import { Card } from "@heroui/react";
import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

type BoxProps<T extends ElementType> = {
  /** Variante du `Card` HeroUI (`default`, `secondary`, `tertiary`, `transparent`). */
  variant?: ComponentPropsWithoutRef<typeof Card>["variant"];
  /** Élément rendu (`section`, `aside`, `header`, `form`…) : le sens de la page reste celui de l'élément. */
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/**
 * Carte HeroUI (`Card`) rendue dans l'élément voulu. Les paddings et espacements se règlent
 * avec `className` (`gap-4 p-5`, `p-0`…) ; la carte ne porte aucun padding par défaut ici.
 */
export function Box<T extends ElementType = "div">({ as, variant, className, children, ...rest }: BoxProps<T>) {
  const tag = (as ?? "div") as ElementType;
  return (
    <Card
      variant={variant}
      className={className}
      render={(props) => createElement(tag, props as Record<string, unknown>)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Card>
  );
}

export { Card };
