/**
 * Contrat frontend / API (AUDIT-ARCH-003), vérifié au typecheck.
 *
 * Les types de `lib/types.ts` sont écrits à la main ; `schema.d.ts` est généré depuis l'OpenAPI du
 * backend (`npm run api:types`). Chaque ligne ci-dessous échoue à la compilation si un champ lu par
 * la console n'existe plus dans la réponse de l'API (champ renommé ou supprimé) : la CI casse au lieu
 * de l'écran. Pour ajouter un type, ajouter une ligne ; un champ calculé côté console s'exclut avec Omit.
 *
 * Les types dérivés directement du schéma dans `lib/types.ts` (DATA-04) n'ont plus besoin d'y figurer :
 * seuls restent ici ceux encore écrits à la main.
 */
import type { components } from "./schema";
import type * as T from "../types";

type S = components["schemas"];
/** Champs du type de la console absents du schéma de l'API (doit être `never`). */
type Missing<Console, Api> = Exclude<keyof Console, keyof Api>;
type Expect<Keys extends never> = Keys;

export type ApiContract = [
  Expect<Missing<T.Membership, S["CampaignMembershipRead"]>>,
  Expect<Missing<T.MetaSettings, S["MetaConfigRead"]>>,
  Expect<Missing<T.Message, S["MessageRead"]>>,
  Expect<Missing<T.Conversation, S["ConversationRead"]>>,
  Expect<Missing<T.ConversationProspect, S["ConversationProspect"]>>,
  Expect<Missing<T.ConversationSummary, S["ConversationSummary"]>>,
  Expect<Missing<T.AgentRun, S["AgentRunResult"]>>,
  Expect<Missing<T.TodoItem, S["TodoItem"]>>,
  Expect<Missing<T.TodoPage, S["TodoPage"]>>,
  Expect<Missing<T.KnowledgeDocumentDetail, S["DocumentDetailRead"]>>,
  Expect<Missing<T.EmailStatus, S["EmailStatus"]>>,
  Expect<Missing<T.TreatedItem, S["TreatedItem"]>>,
  Expect<Missing<T.TreatedPage, S["TreatedPage"]>>,
  Expect<Missing<T.EmailConfig, S["EmailConfigRead"]>>,
  Expect<Missing<T.CalendarSettings, S["CalendarSettingsRead"]>>,
  Expect<Missing<T.ZoomSettings, S["ZoomSettingsRead"]>>,
  Expect<Missing<T.ImportReport, S["ImportReport"]>>,
];
