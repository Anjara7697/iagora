/**
 * Fin de campagne : le jour de fin est inclus, en heure de Paris, comme côté agent (audit I2).
 * La console enregistre la fin à 00:00 UTC du jour choisi ; la campagne court jusqu'à la fin de ce jour.
 */
export function campaignEnded(endDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!endDate) return false;
  const endDay = endDate.slice(0, 10);
  const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
  return today > endDay;
}
