import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  FileDown,
  FileSpreadsheet,
  FileJson,
  HardDrive,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Lock,
  Calendar,
} from 'lucide-react';
import {
  AuditLogCategory,
  AuditLogEntry,
  AuditLogSeverity,
  SchoolProfile,
  getISOWeekKey,
  getWeekDateRangeLabel,
} from '../types/school.ts';
import { getAuthHeaders } from '../lib/firebase.ts';
import { apiFetch } from '../lib/apiClient.ts';
import { formatAuthIdentifierForDisplay } from '../lib/phoneAuth.ts';
import { recordAuditLog } from '../lib/schoolService.ts';

interface AuditLogsViewProps {
  school: SchoolProfile;
  auditLogs: AuditLogEntry[];
}

function parseTimestamp(ts: unknown): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Date) return ts;
  if (typeof ts === 'object' && ts !== null) {
    const maybe = ts as { toDate?: () => Date; seconds?: number };
    if (typeof maybe.toDate === 'function') return maybe.toDate();
    if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  }
  return new Date(0);
}

function csvSafeCell(value: unknown): string {
  const raw = String(value ?? '');
  const trimmedStart = raw.replace(/^[\uFEFF\s]+/, '');
  const safe = /^[=+\-@\t\r]/.test(trimmedStart) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

const CATEGORY_LABELS: Record<AuditLogCategory, string> = {
  auth: 'Connexion',
  student: 'Élèves',
  grade: 'Notes',
  bulletin: 'Bulletins',
  classroom: 'Classes',
  subject: 'Matières',
  rbac: 'Rôles RBAC',
  settings: 'Établissement',
  security: 'Sécurité',
  export: 'Exports',
  archive: 'Archives annuelles',
};

const SEVERITY_CONFIG: Record<
  AuditLogSeverity,
  { label: string; badgeClass: string; icon: typeof CheckCircle2 }
> = {
  info: {
    label: 'Info',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
  },
  warning: {
    label: 'Attention',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Sensible',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: ShieldAlert,
  },
};

export function AuditLogsView({ school, auditLogs }: AuditLogsViewProps) {
  const currentWeek = getISOWeekKey();
  const [selectedWeek, setSelectedWeek] = useState<string>(currentWeek);
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditLogCategory>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | AuditLogSeverity>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const storageKey = `smi_exported_weeks_${school.id}`;
  const [exportedWeeks, setExportedWeeks] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const markWeekExported = (weekKey: string) => {
    if (weekKey === 'ALL') return;
    setExportedWeeks((prev) => {
      const next = Array.from(new Set([...prev, weekKey]));
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const availableWeeks = useMemo(() => {
    const set = new Set<string>([currentWeek]);
    auditLogs.forEach((l) => {
      if (l.weekKey) set.add(l.weekKey);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [auditLogs, currentWeek]);

  const unexportedPastWeeks = useMemo(
    () =>
      availableWeeks.filter(
        (w) => w !== currentWeek && !exportedWeeks.includes(w) && auditLogs.some((l) => l.weekKey === w)
      ),
    [availableWeeks, currentWeek, exportedWeeks, auditLogs]
  );

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...auditLogs]
      .filter((log) => (selectedWeek === 'ALL' ? true : log.weekKey === selectedWeek))
      .filter((log) => (categoryFilter === 'all' ? true : log.category === categoryFilter))
      .filter((log) => (severityFilter === 'all' ? true : log.severity === severityFilter))
      .filter((log) => {
        if (!q) return true;
        return (
          log.action.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q) ||
          log.actorName.toLowerCase().includes(q) ||
          log.actorEmail.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ta = parseTimestamp(a.createdAt).getTime();
        const tb = parseTimestamp(b.createdAt).getTime();
        if (tb !== ta) return tb - ta;
        return b.id.localeCompare(a.id);
      });
  }, [auditLogs, selectedWeek, categoryFilter, severityFilter, searchTerm]);

  const buildWeeklyTextReport = (logsToExport: AuditLogEntry[], weekLabel: string): string => {
    const range = weekLabel === 'ALL' ? 'Toutes les semaines' : getWeekDateRangeLabel(weekLabel);
    const lines: string[] = [
      '========================================================================',
      `JOURNAL DE SÉCURITÉ ET D'AUDIT HEBDOMADAIRE — ${school.schoolName}`,
      `Année scolaire : ${school.academicYear} | Période : ${weekLabel} (${range})`,
      `Généré le : ${new Date().toLocaleString('fr-FR')}`,
      `Nombre total d'événements : ${logsToExport.length}`,
      '========================================================================',
      '',
    ];

    if (logsToExport.length === 0) {
      lines.push('Aucun événement enregistré sur cette période.');
      return lines.join('\n');
    }

    const byCat: Record<string, number> = {};
    const bySev: Record<string, number> = {};
    for (const l of logsToExport) {
      byCat[l.category] = (byCat[l.category] || 0) + 1;
      bySev[l.severity] = (bySev[l.severity] || 0) + 1;
    }

    lines.push('RÉSUMÉ :');
    lines.push(
      `  Niveaux -> Info: ${bySev.info || 0} | Attention: ${bySev.warning || 0} | Sensible: ${bySev.critical || 0}`
    );
    lines.push(
      '  Catégories -> ' +
        Object.entries(byCat)
          .map(([k, v]) => `${CATEGORY_LABELS[k as AuditLogCategory] || k}: ${v}`)
          .join(' | ')
    );
    lines.push('');
    lines.push('DÉTAILS CHRONOLOGIQUES (du plus récent au plus ancien) :');
    lines.push('------------------------------------------------------------------------');

    for (const log of logsToExport) {
      const dt = parseTimestamp(log.createdAt);
      const dateStr = dt.getTime() > 0 ? dt.toLocaleString('fr-FR') : 'Horodatage serveur';
      lines.push(
        `[${dateStr}] [${log.severity.toUpperCase()}] [${CATEGORY_LABELS[log.category] || log.category}] ${log.action}`
      );
      lines.push(`   Acteur : ${log.actorName} <${log.actorEmail}> (Rôle : ${log.actorRole})`);
      lines.push(`   Détails : ${log.details}`);
      if (log.targetId) {
        lines.push(`   Réf. document : ${log.targetId}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  };

  const safeSchoolFile =
    school.schoolName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Schoolaria';

  const handleDownloadTxt = () => {
    const label = selectedWeek === 'ALL' ? 'Complet' : selectedWeek;
    const text = buildWeeklyTextReport(filteredLogs, selectedWeek);
    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Journal_Securite_${label}_${safeSchoolFile}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    markWeekExported(selectedWeek);
    setFeedback({ type: 'success', text: `Fichier journal (.txt) téléchargé pour ${label}.` });
    void recordAuditLog({
      ownerId: school.ownerId,
      schoolId: school.id,
      category: 'export',
      severity: 'info',
      action: 'Export journal hebdomadaire (.txt)',
      details: `Export TXT de ${filteredLogs.length} événement(s) pour la période ${label}.`,
      targetId: label,
    });
  };

  const handleDownloadCsv = () => {
    const label = selectedWeek === 'ALL' ? 'Complet' : selectedWeek;
    const headers = ['Date', 'Semaine', 'Niveau', 'Categorie', 'Action', 'Acteur', 'Email', 'Role', 'Details', 'Cible'];
    const rows = filteredLogs.map((l) => {
      const dt = parseTimestamp(l.createdAt);
      const dateStr = dt.getTime() > 0 ? dt.toLocaleString('fr-FR') : '';
      return [
        csvSafeCell(dateStr),
        csvSafeCell(l.weekKey),
        csvSafeCell(l.severity),
        csvSafeCell(CATEGORY_LABELS[l.category] || l.category),
        csvSafeCell(l.action),
        csvSafeCell(l.actorName),
        csvSafeCell(l.actorEmail),
        csvSafeCell(l.actorRole),
        csvSafeCell(l.details),
        csvSafeCell(l.targetId ?? ''),
      ].join(';');
    });

    const csv = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Journal_Securite_${label}_${safeSchoolFile}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    markWeekExported(selectedWeek);
    setFeedback({ type: 'success', text: `Tableur sécurisé (.csv) téléchargé pour ${label}.` });
    void recordAuditLog({
      ownerId: school.ownerId,
      schoolId: school.id,
      category: 'export',
      severity: 'info',
      action: 'Export journal hebdomadaire (.csv)',
      details: `Export CSV de ${filteredLogs.length} événement(s) pour la période ${label}.`,
      targetId: label,
    });
  };

  const handleDownloadJson = () => {
    const label = selectedWeek === 'ALL' ? 'Complet' : selectedWeek;
    const payload = {
      exportedAt: new Date().toISOString(),
      schoolName: school.schoolName,
      academicYear: school.academicYear,
      period: selectedWeek,
      count: filteredLogs.length,
      logs: filteredLogs.map((l) => ({
        ...l,
        createdAtIso: parseTimestamp(l.createdAt).toISOString(),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Journal_Securite_${label}_${safeSchoolFile}.json`;
    a.click();
    URL.revokeObjectURL(url);

    markWeekExported(selectedWeek);
    setFeedback({ type: 'success', text: `Archive JSON téléchargée pour ${label}.` });
    void recordAuditLog({
      ownerId: school.ownerId,
      schoolId: school.id,
      category: 'export',
      severity: 'info',
      action: 'Export archive (.json)',
      details: `Export JSON de ${filteredLogs.length} événement(s) pour la période ${label}.`,
      targetId: label,
    });
  };

  const handleServerArchive = async () => {
    const weekToSave = selectedWeek === 'ALL' ? currentWeek : selectedWeek;
    const logsForWeek = auditLogs.filter((l) => l.weekKey === weekToSave);
    const content = buildWeeklyTextReport(logsForWeek, weekToSave);
    setArchiving(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      const res = await apiFetch('/api/logs/archive', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          weekKey: weekToSave,
          schoolId: school.id,
          content,
        }),
      });
      const data = (await res.json()) as { archived?: boolean; fileName?: string; reason?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Échec de l’archivage serveur.');
      }
      if (data.archived) {
        markWeekExported(weekToSave);
        setFeedback({
          type: 'success',
          text: `Journal hebdomadaire enregistré sur le disque du serveur : ${data.fileName}`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: `Disque serveur en lecture seule ici (${data.reason || 'cloud'}). Utilisez les boutons .txt / .csv pour enregistrer le fichier sur votre PC.`,
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : "Erreur lors de l'archivage.",
      });
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl theme-surface-header p-6 shadow-md border flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl theme-nav-active flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">
              Journaux Hebdomadaires & Sécurité de l’École
            </h1>
            <p className="text-xs theme-header-subtext mt-1">
              Traçabilité infalsifiable (lecture seule pour les journaux passés) · Semaine active :{' '}
              <strong>{currentWeek}</strong> ({getWeekDateRangeLabel(currentWeek)})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTxt}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl theme-nav-active text-xs font-bold transition-colors shadow-xs"
          >
            <FileDown className="w-4 h-4" />
            Télécharger (.txt)
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl theme-header-chip border text-xs font-semibold transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel (.csv)
          </button>
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl theme-header-chip border text-xs font-semibold transition-colors"
          >
            <FileJson className="w-4 h-4" />
            Archive (.json)
          </button>
          <button
            type="button"
            onClick={handleServerArchive}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
          >
            <HardDrive className="w-4 h-4" />
            {archiving ? 'Sauvegarde...' : 'Sauver sur PC serveur'}
          </button>
        </div>
      </div>

      {unexportedPastWeeks.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Rappel d’archivage hebdomadaire :</strong> {unexportedPastWeeks.length} semaine(s) terminée(s)
              ({unexportedPastWeeks.join(', ')}) n’ont pas encore été exportées en fichier local.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedWeek(unexportedPastWeeks[0])}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap self-start sm:self-auto"
          >
            Consulter {unexportedPastWeeks[0]}
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Security Hardening Checklist */}
      <div className="theme-card-tinted backdrop-blur-xs border theme-border-soft rounded-2xl p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-bold theme-text-ink flex items-center gap-2">
            <Lock className="w-4 h-4 theme-text-accent" />
            Verrous de protection anti-fraude actifs
          </h2>
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800">
            Base de données & API sécurisées
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="bg-white border theme-border-soft rounded-xl p-3.5">
            <p className="font-bold text-zinc-900">1. Isolation Élèves & Parents</p>
            <p className="text-zinc-600 mt-1">
              Les parents/élèves ne peuvent ni modifier les notes, ni envoyer de fausses notifications, ni voir d’autres dossiers.
            </p>
          </div>
          <div className="bg-white border theme-border-soft rounded-xl p-3.5">
            <p className="font-bold text-zinc-900">2. Messagerie Anti-Usurpation</p>
            <p className="text-zinc-600 mt-1">
              L’identité, l’email vérifié et le rôle d’envoi (Admin / Prof / Parent) sont vérifiés par les règles serveur.
            </p>
          </div>
          <div className="bg-white border theme-border-soft rounded-xl p-3.5">
            <p className="font-bold text-zinc-900">3. API IA Authentifiée</p>
            <p className="text-zinc-600 mt-1">
              Les routes IA exigent un jeton Google valide avec limitation de requêtes par minute et contrôle des fichiers.
            </p>
          </div>
          <div className="bg-white border theme-border-soft rounded-xl p-3.5">
            <p className="font-bold text-zinc-900">4. Journaux Inaltérables</p>
            <p className="text-zinc-600 mt-1">
              Chaque note, absence ou changement d’accès est horodaté par le serveur et ne peut être ni édité ni effacé.
            </p>
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 theme-text-accent" />
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-900 outline-none theme-input"
            >
              <option value="ALL">Toutes les semaines ({auditLogs.length})</option>
              {availableWeeks.map((wk) => (
                <option key={wk} value={wk}>
                  {wk === currentWeek ? `Semaine en cours (${wk})` : `Semaine ${wk}`} · {getWeekDateRangeLabel(wk)}
                </option>
              ))}
            </select>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | AuditLogCategory)}
            className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 outline-none theme-input"
          >
            <option value="all">Toutes catégories</option>
            {(Object.keys(CATEGORY_LABELS) as AuditLogCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | AuditLogSeverity)}
            className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 outline-none theme-input"
          >
            <option value="all">Tous niveaux</option>
            <option value="info">Info</option>
            <option value="warning">Attention</option>
            <option value="critical">Sensible</option>
          </select>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher action, acteur, élève..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none theme-input"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b theme-table-head flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold theme-text-ink">
              Registre d’activité ({filteredLogs.length} entrée{filteredLogs.length > 1 ? 's' : ''})
            </h2>
            <p className="text-[11px] theme-text-accent">
              {selectedWeek === 'ALL'
                ? 'Historique complet des semaines enregistrées'
                : `Période : ${selectedWeek} (${getWeekDateRangeLabel(selectedWeek)})`}
            </p>
          </div>
          <span className="text-[11px] font-mono-nums theme-text-ink font-semibold">
            Lecture seule · Horodatage serveur
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-xs text-zinc-500">
            Aucun événement enregistré pour cette sélection. Chaque inscription, saisie de note ou modification de rôle apparaîtra automatiquement ici.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {filteredLogs.map((log) => {
              const sev = SEVERITY_CONFIG[log.severity] ?? SEVERITY_CONFIG.info;
              const SevIcon = sev.icon;
              const dt = parseTimestamp(log.createdAt);
              const dateLabel = dt.getTime() > 0 ? dt.toLocaleString('fr-FR') : 'À l’instant';

              return (
                <div key={log.id} className="p-4 theme-bg-soft-hover transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-bold shrink-0 ${sev.badgeClass}`}
                    >
                      <SevIcon className="w-3.5 h-3.5" />
                      {sev.label}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-zinc-900">{log.action}</span>
                        <span className="px-2 py-0.5 rounded-md theme-pill-soft border font-semibold text-[11px]">
                          {CATEGORY_LABELS[log.category] || log.category}
                        </span>
                        <span className="text-[11px] text-zinc-400 font-mono-nums">{log.weekKey}</span>
                      </div>
                      <p className="text-zinc-700 mt-1 break-words">{log.details}</p>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Par <strong>{log.actorName}</strong> ({formatAuthIdentifierForDisplay(log.actorEmail)} · rôle : {log.actorRole})
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono-nums whitespace-nowrap shrink-0 sm:text-right">
                    {dateLabel}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
