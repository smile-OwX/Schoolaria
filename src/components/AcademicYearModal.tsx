import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ALL_CLASSES,
  AcademicArchive,
  Classroom,
  CycleType,
  GradeRecord,
  SchoolProfile,
  Student,
  Subject,
  compareClassNames,
  getCycleForClass,
  getNextProgressionTarget,
  sortClassrooms,
} from '../types/school.ts';
import { computeStudentGeneralAverage } from '../lib/bulletinPdf.ts';
import { executeAcademicYearTransition } from '../lib/schoolService.ts';

type TransitionDecision = 'promote' | 'repeat' | 'graduate' | 'withdraw';

interface StudentTransitionRow {
  student: Student;
  annualAverage: number | null;
  action: TransitionDecision;
  targetClasse: string;
}

interface AcademicYearModalProps {
  open: boolean;
  uid: string;
  actorEmail: string;
  actorName: string;
  school: SchoolProfile;
  classrooms: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  onClose: () => void;
  onSuccess: (summaryText: string) => void;
}

function suggestNextAcademicYear(current: string): string {
  const m = current.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (m) {
    const start = Number(m[1]) + 1;
    const end = Number(m[2]) + 1;
    return `${start}-${end}`;
  }
  const nowYear = new Date().getFullYear();
  return `${nowYear}-${nowYear + 1}`;
}

function suggestNextEndOfYearDate(currentEnd?: string): string {
  if (currentEnd && /^\d{4}-\d{2}-\d{2}$/.test(currentEnd)) {
    const year = Number(currentEnd.slice(0, 4)) + 1;
    return `${year}${currentEnd.slice(4)}`;
  }
  const nowYear = new Date().getFullYear() + 1;
  return `${nowYear}-06-30`;
}

export function AcademicYearModal({
  open,
  uid,
  actorEmail,
  actorName,
  school,
  classrooms,
  students,
  subjects,
  grades,
  onClose,
  onSuccess,
}: AcademicYearModalProps) {
  const sortedClassOptions = useMemo(() => {
    const base =
      classrooms.length > 0
        ? sortClassrooms(classrooms)
        : sortClassrooms(ALL_CLASSES.map((c) => ({ name: c.name, cycle: c.cycle })));
    return base.map((c) => c.name);
  }, [classrooms]);

  const activeStudents = useMemo(
    () =>
      [...students]
        .filter((s) => s.status === 'actif')
        .sort(
          (a, b) =>
            compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
        ),
    [students]
  );

  const computeAnnualAvg = (stu: Student): number | null => {
    const periods: Array<1 | 2 | 3> = stu.cycle === 'Lycée' ? [1, 2] : [1, 2, 3];
    const avgs = periods
      .map((p) => computeStudentGeneralAverage(stu, p, subjects, grades, classrooms).average)
      .filter((v): v is number => v !== null);
    if (avgs.length === 0) return null;
    return Number((avgs.reduce((acc, v) => acc + v, 0) / avgs.length).toFixed(2));
  };

  const initialRows = useMemo<StudentTransitionRow[]>(() => {
    return activeStudents.map((stu) => {
      const annualAverage = computeAnnualAvg(stu);
      const rec = getNextProgressionTarget(stu.classe, classrooms);
      const shouldRepeat = annualAverage !== null && annualAverage < 10;
      if (shouldRepeat) {
        return {
          student: stu,
          annualAverage,
          action: 'repeat',
          targetClasse: stu.classe,
        };
      }
      return {
        student: stu,
        annualAverage,
        action: rec.action,
        targetClasse: rec.action === 'graduate' ? 'Diplômé / Sortant' : rec.targetClasse,
      };
    });
  }, [activeStudents, classrooms, subjects, grades]);

  const [rows, setRows] = useState<StudentTransitionRow[]>(initialRows);
  const [newAcademicYear, setNewAcademicYear] = useState(() =>
    suggestNextAcademicYear(school.academicYear)
  );
  const [newEndOfYearDate, setNewEndOfYearDate] = useState(() =>
    suggestNextEndOfYearDate(school.endOfYearDate)
  );
  const [resetGrades, setResetGrades] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRows(initialRows);
      setNewAcademicYear(suggestNextAcademicYear(school.academicYear));
      setNewEndOfYearDate(suggestNextEndOfYearDate(school.endOfYearDate));
      setError(null);
      setSearchFilter('');
    }
  }, [open, initialRows, school.academicYear, school.endOfYearDate]);

  if (!open) return null;

  const counts = {
    promote: rows.filter((r) => r.action === 'promote').length,
    repeat: rows.filter((r) => r.action === 'repeat').length,
    graduate: rows.filter((r) => r.action === 'graduate').length,
    withdraw: rows.filter((r) => r.action === 'withdraw').length,
  };

  const updateRow = (
    studentId: string,
    patch: Partial<Pick<StudentTransitionRow, 'action' | 'targetClasse'>>
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.student.id !== studentId) return row;
        const nextAction = patch.action ?? row.action;
        let nextTarget = patch.targetClasse ?? row.targetClasse;
        if (patch.action === 'repeat') {
          nextTarget = row.student.classe;
        } else if (patch.action === 'graduate') {
          nextTarget = 'Diplômé / Sortant';
        } else if (patch.action === 'withdraw') {
          nextTarget = 'Retiré';
        } else if (patch.action === 'promote' && (row.targetClasse === 'Diplômé / Sortant' || row.targetClasse === 'Retiré' || row.targetClasse === row.student.classe)) {
          const rec = getNextProgressionTarget(row.student.classe, classrooms);
          nextTarget = rec.action === 'promote' ? rec.targetClasse : sortedClassOptions[0] || row.student.classe;
        }
        return {
          ...row,
          action: nextAction,
          targetClasse: nextTarget,
        };
      })
    );
  };

  const visibleRows = rows.filter((r) => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      r.student.nom.toLowerCase().includes(q) ||
      r.student.prenoms.toLowerCase().includes(q) ||
      r.student.classe.toLowerCase().includes(q)
    );
  });

  const handleConfirmTransition = async () => {
    if (!newAcademicYear.trim()) {
      setError('Veuillez renseigner le libellé de la nouvelle année scolaire (ex: 2027-2028).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const classSummaryMap = new Map<string, { cycle: CycleType; avgs: number[]; count: number }>();
      for (const r of rows) {
        const entry = classSummaryMap.get(r.student.classe) ?? {
          cycle: r.student.cycle,
          avgs: [],
          count: 0,
        };
        entry.count++;
        if (r.annualAverage !== null) entry.avgs.push(r.annualAverage);
        classSummaryMap.set(r.student.classe, entry);
      }

      const classSummaries = Array.from(classSummaryMap.entries())
        .sort(([a], [b]) => compareClassNames(a, b))
        .map(([classe, info]) => ({
          classe,
          cycle: info.cycle,
          effectif: info.count,
          average:
            info.avgs.length > 0
              ? Number((info.avgs.reduce((a, b) => a + b, 0) / info.avgs.length).toFixed(2))
              : null,
        }));

      await executeAcademicYearTransition(uid, school, {
        newAcademicYear: newAcademicYear.trim(),
        newEndOfYearDate,
        closedByEmail: actorEmail,
        closedByName: actorName,
        decisions: rows.map((r) => ({
          student: r.student,
          annualAverage: r.annualAverage,
          action: r.action,
          targetClasse: r.targetClasse,
          targetCycle: getCycleForClass(r.targetClasse, classrooms),
        })),
        classSummaries,
        resetGradesAndRemarks: resetGrades,
      });

      onSuccess(
        `Année ${school.academicYear} archivée ! Nouvelle année ${newAcademicYear.trim()} ouverte (${counts.promote} promus, ${counts.repeat} redoublants, ${counts.graduate} sortants).`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du passage d’année.');
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92dvh] flex flex-col border theme-border-soft shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="theme-surface-header border-b px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl theme-header-chip border flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold">
                Passer à une nouvelle année scolaire
              </h2>
              <p className="text-xs theme-header-subtext">
                Archivage complet de {school.academicYear}, promotion par niveau et réinitialisation propre des notes.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="p-1.5 rounded-lg theme-header-chip transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Config + Stats */}
        <div className="p-5 theme-bg-soft border-b theme-border-soft space-y-4 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold theme-text-ink mb-1">
                Nouvelle année scolaire *
              </label>
              <input
                type="text"
                value={newAcademicYear}
                onChange={(e) => setNewAcademicYear(e.target.value)}
                placeholder="2027-2028"
                className="w-full px-3 py-2 rounded-xl border theme-border-soft bg-white text-xs font-bold font-mono-nums outline-none theme-input"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold theme-text-ink mb-1">
                Date prévue de fin d’année
              </label>
              <input
                type="date"
                value={newEndOfYearDate}
                onChange={(e) => setNewEndOfYearDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border theme-border-soft bg-white text-xs font-mono-nums outline-none theme-input"
              />
            </div>
            <label className="flex items-center gap-2.5 bg-white border theme-border-soft rounded-xl px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={resetGrades}
                onChange={(e) => setResetGrades(e.target.checked)}
                className="rounded border-zinc-300 accent-[var(--theme-accent)]"
              />
              <span className="text-[11px] font-semibold text-zinc-700 leading-tight">
                Archiver puis vider les notes actives de {school.academicYear}
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-bold">
                Promus : {counts.promote}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-bold">
                Redoublants : {counts.repeat}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-800 font-bold">
                Diplômés / Sortants (Tle) : {counts.graduate}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 font-bold">
                Retirés : {counts.withdraw}
              </span>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filtrer un élève ou classe..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border theme-border-soft bg-white text-xs outline-none theme-input"
              />
            </div>
          </div>
        </div>

        {/* Decisions Table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              Aucun élève actif inscrit pour cette année scolaire. Vous pouvez directement archiver et ouvrir {newAcademicYear}.
            </div>
          ) : (
            <div className="overflow-x-auto border border-zinc-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-bold text-zinc-600 uppercase">
                    <th className="py-2.5 px-3">Élève</th>
                    <th className="py-2.5 px-3">Classe actuelle</th>
                    <th className="py-2.5 px-3 text-right">Moy. Annuelle</th>
                    <th className="py-2.5 px-3">Décision</th>
                    <th className="py-2.5 px-3">Classe cible ({newAcademicYear})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {visibleRows.map((row) => (
                    <tr key={row.student.id} className="theme-bg-soft-hover">
                      <td className="py-2 px-3 font-semibold text-zinc-900">
                        {row.student.nom} {row.student.prenoms}
                        <span className="block text-[10px] font-mono-nums text-zinc-400">
                          {row.student.matricule}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-semibold theme-text-accent">{row.student.classe}</td>
                      <td className="py-2 px-3 text-right font-mono-nums font-bold">
                        {row.annualAverage !== null ? (
                          <span className={row.annualAverage >= 10 ? 'text-emerald-700' : 'text-rose-600'}>
                            {row.annualAverage.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={row.action}
                          onChange={(e) =>
                            updateRow(row.student.id, {
                              action: e.target.value as TransitionDecision,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-semibold outline-none theme-input"
                        >
                          <option value="promote">Promouvoir</option>
                          <option value="repeat">Redoubler</option>
                          <option value="graduate">Diplômé / Fin de cycle</option>
                          <option value="withdraw">Supprimer / Quitte l’école</option>
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        {row.action === 'promote' ? (
                          <select
                            value={row.targetClasse}
                            onChange={(e) =>
                              updateRow(row.student.id, { targetClasse: e.target.value })
                            }
                            className="px-2.5 py-1.5 rounded-lg border theme-pill-soft text-xs font-bold outline-none theme-input"
                          >
                            {!sortedClassOptions.includes(row.targetClasse) && (
                              <option value={row.targetClasse}>{row.targetClasse}</option>
                            )}
                            {sortedClassOptions.map((cl) => (
                              <option key={cl} value={cl}>
                                {cl}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs font-medium text-zinc-500">
                            {row.action === 'repeat'
                              ? `Reste en ${row.student.classe}`
                              : row.action === 'graduate'
                              ? 'Archivé (Diplômé)'
                              : 'Supprimé de la liste active'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 bg-zinc-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          {error ? (
            <p className="text-xs font-semibold text-rose-600">{error}</p>
          ) : (
            <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5 theme-text-accent shrink-0" />
              <span>
                Un bilan permanent de {school.academicYear} sera conservé dans « Archives des années précédentes ».
              </span>
            </p>
          )}
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 text-xs font-semibold text-zinc-700"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleConfirmTransition()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl theme-btn-primary text-xs font-bold transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} />
              <span>{submitting ? 'Archivage en cours...' : `Valider et ouvrir ${newAcademicYear}`}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface ArchivesViewProps {
  schoolName: string;
  archives: AcademicArchive[];
  onBack: () => void;
}

export function ArchivesView({ schoolName, archives, onBack }: ArchivesViewProps) {
  const [selectedId, setSelectedId] = useState<string>(archives[0]?.id ?? '');
  const selected = archives.find((a) => a.id === selectedId) ?? archives[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl theme-surface-header border p-5 sm:p-6 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl theme-header-chip border flex items-center justify-center shrink-0">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold">
              Archives des années scolaires
            </h1>
            <p className="text-xs theme-header-subtext">
              Historique officiel en lecture seule · {schoolName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-xl theme-header-chip border text-xs font-semibold whitespace-nowrap self-start sm:self-auto"
        >
          Retour
        </button>
      </div>

      {archives.length === 0 ? (
        <div className="bg-white/95 border theme-border-soft rounded-2xl p-10 text-center space-y-2">
          <GraduationCap className="w-8 h-8 theme-text-accent opacity-60 mx-auto" />
          <p className="text-sm font-bold theme-text-ink">Aucune année archivée pour le moment</p>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            Lorsque le Directeur clôturera une année scolaire via « Passer à une nouvelle année scolaire », le bilan complet apparaîtra ici.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white/95 border theme-border-soft rounded-2xl p-4 space-y-2 h-fit">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 px-1">
              Années clôturées ({archives.length})
            </h2>
            {archives.map((arch) => (
              <button
                key={arch.id}
                type="button"
                onClick={() => setSelectedId(arch.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected?.id === arch.id
                    ? 'theme-btn-primary border-transparent'
                    : 'theme-pill-soft border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold font-mono-nums">{arch.academicYear}</span>
                  <span className={`text-[11px] font-bold ${selected?.id === arch.id ? 'opacity-90' : 'theme-text-accent'}`}>
                    {arch.totalStudents} élèves
                  </span>
                </div>
                <p className={`text-[11px] mt-1 ${selected?.id === arch.id ? 'opacity-80' : 'text-zinc-500'}`}>
                  Clôturée le {new Date(arch.closedAtIso).toLocaleDateString('fr-FR')} par {arch.closedByName}
                </p>
              </button>
            ))}
          </div>

          {selected && (
            <div className="lg:col-span-2 bg-white/95 border theme-border-soft rounded-2xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                <div>
                  <h3 className="text-base font-extrabold theme-text-ink">
                    Bilan annuel · {selected.academicYear}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Archivé le {new Date(selected.closedAtIso).toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                    {selected.promotedCount} promus
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-bold border border-amber-200">
                    {selected.repeatedCount} redoublants
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 font-bold border border-sky-200">
                    {selected.graduatedCount} diplômés
                  </span>
                </div>
              </div>

              {selected.classSummaries.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                    Moyennes par classe
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selected.classSummaries.map((cs) => (
                      <div key={cs.classe} className="p-2.5 rounded-xl theme-bg-soft border theme-border-soft text-xs">
                        <p className="font-bold theme-text-ink">{cs.classe}</p>
                        <p className="text-[11px] text-zinc-600 font-mono-nums">
                          {cs.effectif} él. · Moy {cs.average !== null ? `${cs.average}/20` : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Registre archivé ({selected.studentRecords.length})
                </h4>
                <div className="overflow-x-auto max-h-96 border border-zinc-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-bold text-zinc-600">
                        <th className="py-2 px-3">Matricule</th>
                        <th className="py-2 px-3">Nom & Prénoms</th>
                        <th className="py-2 px-3">Classe</th>
                        <th className="py-2 px-3 text-right">Moyenne</th>
                        <th className="py-2 px-3">Issue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {selected.studentRecords.map((rec) => (
                        <tr key={rec.studentId}>
                          <td className="py-2 px-3 font-mono-nums text-zinc-500">{rec.matricule}</td>
                          <td className="py-2 px-3 font-semibold text-zinc-900">{rec.fullName}</td>
                          <td className="py-2 px-3 theme-text-accent font-medium">{rec.classe}</td>
                          <td className="py-2 px-3 text-right font-mono-nums font-bold">
                            {rec.annualAverage !== null ? `${rec.annualAverage}/20` : '—'}
                          </td>
                          <td className="py-2 px-3 text-zinc-600">
                            {rec.decision === 'promote'
                              ? `Admis → ${rec.nextClasse}`
                              : rec.decision === 'repeat'
                              ? `Redouble (${rec.classe})`
                              : rec.nextClasse}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
