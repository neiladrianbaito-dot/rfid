const DEFAULT_DEV_API_ORIGIN = "http://localhost:8080";

function normalizeApiOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export function getApiOrigin(): string {
  const configured = normalizeApiOrigin(import.meta.env.VITE_API_URL || null);
  if (configured) return configured;
  if (import.meta.env.DEV) return DEFAULT_DEV_API_ORIGIN;
  return window.location.origin;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiPath = normalizedPath.startsWith("/api/")
    ? normalizedPath
    : `/api${normalizedPath}`;
  return `${getApiOrigin()}${apiPath}`;
}
