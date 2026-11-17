import { SIMULATOR_ENABLED } from "./api";
import type { User } from "./types";

/**
 * Page Évaluation (D-35) : passages d'évaluation de l'agent lancés, importés et comparés depuis la console.
 * Outil de recette : réservé aux administrateurs, avec l'interrupteur du Simulateur ; l'API le refuse en production.
 */
export function canUseEvaluation(role: User["role"] | undefined): boolean {
  return SIMULATOR_ENABLED && role === "ADMIN";
}

export type Suite = "agent" | "conversations" | "kb";
export type RunStatus = "running" | "done" | "cancelled" | "failed" | "interrupted";

export type Indicator = {
  key: string;
  label: string;
  group: string;
  value: number | null;
  display: string;
  /** Sens du progrès : `up` (plus haut, mieux), `down` (plus bas, mieux), null (descriptif). */
  better: "up" | "down" | null;
  kind: "rate" | "number";
};

export type RunSettings = {
  live?: boolean;
  real_rag?: boolean;
  pause?: number;
  ids?: string[];
  categories?: string[];
  ablation?: string | null;
  price_in?: number | null;
  price_out?: number | null;
  min_score?: number | null;
  cleanup?: boolean;
};

export type EvalRun = {
  id: string;
  suite: Suite;
  suite_label: string;
  label: string;
  notes: string;
  source: "app" | "import";
  status: RunStatus;
  settings: RunSettings;
  model: string | null;
  mode?: string | null;
  file_name?: string | null;
  created_at: string;
  ran_at: string;
  started_at?: string;
  finished_at?: string;
  duration_seconds?: number;
  error?: string | null;
  cleaned_up?: number;
  progress?: { done: number; total: number; ok: number };
  indicators: Indicator[];
  report?: EvalReport;
};

export type TranscriptLine = { role: "prospect" | "agent"; text: string };

export type ConversationRow = {
  id: string;
  title?: string;
  ok: boolean;
  evaluable?: boolean;
  skipped?: string | null;
  error?: string | null;
  end_ok?: boolean | null;
  profile_ok?: boolean | null;
  turns: { id: string; ok: boolean; intent?: string | null; action?: string; handoff_reason?: string | null; reply?: string }[];
  transcript?: TranscriptLine[];
  issues?: string[];
  seconds?: number;
};

export type CaseRow = {
  id: string;
  category: string;
  ok: boolean;
  evaluable?: boolean;
  intent?: string | null;
  action?: string;
  handoff_reason?: string | null;
  error?: string | null;
  message?: string | null;
  reply?: string;
  gaps?: string[];
  seconds?: number;
};

export type QuestionRow = {
  question: string;
  target: string;
  expect: string | null;
  same_topic: boolean;
  found: string | null;
  score: number;
  retained: boolean;
  ok: boolean | null;
};

export type EvalReport = {
  meta?: Record<string, unknown>;
  summary: Record<string, unknown>;
  cases?: CaseRow[];
  conversations?: ConversationRow[];
  questions?: QuestionRow[];
};

export type CatalogItem = { id: string; title: string; group?: string; turns?: number; live_only?: boolean };
export type Catalog = {
  suites: { key: Suite; label: string; items: CatalogItem[]; categories?: string[]; ablations?: string[] }[];
  model: { available: boolean; name: string | null };
  embeddings: { available: boolean; name: string | null };
  rag_min_score: number;
  llm_calls_per_turn: number;
  running: string | null;
};

export const SUITES: Record<Suite, string> = {
  conversations: "Conversations",
  agent: "Cas un par un",
  kb: "Base de connaissances",
};

export const SUITE_HINTS: Record<Suite, string> = {
  conversations: "Parcours de plusieurs messages : conformité, profil lu, technique de vente.",
  agent: "Chaque situation isolée : intention, décision, transfert, réponse sourcée.",
  kb: "La recherche trouve-t-elle le bon document pour chaque question type ?",
};

export const STATUS: Record<RunStatus, { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" }> = {
  running: { label: "En cours", tone: "accent" },
  done: { label: "Terminé", tone: "success" },
  cancelled: { label: "Annulé", tone: "warning" },
  failed: { label: "En échec", tone: "danger" },
  interrupted: { label: "Interrompu", tone: "warning" },
};

/** Onglets de la page, dans l'adresse (`?tab=…`). */
export const EVALUATION_TABS = {
  history: "Historique",
  launch: "Lancer",
  compare: "Comparer",
  evolution: "Évolution",
} as const;
export type EvaluationTab = keyof typeof EVALUATION_TABS;

type Query = { get: (key: string) => string | null };
const RUN_ID = /^[0-9a-f]{32}$/;
const KEY = /^[a-z_]{1,40}$/;
const isSuite = (v: string | null): v is Suite => v === "agent" || v === "conversations" || v === "kb";

/** État porté par l'adresse : onglet, suite affichée, passages comparés, indicateur suivi. Seules les valeurs valides sont relues. */
export function readEvaluationView(query: Query) {
  const tab = query.get("tab");
  const suite = query.get("suite");
  const a = query.get("a");
  const b = query.get("b");
  const indicator = query.get("indicator");
  return {
    tab: (tab && Object.hasOwn(EVALUATION_TABS, tab) ? tab : "history") as EvaluationTab,
    suite: isSuite(suite) ? suite : ("" as const),
    a: a && RUN_ID.test(a) ? a : null,
    b: b && RUN_ID.test(b) ? b : null,
    indicator: indicator && KEY.test(indicator) ? indicator : null,
  };
}
export type EvaluationView = ReturnType<typeof readEvaluationView>;

export function evaluationHref(view: EvaluationView): string {
  const params = new URLSearchParams();
  if (view.tab !== "history") params.set("tab", view.tab);
  if (view.suite) params.set("suite", view.suite);
  if (view.a) params.set("a", view.a);
  if (view.b) params.set("b", view.b);
  if (view.indicator) params.set("indicator", view.indicator);
  const query = params.toString();
  return query ? `/evaluation?${query}` : "/evaluation";
}

export const runHref = (id: string) => `/evaluation/${id}`;
export const isRunId = (id: string) => RUN_ID.test(id);

export function indicatorOf(run: EvalRun, key: string): Indicator | undefined {
  return run.indicators.find((i) => i.key === key);
}

/** Résumé d'un passage en une ligne : la conformité, l'indicateur le plus parlant de chaque suite. */
export function headline(run: EvalRun): string {
  return indicatorOf(run, "conform")?.display ?? "n/a";
}

export type Change = "better" | "worse" | "same" | "neutral" | "unknown";

/** Lecture d'un écart entre deux valeurs d'un même indicateur, selon le sens du progrès. */
export function compareValues(before: Indicator | undefined, after: Indicator | undefined): { change: Change; delta: string } {
  if (!before || !after || before.value === null || after.value === null) return { change: "unknown", delta: "" };
  const diff = after.value - before.value;
  const kind = after.kind;
  const delta =
    Math.abs(diff) < 1e-9
      ? "="
      : kind === "rate"
        ? `${diff > 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))} pts`
        : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))}`;
  if (Math.abs(diff) < 1e-9) return { change: "same", delta };
  if (after.better === null) return { change: "neutral", delta };
  const improved = after.better === "up" ? diff > 0 : diff < 0;
  return { change: improved ? "better" : "worse", delta };
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("fr-FR") : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Libellé de date d'un passage : jour et heure. */
export function formatRunDate(iso: string | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "-";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}

/** Réglages lisibles d'un passage (ce qui a été joué, avec quel modèle et quelle recherche). */
export function describeSettings(run: EvalRun): string[] {
  const s = run.settings;
  const out: string[] = [];
  if (run.source === "import") out.push(`Importé${run.file_name ? ` (${run.file_name})` : ""}`);
  if (run.model) out.push(`Modèle : ${run.model}`);
  if (s.real_rag !== undefined) out.push(s.real_rag ? "Recherche réelle" : "Recherche lexicale (base fictive)");
  if (s.ids?.length) out.push(`${s.ids.length} élément${s.ids.length > 1 ? "s" : ""} choisi${s.ids.length > 1 ? "s" : ""}`);
  if (s.categories?.length) out.push(`Catégories : ${s.categories.join(", ")}`);
  if (s.ablation) out.push(`Variante : ${s.ablation}`);
  if (s.pause) out.push(`Pause : ${s.pause} s`);
  if (s.min_score !== undefined && s.min_score !== null) out.push(`Seuil essayé : ${s.min_score}`);
  return out;
}
