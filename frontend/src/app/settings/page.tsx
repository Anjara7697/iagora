"use client";

import { toast } from "@heroui/react";
import { Bot, CalendarClock, Mail, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TestingAccess from "@/components/TestingAccess";
import { canUseSimulator } from "@/lib/access";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, Notice, SelectBox } from "@/components/ds/controls";
import { ErrorState, PageHeader, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ui";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { ActionsBar } from "@/components/ds/settings";
import { AgentSection, AiSection, AppointmentsSection, EmailsSection } from "@/components/settings/SettingsSections";
import { api, ApiError } from "@/lib/api";
import type { RuntimeSettings } from "@/lib/types";

const READ_ONLY = [
  "source",
  "gemini_api_key_set",
  "openai_api_key_set",
  "embedding_model",
] as const;

const SECTIONS = [
  {
    id: "ia",
    label: "Intelligence artificielle",
    hint: "Modèle, clé, secours",
  },
  { id: "agent", label: "Agent et relances", hint: "Réponses et relances" },
  { id: "emails", label: "Emails", hint: "Pied, mise en page, relève" },
  { id: "rdv", label: "Rendez-vous", hint: "Jours et horaires" },
] as const;
const ICONS: Record<string, LucideIcon> = { ia: Sparkles, agent: Bot, emails: Mail, rdv: CalendarClock };
type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const requested = useSearchParams().get("section");
  const active: SectionId =
    SECTIONS.find((s) => s.id === requested)?.id ?? SECTIONS[0].id;
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Quitter Paramètres (menu, onglet) avec des réglages non enregistrés demande confirmation.
  const { dialog: discardDialog } = useDiscardGuard(() => dirty);
  const [preview, setPreview] = useState<string | null>(null);
  const [test, setTest] = useState<{
    ok: boolean;
    model: string;
    detail: string;
  } | null>(null);
  const isAdmin = user?.role === "ADMIN";

  const load = () => {
    setLoadError(null);
    return api<RuntimeSettings>("/settings")
      .then((s) => {
        setForm(s);
        setDirty(false);
      })
      .catch((e) =>
        setLoadError(`Chargement des paramètres impossible${e instanceof ApiError ? ` : ${e.message}` : "."}`),
      );
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (user && !isAdmin)
    return canUseSimulator(user.role) ? (
      <Screen className="max-w-[960px]">
        <PageHeader
          eyebrow="Réglages · Outils de test"
          title="Paramètres"
          subtitle="Retrouvez les outils pour essayer l’agent avec des données fictives."
        />
        <TestingAccess />
      </Screen>
    ) : (
      <Screen>
        <Notice tone="warning">Cette page est réservée aux administrateurs.</Notice>
      </Screen>
    );
  if (!form)
    return (
      <Screen className="max-w-[1200px]">
        <PageHeader eyebrow="Administration · Paramètres" title="Paramètres" />
        <TestingAccess />
        {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : <Skeleton />}
      </Screen>
    );

  const set = <K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K],
  ) => {
    setForm({ ...form, [key]: value });
    setDirty(true);
  };
  const num =
    (key: keyof RuntimeSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, Number(e.target.value) as never);

  function payload() {
    const body: Record<string, unknown> = { ...form };
    for (const k of READ_ONLY) delete body[k];
    body.gemini_api_key = geminiKey || null;
    body.openai_api_key = openaiKey || null;
    return body;
  }

  /** `failure` dit ce qui a échoué, avant le détail du serveur (règle 12). */
  async function act(name: string, failure: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`${failure}${e instanceof ApiError ? ` : ${e.message}` : "."}`);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    act("save", "Enregistrement impossible", async () => {
      await api("/settings", { method: "PUT", body: payload() });
      setGeminiKey("");
      setOpenaiKey("");
      await load();
      toast.success("Paramètres enregistrés", { description: "Ils s’appliquent immédiatement, sans redémarrage." });
    });
  const runTest = () =>
    act("test", "Test du modèle impossible", async () => {
      setTest(null);
      setTest(
        await api("/settings/llm/test", { method: "POST", body: payload() }),
      );
    });
  const showPreview = () =>
    act("preview", "Aperçu impossible", async () => {
      const r = await api<{ html: string }>("/settings/email/preview", {
        method: "POST",
        body: payload(),
      });
      setPreview(r.html);
    });
  const reset = () =>
    act("reset", "Retour aux valeurs du serveur impossible", async () => {
      await api("/settings", { method: "DELETE" });
      setGeminiKey("");
      setOpenaiKey("");
      await load();
      toast.success("Valeurs du serveur rétablies", { description: "Les réglages enregistrés dans la console sont oubliés." });
    });

  const sectionProps = { form, set, num, busy };

  return (
    <Screen className="max-w-[1200px]">
      {discardDialog}
      <PageHeader
        {...reveal(0)}
        eyebrow="Administration · Paramètres"
        title="Paramètres"
        subtitle={
          <>
            Réglages de l’agent, appliqués sans redémarrage.{" "}
            {form.source === "console"
              ? "Enregistrés dans la console."
              : "Valeurs par défaut du serveur : enregistrer ici les remplace."}
          </>
        }
      />

      <div
        className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]", reveal(1).className)}
        style={reveal(1).style}
      >
        <div className="flex flex-col gap-1.5 lg:hidden">
          <label id="settings-category-label" htmlFor="settings-category" className="text-[13px] font-medium text-foreground">
            Catégorie
          </label>
          <SelectBox variant="secondary"
            id="settings-category"
            aria-labelledby="settings-category-label"
            value={active}
            onChange={(e) =>
              router.replace(`${pathname}?section=${e.target.value}`, {
                scroll: false,
              })
            }
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </SelectBox>
        </div>
        <nav className="hidden flex-col gap-1 lg:sticky lg:top-24 lg:flex" aria-label="Catégories de paramètres">
          {SECTIONS.map((s) => {
            const Icon = ICONS[s.id];
            const on = active === s.id;
            return (
              <Link
                key={s.id}
                href={`${pathname}?section=${s.id}`}
                replace
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                  on ? "bg-surface shadow-surface" : "hover:bg-default/60",
                )}
              >
                <Icon className={cx("mt-0.5 size-4 shrink-0", on ? "text-accent" : "text-muted")} aria-hidden="true" />
                <span className="flex flex-col">
                  <span className={cx("text-sm font-medium", on ? "text-foreground" : "text-foreground/90")}>{s.label}</span>
                  <small className="text-xs text-muted">{s.hint}</small>
                </span>
              </Link>
            );
          })}
          <div className="my-2 border-t border-separator" />
          <TestingAccess compact disabled={busy !== null} unsaved={dirty} />
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <AiSection
            {...sectionProps}
            hidden={active !== "ia"}
            geminiKey={geminiKey}
            openaiKey={openaiKey}
            setGeminiKey={setGeminiKey}
            setOpenaiKey={setOpenaiKey}
            setDirty={setDirty}
            runTest={runTest}
            test={test}
          />

          <AgentSection {...sectionProps} hidden={active !== "agent"} dirty={dirty} canSimulate={canUseSimulator(user?.role)} />

          <EmailsSection {...sectionProps} hidden={active !== "emails"} preview={preview} showPreview={showPreview} />

          <AppointmentsSection {...sectionProps} hidden={active !== "rdv"} />

          <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-2xl border border-separator bg-surface/95 px-4 py-3 shadow-overlay backdrop-blur">
            <ActionsBar>
              <Btn variant="primary" onClick={save} disabled={busy !== null}>
                Enregistrer les paramètres
              </Btn>
              {form.source === "console" && (
                <ConfirmDialog
                  trigger={
                    <Btn variant="ghost" disabled={busy !== null}>
                      Revenir aux valeurs du serveur
                    </Btn>
                  }
                  title="Revenir aux valeurs du serveur ?"
                  description="Les réglages enregistrés dans la console sont oubliés, clés d’API comprises : l’agent reprend les valeurs du fichier de configuration du serveur."
                  confirmLabel="Revenir aux valeurs du serveur"
                  status="warning"
                  onConfirm={() => void reset()}
                />
              )}
              {dirty && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Modifications non enregistrées
                </span>
              )}
            </ActionsBar>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </div>
      </div>
    </Screen>
  );
}
