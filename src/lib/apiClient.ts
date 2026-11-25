import { isCompiledShell } from './firebase.ts';
import {
  buildApiUrlFromBase,
  normalizeBaseUrl,
  requiresExternalApiUrlForTarget,
  resolveApiBaseUrl,
} from './apiUrl.ts';

const API_BASE_STORAGE_KEY = 'schoolaria_api_base_url';

export { normalizeBaseUrl };

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
  return resolveApiBaseUrl({
    savedUrl: getSavedApiBaseUrl(),
    envUrl: import.meta.env.VITE_API_BASE_URL,
  });
}

export function requiresExternalApiUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return requiresExternalApiUrlForTarget({
    protocol: window.location?.protocol || '',
    isCompiledShell: isCompiledShell(),
    resolvedBaseUrl: getApiBaseUrl(),
  });
}

export function buildApiUrl(path: string, explicitBase?: string): string {
  const base = explicitBase !== undefined ? explicitBase : getApiBaseUrl();
  return buildApiUrlFromBase(path, base);
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (requiresExternalApiUrl()) {
    throw new Error(
      "Aucune URL de serveur Vercel / Node.js n'est configurée pour cette application compilée. Renseignez l'URL de votre site Vercel (ex : https://mon-ecole.vercel.app) dans Établissement → Serveur Cloud Node.js."
    );
  }

  const url = buildApiUrl(path);
  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type') || '';
    if ((response.status === 404 || response.status === 405) && contentType.includes('text/html')) {
      throw new Error(
        `Le serveur cible (${url}) n'expose pas la route API attendue (réponse HTML ${response.status}). Vérifiez l'URL Vercel dans Établissement → Serveur Cloud Node.js.`
      );
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Serveur Cloud Node.js')) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : '';
    throw new Error(
      `Impossible de joindre le serveur Schoolaria (${url}). Vérifiez votre connexion Internet ou l'URL Vercel configurée${detail ? ` (${detail})` : ''}.`
    );
  }
}
