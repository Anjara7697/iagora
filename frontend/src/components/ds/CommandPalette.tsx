"use client";

import { Button, Description, Header, Kbd, Label, ListBox, Modal, ScrollShadow, SearchField } from "@heroui/react";
import { ArrowRight, Keyboard, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { activeShortcuts, type ShortcutKey } from "@/lib/shortcuts";
import { useIsMac } from "@/lib/useIsMac";
import { useKeyShortcuts } from "./controls";
import { SCROLL_SHADOW_SIZE } from "./layout";
import { ShortcutKbd } from "./shortcut";

export type Command = {
  id: string;
  label: string;
  group: string;
  href: string;
  icon: LucideIcon;
  hint?: string;
};

/** Entrée de la palette : une page à ouvrir, ou une action de l'écran affiché avec son raccourci. */
type Entry = Omit<Command, "href"> & ({ href: string; run?: never; shortcut?: never } | { href?: never; run: () => void; shortcut: ShortcutKey });

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Palette ⌘K / Ctrl K : aller à une page, lancer une action ou chercher un prospect. Seule recherche de la
 * console : son déclencheur a l'allure d'un champ dans la barre du haut (une icône sur mobile), et le raccourci
 * l'ouvre de n'importe où. Les raccourcis de l'écran affiché (« À traiter ») y figurent aussi, avec leurs touches.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const mac = useIsMac();
  const keysRef = useKeyShortcuts(mac ? "Meta+K" : "Control+K");

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
  // Lus à l'ouverture : ce que l'écran permet à cet instant (un brouillon ouvert, une file non vide…).
  const pageEntries: Entry[] = open
    ? activeShortcuts().map((s) => ({
        id: `shortcut:${s.label}`,
        label: s.label,
        group: "Sur cette page",
        icon: Keyboard,
        run: s.run,
        shortcut: s,
      }))
    : [];
  const matching = (c: Entry) => norm(`${c.label} ${c.hint ?? ""}`).includes(norm(query));
  // Les actions de l'écran passent en tête ; puis la recherche de prospect, puis les pages.
  const items: Entry[] = [
    ...pageEntries.filter(matching),
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
    ...commands.filter(matching),
  ];
  const groups = [...new Set(items.map((i) => i.group))];

  function go(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setOpen(false);
    setQ("");
    // Une action de l'écran part une fois la palette fermée (le focus est revenu à la page).
    if (item.run) setTimeout(item.run, 0);
    else router.push(item.href);
  }

  return (
    <>
      {/* Un seul déclencheur : icône sur mobile, allure de champ (texte et raccourci) à partir de md. */}
      <Button
        variant="tertiary"
        className="w-10 justify-center gap-2 px-0 font-normal text-muted md:w-full md:justify-start md:px-3"
        onPress={() => setOpen(true)}
        ref={keysRef}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        {/* Nom accessible tiré du texte visible (WCAG 2.5.3) : « Rechercher un prospect, une page », dont seule la
            partie qui tient est affichée (rien sur mobile, « Rechercher… » sur tablette, tout sur grand écran). */}
        <span className="max-md:sr-only">
          Rechercher<span className="max-xl:sr-only"> un prospect, une page</span>
          <span aria-hidden="true">…</span>
        </span>
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
              <p className="px-4 py-8 text-center type-body text-muted">Aucun résultat pour « {query} »</p>
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
                            {c.shortcut ? (
                              <ShortcutKbd shortcut={c.shortcut} className="ms-auto" />
                            ) : (
                              <ArrowRight className="ms-auto size-4 text-muted" aria-hidden="true" />
                            )}
                          </ListBox.Item>
                        ))}
                    </ListBox.Section>
                  ))}
                </ListBox>
              </ScrollShadow>
            )}
            <div className="flex items-center gap-3 border-t border-separator px-4 py-2 type-caption text-muted">
              <span>↑↓ pour naviguer</span>
              <span>↵ pour ouvrir</span>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
