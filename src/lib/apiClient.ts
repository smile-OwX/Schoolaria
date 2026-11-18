import { isCompiledShell } from './firebase.ts';

const API_BASE_STORAGE_KEY = 'schoolaria_api_base_url';

function normalizeBaseUrl(raw?: string | null): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

export function getSavedApiBaseUrl(): string {
  try {
    if (typeof window === 'undefined') return '';
    return normalizeBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function setSavedApiBaseUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  try {
    if (typeof window !== 'undefined') {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage restriction
  }
  return normalized;
}

export function getApiBaseUrl(): string {
  const saved = getSavedApiBaseUrl();
  if (saved) return saved;
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  if (fromEnv) return fromEnv;
  return '';
}

export function requiresExternalApiUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const proto = window.location?.protocol || '';
  const isLocalPackagedOrigin =
    proto === 'file:' ||
    proto === 'capacitor:' ||
    proto === 'ionic:' ||
    proto === 'app:' ||
    (isCompiledShell() && window.location.hostname === 'localhost' && !window.location.port);
  return isLocalPackagedOrigin && !getApiBaseUrl();
}

export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  if (base) return `${base}${cleanPath}`;
  return cleanPath;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (requiresExternalApiUrl()) {
    throw new Error(
      "Aucune URL de serveur Node.js cloud configurée pour cette version compilée. Renseignez l'URL du serveur dans Établissement → Connexion Serveur."
    );
  }
  const url = buildApiUrl(path);
  try {
    return await fetch(url, init);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : '';
    throw new Error(
      `Impossible de joindre le serveur Schoolaria (${url}). Vérifiez votre connexion Internet ou l'URL du serveur${detail ? ` (${detail})` : ''}.`
    );
  }
}
