export type ApiErrorCode =
  | "VIEW_ONLY"
  | "SUPER_ADMIN_ONLY"
  | "UNAUTHENTICATED"
  | string;

export class ApiError extends Error {
  status: number;
  code?: ApiErrorCode;
  data: any;

  constructor(message: string, status: number, code?: ApiErrorCode, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// ── global "access denied" modal hook-up ─────────────────────────────────────

type DenyHandler = (message: string, code: ApiErrorCode) => void;
let denyHandler: DenyHandler = () => {};

/** Called once from <AccessDeniedProvider /> so any 403 opens the modal. */
export function registerAccessDeniedHandler(fn: DenyHandler): void {
  denyHandler = fn;
}

// ── base url ─────────────────────────────────────────────────────────────────

function normalizeApiBaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL || null);

function getAuthHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("termipay_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Use this instead of raw fetch() for every admin API call.
 *
 * On a 403 with code VIEW_ONLY or SUPER_ADMIN_ONLY it automatically opens
 * the global access-denied modal and throws an ApiError, so the calling
 * component doesn't need its own handling.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
      ...(init.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.message || data?.error || `Request failed with status ${response.status}`;
    const code: ApiErrorCode | undefined = data?.code;

    if (response.status === 403 && (code === "VIEW_ONLY" || code === "SUPER_ADMIN_ONLY")) {
      denyHandler(message, code);
    }

    if (response.status === 401) {
      // token expired / account disabled — bounce to login
      window.localStorage.removeItem("termipay_auth_token");
    }

    throw new ApiError(message, response.status, code, data);
  }

  return data;
}

export const api = {
  get:    (path: string) => apiFetch(path, { method: "GET" }),
  post:   (path: string, body?: unknown) =>
            apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put:    (path: string, body?: unknown) =>
            apiFetch(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch:  (path: string, body?: unknown) =>
            apiFetch(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: (path: string) => apiFetch(path, { method: "DELETE" }),
};