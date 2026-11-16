import type { Page, Route } from "@playwright/test";

/**
 * Jeu de données fixe des captures de référence (`visuel.spec.ts`) : une API simulée qui répond à tous les écrans
 * principaux, avec des dates fixes (l'horloge de la page est arrêtée sur `NOW`). Données fictives uniquement.
 * Une requête sans réponse prévue est relevée dans `unexpected` : le test échoue plutôt que de figer un écran à
 * moitié chargé.
 */
export const NOW = new Date("2026-11-13T09:30:00+01:00");

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

const advisor = { id: 1, username: "nadia.cisse", role: "ADMIN", email: "nadia.cisse@example.com" };

const marie = {
  id: 1,
  first_name: "Marie",
  last_name: "Dupont",
  email: "marie.dupont@example.com",
  stage: "qualified",
  total_score: 80,
  level: "very_hot",
  assigned_advisor_id: null,
};

const membership = {
  id: 11,
  campaign_id: 1,
  campaign_name: "Recrutement eBIHAR 2026",
  source_id: 10,
  source_name: "LinkedIn Ads",
  conversion_stage: "qualified",
  total_score: 80,
  interest_score: 80,
  fit_score: 75,
  interest_status: "very_hot",
  assigned_advisor_id: 1,
};

const prospect = {
  id: 1,
  first_name: "Marie",
  last_name: "Dupont",
  email: "marie.dupont@example.com",
  phone: "+33 6 12 34 56 78",
  consent_status: "granted",
  consent_source: "formulaire",
  profile: { programme: "eBIHAR", niveau_etudes: "Bac+3", financement: "CPF" },
  created_at: "2026-10-01T10:00:00Z",
  current_membership_id: 11,
  campaigns: [membership],
};

const prospects = [
  prospect,
  {
    ...prospect,
    id: 2,
    first_name: "Ahmed",
    last_name: "Belkacem",
    email: "ahmed.belkacem@example.com",
    consent_status: "unknown",
    campaigns: [{ ...membership, id: 12, conversion_stage: "in_conversation", total_score: 42, interest_status: "warm" }],
  },
  {
    ...prospect,
    id: 3,
    first_name: "Sophie",
    last_name: "Merlin",
    email: "sophie.merlin@example.com",
    campaigns: [{ ...membership, id: 13, conversion_stage: "meeting_scheduled", total_score: 88 }],
  },
  {
    ...prospect,
    id: 4,
    first_name: "Lucas",
    last_name: "Bernard",
    email: "lucas.bernard@example.com",
    consent_status: "unknown",
    campaigns: [{ ...membership, id: 14, conversion_stage: "new", total_score: 12, interest_status: "cold" }],
  },
];

const draftItem = {
  id: "draft:c1:m1",
  kind: "validation",
  priority: "high",
  conversation_id: "c1",
  prospect: marie,
  channel: "email",
  title: "Brouillon de réponse à valider",
  detail: "Je ne sais pas si je peux financer la formation.",
  created_at: hoursAgo(2),
  draft: {
    message_id: "m1",
    content: "Bonjour Marie, la formation eBIHAR est éligible au CPF. Je vous propose d'en parler lors d'un rendez-vous.",
    sources: ["Financement & OPCO v3"],
    confidence: 0.91,
    created_at: hoursAgo(2),
  },
  handoff: null,
  recommendation: {
    action: "Valider ou modifier la réponse de l'agent",
    reason: "Objection financement détectée",
    risk: "low",
    confidence: 0.91,
    sources: ["Financement & OPCO v3"],
  },
};

const gapItem = {
  id: "handoff:c2",
  kind: "kb_gap",
  priority: "medium",
  conversation_id: "c2",
  prospect: { ...marie, id: 2, first_name: "Ahmed", last_name: "Belkacem", email: "ahmed.belkacem@example.com", level: "warm" },
  channel: "email",
  title: "Lacune de la base de connaissances",
  detail: "Le certificat est-il reconnu par l'État ?",
  created_at: hoursAgo(4),
  draft: null,
  handoff: {
    reason: "question_hors_base",
    summary: "Question sans extrait validé.",
    pending_question: "Le certificat est-il reconnu par l'État ?",
    recommended_action: "Répondre à la question",
    identity: {},
  },
  recommendation: { action: "Répondre à la question", reason: "Question sans extrait validé.", risk: "medium", confidence: null, sources: [] },
};

const todoItems = [draftItem, gapItem];

const conversationSummary = {
  id: "c1",
  prospect_id: 1,
  channel: "email",
  status: "open",
  last_message_at: hoursAgo(2),
  message_count: 2,
  last_message_role: "prospect",
  last_message_preview: "Le programme m'intéresse mais je ne sais pas si je peux le financer.",
  handoff: null,
  prospect: marie,
};

const conversation = {
  id: "c1",
  prospect_id: 1,
  channel: "email",
  status: "open",
  summary: null,
  started_at: hoursAgo(26),
  last_message_at: hoursAgo(2),
  handoff: null,
  messages: [
    { id: "m0", role: "prospect", content: "Bonjour, quelle est la durée du programme eBIHAR ?", created_at: hoursAgo(26), metadata: {} },
    {
      id: "m0b",
      role: "agent",
      content: "Bonjour Marie, le programme eBIHAR dure 18 mois.",
      created_at: hoursAgo(25),
      metadata: { sources: ["Programme eBIHAR / Durée"], validated_by: "nadia.cisse", delivery: { status: "sent" } },
    },
    { id: "m1", role: "prospect", content: "Le programme m'intéresse mais je ne sais pas si je peux le financer.", created_at: hoursAgo(2), metadata: {} },
  ],
};

const campaign = {
  id: 1,
  name: "Recrutement eBIHAR 2026",
  description: "Campagne de rentrée",
  status: "active",
  start_date: "2026-09-01T00:00:00Z",
  end_date: "2026-12-31T00:00:00Z",
  responsible_advisor_id: 1,
  responsible_advisor_name: "nadia.cisse",
  targets: [{ id: 1, code: "ebihar_students", name: "Étudiants eBIHAR" }],
  sources: [
    { id: 10, name: "LinkedIn Ads", type: "ads", platform: "linkedin", external_id: null },
    { id: 11, name: "Formulaire du site", type: "landing_page", platform: "web", external_id: null },
  ],
};

const campaigns = [
  campaign,
  {
    ...campaign,
    id: 2,
    name: "Les Compagnons — professionnels",
    status: "draft",
    description: null,
    start_date: null,
    end_date: null,
    targets: [{ id: 2, code: "compagnons_pros", name: "Professionnels Les Compagnons" }],
    sources: [{ id: 12, name: "Import salon", type: "import", platform: "csv", external_id: null }],
  },
];

const settings = {
  llm_provider: "gemini",
  llm_model: "gemini-2.5-flash",
  llm_fallback_model: "",
  llm_temperature: 0.3,
  agent_auto_reply: true,
  follow_up_window_start_hour: 8,
  follow_up_window_end_hour: 19,
  follow_up_weekdays_only: true,
  follow_up_max_per_silence: 3,
  agent_meeting_min_score: 50,
  agent_nurture_max_score: 24,
  agent_min_confidence: 0.5,
  agent_extra_terms: "",
  email_footer: "Répondez STOP pour ne plus recevoir de messages.",
  email_ai_notice: "Ce message a été rédigé avec l'aide d'un assistant virtuel (IA).",
  email_brand_name: "DATUM Academy",
  email_brand_color: "#1f4fd8",
  email_logo_url: "",
  email_create_unknown_senders: true,
  email_poll_seconds: 60,
  calendar_timezone: "Europe/Paris",
  calendar_work_days: "1,2,3,4,5",
  calendar_work_start_hour: 9,
  calendar_work_end_hour: 18,
  calendar_slot_minutes: 30,
  calendar_min_notice_hours: 4,
  calendar_horizon_days: 14,
  calendar_buffer_minutes: 0,
  source: "console",
  gemini_api_key_set: true,
  openai_api_key_set: false,
  embedding_model: "gemini/gemini-embedding-001",
};

const members = [
  { ...advisor, is_active: true, must_change_password: false, created_at: "2026-09-01T10:00:00Z" },
  { id: 2, username: "paul.martin", email: "paul.martin@example.com", role: "ADVISOR", is_active: true, must_change_password: false, created_at: "2026-09-02T10:00:00Z" },
  { id: 3, username: "lea.roux", email: "lea.roux@example.com", role: "VIEWER", is_active: false, must_change_password: false, created_at: "2026-09-03T10:00:00Z" },
];

const page = (items: unknown[], limit: number, offset = 0) => ({ items, total: items.length, limit, offset });

/** Réponse de l'API simulée pour une requête GET, ou `undefined` si rien n'est prévu. */
function respond(path: string, query: URLSearchParams): unknown {
  const limit = Number(query.get("limit") ?? 50);
  switch (path) {
    case "/auth/me":
      return advisor;
    case "/agent/mode":
      return { mode: "assisted" };
    case "/dashboard/summary":
      return {
        agent_mode: "assisted",
        hot_prospects: [
          { id: 3, name: "Sophie Merlin", email: "sophie.merlin@example.com", stage: "qualified", level: "very_hot", total_score: 88, campaign_id: 1, campaign_name: "eBIHAR" },
        ],
        activity: { hours: 24, prospects_analysed: 24, drafts_generated: 3, sent_after_validation: 2, sent_without_validation: 0, escalations: 1, errors: 0 },
        follow_ups: [{ id: 1, prospect_id: 2, prospect_name: "Ahmed Belkacem", scheduled_at: "2026-11-20T09:00:00Z", reason: "Relance J+7" }],
        follow_ups_total: 1,
        funnel_days: 30,
        funnel: { new: 20, in_conversation: 10, qualified: 4, converted: 1 },
        leads: 35,
      };
    case "/dashboard/overview":
      return {
        days: Number(query.get("days") ?? 30),
        since: "2026-10-14T09:30:00Z",
        leads: 40,
        funnel: [
          { key: "leads", label: "Leads reçus", count: 40 },
          { key: "qualified", label: "Qualifiés", count: 20 },
          { key: "meeting", label: "Rendez-vous planifiés", count: 8 },
          { key: "applied", label: "Candidatures", count: 4 },
          { key: "converted", label: "Inscrits", count: 3 },
        ],
        by_target: [
          { key: "ebihar_students", label: "Étudiants eBIHAR", count: 30 },
          { key: null, label: "Non renseigné", count: 10 },
        ],
        by_source: [
          { key: "10", label: "LinkedIn Ads", count: 28 },
          { key: "11", label: "Formulaire du site", count: 12 },
        ],
      };
    case "/todo": {
      const kind = query.get("kind");
      const rows = todoItems.filter((item) => !kind || item.kind === kind);
      const counts: Record<string, number> = {};
      for (const item of todoItems) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      return { ...page(rows.slice(0, limit), limit), total: rows.length, counts, truncated: false };
    }
    case "/todo/item":
      return todoItems.find((item) => item.id === query.get("id"));
    case "/todo/treated":
      return { items: [], total: 0, hours: 24, truncated: false };
    case "/appointments":
      return {
        ...page(
          [
            {
              id: 9,
              prospect: { id: 3, first_name: "Sophie", last_name: "Merlin", email: "sophie.merlin@example.com" },
              advisor_id: 1,
              advisor_name: "nadia.cisse",
              start_at: "2026-11-13T13:00:00Z",
              end_at: "2026-11-13T13:30:00Z",
              status: "scheduled",
              meeting_url: "https://zoom.example/9",
            },
          ],
          limit,
        ),
      };
    case "/conversations":
      return page([conversationSummary, { ...conversationSummary, id: "c2", prospect_id: 2, status: "handed_off", prospect: gapItem.prospect, last_message_at: hoursAgo(4), last_message_preview: "Le certificat est-il reconnu par l'État ?" }], limit);
    case "/conversations/c1":
      return conversation;
    case "/conversations/c1/summary":
      return conversationSummary;
    case "/prospects":
      return query.get("pending_campaign") ? page([], limit) : page(prospects.slice(0, limit), limit);
    case "/prospects/1":
      return prospect;
    case "/prospects/1/conversation":
      return conversation;
    case "/prospects/1/agent-runs":
      return [];
    case "/prospects/1/history":
      return { score_events: [], stage_events: [] };
    case "/campaigns": {
      const status = query.get("status");
      const rows = campaigns.filter((c) => !status || c.status === status);
      return { ...page(rows.slice(0, limit), limit), total: rows.length };
    }
    case "/campaigns/overview":
      return [
        { campaign_id: 1, prospects: 12, hot: 3, meetings: 2, qualified: 5, converted: 1 },
        { campaign_id: 2, prospects: 0, hot: 0, meetings: 0, qualified: 0, converted: 0 },
      ];
    case "/campaigns/1":
      return campaign;
    case "/campaigns/1/stats":
      return {
        prospects: 12,
        average_score: 31.5,
        by_stage: { new: 5, in_conversation: 3, meeting_scheduled: 2, converted: 1, lost: 1 },
        by_level: { cold: 6, warm: 3, hot: 2, very_hot: 1 },
        by_source: [
          { source_id: 10, name: "LinkedIn Ads", platform: "linkedin", prospects: 9 },
          { source_id: 11, name: "Formulaire du site", platform: "web", prospects: 3 },
        ],
        meetings: 2,
        converted: 1,
      };
    case "/targets":
      return campaign.targets.concat(campaigns[1].targets);
    case "/integrations/email":
      return {
        configured: true,
        enabled: true,
        send_enabled: false,
        sender: "admissions@example.com",
        imap_host: "imap.example.com",
        smtp_host: "smtp.example.com",
        sandbox_recipients: ["test@example.com"],
        last_run_at: hoursAgo(1),
        last_error: null,
        last_report: null,
        outbox: { not_sent: 0, sent: 5 },
      };
    case "/integrations/calendar":
      return { provider: "none", source: "console", google_client_id: "", client_secret_set: false, default_user_id: null, redirect_uri: "http://localhost:8000/api/v1/calendar/google/callback", connections: [] };
    case "/integrations/zoom":
      return { mode: "none", source: "console", account_id: "", client_id: "", client_secret_set: false, host_user: "me", redirect_uri: "http://localhost:8000/api/v1/zoom/callback", connections: [] };
    case "/integrations/tokens":
      return [];
    case "/integrations/meta":
      return {
        configured: false,
        enabled: false,
        app_id: "",
        api_version: "v24.0",
        app_secret_set: false,
        page_access_token_set: false,
        verify_token_set: false,
        mappings: [],
        webhook_path: "/api/v1/webhooks/meta",
        last_event_at: null,
        last_success_at: null,
        last_error: null,
        received: 0,
        processed: 0,
        failed: 0,
      };
    case "/settings":
      return settings;
    case "/users":
      return page(members, limit);
    default:
      return undefined;
  }
}

/** Branche l'API simulée sur la page ; renvoie la liste des requêtes restées sans réponse prévue. */
export async function mockConsole(target: Page): Promise<string[]> {
  const unexpected: string[] = [];
  await target.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const body = request.method() === "GET" ? respond(path, url.searchParams) : undefined;
    if (body === undefined) {
      unexpected.push(`${request.method()} ${path}${url.search}`);
      await route.fulfill({ status: 404, json: { detail: "Introuvable" } });
      return;
    }
    await route.fulfill({ json: body });
  });
  return unexpected;
}
