import type { Message } from "@/lib/types";

/** Messages types pour tester rapidement les cas importants du cahier des charges. */
export const SCENARIOS: { title: string; message: string }[] = [
  { title: "Durée", message: "Combien de temps dure le programme ?" },
  { title: "Admission", message: "Quelles sont les conditions d'admission ?" },
  { title: "Prix", message: "Combien coûte la formation ?" },
  {
    title: "Financement (hors base)",
    message: "Puis-je financer la formation avec mon CPF ?",
  },
  { title: "Programmes", message: "Quelles formations proposez-vous ?" },
  {
    title: "Rendez-vous",
    message: "Je voudrais prendre rendez-vous avec un conseiller.",
  },
  {
    title: "Veut un conseiller",
    message: "Je préfère parler directement à un conseiller.",
  },
  {
    title: "Situation sensible",
    message: "Je vais porter plainte contre votre école.",
  },
  { title: "Pas intéressé", message: "Non merci, ça ne m'intéresse pas." },
  { title: "Désinscription", message: "STOP, ne m'écrivez plus." },
];

export const END_ACTIONS = ["human_handoff", "close", "opt_out"];

export function pendingDraft(messages: Message[]): Message | undefined {
  const last = [...messages].reverse().find((m) => {
    const status = (m.metadata.draft as { status?: string } | undefined)
      ?.status;
    return (
      m.role === "agent" &&
      status !== "rejected" &&
      status !== "superseded" &&
      status !== "cancelled"
    );
  });
  const status = (last?.metadata.draft as { status?: string } | undefined)
    ?.status;
  return status === "pending" ? last : undefined;
}
