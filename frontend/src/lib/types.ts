// Types alignés sur les schémas de l'API (backend/app/schemas).

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Role = "ADMIN" | "ADVISOR" | "VIEWER";

export type User = { id: number; username: string; email: string; role: Role };

export type Membership = {
  id: number;
  assignment_is_override?: boolean;
  last_seen_at?: string;
  campaign_source_id?: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  source_name?: string | null;
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

export type TodoKind = "validation" | "escalation" | "kb_gap" | "incident";
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
