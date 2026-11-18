import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Award, BarChart3, Users, CheckCircle2 } from 'lucide-react';
import {
  ALL_CLASSES,
  Classroom,
  CycleType,
  GradeRecord,
  Student,
  Subject,
  computeMoyMatiere,
  getCycleForClass,
  getEffectiveSubjectsForClass,
} from '../types/school.ts';

interface StatisticsViewProps {
  classrooms: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  onSelectClass: (classe: string) => void;
}

export function StatisticsView({
  classrooms,
  students,
  subjects,
  grades,
  onSelectClass,
}: StatisticsViewProps) {
  const [trimester, setTrimester] = useState<1 | 2 | 3>(1);

  const activeStudents = useMemo(
    () =>
      students.filter(
        (s) => s.status === 'actif' && (s.cycle === 'Collège' || s.cycle === 'Lycée')
      ),
    [students]
  );

  const boys = activeStudents.filter((s) => s.sexe === 'M').length;
  const girls = activeStudents.filter((s) => s.sexe === 'F').length;
  const boysPct = activeStudents.length > 0 ? Math.round((boys / activeStudents.length) * 100) : 0;
  const girlsPct = activeStudents.length > 0 ? 100 - boysPct : 0;

  const studentAverages = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const s of activeStudents) {
      const clsObj = classrooms.find((c) => c.name === s.classe);
      const studentGrades = grades.filter(
        (item) => item.studentId === s.id && item.trimester === trimester
      );
      const effectiveSubjects = getEffectiveSubjectsForClass(
        s.classe,
        subjects,
        clsObj,
        studentGrades
      );
      let weighted = 0;
      let totalCoef = 0;
      for (const sub of effectiveSubjects) {
        const g = studentGrades.find((item) => item.subjectId === sub.id);
        if (!g) continue;
        const moy = computeMoyMatiere(g);
        if (moy !== null) {
          weighted += moy * sub.coef;
          totalCoef += sub.coef;
        }
      }
      map[s.id] = totalCoef > 0 ? Number((weighted / totalCoef).toFixed(2)) : null;
    }
    return map;
  }, [activeStudents, classrooms, subjects, grades, trimester]);

  const classList = useMemo(() => {
    const names = new Set<string>();
    const activeClassrooms = classrooms.filter(
      (c) => c.cycle === 'Collège' || c.cycle === 'Lycée'
    );
    if (activeClassrooms.length > 0) {
      activeClassrooms.forEach((c) => names.add(c.name));
    } else {
      ALL_CLASSES.forEach((c) => names.add(c.name));
    }
    activeStudents.forEach((s) => names.add(s.classe));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [classrooms, activeStudents]);

  const classRows = useMemo(() => {
    return classList
      .map((clsName) => {
        const members = activeStudents.filter((s) => s.classe === clsName);
        const avgs = members
          .map((m) => studentAverages[m.id])
          .filter((v): v is number => v !== null);
        const classAvg =
          avgs.length > 0
            ? Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2))
            : null;
        const passing = avgs.filter((v) => v >= 10).length;
        const passRate = avgs.length > 0 ? Math.round((passing / avgs.length) * 100) : null;

        let topStudent: { name: string; avg: number } | null = null;
        for (const m of members) {
          const a = studentAverages[m.id];
          if (a !== null && (!topStudent || a > topStudent.avg)) {
            topStudent = { name: `${m.nom} ${m.prenoms}`, avg: a };
          }
        }

        return {
          classe: clsName,
          cycle: getCycleForClass(clsName, classrooms),
          total: members.length,
          boys: members.filter((m) => m.sexe === 'M').length,
          girls: members.filter((m) => m.sexe === 'F').length,
          classAvg,
          passRate,
          topStudent,
        };
      })
      .filter((row) => row.total > 0);
  }, [classList, classrooms, activeStudents, studentAverages]);

  const globalEvaluated = Object.values(studentAverages).filter((v): v is number => v !== null);
  const globalPassRate =
    globalEvaluated.length > 0
      ? Math.round(
          (globalEvaluated.filter((v) => v >= 10).length / globalEvaluated.length) * 100
        )
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-white">Statistiques de l'établissement</h1>
          <p className="text-xs text-violet-100/90">
            Effectifs, parité, moyennes générales et taux de réussite par classe et division.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-full bg-white/15 border border-white/25 self-start">
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
                    layoutId="stats-trimester-pill"
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-white/95 to-violet-100/80 backdrop-blur-xs border border-violet-300/80 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Parité Garçons / Filles</span>
            <Users className="w-4 h-4 text-violet-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-3 font-mono-nums">
            <span className="text-xl font-bold text-zinc-900">{boys} G ({boysPct}%)</span>
            <span className="text-zinc-300">/</span>
            <span className="text-xl font-bold text-violet-700">{girls} F ({girlsPct}%)</span>
          </div>
          <div className="mt-3 h-2.5 w-full rounded-full bg-violet-100 overflow-hidden flex">
            <div style={{ width: `${boysPct}%` }} className="bg-zinc-800 h-full transition-all" />
            <div style={{ width: `${girlsPct}%` }} className="bg-violet-600 h-full transition-all" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-indigo-100/80 backdrop-blur-xs border border-indigo-300/80 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-800">Répartition par Cycle</span>
            <BarChart3 className="w-4 h-4 text-violet-600" />
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {(['Collège', 'Lycée'] as CycleType[]).map((cycle) => {
              const count = activeStudents.filter((s) => s.cycle === cycle).length;
              const pct =
                activeStudents.length > 0 ? Math.round((count / activeStudents.length) * 100) : 0;
              return (
                <div key={cycle} className="flex items-center justify-between gap-2">
                  <span className="text-zinc-700 font-medium w-20">{cycle}</span>
                  <div className="flex-1 h-2 bg-violet-100 rounded-full overflow-hidden">
                    <div style={{ width: `${pct}%` }} className="h-full bg-violet-700 rounded-full" />
                  </div>
                  <span className="font-mono-nums font-semibold text-zinc-900 w-10 text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-emerald-50/90 backdrop-blur-xs border border-emerald-300/80 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800">Taux de réussite (≥ 10/20)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-3 text-3xl font-extrabold font-mono-nums text-emerald-700">
            {globalPassRate !== null ? `${globalPassRate}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-zinc-600 font-mono-nums">
            Sur {globalEvaluated.length} élève(s) évalué(s) au Trimestre {trimester}
          </p>
        </div>
      </div>

      <div className="bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-violet-200 bg-violet-100/75 flex items-center justify-between">
          <h2 className="text-sm font-bold text-violet-950">Performance détaillée par classe</h2>
          <span className="text-xs text-violet-700 font-semibold font-mono-nums">
            {classRows.length} / {classList.length} classes peuplées
          </span>
        </div>

        {classRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            Aucune donnée statistique disponible. Inscrivez des élèves pour afficher les indicateurs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase">
                  <th className="py-3 px-4">Classe</th>
                  <th className="py-3 px-4">Cycle</th>
                  <th className="py-3 px-3 text-right">Effectif</th>
                  <th className="py-3 px-3 text-right">G / F</th>
                  <th className="py-3 px-4 text-right">Moy. Classe</th>
                  <th className="py-3 px-4 text-right">Réussite</th>
                  <th className="py-3 px-4">Major de classe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {classRows.map((row) => (
                  <tr
                    key={row.classe}
                    onClick={() => onSelectClass(row.classe)}
                    className="hover:bg-violet-50/40 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-violet-800">{row.classe}</td>
                    <td className="py-3 px-4 text-zinc-500">{row.cycle}</td>
                    <td className="py-3 px-3 text-right font-mono-nums font-semibold text-zinc-900">
                      {row.total}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-nums text-zinc-500">
                      {row.boys} / {row.girls}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-nums font-bold text-zinc-900">
                      {row.classAvg !== null ? `${row.classAvg.toFixed(2)} /20` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-nums">
                      {row.passRate !== null ? (
                        <span
                          className={
                            row.passRate >= 50
                              ? 'text-emerald-700 font-semibold'
                              : 'text-rose-600 font-semibold'
                          }
                        >
                          {row.passRate}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {row.topStudent ? (
                        <span className="inline-flex items-center gap-1.5 text-zinc-800 font-medium">
                          <Award className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                          {row.topStudent.name}
                          <span className="font-mono-nums text-violet-700 font-bold">
                            ({row.topStudent.avg.toFixed(2)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
