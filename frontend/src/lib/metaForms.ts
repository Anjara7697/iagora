import { api } from "@/lib/api";
import type { Campaign, MetaFormMapping, MetaSettings } from "@/lib/types";

/** Formulaire Meta saisi pour une source : identifiant du formulaire et nom de la source. */
export type MetaFormDraft = { connector: string; name: string; external_id: string };

/**
 * Associe à la campagne créée les formulaires Meta saisis à l'étape des sources (identifiant du formulaire → campagne,
 * source, programme s'il est unique). Renvoie un message si l'association n'a pas pu se faire : la campagne existe déjà.
 */
export async function linkMetaForms(created: Campaign, drafts: MetaFormDraft[]): Promise<string | null> {
  const forms = drafts.filter((s) => s.connector === "meta" && s.external_id.trim());
  if (forms.length === 0) return null;
  try {
    const cfg = await api<MetaSettings>("/integrations/meta");
    if (!cfg.configured) return "Meta n’est pas encore connectée : associez le formulaire dans Intégrations → Meta Lead Ads.";
    const added = forms.flatMap((draft): MetaFormMapping[] => {
      const source = created.sources.find((x) => x.platform === "meta" && x.external_id === draft.external_id.trim());
      return source
        ? [
            {
              form_id: draft.external_id.trim(),
              form_name: draft.name.trim(),
              campaign_id: created.id,
              source_id: source.id,
              target_code: created.targets.length === 1 ? created.targets[0].code : null,
              enabled: true,
            },
          ]
        : [];
    });
    await api("/integrations/meta", {
      method: "PUT",
      body: {
        app_id: cfg.app_id,
        api_version: cfg.api_version,
        enabled: cfg.enabled,
        mappings: [...cfg.mappings.filter((m) => !added.some((a) => a.form_id === m.form_id)), ...added],
        app_secret: null,
        page_access_token: null,
        verify_token: null,
      },
    });
    return null;
  } catch {
    return "Le formulaire Meta n’a pas pu être associé : faites-le dans Intégrations → Meta Lead Ads.";
  }
}
