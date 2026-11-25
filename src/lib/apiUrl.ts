export interface CorsEnvLike {
  APP_URL?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  ALLOWED_CORS_ORIGINS?: string;
}

export function normalizeBaseUrl(raw?: string | null): string {
  let trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  // Allow users to paste a bare Vercel/domain hostname such as "mon-ecole.vercel.app"
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    if (/^[a-z0-9.-]+(?::\d+)?$/i.test(trimmed) && (trimmed.includes('.') || trimmed.startsWith('localhost'))) {
      const useHttp = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed);
      trimmed = `${useHttp ? 'http' : 'https'}://${trimmed}`;
    } else {
      return '';
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function resolveApiBaseUrl(options: {
  savedUrl?: string | null;
  envUrl?: string | null;
}): string {
  const saved = normalizeBaseUrl(options.savedUrl);
  if (saved) return saved;
  const fromEnv = normalizeBaseUrl(options.envUrl);
  if (fromEnv) return fromEnv;
  return '';
}

export function requiresExternalApiUrlForTarget(options: {
  protocol?: string | null;
  isCompiledShell: boolean;
  resolvedBaseUrl?: string | null;
}): boolean {
  const proto = (options.protocol ?? '').toLowerCase();
  const isLocalPackagedOrigin =
    proto === 'file:' ||
    proto === 'capacitor:' ||
    proto === 'ionic:' ||
    proto === 'app:' ||
    options.isCompiledShell;
  return isLocalPackagedOrigin && !normalizeBaseUrl(options.resolvedBaseUrl);
}

export function buildApiUrlFromBase(path: string, base?: string | null): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBase = normalizeBaseUrl(base);
  if (normalizedBase) return `${normalizedBase}${cleanPath}`;
  return cleanPath;
}

export function isAllowedCorsOrigin(origin?: string, env: CorsEnvLike = {}): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto === 'capacitor:' || proto === 'ionic:' || proto === 'app:' || proto === 'file:') {
    return true;
  }

  if (
    (proto === 'http:' || proto === 'https:') &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return true;
  }

  if (proto === 'https:' && /^[a-z0-9-]+\.vercel\.app$/i.test(parsed.hostname) && !parsed.port) {
    return true;
  }
  if (proto === 'https:' && /^[a-z0-9-]+\.run\.app$/i.test(parsed.hostname) && !parsed.port) {
    return true;
  }

  const candidateOrigins = [
    env.APP_URL,
    env.VERCEL_URL ? `https://${env.VERCEL_URL.replace(/^https?:\/\//i, '')}` : undefined,
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//i, '')}`
      : undefined,
    ...(env.ALLOWED_CORS_ORIGINS ? env.ALLOWED_CORS_ORIGINS.split(',') : []),
  ];

  for (const candidate of candidateOrigins) {
    const normalized = normalizeBaseUrl(candidate);
    if (!normalized) continue;
    try {
      const candidateUrl = new URL(normalized);
      if (parsed.origin === candidateUrl.origin) {
        return true;
      }
    } catch {
      // Ignore malformed candidate
    }
  }
  return false;
}
