// Types alignés sur les schémas de l'API (backend/app/schemas).

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export type Role = "admin" | "advisor" | "viewer";

export type User = { id: number; username: string; email: string; role: Role };

export type Membership = {
  id: number;
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
  campaigns: Membership[];
};

export type Target = { id: number; code: string; name: string };
export type Source = { id: number; name: string };
export type Campaign = {
  id: number;
  name: string;
  status: string;
  targets: Target[];
  sources: Source[];
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
