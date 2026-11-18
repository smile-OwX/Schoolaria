import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Printer,
  FileDown,
  Sparkles,
  Save,
  TrendingUp,
  Award,
  Layers,
  User,
  FileText,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  BulletinRemark,
  Classroom,
  GradeRecord,
  SchoolProfile,
  Student,
  Subject,
  formatRank,
} from '../types/school.ts';
import {
  createNotification,
  recordAuditLog,
  upsertBulletinRemark,
} from '../lib/schoolService.ts';
import { getAuthHeaders } from '../lib/firebase.ts';
import { apiFetch } from '../lib/apiClient.ts';
import {
  ComputedStudentBulletin,
  computeClassroomBulletins,
  computeStudentGeneralAverage,
  generateBulletinsPdf,
} from '../lib/bulletinPdf.ts';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BulletinViewProps {
  ownerUid: string;
  actorEmail: string;
  actorName: string;
  readOnly?: boolean;
  school: SchoolProfile;
  classrooms?: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  remarks: BulletinRemark[];
  initialStudentId?: string | null;
  initialTrimester?: 1 | 2 | 3;
}

export function BulletinView({
  ownerUid,
  actorEmail,
  actorName,
  readOnly = false,
  school,
  classrooms = [],
  students,
  subjects,
  grades,
  remarks,
  initialStudentId,
  initialTrimester = 1,
}: BulletinViewProps) {
  const activeStudents = useMemo(
    () =>
      [...students]
        .filter((s) => s.status === 'actif' && (s.cycle === 'Collège' || s.cycle === 'Lycée'))
        .sort((a, b) => a.classe.localeCompare(b.classe) || a.nom.localeCompare(b.nom)),
    [students]
  );

  const availableClasses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of activeStudents) {
      counts.set(s.classe, (counts.get(s.classe) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStudents]);

  const [viewMode, setViewMode] = useState<'single' | 'batch'>('single');
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    () => initialStudentId || activeStudents[0]?.id || ''
  );
  const [selectedBatchClass, setSelectedBatchClass] = useState<string>(
    () => availableClasses[0]?.name || ''
  );
  const [trimester, setTrimester] = useState<1 | 2 | 3>(initialTrimester);

  useEffect(() => {
    if (initialStudentId) {
      setSelectedStudentId(initialStudentId);
      setViewMode('single');
    }
  }, [initialStudentId]);

  useEffect(() => {
    if (!selectedStudentId && activeStudents.length > 0) {
      setSelectedStudentId(activeStudents[0].id);
    }
  }, [activeStudents, selectedStudentId]);

  const student = useMemo(
    () => activeStudents.find((s) => s.id === selectedStudentId) ?? activeStudents[0] ?? null,
    [activeStudents, selectedStudentId]
  );

  useEffect(() => {
    if (availableClasses.length === 0) {
      setSelectedBatchClass('');
      return;
    }
    const stillValid = availableClasses.some((c) => c.name === selectedBatchClass);
    if (!stillValid) {
      setSelectedBatchClass(student?.classe || availableClasses[0].name);
    }
  }, [availableClasses, selectedBatchClass, student?.classe]);

  const existingRemark = useMemo(
    () =>
      student
        ? remarks.find((r) => r.studentId === student.id && r.trimester === trimester)
        : undefined,
    [remarks, student, trimester]
  );

  const [absences, setAbsences] = useState<number>(0);
  const [conduite, setConduite] = useState<string>('Bonne');
  const [decision, setDecision] = useState<string>('');
  const [generalRemark, setGeneralRemark] = useState<string>('');
  const [savingRemark, setSavingRemark] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    setAbsences(existingRemark?.absences ?? 0);
    setConduite(existingRemark?.conduite ?? 'Bonne');
    setDecision(existingRemark?.decision ?? '');
    setGeneralRemark(existingRemark?.generalRemark ?? '');
  }, [existingRemark, student?.id, trimester]);

  const singleClassBulletins = useMemo(() => {
    if (!student) return [];
    return computeClassroomBulletins({
      classroomName: student.classe,
      trimester,
      students: activeStudents,
      classrooms,
      subjects,
      grades,
      remarks,
    });
  }, [student, trimester, activeStudents, classrooms, subjects, grades, remarks]);

  const singleComputed: ComputedStudentBulletin | null = useMemo(() => {
    if (!student) return null;
    return singleClassBulletins.find((b) => b.student.id === student.id) ?? null;
  }, [singleClassBulletins, student]);

  const batchBulletins = useMemo(() => {
    if (readOnly || !selectedBatchClass) return [];
    return computeClassroomBulletins({
      classroomName: selectedBatchClass,
      trimester,
      students: activeStudents,
      classrooms,
      subjects,
      grades,
      remarks,
    });
  }, [readOnly, selectedBatchClass, trimester, activeStudents, classrooms, subjects, grades, remarks]);

  // Multi-trimester progression for "Suivi des notes"
  const trimesterHistory = useMemo(() => {
    if (!student) return [];
    return ([1, 2, 3] as const).map((t) => {
      const res = computeStudentGeneralAverage(student, t, subjects, grades, classrooms);
      return { trimester: t, average: res.average };
    });
  }, [student, subjects, grades, classrooms]);

  const handleSaveRemark = async () => {
    if (!student || readOnly || !singleComputed) return;
    setSavingRemark(true);
    setSavedNotice(null);
    setErrorNotice(null);
    try {
      const prevAbsences = existingRemark?.absences ?? 0;
      const safeAbsences = Math.min(365, Math.max(0, Math.round(Number(absences) || 0)));
      await upsertBulletinRemark(ownerUid, school.id, existingRemark, {
        studentId: student.id,
        trimester,
        absences: safeAbsences,
        conduite,
        decision: decision || singleComputed.mention.label,
        generalRemark,
        parentEmail: student.parentEmail,
        teacherEmails: student.teacherEmails,
      });
      if (safeAbsences > prevAbsences && student.parentEmail) {
        await createNotification(ownerUid, school.id, {
          type: 'absence',
          title: `Mise à jour des absences · ${student.nom} ${student.prenoms}`,
          message: `Le total des absences pour le Trimestre ${trimester} en ${student.classe} est désormais de ${safeAbsences} heure(s).`,
          targetClasse: student.classe,
          studentId: student.id,
          audienceEmails: [student.parentEmail],
          createdByEmail: actorEmail,
          createdByName: actorName,
        });
      }
      setSavedNotice('Appréciations du bulletin enregistrées.');
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSavingRemark(false);
    }
  };

  const handleGenerateAiAppreciation = async () => {
    if (!student || !singleComputed || singleComputed.studentAvg === null) return;
    setGeneratingAi(true);
    setErrorNotice(null);
    try {
      const summary = singleComputed.subjectRows
        .filter((r) => r.moyMat !== null)
        .map((r) => `${r.subject.name}: ${r.moyMat}/20`)
        .join(', ');

      const sendAi = async (forceRefresh: boolean) => {
        const headers = await getAuthHeaders(forceRefresh);
        return apiFetch('/api/ai/appreciation', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            studentName: `${student.nom} ${student.prenoms}`,
            classe: student.classe,
            average: singleComputed.studentAvg,
            rank: singleComputed.rank,
            totalStudents: singleComputed.totalStudents,
            subjectsSummary: summary,
            absences,
          }),
        });
      };

      let res = await sendAi(false);
      if (res.status === 401) {
        res = await sendAi(true);
      }
      const raw = await res.text();
      let data: { decision?: string; remark?: string; error?: string } = {};
      try {
        data = JSON.parse(raw);
      } catch {
        if (!res.ok) throw new Error(`Erreur serveur IA (${res.status}).`);
      }
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la génération IA.');
      if (data.decision) setDecision(data.decision);
      if (data.remark) setGeneralRemark(data.remark);
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : 'Erreur lors de la génération IA.');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleDownloadSinglePdf = () => {
    if (!student || !singleComputed) return;
    setGeneratingPdf(true);
    setErrorNotice(null);
    setBatchNotice(null);
    try {
      const overrideBulletin: ComputedStudentBulletin = {
        ...singleComputed,
        absences,
        conduite,
        decision: decision || singleComputed.mention.label,
        generalRemark,
      };
      const fileName = generateBulletinsPdf({
        school,
        trimester,
        bulletins: [overrideBulletin],
        filenameLabel: `${student.nom}_${student.prenoms}_${student.classe}`,
      });
      setBatchNotice(`PDF téléchargé : ${fileName}`);
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : 'Impossible de générer le PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadBatchPdf = () => {
    if (readOnly || batchBulletins.length === 0 || !selectedBatchClass) return;
    setGeneratingPdf(true);
    setErrorNotice(null);
    setBatchNotice(null);
    try {
      const fileName = generateBulletinsPdf({
        school,
        trimester,
        bulletins: batchBulletins,
        filenameLabel: selectedBatchClass,
      });
      setBatchNotice(
        `Grand PDF généré (${batchBulletins.length} bulletins A4) : ${fileName}`
      );
      recordAuditLog({
        ownerId: ownerUid,
        schoolId: school.id,
        category: 'bulletin',
        severity: 'info',
        action: `Génération grand PDF classe ${selectedBatchClass}`,
        details: `${batchBulletins.length} bulletins · Trimestre ${trimester}`,
        actorName,
      }).catch(() => {});
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : 'Impossible de générer le grand PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handlePrintBatch = () => {
    if (readOnly || batchBulletins.length === 0) return;
    setBatchNotice(null);
    setErrorNotice(null);
    if (viewMode !== 'batch') {
      setViewMode('batch');
      requestAnimationFrame(() => {
        setTimeout(() => window.print(), 120);
      });
    } else {
      window.print();
    }
  };

  const handleDownloadEditableDoc = () => {
    if (!student || !singleComputed) return;
    const rowsHtml = singleComputed.subjectRows
      .map(
        (r) => `
      <tr>
        <td style="padding:6px;border:1px solid #d4d4d8;">${escapeHtml(r.subject.name)}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;">${escapeHtml(r.subject.coef)}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;">${escapeHtml(r.moyCl ?? '—')}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;">${escapeHtml(r.compo ?? '—')}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;"><strong>${escapeHtml(r.moyMat ?? '—')}</strong></td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;">${escapeHtml(r.weighted ?? '—')}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;text-align:center;">${r.rank > 0 ? `${r.rank}e` : '—'}</td>
        <td style="padding:6px;border:1px solid #d4d4d8;">${escapeHtml(r.appreciation)}</td>
      </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bulletin ${escapeHtml(student.nom)} ${escapeHtml(student.prenoms)}</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#18181b;">
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #6d28d9;padding-bottom:12px;margin-bottom:16px;">
        <div><h2 style="margin:0;color:#6d28d9;">${escapeHtml(school.schoolName)}</h2><p style="margin:4px 0 0;font-size:12px;">${escapeHtml(school.motto || '')} · ${escapeHtml(school.address || '')}</p></div>
        <div style="text-align:right;"><h3 style="margin:0;">BULLETIN TRIMESTRIEL N°${trimester}</h3><p style="margin:4px 0 0;font-size:12px;">Année scolaire : ${escapeHtml(school.academicYear)}</p></div>
      </div>
      <p><strong>Élève :</strong> ${escapeHtml(student.nom)} ${escapeHtml(student.prenoms)} | <strong>Matricule :</strong> ${escapeHtml(student.matricule)} | <strong>Classe :</strong> ${escapeHtml(student.classe)} | <strong>Sexe :</strong> ${escapeHtml(student.sexe)} | <strong>Âge :</strong> ${escapeHtml(student.age)} ans</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;">
        <thead><tr style="background:#f5f3ff;">
          <th style="padding:8px;border:1px solid #d4d4d8;text-align:left;">Matière</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Coef</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Moy. Cl.</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Compo</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Moy. /20</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Moy×Coef</th>
          <th style="padding:8px;border:1px solid #d4d4d8;">Rang</th>
          <th style="padding:8px;border:1px solid #d4d4d8;text-align:left;">Appréciation</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="margin-top:16px;padding:12px;border:1px solid #d4d4d8;background:#faf9fe;">
        <p style="margin:4px 0;"><strong>Moyenne Générale :</strong> ${escapeHtml(singleComputed.studentAvg ?? '—')} / 20 | <strong>Rang :</strong> ${escapeHtml(formatRank(singleComputed.rank, singleComputed.totalStudents))} | <strong>Moyenne de classe :</strong> ${escapeHtml(singleComputed.classAvg ?? '—')}/20</p>
        <p style="margin:4px 0;"><strong>Absences :</strong> ${escapeHtml(absences)} h | <strong>Conduite :</strong> ${escapeHtml(conduite)} | <strong>Décision :</strong> ${escapeHtml(decision || singleComputed.mention.label)}</p>
        <p style="margin:8px 0 0;"><strong>Appréciation du conseil :</strong> ${escapeHtml(generalRemark || '—')}</p>
      </div>
    </body></html>`;

    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bulletin_Modifiable_${student.nom}_${student.classe}_T${trimester}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (activeStudents.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-12 text-center">
        <Award className="w-10 h-10 text-violet-300 mx-auto mb-3" />
        <h2 className="text-base font-bold text-zinc-900">Aucun élève disponible</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Inscrivez des élèves et saisissez leurs notes pour générer leurs bulletins scolaires.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <div className="no-print rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white border border-violet-700/70 p-4 sm:p-5 space-y-4 shadow-md">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {!readOnly && availableClasses.length > 0 && (
              <div className="inline-flex p-1 rounded-full bg-white/15 border border-white/25">
                <button
                  type="button"
                  onClick={() => setViewMode('single')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    viewMode === 'single'
                      ? 'bg-white text-violet-950 shadow-xs'
                      : 'text-violet-100 hover:text-white'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Fiche élève</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (student?.classe && selectedBatchClass !== student.classe) {
                      setSelectedBatchClass(student.classe);
                    }
                    setViewMode('batch');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    viewMode === 'batch'
                      ? 'bg-white text-violet-950 shadow-xs'
                      : 'text-violet-100 hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Lot Classe (PDF)</span>
                </button>
              </div>
            )}

            {viewMode === 'single' ? (
              <select
                value={student?.id ?? ''}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="px-3.5 py-2 rounded-xl border border-white/25 bg-white text-sm font-semibold text-violet-950 focus:border-white outline-none max-w-xs"
              >
                {activeStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    [{s.classe}] {s.nom} {s.prenoms}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedBatchClass}
                onChange={(e) => setSelectedBatchClass(e.target.value)}
                className="px-3.5 py-2 rounded-xl border border-white/25 bg-white text-sm font-semibold text-violet-950 focus:border-white outline-none"
              >
                {availableClasses.map((c) => (
                  <option key={c.name} value={c.name}>
                    Classe {c.name} ({c.count} élève{c.count > 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex p-1 rounded-full bg-white/15 border border-white/25">
              {([1, 2, 3] as const).map((t) => {
                const active = trimester === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTrimester(t)}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      active ? 'text-violet-950' : 'text-violet-100 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="bulletin-trimester-pill"
                        transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                        className="absolute inset-0 rounded-full bg-white shadow-xs"
                      />
                    )}
                    <span className="relative z-10">Trimestre {t}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'single' ? (
              <>
                <button
                  type="button"
                  onClick={handleDownloadEditableDoc}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors"
                >
                  <FileDown className="w-4 h-4 text-white" />
                  <span>Modifiable (.doc)</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadSinglePdf}
                  disabled={generatingPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/25 bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors disabled:opacity-60"
                >
                  <FileText className="w-4 h-4 text-white" />
                  <span>{generatingPdf ? 'PDF...' : 'Télécharger PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors shadow-xs"
                >
                  <Printer className="w-4 h-4 text-violet-700" />
                  <span>Imprimer</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleDownloadBatchPdf}
                  disabled={generatingPdf || batchBulletins.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-emerald-950 text-xs font-extrabold transition-colors shadow-xs disabled:opacity-60"
                >
                  <FileDown className="w-4 h-4" />
                  <span>
                    {generatingPdf
                      ? 'Génération du grand PDF...'
                      : `Télécharger Grand PDF (${batchBulletins.length} élèves)`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintBatch}
                  disabled={batchBulletins.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors shadow-xs disabled:opacity-60"
                >
                  <Printer className="w-4 h-4 text-violet-700" />
                  <span>Imprimer toute la classe ({batchBulletins.length})</span>
                </button>
              </>
            )}
          </div>
        </div>

        {(batchNotice || (errorNotice && viewMode === 'batch')) && (
          <div
            className={`rounded-xl px-3.5 py-2 text-xs font-semibold flex items-center gap-2 ${
              errorNotice
                ? 'bg-rose-500/20 border border-rose-300/40 text-rose-100'
                : 'bg-emerald-500/20 border border-emerald-300/40 text-emerald-50'
            }`}
          >
            {errorNotice ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{errorNotice || batchNotice}</span>
          </div>
        )}
      </div>

      {/* SINGLE STUDENT MODE */}
      {viewMode === 'single' && student && singleComputed && (
        <>
          {/* Suivi des notes (Multi-trimester Evolution Strip) */}
          <div className="no-print bg-white border border-zinc-200/90 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900">
                  Suivi annuel de {student.nom} {student.prenoms}
                </h3>
                <p className="text-xs text-zinc-500">
                  Évolution des moyennes trimestrielles sur 20
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:w-96">
              {trimesterHistory.map((item) => (
                <button
                  key={item.trimester}
                  type="button"
                  onClick={() => setTrimester(item.trimester)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    trimester === item.trimester
                      ? 'border-violet-500 bg-violet-50/50'
                      : 'border-zinc-200 bg-zinc-50/40 hover:border-violet-300'
                  }`}
                >
                  <p className="text-[11px] font-medium text-zinc-500">Trimestre {item.trimester}</p>
                  <p className="text-base font-bold font-mono-nums text-zinc-900 mt-0.5">
                    {item.average !== null ? `${item.average.toFixed(2)}` : '—'}
                    <span className="text-[11px] font-normal text-zinc-400"> /20</span>
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Official Printable A4 Bulletin */}
          <div className="print-only-container bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b-2 border-violet-700 pb-5">
              <div>
                <h2 className="text-xl font-extrabold text-violet-800 uppercase tracking-tight">
                  {school.schoolName}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {school.motto || 'Discipline · Travail · Succès'}
                  {school.address ? ` · ${school.address}` : ''}
                  {school.phone ? ` · Tél : ${school.phone}` : ''}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="text-sm font-extrabold text-zinc-900 uppercase">
                  Bulletin de Notes · Trimestre {trimester}
                </p>
                <p className="text-xs text-zinc-500 font-mono-nums mt-0.5">
                  Année scolaire : {school.academicYear}
                </p>
              </div>
            </div>

            {/* Student Info Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-[#FAF9FE] border border-violet-100 rounded-xl p-4 text-xs">
              <div>
                <span className="text-zinc-500 block">Nom & Prénoms</span>
                <strong className="text-zinc-900 text-sm">
                  {student.nom} {student.prenoms}
                </strong>
              </div>
              <div>
                <span className="text-zinc-500 block">Matricule</span>
                <strong className="text-zinc-900 font-mono-nums">{student.matricule}</strong>
              </div>
              <div>
                <span className="text-zinc-500 block">Classe · Cycle</span>
                <strong className="text-violet-800">{student.classe} ({student.cycle})</strong>
              </div>
              <div>
                <span className="text-zinc-500 block">Sexe · Âge · Effectif</span>
                <strong className="text-zinc-900 font-mono-nums">
                  {student.sexe} · {student.age} ans · {singleComputed.totalStudents} élèves
                </strong>
              </div>
            </div>

            {/* Subjects Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-zinc-200 text-xs">
                <thead>
                  <tr className="bg-violet-50 text-violet-950 font-bold uppercase text-[11px]">
                    <th className="py-2.5 px-3 border border-zinc-200">Matière</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Coef</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Moy. Cl.</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Compo</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Moy. /20</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Moy × Coef</th>
                    <th className="py-2.5 px-2 border border-zinc-200 text-center">Rang</th>
                    <th className="py-2.5 px-3 border border-zinc-200">Appréciation</th>
                  </tr>
                </thead>
                <tbody>
                  {singleComputed.subjectRows.map((row) => (
                    <tr key={row.subject.id}>
                      <td className="py-2 px-3 border border-zinc-200 font-semibold text-zinc-900">
                        {row.subject.name}
                      </td>
                      <td className="py-2 px-2 border border-zinc-200 text-center font-mono-nums">
                        {row.subject.coef}
                      </td>
                      <td className="py-2 px-2 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                        {row.moyCl !== null ? row.moyCl.toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-2 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                        {row.compo !== null ? row.compo.toFixed(2) : '—'}
                      </td>
                      <td
                        className={`py-2 px-2 border border-zinc-200 text-center font-mono-nums font-bold ${
                          row.moyMat === null
                            ? 'text-zinc-400'
                            : row.moyMat >= 10
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                        }`}
                      >
                        {row.moyMat !== null ? row.moyMat.toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-2 border border-zinc-200 text-center font-mono-nums">
                        {row.weighted !== null ? row.weighted.toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-2 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                        {row.rank > 0 ? `${row.rank}e` : '—'}
                      </td>
                      <td className="py-2 px-3 border border-zinc-200 text-zinc-700">
                        {row.appreciation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary & Council Box */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-zinc-200 rounded-xl p-4 space-y-2 text-xs">
                <h4 className="font-bold text-zinc-900 uppercase text-[11px] tracking-wider">
                  Bilan Trimestriel
                </h4>
                <div className="flex justify-between py-1 border-b border-zinc-100">
                  <span className="text-zinc-500">Total Points / Total Coefs</span>
                  <strong className="font-mono-nums text-zinc-900">
                    {singleComputed.totalWeighted.toFixed(2)} / {singleComputed.totalCoef}
                  </strong>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-100">
                  <span className="text-zinc-500">Moyenne Générale</span>
                  <strong className="font-mono-nums text-base text-violet-700">
                    {singleComputed.studentAvg !== null
                      ? `${singleComputed.studentAvg.toFixed(2)} / 20`
                      : '—'}
                  </strong>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-100">
                  <span className="text-zinc-500">Rang dans la classe</span>
                  <strong className="font-mono-nums text-zinc-900">
                    {formatRank(singleComputed.rank, singleComputed.totalStudents)}
                  </strong>
                </div>
                <div className="flex justify-between py-1 text-zinc-500 font-mono-nums">
                  <span>Classe : Moy {singleComputed.classAvg ?? '—'}</span>
                  <span>
                    Max {singleComputed.highestAvg ?? '—'} · Min {singleComputed.lowestAvg ?? '—'}
                  </span>
                </div>
              </div>

              <div className="border border-zinc-200 rounded-xl p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-zinc-900 uppercase text-[11px] tracking-wider">
                    Conseil de Classe {readOnly ? '' : '(Modifiable)'}
                  </h4>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleGenerateAiAppreciation}
                      disabled={generatingAi || singleComputed.studentAvg === null}
                      className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 font-semibold transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-3 h-3" />
                      {generatingAi ? 'Yasmine rédige...' : 'Suggérer (Yasmine)'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-zinc-500 block mb-1">Absences (heures)</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      readOnly={readOnly}
                      value={absences}
                      onChange={(e) =>
                        setAbsences(Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 font-mono-nums outline-none focus:border-violet-600 read-only:bg-zinc-50"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-500 block mb-1">Conduite</label>
                    <input
                      type="text"
                      readOnly={readOnly}
                      value={conduite}
                      onChange={(e) => setConduite(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 outline-none focus:border-violet-600 read-only:bg-zinc-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-zinc-500 block mb-1">Décision / Mention</label>
                  <input
                    type="text"
                    readOnly={readOnly}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                    placeholder={singleComputed.mention.label}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 font-semibold text-zinc-900 outline-none focus:border-violet-600 read-only:bg-zinc-50"
                  />
                </div>

                <div>
                  <label className="text-zinc-500 block mb-1">Appréciation générale</label>
                  <textarea
                    rows={2}
                    readOnly={readOnly}
                    value={generalRemark}
                    onChange={(e) => setGeneralRemark(e.target.value)}
                    placeholder="Observations de la direction..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 outline-none focus:border-violet-600 resize-none read-only:bg-zinc-50"
                  />
                </div>

                {!readOnly && (
                  <div className="no-print flex items-center justify-between pt-1 gap-2">
                    <span className={`text-[11px] font-medium ${errorNotice ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {errorNotice || savedNotice}
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveRemark}
                      disabled={savingRemark}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-semibold"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingRemark ? 'Sauvegarde...' : 'Enregistrer'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Signature Footer */}
            <div className="pt-6 grid grid-cols-2 gap-8 text-xs text-zinc-600">
              <div>
                <p className="font-semibold">Visa des Parents / Tuteur</p>
                <div className="h-12 border-b border-dashed border-zinc-300 mt-4" />
              </div>
              <div className="text-right">
                <p className="font-semibold">Le Directeur · {school.adminName}</p>
                <div className="h-12 border-b border-dashed border-zinc-300 mt-4" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* BATCH CLASSROOM MODE (1 bulletin per A4 page, ready for single giant PDF & batch print) */}
      {viewMode === 'batch' && !readOnly && (
        <div className="space-y-6">
          <div className="no-print bg-violet-50 border border-violet-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-violet-950">
                Aperçu du lot · Classe {selectedBatchClass} · Trimestre {trimester}
              </h3>
              <p className="text-xs text-violet-700 mt-0.5">
                {batchBulletins.length} bulletin(s) A4 prêts à être exportés dans un seul fichier PDF ou imprimés en série (1 élève par page).
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-white border border-violet-200 text-xs font-extrabold text-violet-900 shrink-0">
              {batchBulletins.length} page{batchBulletins.length > 1 ? 's' : ''} A4
            </span>
          </div>

          {batchBulletins.map((item, idx) => (
            <div
              key={item.student.id}
              className="print-only-container print-bulletin-page bg-white border border-zinc-200 rounded-2xl p-6 sm:p-7 space-y-4 print:space-y-3"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b-2 border-violet-700 pb-4 print:pb-3">
                <div>
                  <h2 className="text-lg font-extrabold text-violet-800 uppercase tracking-tight">
                    {school.schoolName}
                  </h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {school.motto || 'Discipline · Travail · Succès'}
                    {school.address ? ` · ${school.address}` : ''}
                    {school.phone ? ` · Tél : ${school.phone}` : ''}
                  </p>
                </div>

                <div className="sm:text-right">
                  <p className="text-xs font-extrabold text-zinc-900 uppercase">
                    Bulletin de Notes · Trimestre {trimester}
                  </p>
                  <p className="text-[11px] text-zinc-500 font-mono-nums mt-0.5">
                    Année : {school.academicYear} · Page {idx + 1}/{batchBulletins.length}
                  </p>
                </div>
              </div>

              {/* Student Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FAF9FE] border border-violet-100 rounded-xl p-3 text-xs">
                <div>
                  <span className="text-zinc-500 block text-[11px]">Nom & Prénoms</span>
                  <strong className="text-zinc-900">
                    {item.student.nom} {item.student.prenoms}
                  </strong>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Matricule</span>
                  <strong className="text-zinc-900 font-mono-nums">{item.student.matricule}</strong>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Classe · Cycle</span>
                  <strong className="text-violet-800">
                    {item.student.classe} ({item.student.cycle})
                  </strong>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Sexe · Âge · Effectif</span>
                  <strong className="text-zinc-900 font-mono-nums">
                    {item.student.sexe} · {item.student.age} ans · {item.totalStudents} élèves
                  </strong>
                </div>
              </div>

              {/* Subjects Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-zinc-200 text-[11px]">
                  <thead>
                    <tr className="bg-violet-50 text-violet-950 font-bold uppercase text-[10px]">
                      <th className="py-1.5 px-2.5 border border-zinc-200">Matière</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Coef</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Moy. Cl.</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Compo</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Moy. /20</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Moy × Coef</th>
                      <th className="py-1.5 px-1.5 border border-zinc-200 text-center">Rang</th>
                      <th className="py-1.5 px-2.5 border border-zinc-200">Appréciation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.subjectRows.map((row) => (
                      <tr key={row.subject.id}>
                        <td className="py-1.5 px-2.5 border border-zinc-200 font-semibold text-zinc-900">
                          {row.subject.name}
                        </td>
                        <td className="py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums">
                          {row.subject.coef}
                        </td>
                        <td className="py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                          {row.moyCl !== null ? row.moyCl.toFixed(2) : '—'}
                        </td>
                        <td className="py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                          {row.compo !== null ? row.compo.toFixed(2) : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums font-bold ${
                            row.moyMat === null
                              ? 'text-zinc-400'
                              : row.moyMat >= 10
                              ? 'text-emerald-700'
                              : 'text-rose-600'
                          }`}
                        >
                          {row.moyMat !== null ? row.moyMat.toFixed(2) : '—'}
                        </td>
                        <td className="py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums">
                          {row.weighted !== null ? row.weighted.toFixed(2) : '—'}
                        </td>
                        <td className="py-1.5 px-1.5 border border-zinc-200 text-center font-mono-nums text-zinc-600">
                          {row.rank > 0 ? `${row.rank}e` : '—'}
                        </td>
                        <td className="py-1.5 px-2.5 border border-zinc-200 text-zinc-700">
                          {row.appreciation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary & Council Box */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="border border-zinc-200 rounded-xl p-3 space-y-1.5">
                  <h4 className="font-bold text-zinc-900 uppercase text-[10px] tracking-wider">
                    Bilan Trimestriel
                  </h4>
                  <div className="flex justify-between border-b border-zinc-100 pb-1">
                    <span className="text-zinc-500">Total Points / Coefs</span>
                    <strong className="font-mono-nums text-zinc-900">
                      {item.totalWeighted.toFixed(2)} / {item.totalCoef}
                    </strong>
                  </div>
                  <div className="flex justify-between border-b border-zinc-100 pb-1">
                    <span className="text-zinc-500">Moyenne Générale</span>
                    <strong className="font-mono-nums text-sm text-violet-700">
                      {item.studentAvg !== null ? `${item.studentAvg.toFixed(2)} / 20` : '—'}
                    </strong>
                  </div>
                  <div className="flex justify-between border-b border-zinc-100 pb-1">
                    <span className="text-zinc-500">Rang dans la classe</span>
                    <strong className="font-mono-nums text-zinc-900">
                      {formatRank(item.rank, item.totalStudents)}
                    </strong>
                  </div>
                  <div className="flex justify-between text-zinc-500 font-mono-nums text-[11px]">
                    <span>Moy classe : {item.classAvg ?? '—'}</span>
                    <span>
                      Max {item.highestAvg ?? '—'} · Min {item.lowestAvg ?? '—'}
                    </span>
                  </div>
                </div>

                <div className="border border-zinc-200 rounded-xl p-3 space-y-1.5 bg-[#FAF9FE]">
                  <h4 className="font-bold text-zinc-900 uppercase text-[10px] tracking-wider">
                    Conseil de Classe
                  </h4>
                  <p className="text-zinc-700">
                    <strong>Absences :</strong> {item.absences} h · <strong>Conduite :</strong>{' '}
                    {item.conduite || 'Bonne'}
                  </p>
                  <p className="text-violet-900 font-semibold">
                    <strong>Décision :</strong> {item.decision}
                  </p>
                  <p className="text-zinc-600 line-clamp-2">
                    <strong>Appréciation :</strong> {item.generalRemark || '—'}
                  </p>
                </div>
              </div>

              {/* Signature Footer */}
              <div className="pt-3 grid grid-cols-2 gap-8 text-xs text-zinc-600">
                <div>
                  <p className="font-semibold">Visa des Parents / Tuteur</p>
                  <div className="h-9 border-b border-dashed border-zinc-300 mt-2" />
                </div>
                <div className="text-right">
                  <p className="font-semibold">Le Directeur · {school.adminName}</p>
                  <div className="h-9 border-b border-dashed border-zinc-300 mt-2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
