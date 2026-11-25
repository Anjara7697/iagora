import type { components } from "./api/schema";

/** Types de lecture dérivés du schéma OpenAPI généré (DATA-04) : ceux qui ne le sont pas encore restent écrits à la main. */
type Schemas = components["schemas"];

// Types alignés sur les schémas de l'API (backend/app/schemas).

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Role = "ADMIN" | "ADVISOR" | "VIEWER";

export type User = Schemas["UserRead"];

export type CreatedUser = Schemas["UserCreated"];

export type Membership = {
  id: number;
  assignment_is_override?: boolean;
  last_seen_at?: string;
  campaign_source_id?: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  source_name?: string | null;
  source_id?: number | null;
  conversion_stage: string;
  interest_status: string | null;
  interest_score: number;
  fit_score: number;
  total_score: number;
  assigned_advisor_id: number | null;
};

export type Prospect = Schemas["ProspectDetail"];

export type Target = Schemas["TargetRead"];
export type Source = Schemas["SourceRead"];
export type MetaFormMapping = Schemas["MetaFormMapping"];
export type MetaSettings = {
  configured: boolean;
  enabled: boolean;
  app_id: string;
  api_version: string;
  app_secret_set: boolean;
  page_access_token_set: boolean;
  verify_token_set: boolean;
  mappings: MetaFormMapping[];
  webhook_path: string;
  last_event_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  received: number;
  processed: number;
  failed: number;
  /** En attente de traitement ; repris automatiquement après 5 minutes. */
  queued?: number;
  /** En échec et encore rejouables. */
  replayable?: number;
};
export type Campaign = Schemas["CampaignRead"];
export type CampaignStats = Schemas["CampaignStats"];
/** Document de campagne que l'agent peut joindre à un email (D-42). */
export type CampaignFile = Schemas["CampaignFileRead"];
export type DraftAttachment = Schemas["TodoAttachment"];
export type CampaignOverview = Schemas["CampaignOverview"];

export type Message = {
  id: string;
  role: "prospect" | "agent" | "advisor";
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

type HandoffSheet = {
  reason: string;
  identity: Record<string, string | null>;
  campaign: string | null;
  source: string | null;
  channel: string;
  summary: string;
  pending_question: string | null;
  recommended_action: string;
  evidence_reference?: string | null;
  score: Record<string, unknown>;
  qualification: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  prospect_id: number;
  channel: string;
  status: "open" | "handed_off" | "closed";
  summary: string | null;
  started_at: string;
  last_message_at: string | null;
  messages: Message[];
  handoff: HandoffSheet | null;
};

export type ConversationProspect = {
  assigned_advisor_name?: string | null;
  campaign_id?: number | null;
  campaign_name?: string | null;
  source_name?: string | null;
  membership_id?: number | null;
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  stage: string | null;
  total_score: number | null;
  level: string | null;
  assigned_advisor_id: number | null;
};

export type ConversationSummary = {
  id: string;
  prospect_id: number;
  channel: string;
  status: "open" | "handed_off" | "closed";
  last_message_at: string | null;
  message_count: number;
  last_message_role: string | null;
  last_message_preview: string | null;
  handoff: HandoffSheet | null;
  prospect: ConversationProspect | null;
};

export type TraceEntry = Schemas["TraceRead"];

/** Journal en direct de l'agent : libellés fixes et nombres seulement (aucun texte du modèle). */
export type AgentActivity = Schemas["LiveActivity"];
export type AgentActivityItem = Schemas["LiveActivityItem"];
export type AgentActivityState = AgentActivity["state"];

export type AgentRun = {
  run_id: string;
  prospect_id: number;
  conversation_id: string;
  trigger: string;
  action: string;
  reason: string;
  outcome: string;
  reply: string | null;
  handoff_reason: string | null;
  stage_before: string | null;
  stage_after: string | null;
  scores: { interest?: number; fit?: number; total?: number; level?: string };
  llm: { provider?: string; model?: string };
  trace: TraceEntry[];
  started_at: string;
};

export type History = {
  stage_events: {
    id: number;
    from_stage: string | null;
    to_stage: string;
    reason: string | null;
    created_at: string;
  }[];
  score_events: {
    id: number;
    score_type: string;
    points: number;
    new_value: number;
    reason: string;
    created_at: string;
  }[];
};

export type AgentMode = "assisted" | "auto" | "manual";

export type TodoKind =
  | "validation"
  | "first_contact"
  | "escalation"
  | "kb_gap"
  | "incident"
  | "application"
  | "enrollment"
  | "opt_out_check";
export type Priority = "critical" | "high" | "medium" | "low";

export type TodoItem = {
  id: string;
  kind: TodoKind;
  priority: Priority;
  conversation_id: string;
  prospect: ConversationProspect | null;
  channel: string;
  title: string;
  detail: string | null;
  created_at: string | null;
  draft: {
    message_id: string;
    content: string;
    sources: string[];
    confidence: number | null;
    created_at: string;
    subject?: string | null;
    footer?: string | null;
    /** Documents de la campagne joints par l'agent (D-42). */
    attachments?: DraftAttachment[];
  } | null;
  handoff: HandoffSheet | null;
  recommendation: {
    action: string;
    reason: string | null;
    risk: "low" | "medium" | "high";
    confidence: number | null;
    sources: string[];
  } | null;
};

export type TodoPage = Page<TodoItem> & {
  counts: Partial<Record<TodoKind, number>>;
  /** Vrai si seules les conversations les plus récentes ont été lues : la liste est incomplète. */
  truncated?: boolean;
};

export type KnowledgeStatus = Schemas["KnowledgeStatus"];

export type KnowledgeDocument = Schemas["DocumentRead"];

export type KnowledgeDocumentDetail = KnowledgeDocument & {
  source_text: string | null;
  sections: { heading: string | null; text: string }[];
};

export type SearchHit = Schemas["SearchHit"];
export type SearchResult = Schemas["SearchResult"];

export type EmailStatus = {
  configured: boolean;
  enabled: boolean;
  send_enabled: boolean;
  sender: string | null;
  imap_host: string;
  smtp_host: string;
  sandbox_recipients: string[];
  last_run_at: string | null;
  last_error: string | null;
  last_report: Record<string, unknown> | null;
  outbox: Record<string, number>;
};

export type EmailCheck = Schemas["EmailCheck"];

export type DashboardSummary = Schemas["DashboardSummary"];

export type TreatedItem = {
  id: string;
  conversation_id: string;
  prospect: ConversationProspect | null;
  channel: string;
  decision: "approved" | "rejected";
  decided_at: string | null;
  decided_by: number | null;
  edited: boolean;
  content: string;
  reason: string | null;
  execution:
    | "approved"
    | "sending"
    | "sent"
    | "failed"
    | "blocked"
    | "rejected";
  execution_detail: string | null;
};
export type TreatedPage = {
  items: TreatedItem[];
  total: number;
  hours: number;
  truncated?: boolean;
};

export type EmailConfig = {
  address: string;
  username: string | null;
  imap_host: string;
  imap_port: number;
  imap_folder: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "ssl";
  from_name: string;
  enabled: boolean;
  send_enabled: boolean;
  sandbox_recipients: string[];
  source?: "console" | "env";
  password_set?: boolean;
  updated_at?: string | null;
};

export type EmailAutodetect = Schemas["EmailAutodetect"];

export type EmailTestResult = Schemas["EmailTestResult"];

export type CalendarSettings = {
  provider: "none" | "demo" | "google";
  source: "console" | "env";
  google_client_id: string;
  client_secret_set: boolean;
  default_user_id: number | null;
  redirect_uri: string;
  connections: {
    user_id: number;
    username: string | null;
    account_email: string | null;
    connected_at: string | null;
    last_error: string | null;
  }[];
};

export type MyCalendar = Schemas["MyCalendarRead"];

export type ZoomMode = "none" | "account" | "advisor";

/** Couleur d'état d'une pastille (ok : en service, warn : à surveiller, err : bloqué, off : inactif). */
export type Tone = "ok" | "warn" | "err" | "off";

export type ZoomSettings = {
  mode: ZoomMode;
  source: "console" | "env";
  account_id: string;
  client_id: string;
  client_secret_set: boolean;
  host_user: string;
  redirect_uri: string;
  connections: {
    user_id: number;
    username: string | null;
    account_email: string | null;
    connected_at: string | null;
    last_error: string | null;
  }[];
};

export type MyZoom = Schemas["MyZoomRead"];

export type RuntimeSettings = Schemas["RuntimeSettingsRead"];

export type ErasureReport = Schemas["ErasureReport"];

export type ServiceToken = Schemas["ServiceTokenCreated"];

export type ImportReport = {
  dry_run: boolean;
  total: number;
  created: number;
  existing: number;
  invalid: { row: number; error: string }[];
  columns: Record<string, string>;
  /** Lignes valides enregistrées avec consentement (colonne « consentement » ou case de l'écran). */
  consented: number;
  consent_by_column: boolean;
};

/** Premiers contacts d'une campagne (décision D-29) : qui les recevrait, et pourquoi les autres non. */
export type FirstContacts = Schemas["FirstContactsRead"];

export type BatchResult = Schemas["BatchResult"];

export type Appointment = Schemas["AppointmentRead"];

/** Tableau de bord (Pilotage) : `GET /dashboard/overview?days=7|30|90`. */
export type DashboardOverview = Schemas["DashboardOverview"];

/** Analyses (Pilotage) : `GET /analytics?days=7|30|90`. Une valeur null signifie « pas de donnée ». */
export type Analytics = Schemas["Analytics"];

/** Doublon suspect : deux fiches qui semblent décrire la même personne, à trancher (fusion ou « distinctes »). */
export type DuplicatePair = Schemas["DuplicatePair"];
