/** Une adresse en https:// complète, sans espace, comme l'exige l'API pour les liens d'une campagne (D-39). */
export function isHttpsUrl(value: string): boolean {
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}
