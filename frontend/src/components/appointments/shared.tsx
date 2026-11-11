"use client";

import { Video, VideoOff } from "lucide-react";
import { LinkButton, Tag, type Tone } from "@/components/ds/controls";
import { APPOINTMENT_STATUS, label } from "@/lib/labels";
import type { Appointment } from "@/lib/types";

/** Couleur du statut d'un rendez-vous (palette commune aux écrans Rendez-vous et Aujourd'hui). */
export const APPOINTMENT_TONES: Record<string, Tone> = {
  proposed: "warning",
  scheduled: "accent",
  done: "success",
  cancelled: "neutral",
  no_show: "danger",
};

/** Lien de visio navigable (http ou https) ; toute autre valeur est ignorée. */
export function meetingLink(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Formats d'heure et de jour dans le fuseau du navigateur. */
export function timeFormats(timeZone: string) {
  return {
    hour: (value: string) =>
      new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value)),
    day: (value: string) =>
      new Intl.DateTimeFormat("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone,
      }).format(new Date(value)),
  };
}

export function AppointmentStatus({ status }: { status: string }) {
  return <Tag tone={APPOINTMENT_TONES[status] ?? "neutral"}>{label(APPOINTMENT_STATUS, status)}</Tag>;
}

export function MeetingLink({ appointment, name }: { appointment: Appointment; name: string }) {
  const url = meetingLink(appointment.meeting_url);
  return url ? (
    <LinkButton
      href={url}
      variant="secondary"
      size="sm"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ouvrir la visio de ${name} dans un nouvel onglet`}
    >
      <Video className="size-4" aria-hidden="true" />
      Ouvrir la visio
    </LinkButton>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <VideoOff className="size-4" aria-hidden="true" />
      Lien visio non disponible
    </span>
  );
}
