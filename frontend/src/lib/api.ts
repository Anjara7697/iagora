export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// Le simulateur crée des données de test : désactivable pour un déploiement réel.
export const SIMULATOR_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_SIMULATOR !== "false";

const TOKEN_KEY = "iagora.token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible (navigation privée) : la session ne sera pas conservée */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Options = {
  method?: string;
  body?: unknown;
  form?: Record<string, string>;
  /** Envoi de fichier (multipart) : le navigateur fixe lui-même l'en-tête Content-Type. */
  multipart?: FormData;
};

const UUID =
  /\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const GENERIC: Record<number, string> = {
  403: "Votre rôle ne permet pas cette action.",
  404: "Élément introuvable : il a peut-être été supprimé ou déplacé.",
  409: "Cette action entre en conflit avec une modification récente. Rechargez la page.",
  413: "Fichier trop volumineux.",
  429: "Trop de demandes en peu de temps : patientez quelques secondes.",
};
// Messages techniques renvoyés tels quels par certaines briques : jamais affichés bruts.
const RAW = new Set([
  "introuvable",
  "not found",
  "forbidden",
  "droits insuffisants",
  "internal server error",
  "erreur interne du serveur",
  "unprocessable entity",
]);

/** Message d'erreur lisible par un conseiller, sans identifiant technique. */
export function humanError(status: number, payload: unknown): string {
  let detail: string | null = null;
  if (payload && typeof payload === "object" && "detail" in payload) {
    const raw = (payload as { detail: unknown }).detail;
    if (typeof raw === "string") detail = raw;
    else if (Array.isArray(raw) && raw[0]) {
      // Erreur de validation (422) : on nomme le champ plutôt que le message anglais.
      const loc = Array.isArray(raw[0].loc) ? raw[0].loc : [];
      const field = loc.length ? String(loc[loc.length - 1]) : null;
      return field && field !== "body"
        ? `Information manquante ou invalide (champ « ${field} »).`
        : "Information manquante ou invalide : vérifiez le formulaire.";
    }
  }
  if (status >= 500)
    return "Le serveur a rencontré une erreur. Réessayez dans un instant ; si cela continue, prévenez l’administrateur.";
  if (detail && !RAW.has(detail.trim().toLowerCase()))
    return detail
      .replace(UUID, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  return GENERIC[status] ?? `Erreur ${status} : réessayez dans un instant.`;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.multipart) {
    body = options.multipart;
  } else if (options.form) {
    body = new URLSearchParams(options.form);
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable : le backend est-il démarré ?");
  }
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    setToken(null);
    window.location.assign("/login");
  }
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      res.status,
      "Réponse du serveur illisible. Réessayez dans quelques instants.",
    );
  }
  if (!res.ok) throw new ApiError(res.status, humanError(res.status, payload));
  return payload as T;
}

export function qs(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Télécharge un fichier (export CSV) avec la session en cours. */
export async function download(path: string, filename: string): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable : le backend est-il démarré ?");
  }
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, humanError(res.status, payload));
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
