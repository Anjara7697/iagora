// Types alignés sur les schémas de l'API (backend/app/schemas).

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Role = "ADMIN" | "ADVISOR" | "VIEWER";

export type User = {
  id: number;
  username: string;
  email: string;
  role: Role;
  is_active?: boolean;
  must_change_password?: boolean;
  created_at?: string;
};

export type CreatedUser = User & { temporary_password: string | null };

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

export type Prospect = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  profile: Record<string, unknown>;
  consent_status: string;
  consent_source: string | null;
  opted_out_at: string | null;
  created_at: string;
  is_demo?: boolean;
  campaigns: Membership[];
  current_membership_id?: number | null;
};

export type Target = { id: number; code: string; name: string };
export type Source = {
  id: number;
  name: string;
  type?: string;
  platform?: string;
  external_id?: string | null;
};
export type MetaFormMapping = {
  form_id: string;
  form_name: string;
  campaign_id: number;
  source_id: number;
  target_code: string | null;
  enabled: boolean;
};
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
};
export type Campaign = {
  id: number;
  responsible_advisor_id?: number | null;
  responsible_advisor_name?: string | null;
  responsible_advisor_active?: boolean | null;
  name: string;
  status: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  targets: Target[];
  sources: Source[];
};
export type CampaignStats = {
  prospects: number;
  average_score: number;
  by_stage: Record<string, number>;
  by_level: Record<string, number>;
  by_source: {
    source_id: number;
    name: string;
    platform: string;
    prospects: number;
  }[];
  meetings: number;
  converted: number;
};
export type CampaignOverview = {
  campaign_id: number;
  prospects: number;
  hot: number;
  meetings: number;
  qualified?: number;
  converted: number;
};

export type Message = {
  id: string;
  role: "prospect" | "agent" | "advisor";
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type HandoffSheet = {
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

export type TraceEntry = { node: string; summary: string; at: string };

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
  | "escalation"
  | "kb_gap"
  | "incident"
  | "application"
  | "enrollment";
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
};

export type KnowledgeStatus = {
  configured: boolean;
  embedding_model: string | null;
  min_score: number;
  top_k: number;
};

export type KnowledgeDocument = {
  slug: string;
  title: string;
  target_code: string | null;
  chunks: number;
  embedding_model: string;
  is_demo: boolean;
  updated_at: string | null;
  needs_reindex: boolean;
};

export type KnowledgeDocumentDetail = KnowledgeDocument & {
  source_text: string | null;
  sections: { heading: string | null; text: string }[];
};

export type SearchHit = {
  source: string;
  text: string;
  score: number;
  retained: boolean;
};
export type SearchResult = { threshold: number; results: SearchHit[] };

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

export type EmailCheck = { imap: string; smtp: string };

export type DashboardSummary = {
  agent_mode: AgentMode;
  hot_prospects: {
    id: number;
    name: string;
    email: string | null;
    stage: string;
    level: string | null;
    total_score: number;
    campaign_id: number | null;
    campaign_name: string | null;
  }[];
  activity: {
    hours: number;
    prospects_analysed: number;
    drafts_generated: number;
    sent_after_validation: number;
    sent_without_validation: number;
    escalations: number;
    errors: number;
  };
  follow_ups: {
    id: number;
    prospect_id: number;
    prospect_name: string;
    scheduled_at: string;
    reason: string | null;
  }[];
  follow_ups_total: number;
  funnel_days: number;
  funnel: Record<string, number>;
  leads: number;
};

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

export type EmailAutodetect = {
  provider: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "ssl";
  source: "preset" | "mx" | "ispdb" | "guess";
  note: string | null;
};

export type EmailTestResult = {
  imap: string;
  smtp: string;
  folders: { name: string; label: string }[];
};

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

export type MyCalendar = {
  available: boolean;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
  last_error: string | null;
};

export type ZoomMode = "none" | "account" | "advisor";

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

export type MyZoom = {
  mode: ZoomMode;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
  last_error: string | null;
};

export type RuntimeSettings = {
  llm_provider: "gemini" | "openai";
  llm_model: string;
  llm_fallback_model: string;
  llm_temperature: number;
  agent_auto_reply: boolean;
  follow_up_window_start_hour: number;
  follow_up_window_end_hour: number;
  follow_up_weekdays_only: boolean;
  follow_up_max_per_silence: number;
  email_footer: string;
  email_create_unknown_senders: boolean;
  email_poll_seconds: number;
  calendar_timezone: string;
  calendar_work_days: string;
  calendar_work_start_hour: number;
  calendar_work_end_hour: number;
  calendar_slot_minutes: number;
  calendar_min_notice_hours: number;
  calendar_horizon_days: number;
  calendar_buffer_minutes: number;
  source?: "console" | "env";
  gemini_api_key_set?: boolean;
  openai_api_key_set?: boolean;
  embedding_model?: string;
};

export type ServiceToken = {
  id: string;
  name: string;
  hint: string;
  channel: string;
  campaign_id: number | null;
  source_id: number | null;
  target_code: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  token?: string;
};

export type ImportReport = {
  dry_run: boolean;
  total: number;
  created: number;
  existing: number;
  invalid: { row: number; error: string }[];
  columns: Record<string, string>;
};

export type Appointment = {
  id: number;
  prospect: { id: number; first_name: string | null; last_name: string | null; email: string | null };
  advisor_id: number | null;
  advisor_name: string | null;
  start_at: string;
  end_at: string;
  status: "proposed" | "scheduled" | "done" | "cancelled" | "no_show";
  meeting_url: string | null;
};
