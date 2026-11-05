/** Une plateforme décrit une provenance, pas un connecteur déjà branché. */
export function sourceReception(source: { type?: string; platform?: string }) {
  if (source.type === "import") return {
    label: "Import CSV",
    description: "Importez un fichier avec aperçu. L’import ne déclenche aucun message de l’agent.",
    connector: null,
  };
  if (source.platform === "meta" && source.type === "ads") return {
    label: "Formulaire instantané Meta",
    description: "Créez la publicité et son formulaire dans Meta. Associez ensuite l’identifiant du formulaire à cette source ; le webhook recevra les contacts.",
    connector: "meta",
  };
  if (source.platform === "linkedin" && source.type === "ads") return {
    label: "LinkedIn : réception manuelle",
    description: "La synchronisation LinkedIn n’est pas branchée. Importez un export autorisé en CSV, ou utilisez une publicité menant à un formulaire du site connecté à IAGORA.",
    connector: null,
  };
  if (source.platform === "email") return {
    label: "Email : attribution à vérifier",
    description: "La boîte email reçoit les messages. Le nom de cette source ne permet pas d’identifier automatiquement une campagne ; le conseiller vérifie le rattachement.",
    connector: "email",
  };
  return {
    label: "Formulaire ou outil connecté",
    description: "Créez un jeton lié à cette campagne et cette source. Le serveur du formulaire ou un outil comme n8n transmet les contacts à IAGORA.",
    connector: "leads",
  };
}

export function sourceDestinationUrl(path: string, campaignId: number, sourceId: number) {
  const [pathname, query] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("campaign", String(campaignId));
  params.set("source", String(sourceId));
  return `${pathname}?${params}`;
}
