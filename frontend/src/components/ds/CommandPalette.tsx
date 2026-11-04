"use client";

import { Button, Description, Header, Kbd, Label, ListBox, Modal, ScrollShadow, SearchField } from "@heroui/react";
import { ArrowRight, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SCROLL_SHADOW_SIZE } from "./layout";

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
 * Palette ⌘K / Ctrl K : aller à une page, lancer une action ou chercher un prospect. Seule recherche de la
 * console : son déclencheur a l'allure d'un champ dans la barre du haut (une icône sur mobile), et le raccourci
 * l'ouvre de n'importe où.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Touche affichée selon le système (lue après le rendu serveur pour éviter un écart d'hydratation).
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  const shortcut = mac ? "⌘ K" : "Ctrl K";

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
      {/* Un seul déclencheur : icône sur mobile, allure de champ (texte et raccourci) à partir de md. */}
      <Button
        variant="tertiary"
        className="w-10 justify-center gap-2 px-0 font-normal text-muted md:w-full md:justify-start md:px-3"
        onPress={() => setOpen(true)}
        aria-label={`Rechercher un prospect, une page ou une action (${shortcut})`}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden md:inline xl:hidden">Rechercher…</span>
        <span className="hidden xl:inline">Rechercher un prospect, une page…</span>
        <span className="hidden flex-1 md:block" />
        <Kbd variant="light" aria-hidden="true" className="hidden md:inline-flex">
          {mac ? <Kbd.Abbr keyValue="command" /> : <Kbd.Content>Ctrl</Kbd.Content>}
          <Kbd.Content>K</Kbd.Content>
        </Kbd>
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container placement="top">
          <Modal.Dialog aria-label="Recherche rapide" className="mt-[10vh] overflow-hidden p-0 sm:max-w-[560px]">
            <div className="flex items-center gap-2 border-b border-separator px-2 py-2">
              <SearchField
                aria-label="Recherche rapide"
                className="min-w-0 flex-1"
                value={q}
                onChange={setQ}
                onSubmit={() => {
                  if (items[0]) go(items[0].id);
                }}
              >
                <SearchField.Group className="border-0 bg-transparent shadow-none">
                  <SearchField.SearchIcon />
                  <SearchField.Input autoFocus placeholder="Rechercher un prospect, une page, une action…" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Kbd variant="light" aria-hidden="true">
                <Kbd.Content>Échap</Kbd.Content>
              </Kbd>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Aucun résultat pour « {query} »</p>
            ) : (
              // Résultats : défilement dans un ScrollShadow (fondu quand il reste des résultats au-dessus ou en dessous).
              <ScrollShadow orientation="vertical" size={SCROLL_SHADOW_SIZE} className="max-h-[360px]">
                <ListBox
                  aria-label="Résultats"
                  selectionMode="none"
                  className="p-2"
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
              </ScrollShadow>
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
