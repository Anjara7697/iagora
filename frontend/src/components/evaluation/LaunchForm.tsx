"use client";

import { ScrollShadow, toast } from "@heroui/react";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Box } from "@/components/ds/card";
import { Collapse } from "@/components/ds/collapse";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, Check, ErrorText, Field, NumberInput, Notice, Segmented, SelectBox, Tag, TextBox, TextInput } from "@/components/ds/controls";
import { SCROLL_SHADOW_SIZE } from "@/components/ds/layout";
import { api, failure } from "@/lib/api";
import { SUITES, SUITE_HINTS, runHref, type Catalog, type EvalRun, type Suite } from "@/lib/evaluation";

const today = () => new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

/**
 * Lancer un passage (D-35) : tous les réglages de la ligne de commande. Ceux qui ne concernent pas la suite choisie
 * sont masqués. Avec le vrai modèle, une confirmation annonce le nombre d'appels estimé (quota).
 */
export default function LaunchForm({ catalog, onLaunched }: { catalog: Catalog; onLaunched: () => void }) {
  const router = useRouter();
  const [suite, setSuite] = useState<Suite>("conversations");
  const [label, setLabel] = useState(`${SUITES.conversations} · ${today()}`);
  const [labelEdited, setLabelEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [live, setLive] = useState(false);
  const [realRag, setRealRag] = useState(false);
  const [pause, setPause] = useState(0);
  const [selected, setSelected] = useState<Record<Suite, string[] | null>>({ agent: null, conversations: null, kb: null });
  const [categories, setCategories] = useState<string[]>([]);
  const [ablation, setAblation] = useState("");
  const [withPrices, setWithPrices] = useState(false);
  const [priceIn, setPriceIn] = useState(0.1);
  const [priceOut, setPriceOut] = useState(0.4);
  const [tryThreshold, setTryThreshold] = useState(false);
  const [threshold, setThreshold] = useState(catalog.rag_min_score);
  const [cleanup, setCleanup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const def = catalog.suites.find((s) => s.key === suite);
  const items = def?.items ?? [];
  const chosen = selected[suite];
  const inCategories = (group?: string) => suite !== "agent" || categories.length === 0 || (group !== undefined && categories.includes(group));
  const played = items.filter((i) => (chosen === null || chosen.includes(i.id)) && inCategories(i.group));
  const turns = played.reduce((n, i) => n + (suite === "conversations" ? (i.turns ?? 1) : 1), 0);
  const calls = turns * catalog.llm_calls_per_turn;
  const usesModel = suite !== "kb";
  const running = catalog.running !== null;
  const blocked =
    running
      ? "Un passage est déjà en cours : attendez sa fin ou annulez-le."
      : played.length === 0
        ? "Aucun élément à jouer avec ces réglages."
        : suite === "kb" && !catalog.embeddings.available
          ? "Embeddings indisponibles : la clé GEMINI_API_KEY n’est pas configurée."
          : label.trim() === ""
            ? "Donnez un nom au passage."
            : null;

  const changeSuite = (next: Suite) => {
    setSuite(next);
    if (!labelEdited) setLabel(`${SUITES[next]} · ${today()}`);
    setError(null);
  };
  const changeLive = (next: boolean) => {
    setLive(next);
    // Formules gratuites : une pause entre deux éléments évite les refus de quota.
    if (next && pause === 0) setPause(4);
    if (!next && pause === 4) setPause(0);
  };

  const launch = async () => {
    setBusy(true);
    setError(null);
    const ids = chosen === null ? [] : chosen.filter((id) => played.some((i) => i.id === id));
    try {
      const run = await api<EvalRun>("/evaluations", {
        method: "POST",
        body: {
          suite,
          label: label.trim(),
          notes,
          live: usesModel && live,
          real_rag: usesModel && realRag,
          pause: usesModel ? pause : 0,
          ids,
          categories: suite === "agent" ? categories : [],
          ablation: suite === "agent" && ablation ? ablation : null,
          price_in: suite === "agent" && withPrices ? priceIn : null,
          price_out: suite === "agent" && withPrices ? priceOut : null,
          min_score: suite === "kb" && tryThreshold ? threshold : null,
          cleanup,
        },
      });
      toast.success("Évaluation lancée", { description: `${played.length} élément${played.length > 1 ? "s" : ""} à jouer.` });
      onLaunched();
      router.push(runHref(run.id));
    } catch (err) {
      setError(failure("Lancement impossible", err));
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = (id: string, on: boolean) => {
    const current = chosen ?? items.map((i) => i.id);
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    setSelected({ ...selected, [suite]: next.length === items.length ? null : next });
  };

  return (
    <Box as="section" aria-label="Lancer une évaluation" className="max-w-3xl gap-5 p-5">
      <div className="flex flex-col gap-2">
        <Segmented<Suite>
          label="Suite à jouer"
          value={suite}
          onChange={changeSuite}
          options={(["conversations", "agent", "kb"] as Suite[]).map((s) => ({ value: s, text: SUITES[s] }))}
        />
        <p className="type-body-sm text-muted">{SUITE_HINTS[suite]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom du passage" hint="Il servira à le retrouver et à le comparer (ex. « après #234 »).">
          <TextInput
            value={label}
            maxLength={120}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelEdited(true);
            }}
          />
        </Field>
        <Field label="Notes" hint="Facultatif : ce qui a changé depuis le passage précédent.">
          <TextBox rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {usesModel && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Segmented<"fake" | "live">
              label="Modèle"
              value={live ? "live" : "fake"}
              onChange={(v) => changeLive(v === "live")}
              options={[
                { value: "fake", text: "Faux modèle (gratuit)" },
                { value: "live", text: catalog.model.name ? `Vrai modèle · ${catalog.model.name}` : "Vrai modèle" },
              ]}
              disabledKeys={catalog.model.available ? [] : ["live"]}
            />
            <p className="type-body-sm text-muted">
              {catalog.model.available
                ? live
                  ? "Mesure le vrai modèle configuré. Consomme du quota."
                  : "Rejoue l’annotation : valide l’outil et les règles du workflow, pas le modèle."
                : "Vrai modèle indisponible : vérifiez la clé et le modèle dans le fichier .env."}
            </p>
          </div>
          <Check
            checked={realRag}
            onChange={setRealRag}
            disabled={!catalog.embeddings.available}
            hint={
              catalog.embeddings.available
                ? "Documents de démonstration chargés par seed-demo. Sinon : recherche lexicale sur la base fictive."
                : "Indisponible : embeddings non configurés."
            }
          >
            Vraie recherche dans la base de connaissances
          </Check>
          <Field label="Pause entre deux éléments (secondes)" hint="Évite les refus de quota des formules gratuites.">
            <NumberInput className="sm:max-w-40" value={pause} min={0} max={60} step={0.5} onValueChange={setPause} />
          </Field>
        </div>
      )}

      {suite === "agent" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Variante" hint="Une version dégradée, pour mesurer ce qu’apporte chaque garde-fou.">
            <SelectBox value={ablation} onChange={(e) => setAblation(e.target.value)}>
              <option value="">Complète</option>
              {(def?.ablations ?? []).map((a) => (
                <option key={a} value={a}>
                  {a === "sans-rag" ? "Sans base de connaissances" : a === "sans-garde-chiffres" ? "Sans garde sur les chiffres" : a}
                </option>
              ))}
            </SelectBox>
          </Field>
          <div className="flex flex-col gap-2">
            <Check checked={withPrices} onChange={setWithPrices} hint="Prix par million de jetons, pour estimer le coût.">
              Estimer le coût
            </Check>
            {withPrices && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Entrée">
                  <NumberInput value={priceIn} min={0} max={1000} step={0.01} onValueChange={setPriceIn} />
                </Field>
                <Field label="Sortie">
                  <NumberInput value={priceOut} min={0} max={1000} step={0.01} onValueChange={setPriceOut} />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}

      {suite === "agent" && (def?.categories?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <span className="type-body font-medium text-foreground">Catégories</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(def?.categories ?? []).map((c) => (
              <Check
                key={c}
                checked={categories.includes(c)}
                onChange={(on) => setCategories(on ? [...categories, c] : categories.filter((x) => x !== c))}
              >
                {c}
              </Check>
            ))}
          </div>
          <p className="type-caption text-muted">Aucune cochée : toutes les catégories.</p>
        </div>
      )}

      {suite === "kb" && (
        <div className="flex flex-col gap-2">
          <Check
            checked={tryThreshold}
            onChange={setTryThreshold}
            hint={`Seuil actuel : ${catalog.rag_min_score}. Essayer une autre valeur ne change pas le réglage de l’agent.`}
          >
            Essayer un autre seuil de pertinence
          </Check>
          {tryThreshold && (
            <Field label="Seuil essayé">
              <NumberInput className="sm:max-w-40" value={threshold} min={0} max={1} step={0.01} onValueChange={setThreshold} />
            </Field>
          )}
        </div>
      )}

      <Collapse
        title={`Éléments joués : ${played.length} sur ${items.length}`}
        className="rounded-lg border border-border px-4 py-3"
        triggerClassName="w-full type-body"
        headingLevel={2}
      >
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" onClick={() => setSelected({ ...selected, [suite]: null })}>
              Tout cocher
            </Btn>
            <Btn size="sm" variant="tertiary" onClick={() => setSelected({ ...selected, [suite]: [] })}>
              Tout décocher
            </Btn>
          </div>
          <ScrollShadow size={SCROLL_SHADOW_SIZE} className="max-h-80">
            <ul className="flex flex-col gap-2 py-1">
              {items.map((i) => (
                <li key={i.id}>
                  <Check
                    checked={chosen === null || chosen.includes(i.id)}
                    onChange={(on) => toggleItem(i.id, on)}
                    hint={[suite !== "kb" && i.id, i.group, i.turns && `${i.turns} messages`].filter(Boolean).join(" · ")}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {i.title}
                      {i.live_only && <Tag tone="muted">vrai modèle seulement</Tag>}
                    </span>
                  </Check>
                </li>
              ))}
            </ul>
          </ScrollShadow>
        </div>
      </Collapse>

      {usesModel && (
        <Check checked={cleanup} onChange={setCleanup} hint="Les prospects fictifs (@demo.example.com) créés pour le passage.">
          Supprimer les prospects de test à la fin
        </Check>
      )}

      {usesModel && live && (
        <Notice tone="warning">
          {`Environ ${calls} appels au modèle (${turns} message${turns > 1 ? "s" : ""} × ${catalog.llm_calls_per_turn}), plus les nouveaux essais éventuels.`}
        </Notice>
      )}
      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex flex-wrap items-center gap-3">
        <Btn
          variant="primary"
          isPending={busy}
          disabled={blocked !== null || busy}
          onClick={() => (usesModel && live ? setConfirming(true) : void launch())}
        >
          <Play className="size-4" aria-hidden="true" />
          Lancer l’évaluation
        </Btn>
        {blocked && <span className="type-body-sm text-muted">{blocked}</span>}
      </div>

      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        status="warning"
        title="Lancer avec le vrai modèle ?"
        description={`${played.length} élément${played.length > 1 ? "s" : ""}, environ ${calls} appels à ${catalog.model.name ?? "ce modèle"}. Le quota du compte est consommé.`}
        confirmLabel="Lancer"
        onConfirm={() => {
          setConfirming(false);
          void launch();
        }}
      />
    </Box>
  );
}
