import React, { useMemo, useRef, useState } from 'react';
import { Bot, Send, Zap, BrainCircuit, User, Square, RotateCcw, Sparkles } from 'lucide-react';
import { GradeRecord, SchoolProfile, Student, compareClassNames, computeMoyMatiere } from '../types/school.ts';
import { getAuthHeaders } from '../lib/firebase.ts';
import { apiFetch, getApiBaseUrl, requiresExternalApiUrl } from '../lib/apiClient.ts';

interface AiAssistantViewProps {
  school: SchoolProfile;
  students: Student[];
  grades: GradeRecord[];
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isUiOnly?: boolean;
  retryPrompt?: string;
}

const SUGGESTED_PROMPTS = [
  'Analyse complète par classe : points forts, classes en difficulté et plans de remédiation.',
  'Rédige une note de service et une convocation des parents pour la remise des bulletins.',
  'Quelles actions pédagogiques concrètes recommandes-tu pour les matières sous 10/20 ?',
];

export function AiAssistantView({ school, students, grades }: AiAssistantViewProps) {
  const initialGreeting = useMemo<ChatMessage>(
    () => ({
      role: 'model',
      text: `Bonjour ${school.adminName}. Je suis Yasmine, l'assistante pédagogique experte de ${school.schoolName}. En mode Analyse approfondie, je raisonne sur l'ensemble de vos effectifs, classes et notes du Trimestre pour vous fournir des synthèses et plans d'action précis.`,
      isUiOnly: true,
    }),
    [school.adminName, school.schoolName]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([initialGreeting]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'deep' | 'fast'>('deep');
  const [loading, setLoading] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const schoolContext = useMemo(() => {
    const active = students.filter((s) => s.status === 'actif');
    const byClass: Record<string, { count: number; sum: number; gradeCount: number; boys: number; girls: number }> = {};
    for (const s of active) {
      if (!byClass[s.classe]) {
        byClass[s.classe] = { count: 0, sum: 0, gradeCount: 0, boys: 0, girls: 0 };
      }
      byClass[s.classe].count += 1;
      if (s.sexe === 'M') byClass[s.classe].boys += 1;
      else byClass[s.classe].girls += 1;
    }

    const bySubject: Record<string, { sum: number; count: number; belowTen: number }> = {};
    let globalSum = 0;
    let globalCount = 0;
    const studentPerf = new Map<string, { name: string; classe: string; sum: number; count: number }>();
    const studentById = new Map(active.map((s) => [s.id, s]));

    for (const g of grades) {
      const moy = computeMoyMatiere(g);
      if (moy === null) continue;
      globalSum += moy;
      globalCount += 1;

      if (byClass[g.classe]) {
        byClass[g.classe].sum += moy;
        byClass[g.classe].gradeCount += 1;
      }

      if (!bySubject[g.subjectName]) {
        bySubject[g.subjectName] = { sum: 0, count: 0, belowTen: 0 };
      }
      bySubject[g.subjectName].sum += moy;
      bySubject[g.subjectName].count += 1;
      if (moy < 10) bySubject[g.subjectName].belowTen += 1;

      const stu = studentById.get(g.studentId);
      if (stu) {
        const cur = studentPerf.get(stu.id) ?? {
          name: `${stu.nom} ${stu.prenoms}`,
          classe: stu.classe,
          sum: 0,
          count: 0,
        };
        cur.sum += moy;
        cur.count += 1;
        studentPerf.set(stu.id, cur);
      }
    }

    const avg = globalCount > 0 ? (globalSum / globalCount).toFixed(2) : 'N/A';

    const classLines = Object.entries(byClass)
      .sort(([a], [b]) => compareClassNames(a, b))
      .map(([cls, info]) => {
        const cAvg = info.gradeCount > 0 ? `${(info.sum / info.gradeCount).toFixed(2)}/20` : 'aucune note';
        return `- ${cls}: ${info.count} élève(s) (${info.boys}G/${info.girls}F), moyenne ${cAvg}`;
      })
      .join('\n');

    const weakSubjects = Object.entries(bySubject)
      .map(([name, s]) => ({ name, avg: s.sum / s.count, belowTen: s.belowTen, total: s.count }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 6)
      .map((s) => `- ${s.name}: moy ${s.avg.toFixed(2)}/20 (${s.belowTen}/${s.total} sous 10)`)
      .join('\n');

    const rankedStudents = Array.from(studentPerf.values())
      .map((s) => ({ ...s, avg: s.sum / s.count }))
      .sort((a, b) => b.avg - a.avg);
    const topStudents = rankedStudents
      .slice(0, 5)
      .map((s) => `${s.name} (${s.classe}: ${s.avg.toFixed(2)}/20)`)
      .join(', ');
    const alertStudents = rankedStudents
      .filter((s) => s.avg < 10)
      .slice(-5)
      .map((s) => `${s.name} (${s.classe}: ${s.avg.toFixed(2)}/20)`)
      .join(', ');

    return [
      `Établissement: ${school.schoolName} | Ville: ${school.city || 'Togo'} | Année: ${school.academicYear}`,
      `Effectif actif: ${active.length} élève(s) | Notes saisies: ${grades.length} | Moyenne générale école: ${avg}/20`,
      classLines ? `Détails par classe:\n${classLines}` : '',
      weakSubjects ? `Matières à surveiller:\n${weakSubjects}` : '',
      topStudents ? `Meilleures moyennes: ${topStudents}` : '',
      alertStudents ? `Élèves sous 10/20: ${alertStudents}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }, [school, students, grades]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

    if (requiresExternalApiUrl()) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: trimmed, isUiOnly: true },
        {
          role: 'model',
          text: "Serveur Node.js cloud non configuré sur cette application compilée. Ouvrez Paramètres → Établissement pour renseigner l'URL de votre serveur Schoolaria (https://...).",
          isUiOnly: true,
        },
      ]);
      setInput('');
      return;
    }

    const updated: ChatMessage[] = [...messages, { role: 'user', text: trimmed }];
    const apiMessages = updated
      .filter((m) => !m.isUiOnly)
      .map(({ role, text }) => ({ role, text }));

    setMessages(updated);
    setInput('');
    setLoading(true);
    setStreamingReply('');
    setRetryStatus(null);
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = '';

    try {
      const callChatFallback = async (): Promise<string> => {
        setRetryStatus('Connexion directe au serveur IA...');
        let headers = await getAuthHeaders(false);
        let fallbackRes = await apiFetch('/api/ai/chat', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            messages: apiMessages,
            schoolContext,
            mode,
          }),
        });
        if (fallbackRes.status === 401) {
          headers = await getAuthHeaders(true);
          fallbackRes = await apiFetch('/api/ai/chat', {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              messages: apiMessages,
              schoolContext,
              mode,
            }),
          });
        }
        const raw = await fallbackRes.text().catch(() => '');
        let parsed: { reply?: string; error?: string } = {};
        try {
          parsed = JSON.parse(raw) as { reply?: string; error?: string };
        } catch {
          // Ignore non-JSON error
        }
        if (!fallbackRes.ok) {
          throw new Error(parsed.error || `Erreur HTTP ${fallbackRes.status}`);
        }
        if (parsed.error) throw new Error(parsed.error);
        return (parsed.reply || '').trim();
      };

      const callStream = async (forceRefresh: boolean) => {
        const headers = await getAuthHeaders(forceRefresh);
        return apiFetch('/api/ai/chat-stream', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            messages: apiMessages,
            schoolContext,
            mode,
          }),
        });
      };

      let res = await callStream(false);
      if (res.status === 401) {
        res = await callStream(true);
      }

      if (!res.ok) {
        const rawErr = await res.text().catch(() => '');
        let parsedMessage = `Erreur HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(rawErr) as { error?: string };
          if (parsed?.error) parsedMessage = parsed.error;
        } catch {
          if (rawErr && !rawErr.startsWith('<')) parsedMessage = rawErr.slice(0, 200);
        }
        if (res.status !== 401 && res.status !== 403 && res.status !== 400 && res.status !== 429) {
          const fallbackReply = await callChatFallback();
          if (fallbackReply) {
            setMessages((prev) => [...prev, { role: 'model', text: fallbackReply }]);
            setRetryStatus(null);
            return;
          }
        }
        throw new Error(parsedMessage);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') || !res.body) {
        const data = (await res.json()) as { reply?: string; error?: string };
        if (data.error) throw new Error(data.error);
        setMessages((prev) => [...prev, { role: 'model', text: data.reply || 'Aucune réponse.' }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const lines = evt.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const rawJson = line.slice(5).trim();
            if (!rawJson) continue;
            try {
              const parsed = JSON.parse(rawJson) as {
                delta?: string;
                done?: boolean;
                error?: string;
                status?: string;
                message?: string;
              };
              if (parsed.status === 'retrying' && parsed.message) {
                setRetryStatus(parsed.message);
              }
              if (parsed.error) {
                streamError = parsed.error;
              }
              if (parsed.delta) {
                setRetryStatus(null);
                assembled += parsed.delta;
                setStreamingReply(assembled);
                scrollToBottom();
              }
            } catch {
              // Ignore incomplete SSE fragment
            }
          }
        }
      }

      if (streamError && !assembled.trim()) {
        const isConfigOrQuotaErr =
          /gemini_api_key|api_key|quota|429|403|401/i.test(streamError);
        if (!isConfigOrQuotaErr) {
          const fallbackReply = await callChatFallback();
          if (fallbackReply) {
            assembled = fallbackReply;
            streamError = null;
          }
        }
        if (streamError && !assembled.trim()) {
          throw new Error(streamError);
        }
      }

      if (!assembled.trim()) {
        const fallbackReply = await callChatFallback();
        if (fallbackReply) {
          assembled = fallbackReply;
        }
      }

      const finalText = assembled.trim() || 'Aucune réponse générée.';
      setMessages((prev) => [...prev, { role: 'model', text: finalText }]);
      setStreamingReply('');
      setRetryStatus(null);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        if (assembled.trim()) {
          setMessages((prev) => [...prev, { role: 'model', text: assembled.trim() }]);
        }
        setStreamingReply('');
        setRetryStatus(null);
      } else {
        const targetHint = getApiBaseUrl() ? ` (${getApiBaseUrl()})` : '';
        const msg = err instanceof Error ? err.message : 'Impossible de joindre le service IA.';
        setMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: `Erreur IA${targetHint} : ${msg}`,
            isUiOnly: true,
            retryPrompt: trimmed,
          },
        ]);
        setStreamingReply('');
        setRetryStatus(null);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      scrollToBottom();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleReset = () => {
    stopGeneration();
    setStreamingReply('');
    setMessages([initialGreeting]);
  };

  return (
    <div className="bg-white/95 border theme-border-soft rounded-2xl overflow-hidden flex flex-col h-[calc(100vh-11rem)] min-h-[520px] shadow-sm">
      {/* Header */}
      <div className="p-4 sm:p-5 theme-surface-header border-b flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl theme-nav-active flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-extrabold flex items-center gap-1.5">
              <span>Yasmine · Assistante Pédagogique</span>
              <Sparkles className="w-3.5 h-3.5 theme-header-subtext" />
            </h1>
            <p className="text-xs theme-header-subtext">
              Raisonnement avancé sur vos classes, matières & bulletins en temps réel
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-1 rounded-xl theme-header-chip border">
            <button
              type="button"
              onClick={() => setMode('deep')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                mode === 'deep'
                  ? 'theme-nav-active shadow-xs'
                  : 'theme-nav-inactive'
              }`}
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              Raisonnement expert
            </button>
            <button
              type="button"
              onClick={() => setMode('fast')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                mode === 'fast'
                  ? 'theme-nav-active shadow-xs'
                  : 'theme-nav-inactive'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Réponse rapide
            </button>
          </div>

          <button
            type="button"
            onClick={handleReset}
            title="Nouvelle discussion"
            className="p-2 rounded-xl theme-header-chip border transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 theme-bg-soft">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-3 ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {msg.role === 'model' && (
              <div className="w-8 h-8 rounded-lg theme-pill-soft border flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'theme-btn-primary'
                  : 'bg-white border border-zinc-200 text-zinc-800 shadow-2xs'
              }`}
            >
              <div>{msg.text}</div>
              {msg.retryPrompt && !loading && (
                <button
                  type="button"
                  onClick={() => sendMessage(msg.retryPrompt!)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg theme-pill-soft border text-xs font-semibold transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Réessayer</span>
                </button>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-zinc-200 text-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {loading && streamingReply && (
          <div className="flex items-start gap-3 justify-start">
            <div className="w-8 h-8 rounded-lg theme-pill-soft border flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-white border theme-border-soft text-zinc-800 shadow-2xs">
              {streamingReply}
            </div>
          </div>
        )}

        {loading && !streamingReply && (
          <div className="flex items-center gap-2 text-xs theme-text-accent font-medium pl-11">
            <span>
              {retryStatus ||
                (mode === 'deep'
                  ? 'Yasmine analyse les données et raisonne en profondeur...'
                  : 'Yasmine rédige...')}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts + Input */}
      <div className="p-4 border-t border-zinc-100 bg-white space-y-3">
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => sendMessage(p)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg theme-pill-soft border font-medium transition-colors text-left"
            >
              {p}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez votre question à Yasmine (suivi, appréciations, conseils)..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm"
          />
          {loading ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Arrêter
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl theme-btn-primary text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              Envoyer
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

