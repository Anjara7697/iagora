import { loginHref } from "./session/returnPath";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// Le simulateur crée des données de test : désactivable pour un déploiement réel.
export const SIMULATOR_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_SIMULATOR !== "false";

// Session : témoin HttpOnly posé par l'API (AUDIT-SEC-004), jamais lisible par la page. Le
// navigateur l'envoie seul (`credentials: "include"`) ; l'en-tête ci-dessous, exigé par l'API sur
// les écritures, ne peut pas être posé par un formulaire d'un autre site (anti-CSRF).
const CSRF_HEADERS = { "X-IAGORA-CSRF": "1" };
const LEGACY_TOKEN_KEY = "iagora.token";

/** Efface le jeton des versions précédentes de la console (stocké dans `localStorage`). */
export function forgetLegacyToken(): void {
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

/** Ferme la session côté serveur (le témoin est effacé par la réponse). Ne lève jamais. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: CSRF_HEADERS,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    /* serveur injoignable : la session expirera d'elle-même */
  }
}

/** Requête qui n'a pas atteint le serveur (réseau coupé, serveur arrêté) : dit quoi faire, sans terme technique. */
const NETWORK_ERROR = "Serveur injoignable : vérifiez votre connexion internet, puis réessayez dans un instant.";

export class ApiError extends Error {
  // Champ déclaré à part (pas de propriété de paramètre) : syntaxe que Node sait exécuter en retirant les types
  // (`erasableSyntaxOnly`), pour les tests unitaires.
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  form?: Record<string, string>;
  /** Envoi de fichier (multipart) : le navigateur fixe lui-même l'en-tête Content-Type. */
  multipart?: FormData;
  /** Abandon par l'appelant (écran quitté, filtre changé) : la promesse est rejetée par une `AbortError`. */
  signal?: AbortSignal;
  /**
   * Délai maximal d'une lecture (GET), 30 s par défaut (DATA-05). Les écritures n'en ont pas : abandonner côté
   * navigateur n'arrête pas le serveur, et l'utilisateur risquerait de recommencer une action déjà faite.
   */
  timeoutMs?: number;
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
/** Message d'échec d'une action : ce qui a échoué d'abord, puis le détail du serveur (règle 12 des parcours). */
export function failure(what: string, error: unknown): string {
  return `${what}${error instanceof ApiError ? ` : ${error.message}` : "."}`;
}

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
  // Un message métier explicite (« Service temporairement indisponible ») est gardé.
  if (detail && !RAW.has(detail.trim().toLowerCase()))
    return detail
      .replace(UUID, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  if (status >= 500) {
    // Référence de la requête (journaux du serveur), à transmettre à l'administrateur.
    const ref =
      payload && typeof payload === "object" && "request_id" in payload
        ? String((payload as { request_id: unknown }).request_id ?? "")
        : "";
    return `Le serveur a rencontré une erreur. Réessayez dans un instant ; si cela continue, prévenez l’administrateur${
      /^[A-Za-z0-9._-]{1,64}$/.test(ref) ? ` (référence ${ref})` : ""
    }.`;
  }
  return GENERIC[status] ?? `Erreur ${status} : réessayez dans un instant.`;
}

const GET_TIMEOUT_MS = 30_000;
const TIMEOUT_ERROR = "Le serveur met trop de temps à répondre : réessayez dans un instant.";

/** Requête abandonnée par l'appelant (pas une erreur à afficher). */
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const writeListeners = new Set<() => void>();

/** Appelé après chaque écriture envoyée (POST, PUT, PATCH, DELETE), réussie ou non : les lectures gardées sont périmées. */
export function onApiWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/** Redirection vers la connexion déjà demandée (la page va être remplacée). */
let redirectingToLogin = false;

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...CSRF_HEADERS };
  let body: BodyInit | undefined;
  if (options.multipart) {
    body = options.multipart;
  } else if (options.form) {
    body = new URLSearchParams(options.form);
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const method = options.method ?? "GET";
  const timeout = method === "GET" ? AbortSignal.timeout(options.timeoutMs ?? GET_TIMEOUT_MS) : null;
  const signal = timeout && options.signal ? AbortSignal.any([options.signal, timeout]) : (timeout ?? options.signal);
  /** Échec d'envoi ou de lecture : abandon voulu (relancé tel quel), délai dépassé, ou réseau. */
  const failed = (error: unknown): never => {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, timeout?.aborted ? TIMEOUT_ERROR : NETWORK_ERROR);
  };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body, signal, credentials: "include", cache: "no-store" });
  } catch (error) {
    return failed(error);
  } finally {
    if (method !== "GET") for (const listener of writeListeners) listener();
  }
  // Session absente ou expirée : connexion, puis retour à la page en cours (NAV-03). Une seule redirection même si
  // plusieurs requêtes échouent ensemble : une seconde rechargerait la page de connexion pendant la saisie.
  if (res.status === 401 && !path.startsWith("/auth/login") && window.location.pathname !== "/login" && !redirectingToLogin) {
    redirectingToLogin = true;
    window.location.assign(loginHref(window.location.pathname + window.location.search));
  }
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    return failed(error);
  }
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
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: CSRF_HEADERS,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
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
