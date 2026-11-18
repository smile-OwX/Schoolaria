import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ChevronRight,
  Search,
  Users,
  Plus,
  Sparkles,
  SlidersHorizontal,
  X,
  Atom,
  BookOpen,
  Microscope,
} from 'lucide-react';
import {
  CYCLES,
  Classroom,
  ClassroomMotif,
  CycleType,
  GradeRecord,
  LEVEL_SUGGESTIONS,
  Student,
  computeMoyMatiere,
  getClassroomTheme,
} from '../types/school.ts';
import { createClassroom, updateClassroom } from '../lib/schoolService.ts';

interface MakeListViewProps {
  uid: string;
  schoolId: string;
  canManageClasses: boolean;
  classrooms: Classroom[];
  students: Student[];
  grades: GradeRecord[];
  onBack: () => void;
  onSelectClass: (classe: string) => void;
}

const ACCENT_OPTIONS = [
  { label: 'Violet Académique', value: '#6d28d9' },
  { label: 'Violet Royal', value: '#7c3aed' },
  { label: 'Indigo Sciences', value: '#4338ca' },
  { label: 'Bleu Azur', value: '#0284c7' },
  { label: 'Émeraude SVT', value: '#047857' },
  { label: 'Teal Observation', value: '#0f766e' },
  { label: 'Ambre Lettres', value: '#b45309' },
  { label: 'Pourpre Culture', value: '#a21caf' },
  { label: 'Carmin Philo', value: '#be123c' },
];

export function MakeListView({
  uid,
  schoolId,
  canManageClasses,
  classrooms,
  students,
  grades,
  onBack,
  onSelectClass,
}: MakeListViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClass, setEditingClass] = useState<Classroom | null>(null);

  // Add/Edit Form state
  const [clsName, setClsName] = useState('6ème C');
  const [clsCycle, setClsCycle] = useState<CycleType>('Collège');
  const [clsLevel, setClsLevel] = useState('6ème');
  const [clsSeries, setClsSeries] = useState('');
  const [clsMotif, setClsMotif] = useState<ClassroomMotif>('general');
  const [clsAccent, setClsAccent] = useState('#6d28d9');
  const [clsRoom, setClsRoom] = useState('');
  const [clsHeadTeacher, setClsHeadTeacher] = useState('');
  const [clsSlogan, setClsSlogan] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const effectiveClassrooms = useMemo<Classroom[]>(() => {
    const allowed = classrooms.filter((c) => c.cycle === 'Collège' || c.cycle === 'Lycée');
    if (allowed.length > 0) {
      return [...allowed].sort((a, b) => a.name.localeCompare(b.name));
    }
    return (Object.keys(CYCLES) as CycleType[]).flatMap((cyc) =>
      CYCLES[cyc].map((c, idx) => ({
        id: `fallback_${cyc}_${idx}`,
        ownerId: uid,
        schoolId,
        name: c.name,
        level: c.level ?? c.name,
        cycle: c.cycle,
        series: c.series ?? '',
        motif: c.motif ?? 'general',
        accentColor: c.accentColor ?? '#6d28d9',
        room: '',
        headTeacher: '',
        slogan: c.slogan ?? '',
      }))
    );
  }, [classrooms, uid, schoolId]);

  const classStats = useMemo(() => {
    const map: Record<string, { total: number; boys: number; girls: number; avg: number | null }> = {};
    for (const cl of effectiveClassrooms) {
      const classStudents = students.filter((s) => s.classe === cl.name && s.status === 'actif');
      const classGrades = grades
        .filter((g) => g.classe === cl.name)
        .map((g) => computeMoyMatiere(g))
        .filter((v): v is number => v !== null);
      const avg =
        classGrades.length > 0
          ? Number((classGrades.reduce((a, b) => a + b, 0) / classGrades.length).toFixed(2))
          : null;
      map[cl.name] = {
        total: classStudents.length,
        boys: classStudents.filter((s) => s.sexe === 'M').length,
        girls: classStudents.filter((s) => s.sexe === 'F').length,
        avg,
      };
    }
    return map;
  }, [effectiveClassrooms, students, grades]);

  const matchedStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.nom.toLowerCase().includes(q) ||
          s.prenoms.toLowerCase().includes(q) ||
          s.matricule.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [students, searchTerm]);

  const openAddModal = () => {
    setEditingClass(null);
    setClsCycle('Collège');
    setClsLevel('6ème');
    setClsName('6ème C');
    setClsSeries('');
    setClsMotif('general');
    setClsAccent('#6d28d9');
    setClsRoom('');
    setClsHeadTeacher('');
    setClsSlogan('');
    setShowAddModal(true);
  };

  const openEditModal = (e: React.MouseEvent, cls: Classroom) => {
    e.stopPropagation();
    setEditingClass(cls);
    setClsCycle(cls.cycle);
    setClsLevel(cls.level || cls.name);
    setClsName(cls.name);
    setClsSeries(cls.series ?? '');
    setClsMotif(cls.motif ?? 'general');
    setClsAccent(cls.accentColor ?? '#6d28d9');
    setClsRoom(cls.room ?? '');
    setClsHeadTeacher(cls.headTeacher ?? '');
    setClsSlogan(cls.slogan ?? '');
    setShowAddModal(true);
  };

  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clsName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editingClass && !editingClass.id.startsWith('fallback_')) {
        await updateClassroom(editingClass.id, {
          name: clsName,
          level: clsLevel || clsName,
          cycle: clsCycle,
          series: clsSeries,
          motif: clsMotif,
          accentColor: clsAccent,
          room: clsRoom,
          headTeacher: clsHeadTeacher,
          slogan: clsSlogan,
        });
      } else {
        await createClassroom(uid, schoolId, {
          name: clsName,
          level: clsLevel || clsName,
          cycle: clsCycle,
          series: clsSeries,
          motif: clsMotif,
          accentColor: clsAccent,
          room: clsRoom,
          headTeacher: clsHeadTeacher,
          slogan: clsSlogan,
        });
      }
      setShowAddModal(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde de la classe.');
    } finally {
      setSaving(false);
    }
  };

  const cycleColumns: Array<{
    cycle: CycleType;
    heading: string;
    desc: string;
    headerGradient: string;
    panelBg: string;
  }> = [
    {
      cycle: 'Collège',
      heading: 'Collège · 1er Cycle (6ème → 3ème)',
      desc: '6e/5e (Coef 1) · 4e/3e (Coefficients officiels Togo)',
      headerGradient: 'from-violet-700 via-purple-700 to-indigo-800',
      panelBg: 'bg-violet-50/90 border-violet-300/80',
    },
    {
      cycle: 'Lycée',
      heading: 'Lycée · 2nd Cycle (Séries A, C, D)',
      desc: '2nde, 1ère & Terminale · Séries A4, C & D',
      headerGradient: 'from-indigo-700 via-violet-800 to-purple-900',
      panelBg: 'bg-violet-50/90 border-violet-300/80',
    },
  ];

  const renderMotifIcon = (motif: ClassroomMotif) => {
    if (motif === 'maths-physique') return <Atom className="w-3.5 h-3.5" />;
    if (motif === 'lettres-philo') return <BookOpen className="w-3.5 h-3.5" />;
    if (motif === 'sciences-nat') return <Microscope className="w-3.5 h-3.5" />;
    return <Sparkles className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-5 sm:p-6 shadow-md border border-violet-700/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-white">Listes des classes & divisions (Make List)</h1>
            <p className="text-xs text-violet-100/90">
              Chaque classe du Collège (6ème → 3ème) et du Lycée (2nde, 1ère, Tle · A, C, D) applique automatiquement ses coefficients officiels.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-violet-300 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Recherche rapide d'un élève..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-white/25 bg-white/95 text-zinc-900 text-xs focus:border-white outline-none"
            />
            {matchedStudents.length > 0 && (
              <div className="absolute right-0 left-0 mt-1 bg-white border border-violet-200 rounded-xl shadow-lg z-20 divide-y divide-violet-100 overflow-hidden">
                {matchedStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectClass(s.classe)}
                    className="w-full px-3 py-2 text-left hover:bg-violet-50 flex items-center justify-between text-xs"
                  >
                    <span className="font-semibold text-zinc-800">
                      {s.nom} {s.prenoms}
                    </span>
                    <span className="text-violet-700 font-semibold">{s.classe}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {canManageClasses && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              <Plus className="w-4 h-4 text-violet-700" />
              Ajouter une classe / division
            </button>
          )}
        </div>
      </div>

      {/* Two Columns: Collège / Lycée */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {cycleColumns.map((col, colIdx) => {
          const items = effectiveClassrooms.filter((c) => c.cycle === col.cycle);
          const cycleTotal = items.reduce((acc, c) => acc + (classStats[c.name]?.total ?? 0), 0);

          return (
            <motion.div
              key={col.cycle}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: colIdx * 0.06, duration: 0.3 }}
              className={`backdrop-blur-xs border rounded-2xl overflow-hidden flex flex-col shadow-sm ${col.panelBg}`}
            >
              <div className={`bg-gradient-to-r ${col.headerGradient} text-white px-5 py-4 flex items-start justify-between gap-3`}>
                <div>
                  <h2 className="text-sm font-extrabold text-white">{col.heading}</h2>
                  <p className="text-[11px] text-white/85">{col.desc}</p>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-white/20 text-xs text-white font-bold font-mono-nums whitespace-nowrap shrink-0">
                  {cycleTotal} élèves
                </span>
              </div>

              <div className="p-4 space-y-3 flex-1">
                {items.map((cl) => {
                  const st = classStats[cl.name] ?? { total: 0, boys: 0, girls: 0, avg: null };
                  const theme = getClassroomTheme(cl.name, cl);

                  return (
                    <div
                      key={cl.id}
                      onClick={() => onSelectClass(cl.name)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onSelectClass(cl.name);
                      }}
                      className={`w-full group rounded-xl border overflow-hidden transition-all cursor-pointer text-left shadow-xs ${theme.surfaceTintClass}`}
                    >
                      <div className={`h-1.5 w-full bg-gradient-to-r ${theme.gradientClass}`} />

                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span
                              style={{ backgroundColor: theme.accentColor }}
                              className="w-7 h-7 rounded-lg text-white flex items-center justify-center shrink-0 shadow-xs"
                            >
                              {renderMotifIcon(theme.motif)}
                            </span>
                            <span className="text-sm font-extrabold text-zinc-900 group-hover:text-violet-900">
                              {cl.name}
                            </span>
                            <span
                              style={{ color: theme.accentColor }}
                              className="inline-flex items-center gap-1 text-[11px] font-bold"
                            >
                              {theme.badgeLabel}
                            </span>
                          </div>

                          <p className="text-[11px] text-zinc-600 truncate mt-1">
                            {theme.series}
                            {cl.room ? ` · Salle ${cl.room}` : ''}
                            {cl.headTeacher ? ` · PP : ${cl.headTeacher}` : ''}
                          </p>

                          <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-600 font-mono-nums">
                            <span className="inline-flex items-center gap-1">
                              <Users className="w-3 h-3" style={{ color: theme.accentColor }} />
                              Effectif : <strong className="text-zinc-900">{st.total}</strong>
                            </span>
                            {st.total > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {st.boys} G / {st.girls} F
                                </span>
                              </>
                            )}
                            {st.avg !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span style={{ color: theme.accentColor }} className="font-bold">
                                  Moy {st.avg}/20
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {canManageClasses && (
                            <button
                              type="button"
                              onClick={(e) => openEditModal(e, cl)}
                              title="Personnaliser cette classe"
                              className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-800 hover:bg-white/80 transition-colors"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-violet-700 transition-colors" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Add / Customize Classroom Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-zinc-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-zinc-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  {editingClass ? `Personnaliser ${editingClass.name}` : 'Créer une nouvelle classe / division'}
                </h3>
                <p className="text-xs text-zinc-500">
                  Ex : 6ème C, 5ème C, 3ème C ou une classe de Lycée avec série et thème dédié.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClassroom} className="space-y-4">
              {saveError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {saveError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Cycle *</label>
                  <select
                    value={clsCycle}
                    onChange={(e) => {
                      const cyc = e.target.value as CycleType;
                      setClsCycle(cyc);
                      setClsLevel(LEVEL_SUGGESTIONS[cyc][0]);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs font-medium outline-none focus:border-violet-600"
                  >
                    <option value="Collège">Collège</option>
                    <option value="Lycée">Lycée</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Niveau de base *</label>
                  <select
                    value={clsLevel}
                    onChange={(e) => setClsLevel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs font-medium outline-none focus:border-violet-600"
                  >
                    {LEVEL_SUGGESTIONS[clsCycle].map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Nom complet / Division *
                  </label>
                  <input
                    type="text"
                    required
                    value={clsName}
                    onChange={(e) => setClsName(e.target.value)}
                    placeholder="Ex : 6ème C ou Tle C"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Série / Spécialité</label>
                  <input
                    type="text"
                    value={clsSeries}
                    onChange={(e) => setClsSeries(e.target.value)}
                    placeholder="Ex : Série C · Maths & Physique"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Thème & symboles flottants
                  </label>
                  <select
                    value={clsMotif}
                    onChange={(e) => setClsMotif(e.target.value as ClassroomMotif)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  >
                    <option value="general">Général (∑, π, √x)</option>
                    <option value="maths-physique">Maths & Physique (∫, E=mc², Δ, Ω)</option>
                    <option value="sciences-nat">Sciences & SVT (ADN, O₂, ATP)</option>
                    <option value="lettres-philo">Lettres & Philo (Φ, Ψ, Logos)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Couleur de la classe</label>
                  <select
                    value={clsAccent}
                    onChange={(e) => setClsAccent(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  >
                    {ACCENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Salle</label>
                  <input
                    type="text"
                    value={clsRoom}
                    onChange={(e) => setClsRoom(e.target.value)}
                    placeholder="Ex : Bâtiment B · S12"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Professeur Principal</label>
                  <input
                    type="text"
                    value={clsHeadTeacher}
                    onChange={(e) => setClsHeadTeacher(e.target.value)}
                    placeholder="Ex : M. Houngbédji"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Devise / Slogan de la classe
                </label>
                <input
                  type="text"
                  value={clsSlogan}
                  onChange={(e) => setClsSlogan(e.target.value)}
                  placeholder="Ex : Objectif 100% au Baccalauréat"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {saving ? 'Enregistrement...' : editingClass ? 'Mettre à jour' : 'Créer la classe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
