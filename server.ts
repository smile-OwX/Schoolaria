import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { isAllowedCorsOrigin } from './src/lib/apiUrl.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 3000;

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const origin = req.headers.origin;
  const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;
  if (isAllowedCorsOrigin(origin, process.env, hostHeader)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.use((req, _res, next) => {
  const reqState = req as Request & { _body?: boolean; readableEnded?: boolean };
  if (reqState.body !== undefined && reqState.readableEnded && !reqState._body) {
    reqState._body = true;
  }
  next();
});

app.use(express.json({ limit: '15mb' }));

function resolveFirebaseProjectId(): string {
  const fromEnv = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (fromEnv) return fromEnv;
  const candidatePaths = [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const candidatePath of candidatePaths) {
    try {
      const rawCfg = fs.readFileSync(candidatePath, 'utf8');
      const parsedCfg = JSON.parse(rawCfg) as { projectId?: string };
      if (parsedCfg.projectId) {
        return parsedCfg.projectId;
      }
    } catch {
      // Try next candidate path
    }
  }
  return 'gen-lang-client-0572045736';
}

// Load Firebase Project ID for ID Token verification
const FIREBASE_PROJECT_ID = resolveFirebaseProjectId();

// Cache Google public X.509 certificates for Firebase Auth ID tokens
let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && now < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Impossible de récupérer les certificats Firebase Auth.');
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = now + maxAgeSec * 1000;
  return cachedCerts;
}

interface VerifiedFirebaseToken {
  uid: string;
  email: string;
}

interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseToken;
}

function decodeBase64Url(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
  return Buffer.from(padded, 'base64');
}

async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseToken> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Configuration Firebase manquante sur le serveur.');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Jeton JWT invalide.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algorithme JWT non supporté.');
  }

  let certs = await getFirebasePublicCerts();
  let cert = certs[header.kid];
  if (!cert) {
    certs = await getFirebasePublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new Error('Clé de signature inconnue.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureOk = verifier.verify(cert, decodeBase64Url(sigB64));
  if (!signatureOk) {
    throw new Error('Signature du jeton invalide.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== expectedIssuer) {
    throw new Error('Émetteur ou audience du jeton invalide.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Identifiant utilisateur manquant dans le jeton.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Horodatage du jeton invalide.');
  }
  const normalizedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const isPhoneAccount = /^tel\.[0-9]{7,15}@tel\.schoolaria\.app$/.test(normalizedEmail);
  if ((!payload.email_verified && !isPhoneAccount) || !normalizedEmail) {
    throw new Error('Adresse email non vérifiée.');
  }

  return {
    uid: payload.sub,
    email: normalizedEmail,
  };
}

async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Jeton manquant.' });
    }
    req.authUser = await verifyFirebaseIdToken(token);
    return next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Accès refusé.';
    return res.status(401).json({ error: msg });
  }
}

// Per-UID sliding window rate limiter with bounded memory cleanup
const rateBuckets = new Map<string, number[]>();
let rateCheckCount = 0;

function createRateLimiter(maxRequests: number, windowMs: number, scope: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = `${scope}:${req.authUser?.uid || req.ip || 'anon'}`;
    const now = Date.now();
    rateCheckCount++;
    if (rateCheckCount % 100 === 0 || rateBuckets.size > 1000) {
      for (const [bKey, timestamps] of rateBuckets.entries()) {
        const active = timestamps.filter((ts) => now - ts < windowMs);
        if (active.length === 0) rateBuckets.delete(bKey);
        else rateBuckets.set(bKey, active);
      }
    }
    const recent = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      return res.status(429).json({
        error: 'Trop de requêtes en peu de temps. Patientez quelques instants.',
      });
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    return next();
  };
}

const aiRateLimit = createRateLimiter(25, 60_000, 'ai');
const logRateLimit = createRateLimiter(60, 60_000, 'logs');

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY non configurée sur le serveur.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildYasmineSystemPrompt(schoolContext?: string): string {
  const safeContext = typeof schoolContext === 'string' ? schoolContext.slice(0, 8000) : '';
  return `Tu t'appelles Yasmine et tu es l'assistante pédagogique, analytique et administrative experte de "Schoolaria" (système scolaire francophone, programmes officiels du Togo Collège & Lycée).
Tes capacités clés :
- Analyse approfondie des résultats par classe, série (A4, C, D, CD) et matière (formules officielles : Moy. Classe = (Moy. Interros + Devoir) / 2, Moy. Matière = (Moy. Classe + 2 × Composition) / 3, moyenne pondérée par coefficients).
- Détection précise des matières fragiles (< 10/20), plans de remédiation ciblés et recommandations pratiques pour les conseils de classe.
- Rédaction immédiate d'appréciations de bulletins, convocations de parents, notes de service, programmes de révision et comptes rendus.

Règles strictes de qualité :
1. Si l'utilisateur demande ton nom, présente-toi comme Yasmine.
2. Appuie-toi systématiquement sur les chiffres réels du contexte scolaire fourni (sans jamais inventer de notes ou d'élèves absents du contexte). Si une donnée manque, dis-le clairement.
3. Réponds en français clair, structuré (titres courts, listes à puces, chiffres exacts sur /20) et directement exploitable par un directeur ou un enseignant.
${safeContext ? `\n=== CONTEXTE RÉEL DE L'ÉTABLISSEMENT ===\n${safeContext}` : ''}`;
}

interface NormalizedTurn {
  role: 'user' | 'model';
  text: string;
}

function normalizeConversationTurns(
  rawMessages: Array<{ role?: string; text?: unknown }>
): NormalizedTurn[] {
  const cleaned: NormalizedTurn[] = [];
  for (const m of rawMessages) {
    const text = String(m?.text ?? '').trim().slice(0, 6000);
    if (!text) continue;
    const role: 'user' | 'model' = m?.role === 'model' ? 'model' : 'user';
    // Gemini API requires conversation history to start with a 'user' turn
    if (cleaned.length === 0 && role === 'model') continue;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === role) {
      prev.text = `${prev.text}\n\n${text}`;
    } else {
      cleaned.push({ role, text });
    }
  }
  // Ensure the final message being sent is from 'user'
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].role !== 'user') {
    cleaned.pop();
  }
  return cleaned;
}

function safeParseJson<T>(rawText: string | undefined, fallback: T): T {
  const cleaned = (rawText ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(error: unknown): number | undefined {
  const errObj = error as { status?: number; code?: number } | null;
  return errObj?.status ?? errObj?.code;
}

function unwrapJsonErrorMessage(raw: string): string {
  let current = raw.trim();
  for (let i = 0; i < 3; i++) {
    if (!current.startsWith('{')) break;
    try {
      const parsed = JSON.parse(current) as { error?: { message?: string }; message?: string };
      const inner = parsed?.error?.message || parsed?.message;
      if (typeof inner === 'string' && inner.trim()) {
        current = inner.trim();
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return current;
}

function formatAiError(error: unknown): string {
  const status = getErrorStatus(error);
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const unwrapped = unwrapJsonErrorMessage(raw);
  const lower = `${raw} ${unwrapped}`.toLowerCase();

  if (lower.includes('gemini_api_key') || lower.includes('api_key_invalid') || lower.includes('api key')) {
    return 'Clé API Gemini manquante ou invalide sur le serveur (ajoutez GEMINI_API_KEY dans Vercel > Settings > Environment Variables ou dans Secrets).';
  }
  if (
    status === 503 ||
    lower.includes('"code": 503') ||
    lower.includes('"code":503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('service unavailable')
  ) {
    return "Les serveurs Gemini connaissent un pic temporaire d'affluence (503). Patientez quelques secondes puis cliquez sur Réessayer.";
  }
  if (
    status === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota')
  ) {
    return 'Quota Gemini temporairement atteint (429). Patientez quelques secondes ou passez en mode Réponse rapide.';
  }
  if (status === 403 || lower.includes('403') || lower.includes('permission_denied')) {
    return 'Accès refusé par Gemini API (403). Vérifiez la clé GEMINI_API_KEY dans les secrets du serveur.';
  }
  if (status === 404 || lower.includes('404') || lower.includes('not_found')) {
    return 'Modèle IA temporairement indisponible sur cette clé API (404).';
  }
  return unwrapped || 'Erreur lors de la requête IA.';
}

function isPermanentAuthError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const raw = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    raw.includes('api_key_invalid') ||
    raw.includes('permission_denied') ||
    raw.includes('gemini_api_key non configurée')
  );
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    firebaseConfigured: Boolean(FIREBASE_PROJECT_ID),
    models: {
      deep: 'gemini-4-hydrogen',
      fast: 'gemini-3.1-flash-lite',
    },
  });
});

app.post('/api/ai/chat', requireFirebaseAuth, aiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { messages, schoolContext, mode } = body as {
      messages?: Array<{ role: 'user' | 'model'; text: string }>;
      schoolContext?: string;
      mode?: 'deep' | 'fast';
    };

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) {
      return res.status(400).json({ error: 'Liste de messages invalide (1 à 60 messages).' });
    }

    const turns = normalizeConversationTurns(messages);
    if (turns.length === 0) {
      return res.status(400).json({ error: 'Aucun message utilisateur valide à traiter.' });
    }

    const ai = getAiClient();
    const isFast = mode === 'fast';
    const systemInstruction = buildYasmineSystemPrompt(schoolContext);
    const history = turns.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const lastMessage = turns[turns.length - 1];

    const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel; delayMs: number }> = isFast
      ? [
          { model: 'gemini-3.1-flash-lite', delayMs: 0 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 700 },
          { model: 'gemini-3.1-flash-lite', delayMs: 1600 },
        ]
      : [
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.XHIGH, delayMs: 0 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.HIGH, delayMs: 700 },
          { model: 'gemini-3.1-flash-lite', delayMs: 1500 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 2400 },
        ];

    let lastErr: unknown = null;
    for (const attempt of attempts) {
      if (attempt.delayMs > 0) {
        await sleep(attempt.delayMs);
      }
      try {
        const chat = ai.chats.create({
          model: attempt.model,
          history,
          config: {
            systemInstruction,
            ...(attempt.thinkingLevel
              ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
              : {}),
          },
        });
        const response = await chat.sendMessage({ message: lastMessage.text });
        const reply = (response.text ?? '').trim();
        if (reply) {
          return res.json({ reply, model: attempt.model });
        }
      } catch (err) {
        lastErr = err;
        console.warn(`AI chat attempt (${attempt.model}/${attempt.thinkingLevel ?? 'default'}) failed:`, err);
        if (isPermanentAuthError(err)) break;
      }
    }

    throw lastErr || new Error('Aucune réponse générée.');
  } catch (error: unknown) {
    console.error('AI Chat Error:', error);
    res.status(500).json({ error: formatAiError(error) });
  }
});

app.post('/api/ai/chat-stream', requireFirebaseAuth, aiRateLimit, async (req: AuthenticatedRequest, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { messages, schoolContext, mode } = body as {
    messages?: Array<{ role: 'user' | 'model'; text: string }>;
    schoolContext?: string;
    mode?: 'deep' | 'fast';
  };

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) {
    return res.status(400).json({ error: 'Liste de messages invalide (1 à 60 messages).' });
  }

  const turns = normalizeConversationTurns(messages);
  if (turns.length === 0) {
    return res.status(400).json({ error: 'Aucun message utilisateur valide à traiter.' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  const sendEvent = (payload: Record<string, unknown>) => {
    if (!clientClosed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  try {
    const ai = getAiClient();
    const isFast = mode === 'fast';
    const systemInstruction = buildYasmineSystemPrompt(schoolContext);
    const history = turns.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const lastMessage = turns[turns.length - 1];

    const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel; delayMs: number }> = isFast
      ? [
          { model: 'gemini-3.1-flash-lite', delayMs: 0 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 800 },
          { model: 'gemini-3.1-flash-lite', delayMs: 1800 },
        ]
      : [
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.XHIGH, delayMs: 0 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.HIGH, delayMs: 800 },
          { model: 'gemini-3.1-flash-lite', delayMs: 1600 },
          { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 2500 },
        ];

    let emittedAnyDelta = false;
    let lastErr: unknown = null;

    for (let idx = 0; idx < attempts.length; idx++) {
      const attempt = attempts[idx];
      if (clientClosed) break;
      if (attempt.delayMs > 0) {
        sendEvent({
          status: 'retrying',
          message: `Pic de trafic Gemini, nouvelle tentative (${idx + 1}/${attempts.length})...`,
        });
        await sleep(attempt.delayMs);
        if (clientClosed) break;
      }

      try {
        const chat = ai.chats.create({
          model: attempt.model,
          history,
          config: {
            systemInstruction,
            ...(attempt.thinkingLevel
              ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
              : {}),
          },
        });
        const stream = await chat.sendMessageStream({
          message: lastMessage.text,
        });

        for await (const chunk of stream) {
          if (clientClosed || res.writableEnded) break;
          const delta = chunk.text || '';
          if (delta) {
            emittedAnyDelta = true;
            sendEvent({ delta });
          }
        }

        if (emittedAnyDelta || clientClosed) {
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`AI stream attempt (${attempt.model}/${attempt.thinkingLevel ?? 'default'}) failed:`, err);
        if (emittedAnyDelta || isPermanentAuthError(err)) break;
      }
    }

    // Final non-streaming rescue if streaming hit transient 503 on all attempts
    if (!emittedAnyDelta && !clientClosed && !isPermanentAuthError(lastErr)) {
      sendEvent({
        status: 'retrying',
        message: 'Mode secours en cours...',
      });
      await sleep(1500);
      if (!clientClosed) {
        try {
          const fallbackChat = ai.chats.create({
            model: 'gemini-3.1-flash-lite',
            history,
            config: { systemInstruction },
          });
          const fallbackResp = await fallbackChat.sendMessage({ message: lastMessage.text });
          const fallbackText = (fallbackResp.text ?? '').trim();
          if (fallbackText) {
            emittedAnyDelta = true;
            sendEvent({ delta: fallbackText });
          }
        } catch (err) {
          lastErr = err;
          console.warn('AI non-stream rescue failed:', err);
        }
      }
    }

    if (!emittedAnyDelta && !clientClosed && lastErr) {
      throw lastErr;
    }

    sendEvent({ done: true });
    res.end();
  } catch (error: unknown) {
    console.error('AI Chat Stream Error:', error);
    sendEvent({ error: formatAiError(error) });
    res.end();
  }
});

app.post('/api/ai/appreciation', requireFirebaseAuth, aiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { studentName, classe, average, rank, totalStudents, subjectsSummary, absences } = body as {
      studentName?: string;
      classe?: string;
      average?: number;
      rank?: number;
      totalStudents?: number;
      subjectsSummary?: string;
      absences?: number;
    };

    if (typeof studentName !== 'string' || !studentName.trim() || typeof average !== 'number' || !Number.isFinite(average)) {
      return res.status(400).json({ error: 'Paramètres de bulletin invalides.' });
    }

    const ai = getAiClient();
    const prompt = `Rédige une appréciation de bulletin trimestriel (2 à 3 phrases maximum, en français académique bienveillant et précis) pour :
Élève : ${String(studentName).slice(0, 120)} (${String(classe || '').slice(0, 40)})
Moyenne générale : ${Math.min(20, Math.max(0, average)).toFixed(2)}/20 (Rang : ${Number(rank) || 0}/${Number(totalStudents) || 0})
Absences : ${Math.max(0, Number(absences) || 0)}
Détails matières : ${String(subjectsSummary || '').slice(0, 1500)}
Propose aussi une décision courte (ex: Tableau d'Honneur, Félicitations, Encouragements, Passable, Avertissement Travail).`;

    const attempts: Array<{ model: string; delayMs: number }> = [
      { model: 'gemini-4-hydrogen', delayMs: 0 },
      { model: 'gemini-3.1-flash-lite', delayMs: 800 },
      { model: 'gemini-4-hydrogen', delayMs: 1800 },
    ];
    let lastErr: unknown = null;

    for (const attempt of attempts) {
      if (attempt.delayMs > 0) await sleep(attempt.delayMs);
      try {
        const response = await ai.models.generateContent({
          model: attempt.model,
          contents: prompt,
          config: {
            ...(attempt.model === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                decision: { type: Type.STRING, description: 'Décision officielle courte du conseil de classe.' },
                remark: { type: Type.STRING, description: 'Appréciation générale constructive de 2 phrases.' },
              },
            },
          },
        });
        const parsed = safeParseJson<{ decision?: string; remark?: string }>(response.text, {});
        if (parsed.decision || parsed.remark) {
          return res.json(parsed);
        }
      } catch (err) {
        lastErr = err;
        console.warn(`AI appreciation attempt (${attempt.model}) failed:`, err);
        if (isPermanentAuthError(err)) break;
      }
    }

    throw lastErr || new Error("Impossible de générer l'appréciation.");
  } catch (error: unknown) {
    console.error('AI Appreciation Error:', error);
    res.status(500).json({ error: formatAiError(error) });
  }
});

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

app.post('/api/ai/analyze-sheet', requireFirebaseAuth, aiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { imageBase64: rawBase64, mimeType, targetClasse } = body as {
      imageBase64?: string;
      mimeType?: string;
      targetClasse?: string;
    };

    if (!rawBase64 || !mimeType || typeof rawBase64 !== 'string' || typeof mimeType !== 'string') {
      return res.status(400).json({ error: 'Image manquante.' });
    }
    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
      return res.status(400).json({ error: 'Format d’image non autorisé (JPG, PNG, WEBP, GIF).' });
    }
    const imageBase64 = rawBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').replace(/\s+/g, '');
    if (!imageBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
      return res.status(400).json({ error: 'Données image base64 invalides.' });
    }
    if (imageBase64.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image trop volumineuse (max 10 Mo).' });
    }

    const ai = getAiClient();
    const safeTargetClasse = typeof targetClasse === 'string' ? targetClasse : '';
    const sheetPrompt = `Analyse cette photo de liste d'élèves ou de feuille de notes manuscrite/imprimée (classe cible : ${String(safeTargetClasse || 'non précisée').slice(0, 40)}).
Extrais tous les élèves visibles avec leurs noms, prénoms, sexe (M ou F si devinable, sinon M), âge (entier si visible, sinon null), et éventuelles notes (int1, int2, devoir, compo sur 20).`;

    const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel; delayMs: number }> = [
      { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.HIGH, delayMs: 0 },
      { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 800 },
      { model: 'gemini-3.1-flash-lite', delayMs: 1800 },
    ];

    let lastErr: unknown = null;
    for (const attempt of attempts) {
      if (attempt.delayMs > 0) await sleep(attempt.delayMs);
      try {
        const response = await ai.models.generateContent({
          model: attempt.model,
          contents: {
            parts: [
              {
                inlineData: {
                  data: imageBase64,
                  mimeType,
                },
              },
              {
                text: sheetPrompt,
              },
            ],
          },
          config: {
            ...(attempt.thinkingLevel
              ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING, description: 'Résumé court de ce qui a été détecté sur la fiche.' },
                students: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      nom: { type: Type.STRING },
                      prenoms: { type: Type.STRING },
                      sexe: { type: Type.STRING },
                      age: { type: Type.INTEGER },
                      int1: { type: Type.NUMBER },
                      int2: { type: Type.NUMBER },
                      devoir: { type: Type.NUMBER },
                      compo: { type: Type.NUMBER },
                    },
                  },
                },
              },
            },
          },
        });

        const parsed = safeParseJson<{ summary?: string; students?: unknown[] }>(response.text, {
          summary: '',
          students: [],
        });
        return res.json(parsed);
      } catch (err) {
        lastErr = err;
        console.warn(`AI sheet attempt (${attempt.model}/${attempt.thinkingLevel ?? 'default'}) failed:`, err);
        if (isPermanentAuthError(err)) break;
      }
    }

    throw lastErr || new Error("Erreur lors de l'analyse de l'image.");
  } catch (error: unknown) {
    console.error('AI Image Analyze Error:', error);
    res.status(500).json({ error: formatAiError(error) });
  }
});

// Archive weekly audit logs locally as a .txt file (useful for school PC deployment)
app.post('/api/logs/archive', requireFirebaseAuth, logRateLimit, (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { weekKey, schoolId, content } = body as {
      weekKey?: string;
      schoolId?: string;
      content?: string;
    };

    if (!weekKey || !/^[0-9]{4}-W[0-9]{2}$/.test(weekKey)) {
      return res.status(400).json({ error: 'Identifiant de semaine invalide.' });
    }
    if (!schoolId || !/^[a-zA-Z0-9_-]{1,128}$/.test(schoolId)) {
      return res.status(400).json({ error: 'Identifiant établissement invalide.' });
    }
    const safeUid = req.authUser?.uid ? req.authUser.uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) : '';
    if (!safeUid || (schoolId !== safeUid && !schoolId.startsWith(`${safeUid}_sch_`))) {
      return res.status(403).json({ error: 'Seul le propriétaire de l’établissement peut archiver ce journal.' });
    }
    if (typeof content !== 'string' || content.length === 0 || content.length > 1_000_000) {
      return res.status(400).json({ error: 'Contenu du journal invalide.' });
    }

    const logsDir = path.resolve(__dirname, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const fileName = `Journal_Hebdo_${weekKey}_${schoolId}.txt`;
    const targetPath = path.resolve(logsDir, fileName);
    if (!targetPath.startsWith(logsDir + path.sep)) {
      return res.status(400).json({ error: 'Chemin de fichier refusé.' });
    }

    fs.writeFileSync(targetPath, content, 'utf8');
    return res.json({ archived: true, fileName: `logs/${fileName}` });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Système de fichiers non accessible en écriture.';
    return res.json({ archived: false, reason });
  }
});

async function startServer() {
  const httpServer = createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port: PORT,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: isHmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.all('/api/*', (_req, res) => {
      res.status(404).json({ error: 'Route API introuvable.' });
    });
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Schoolaria server listening on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL && !process.env.SCHOOLARIA_NO_LISTEN) {
  void startServer();
}

export { app };
export default app;
