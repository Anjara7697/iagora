"use client";

import { Button, Chip, Description } from "@heroui/react";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Box } from "@/components/ds/card";
import { Btn, Field, TextInput, TextLink } from "@/components/ds/controls";
import { SourceAvatar } from "@/components/ds/SourceAvatars";
import { useApi } from "@/lib/useApi";
import type { EmailStatus, MetaSettings, ServiceToken } from "@/lib/types";

export type ConnectorId = "meta" | "form" | "import" | "email" | "linkedin";

/** Source ajoutée à une campagne : le connecteur choisi fixe le type et la plateforme ; `external_id` = formulaire Meta. */
export type SourceDraft = {
  connector: ConnectorId;
  name: string;
  type: string;
  platform: string;
  external_id: string;
};

export type Connector = {
  id: ConnectorId;
  title: string;
  description: string;
  platform: string;
  type: string;
  defaultName: string;
  soon?: boolean;
};

export const CONNECTORS: Connector[] = [
  {
    id: "meta",
    title: "Meta Lead Ads",
    description: "Formulaires instantanés Facebook et Instagram : chaque formulaire alimente la campagne.",
    platform: "meta",
    type: "ads",
    defaultName: "Meta Lead Ads",
  },
  {
    id: "form",
    title: "Formulaire du site ou n8n",
    description: "Un jeton de service envoie les prospects d'un formulaire web ou d'un outil d'automatisation.",
    platform: "web",
    type: "form",
    defaultName: "Formulaire du site",
  },
  {
    id: "import",
    title: "Import CSV",
    description: "Un fichier de prospects (salon, export Excel) importé avec un aperçu avant création.",
    platform: "web",
    type: "import",
    defaultName: "Import CSV",
  },
  {
    id: "email",
    title: "Boîte email",
    description: "Les messages reçus sur la boîte de l'agent sont rattachés à cette source.",
    platform: "email",
    type: "form",
    defaultName: "Boîte email",
  },
  {
    id: "linkedin",
    title: "LinkedIn Lead Gen",
    description: "Bientôt : en attente de l'accès à l'API LinkedIn.",
    platform: "linkedin",
    type: "ads",
    defaultName: "LinkedIn Lead Gen",
    soon: true,
  },
];

type State = { tone: "success" | "warning" | "default"; label: string; link?: { href: string; text: string } };

/** État de chaque connecteur dans IAGORA (lu sur les réglages d'Intégrations ; l'administrateur seul y a accès). */
export function useConnectorStates(): Record<ConnectorId, State | null> {
  const meta = useApi<MetaSettings>("/integrations/meta");
  const tokens = useApi<ServiceToken[]>("/integrations/tokens");
  const email = useApi<EmailStatus>("/integrations/email");
  const settings = { href: "/integrations", text: "Ouvrir Intégrations" };
  return {
    meta: meta.loading
      ? null
      : meta.data?.configured
        ? meta.data.enabled
          ? { tone: "success", label: "Connectée" }
          : { tone: "warning", label: "Configurée, inactive", link: settings }
        : { tone: "warning", label: "À connecter", link: settings },
    form: tokens.loading
      ? null
      : tokens.data?.length
        ? { tone: "success", label: `${tokens.data.length} jeton${tokens.data.length > 1 ? "s" : ""}` }
        : { tone: "default", label: "Jeton à créer", link: settings },
    import: { tone: "success", label: "Disponible" },
    email: email.loading
      ? null
      : email.data?.configured
        ? { tone: "success", label: "Connectée" }
        : { tone: "warning", label: "À configurer", link: settings },
    linkedin: { tone: "default", label: "Bientôt" },
  };
}

/** Ce que l'administrateur doit encore faire pour qu'une source reçoive des prospects. */
export function draftState(s: SourceDraft): { tone: "success" | "warning" | "default"; label: string; help: ReactNode } {
  switch (s.connector) {
    case "meta":
      return s.external_id.trim()
        ? { tone: "success", label: "Formulaire associé", help: "Le formulaire sera associé à la campagne dès sa création." }
        : { tone: "warning", label: "À finaliser", help: "Sans identifiant, associez le formulaire plus tard dans Intégrations → Meta Lead Ads." };
    case "form":
      return {
        tone: "default",
        label: "Jeton à créer",
        help: "Après la création, créez le jeton dans Intégrations → Formulaire du site, rangé dans cette source.",
      };
    case "import":
      return { tone: "success", label: "Prêt", help: "Vous importerez le fichier depuis Prospects → Importer un CSV, en choisissant cette source." };
    default:
      return { tone: "success", label: "Prêt", help: "Les messages reçus sur la boîte de l'agent seront rattachés à cette source." };
  }
}

/** Catalogue de cartes de connecteurs : état de chaque connecteur (lu sur Intégrations) et bouton « Ajouter ». */
export function ConnectorCatalogue({ onAdd }: { onAdd: (connector: Connector) => void }) {
  const states = useConnectorStates();
  return (
    <section aria-label="Connecteurs disponibles" className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium text-foreground">Ajouter une source</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CONNECTORS.map((c) => {
          const state = states[c.id];
          return (
            <Box as="li" key={c.id} className="gap-3 p-4" aria-label={c.title}>
              <div className="flex items-center gap-3">
                <SourceAvatar platform={c.platform} name={c.title} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{c.title}</span>
                {state && (
                  <Chip size="sm" variant="soft" color={state.tone}>
                    <Chip.Label>{state.label}</Chip.Label>
                  </Chip>
                )}
              </div>
              <Description>{c.description}</Description>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="outline" className="rounded-lg" isDisabled={c.soon} onPress={() => onAdd(c)} aria-label={`Ajouter ${c.title}`}>
                  <Plus className="size-4" aria-hidden="true" />
                  Ajouter
                </Button>
                {state?.link && <TextLink href={state.link.href} className="text-xs">{state.link.text}</TextLink>}
              </div>
            </Box>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Sources d'une campagne présentées comme des connecteurs : un catalogue de cartes (avec l'état de chaque connecteur)
 * puis les sources ajoutées, chacune avec ce qui reste à faire pour recevoir des prospects.
 */
export default function SourceConnectors({ value, onChange }: { value: SourceDraft[]; onChange: (value: SourceDraft[]) => void }) {
  const add = (c: Connector) =>
    onChange([...value, { connector: c.id, name: c.defaultName, type: c.type, platform: c.platform, external_id: "" }]);
  const patch = (index: number, change: Partial<SourceDraft>) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...change } : s)));

  return (
    <div className="flex flex-col gap-5">
      <ConnectorCatalogue onAdd={add} />

      <section aria-label="Sources de cette campagne" className="flex flex-col gap-3">
        <h3 className="text-[13px] font-medium text-foreground">
          Sources de cette campagne <span className="font-normal text-muted">({value.length})</span>
        </h3>
        {value.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            Aucune source pour l’instant. Vous pourrez en ajouter plus tard depuis la fiche de la campagne.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {value.map((s, i) => {
            const connector = CONNECTORS.find((c) => c.id === s.connector) ?? CONNECTORS[0];
            const state = draftState(s);
            return (
              <Box as="li" key={i} className="gap-3 p-4" aria-label={`Source ${i + 1} : ${connector.title}`}>
                <div className="flex items-center gap-3">
                  <SourceAvatar platform={s.platform} name={connector.title} />
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{connector.title}</span>
                  <Chip size="sm" variant="soft" color={state.tone}>
                    <Chip.Label>{state.label}</Chip.Label>
                  </Chip>
                  <Btn variant="ghost" size="sm" className="rounded-lg" aria-label={`Retirer la source ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                    <X className="size-4" aria-hidden="true" />
                    Retirer
                  </Btn>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nom de la source">
                    <TextInput variant="secondary" aria-label={`Nom de la source ${i + 1}`} value={s.name} onChange={(e) => patch(i, { name: e.target.value })} />
                  </Field>
                  {s.connector === "meta" && (
                    <Field label="Identifiant du formulaire (facultatif)">
                      <TextInput
                        variant="secondary"
                        aria-label={`Identifiant du formulaire Meta ${i + 1}`}
                        inputMode="numeric"
                        placeholder="ex. 1234567890"
                        value={s.external_id}
                        onChange={(e) => patch(i, { external_id: e.target.value })}
                      />
                    </Field>
                  )}
                </div>
                <Description>{s.connector === "meta" ? "Dans Meta : Gestionnaire de publicités → Formulaires instantanés. " + String(state.help) : state.help}</Description>
              </Box>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
