"use client";

import { Button, Description, Header, Kbd, Label, ListBox, Modal } from "@heroui/react";
import { ArrowRight, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type Command = {
  id: string;
  label: string;
  group: string;
  href: string;
  icon: LucideIcon;
  hint?: string;
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Palette ⌘K / Ctrl K : aller à une page, lancer une action ou chercher un prospect.
 * Ouverte depuis le bouton « Rechercher… » du menu ou par le raccourci, n'importe où.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const query = q.trim();
  const items: Command[] = [
    ...(query
      ? [
          {
            id: "search",
            label: `Rechercher « ${query} » dans les prospects`,
            group: "Prospects",
            href: `/prospects?q=${encodeURIComponent(query)}`,
            icon: Search,
          },
        ]
      : []),
    ...commands.filter((c) => norm(`${c.label} ${c.hint ?? ""}`).includes(norm(query))),
  ];
  const groups = [...new Set(items.map((i) => i.group))];

  function go(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setOpen(false);
    setQ("");
    router.push(item.href);
  }

  return (
    <>
      <Button
        variant="tertiary"
        className="w-full justify-start gap-2 font-normal text-muted"
        onPress={() => setOpen(true)}
        aria-label="Ouvrir la recherche rapide (Ctrl K)"
      >
        <Search className="size-4" aria-hidden="true" />
        Rechercher…
        <span className="flex-1" />
        <Kbd variant="light" aria-hidden="true">
          <Kbd.Abbr keyValue="command" />
          <Kbd.Content>K</Kbd.Content>
        </Kbd>
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container placement="top">
          <Modal.Dialog aria-label="Recherche rapide" className="mt-[10vh] overflow-hidden p-0 sm:max-w-[560px]">
            <div className="flex items-center gap-2 border-b border-separator px-4 py-3">
              <Search className="size-4 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && items[0]) {
                    e.preventDefault();
                    go(items[0].id);
                  }
                }}
                placeholder="Rechercher un prospect, une page, une action…"
                aria-label="Recherche rapide"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
              />
              <Kbd variant="light" aria-hidden="true">
                <Kbd.Content>Échap</Kbd.Content>
              </Kbd>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Aucun résultat pour « {query} »</p>
            ) : (
              <ListBox
                aria-label="Résultats"
                selectionMode="none"
                className="max-h-[360px] overflow-auto p-2"
                onAction={(k) => go(String(k))}
              >
                {groups.map((g) => (
                  <ListBox.Section key={g}>
                    <Header>{g}</Header>
                    {items
                      .filter((i) => i.group === g)
                      .map((c) => (
                        <ListBox.Item key={c.id} id={c.id} textValue={c.label}>
                          <c.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                          <div className="flex min-w-0 flex-col">
                            <Label>{c.label}</Label>
                            {c.hint && <Description>{c.hint}</Description>}
                          </div>
                          <ArrowRight className="ms-auto size-4 text-muted" aria-hidden="true" />
                        </ListBox.Item>
                      ))}
                  </ListBox.Section>
                ))}
              </ListBox>
            )}
            <div className="flex items-center gap-3 border-t border-separator px-4 py-2 text-xs text-muted">
              <span>↑↓ pour naviguer</span>
              <span>↵ pour ouvrir</span>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
