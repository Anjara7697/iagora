/**
 * Contrat frontend / API (AUDIT-ARCH-003), vérifié au typecheck.
 *
 * Les types de `lib/types.ts` sont écrits à la main ; `schema.d.ts` est généré depuis l'OpenAPI du
 * backend (`npm run api:types`). Chaque ligne ci-dessous échoue à la compilation si un champ lu par
 * la console n'existe plus dans la réponse de l'API (champ renommé ou supprimé) : la CI casse au lieu
 * de l'écran. Pour ajouter un type, ajouter une ligne ; un champ calculé côté console s'exclut avec Omit.
 */
import type { components } from "./schema";
import type * as T from "../types";

type S = components["schemas"];
/** Champs du type de la console absents du schéma de l'API (doit être `never`). */
type Missing<Console, Api> = Exclude<keyof Console, keyof Api>;
type Expect<Keys extends never> = Keys;

export type ApiContract = [
  Expect<Missing<T.User, S["UserRead"]>>,
  Expect<Missing<T.CreatedUser, S["UserCreated"]>>,
  Expect<Missing<T.Membership, S["CampaignMembershipRead"]>>,
  Expect<Missing<T.Prospect, S["ProspectDetail"]>>,
  Expect<Missing<T.Target, S["TargetRead"]>>,
  Expect<Missing<T.Source, S["SourceRead"]>>,
  Expect<Missing<T.MetaFormMapping, S["MetaFormMapping"]>>,
  Expect<Missing<T.MetaSettings, S["MetaConfigRead"]>>,
  Expect<Missing<T.Campaign, S["CampaignRead"]>>,
  Expect<Missing<T.CampaignStats, S["CampaignStats"]>>,
  Expect<Missing<T.CampaignOverview, S["CampaignOverview"]>>,
  Expect<Missing<T.Message, S["MessageRead"]>>,
  Expect<Missing<T.Conversation, S["ConversationRead"]>>,
  Expect<Missing<T.ConversationProspect, S["ConversationProspect"]>>,
  Expect<Missing<T.ConversationSummary, S["ConversationSummary"]>>,
  Expect<Missing<T.TraceEntry, S["TraceRead"]>>,
  Expect<Missing<T.AgentRun, S["AgentRunResult"]>>,
  Expect<Missing<T.TodoItem, S["TodoItem"]>>,
  Expect<Missing<T.TodoPage, S["TodoPage"]>>,
  Expect<Missing<T.KnowledgeStatus, S["KnowledgeStatus"]>>,
  Expect<Missing<T.KnowledgeDocument, S["DocumentRead"]>>,
  Expect<Missing<T.KnowledgeDocumentDetail, S["DocumentDetailRead"]>>,
  Expect<Missing<T.SearchHit, S["SearchHit"]>>,
  Expect<Missing<T.SearchResult, S["SearchResult"]>>,
  Expect<Missing<T.EmailStatus, S["EmailStatus"]>>,
  Expect<Missing<T.EmailCheck, S["EmailCheck"]>>,
  Expect<Missing<T.DashboardSummary, S["DashboardSummary"]>>,
  Expect<Missing<T.TreatedItem, S["TreatedItem"]>>,
  Expect<Missing<T.TreatedPage, S["TreatedPage"]>>,
  Expect<Missing<T.EmailConfig, S["EmailConfigRead"]>>,
  Expect<Missing<T.EmailAutodetect, S["EmailAutodetect"]>>,
  Expect<Missing<T.EmailTestResult, S["EmailTestResult"]>>,
  Expect<Missing<T.CalendarSettings, S["CalendarSettingsRead"]>>,
  Expect<Missing<T.MyCalendar, S["MyCalendarRead"]>>,
  Expect<Missing<T.ZoomSettings, S["ZoomSettingsRead"]>>,
  Expect<Missing<T.MyZoom, S["MyZoomRead"]>>,
  Expect<Missing<T.RuntimeSettings, S["RuntimeSettingsRead"]>>,
  Expect<Missing<T.ErasureReport, S["ErasureReport"]>>,
  Expect<Missing<T.ServiceToken, S["ServiceTokenCreated"]>>, // `token` : seulement à la création
  Expect<Missing<T.ImportReport, S["ImportReport"]>>,
  Expect<Missing<T.Appointment, S["AppointmentRead"]>>,
  Expect<Missing<T.DashboardOverview, S["DashboardOverview"]>>,
  Expect<Missing<T.Analytics, S["Analytics"]>>,
];
