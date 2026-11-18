import React, { useMemo, useState } from 'react';
import {
  UserPlus,
  ClipboardList,
  BarChart3,
  FileSpreadsheet,
  Bot,
  Database,
  MessageSquare,
  Bell,
  Users,
  Shield,
  BookOpen,
  GraduationCap,
  Trash2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  ArrowUpRight,
} from 'lucide-react';
import {
  BulletinRemark,
  Classroom,
  GradeRecord,
  Membership,
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  Subject,
  UserRole,
  computeMoyMatiere,
  getClassroomTheme,
  getEffectiveSubjectsForClass,
  getMentionFromAverage,
} from '../types/school.ts';
import { createMembership, deleteMembershipById } from '../lib/schoolService.ts';
import { ExpressiveModuleCard } from './MaterialMotion.tsx';

export type ActiveTab =
  | 'hub'
  | 'inscription'
  | 'makelist'
  | 'classdetail'
  | 'bulletins'
  | 'stats'
  | 'messages'
  | 'notifications'
  | 'roles'
  | 'audit'
  | 'assistant'
  | 'settings';

interface RoleDashboardProps {
  effectiveRole: UserRole;
  isPreview?: boolean;
  activeMembership: Membership | null;
  school: SchoolProfile;
  classrooms: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  remarks: BulletinRemark[];
  messages: MessageItem[];
  notifications: NotificationItem[];
  memberships: Membership[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenClass: (classe: string) => void;
  onOpenBulletin: (studentId: string, trimester: 1 | 2 | 3) => void;
  onSeedDemo: () => Promise<void>;
}

export function PersonalizedDashboard({
  effectiveRole,
  isPreview = false,
  activeMembership,
  school,
  classrooms,
  students,
  subjects,
  grades,
  remarks,
  messages,
  notifications,
  memberships,
  onNavigate,
  onOpenClass,
  onOpenBulletin,
  onSeedDemo,
}: RoleDashboardProps) {
  if (effectiveRole === 'teacher') {
    return (
      <TeacherDashboard
        school={school}
        isPreview={isPreview}
        activeMembership={activeMembership}
        memberships={memberships}
        classrooms={classrooms}
        students={students}
        grades={grades}
        messages={messages}
        notifications={notifications}
        onNavigate={onNavigate}
        onOpenClass={onOpenClass}
      />
    );
  }

  if (effectiveRole === 'parent') {
    return (
      <ParentDashboard
        school={school}
        isPreview={isPreview}
        activeMembership={activeMembership}
        memberships={memberships}
        classrooms={classrooms}
        students={students}
        subjects={subjects}
        grades={grades}
        remarks={remarks}
        messages={messages}
        notifications={notifications}
        onNavigate={onNavigate}
        onOpenBulletin={onOpenBulletin}
      />
    );
  }

  return (
    <AdminDashboard
      school={school}
      classrooms={classrooms}
      students={students}
      grades={grades}
      memberships={memberships}
      messages={messages}
      notifications={notifications}
      onNavigate={onNavigate}
      onSeedDemo={onSeedDemo}
    />
  );
}

function AdminDashboard({
  school,
  classrooms,
  students,
  grades,
  memberships,
  messages,
  notifications,
  onNavigate,
  onSeedDemo,
}: {
  school: SchoolProfile;
  classrooms: Classroom[];
  students: Student[];
  grades: GradeRecord[];
  memberships: Membership[];
  messages: MessageItem[];
  notifications: NotificationItem[];
  onNavigate: (tab: ActiveTab) => void;
  onSeedDemo: () => Promise<void>;
}) {
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const activeStudents = students.filter(
    (s) => s.status === 'actif' && (s.cycle === 'Collège' || s.cycle === 'Lycée')
  );
  const activeClassrooms = classrooms.filter(
    (c) => c.cycle === 'Collège' || c.cycle === 'Lycée'
  );
  const activeClassCount =
    activeClassrooms.length > 0
      ? activeClassrooms.length
      : new Set(activeStudents.map((s) => s.classe)).size;
  const computedAverages = grades
    .map((g) => computeMoyMatiere(g))
    .filter((v): v is number => v !== null);
  const overallAvg =
    computedAverages.length > 0
      ? (computedAverages.reduce((a, b) => a + b, 0) / computedAverages.length).toFixed(2)
      : '—';

  const teachersCount = memberships.filter((m) => m.role === 'teacher').length;
  const parentsCount = memberships.filter((m) => m.role === 'parent').length;
  const unreadMessages = messages.filter((m) => !m.read).length;

  const handleSeed = async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      await onSeedDemo();
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : 'Erreur lors du chargement des données.');
    } finally {
      setSeeding(false);
    }
  };

  const primaryActions = [
    {
      id: 'inscription' as ActiveTab,
      title: 'Inscription',
      subtitle: 'Enregistrer un élève, sa classe/division et l’email du parent',
      icon: UserPlus,
      accent: 'bg-violet-700 text-white',
    },
    {
      id: 'makelist' as ActiveTab,
      title: 'Classes & Notes (Make List)',
      subtitle: 'Collège (6ème → 3ème) et Lycée (2nde, 1ère, Tle · A, C, D)',
      icon: ClipboardList,
      accent: 'bg-violet-100 text-violet-700',
    },
    {
      id: 'bulletins' as ActiveTab,
      title: 'Bulletins & Suivi',
      subtitle: 'Générer les bulletins PDF/Word et suivre les 3 trimestres',
      icon: FileSpreadsheet,
      accent: 'bg-violet-100 text-violet-700',
    },
    {
      id: 'stats' as ActiveTab,
      title: 'Statistiques globales',
      subtitle: 'Effectifs par division, parité, réussite et majors de classe',
      icon: BarChart3,
      accent: 'bg-violet-100 text-violet-700',
    },
    {
      id: 'messages' as ActiveTab,
      title: 'Messagerie sécurisée',
      subtitle: `${messages.length} échange(s) · ${unreadMessages} non lu(s) avec parents et profs`,
      icon: MessageSquare,
      accent: 'bg-indigo-100 text-indigo-700',
    },
    {
      id: 'roles' as ActiveTab,
      title: 'Enseignants & Parents (RBAC)',
      subtitle: `${teachersCount} enseignant(s) · ${parentsCount} parent(s) rattaché(s)`,
      icon: Shield,
      accent: 'bg-emerald-100 text-emerald-700',
    },
  ];

  return (
    <div className="space-y-7">
      {/* Royal Violet & White Hero Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-violet-200 mb-1">
            Espace Administrateur · {school.schoolName} · {school.academicYear}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight text-balance">
            Tableau de pilotage global
          </h1>
          <p className="text-sm text-violet-100/90 mt-1">
            Bienvenue, {school.adminName}. Supervisez l’ensemble des cycles, des divisions, des notes et des communications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeStudents.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/30 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-4 h-4" />
              {seeding ? 'Chargement des données...' : 'Charger des données de démonstration'}
            </button>
          )}
          <button
            onClick={() => onNavigate('audit')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/30 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Shield className="w-4 h-4" />
            Journaux & Sécurité
          </button>
          <button
            onClick={() => onNavigate('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Megaphone className="w-4 h-4 text-violet-700" />
            Publier une annonce ({notifications.length})
          </button>
        </div>
      </div>

      {seedError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {seedError}
        </div>
      )}

      {/* Global KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-white/95 to-violet-100/80 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-violet-700 to-purple-600" />
          <div className="p-5">
            <p className="text-xs text-violet-800 font-semibold">Élèves inscrits</p>
            <p className="mt-2 text-2xl font-extrabold text-violet-950 font-mono-nums">{activeStudents.length}</p>
            <p className="mt-1 text-xs text-violet-700/80">
              {activeStudents.filter((s) => s.sexe === 'M').length} G · {activeStudents.filter((s) => s.sexe === 'F').length} F
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-indigo-100/75 backdrop-blur-xs border border-indigo-300/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-indigo-600 to-violet-700" />
          <div className="p-5">
            <p className="text-xs text-indigo-800 font-semibold">Classes & divisions</p>
            <p className="mt-2 text-2xl font-extrabold text-indigo-950 font-mono-nums">{activeClassCount}</p>
            <p className="mt-1 text-xs text-indigo-700/80">Collège · Lycée (Togo)</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-purple-100/80 backdrop-blur-xs border border-purple-300/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-purple-700 to-fuchsia-600" />
          <div className="p-5">
            <p className="text-xs text-purple-800 font-semibold">Moyenne générale école</p>
            <p className="mt-2 text-2xl font-extrabold text-violet-800 font-mono-nums">
              {overallAvg}
              {overallAvg !== '—' && <span className="text-sm font-normal text-violet-500"> /20</span>}
            </p>
            <p className="mt-1 text-xs text-purple-700/80">{grades.length} notes enregistrées</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-emerald-50/90 backdrop-blur-xs border border-emerald-300/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-emerald-600 to-teal-600" />
          <div className="p-5">
            <p className="text-xs text-emerald-800 font-semibold">Équipe & Familles</p>
            <p className="mt-2 text-2xl font-extrabold text-emerald-950 font-mono-nums">
              {teachersCount + parentsCount}
            </p>
            <p className="mt-1 text-xs text-emerald-700/80">
              {teachersCount} Prof(s) · {parentsCount} Parent(s)
            </p>
          </div>
        </div>
      </div>

      {/* Main Modules */}
      <div>
        <h2 className="text-sm font-bold text-violet-950 mb-3">Modules de gestion</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {primaryActions.map((item, idx) => (
            <ExpressiveModuleCard
              key={item.id}
              index={idx}
              title={item.title}
              subtitle={item.subtitle}
              icon={item.icon}
              accentClass={item.accent}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </div>
      </div>

      {/* AI Assistant Strip */}
      <div className="bg-gradient-to-r from-violet-900 via-indigo-900 to-violet-800 text-white border border-violet-700 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-white/15 text-white flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              Yasmine · Assistante Pédagogique & Numérisation
            </h3>
            <p className="text-xs text-violet-100/85">
              Importez une photo de liste manuscrite ou demandez à Yasmine de rédiger vos appréciations.
            </p>
          </div>
        </div>
        <button
          onClick={() => onNavigate('assistant')}
          className="px-4 py-2 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
        >
          Parler à Yasmine
        </button>
      </div>
    </div>
  );
}

function TeacherDashboard({
  school,
  isPreview = false,
  activeMembership,
  memberships,
  classrooms,
  students,
  grades,
  messages,
  notifications,
  onNavigate,
  onOpenClass,
}: {
  school: SchoolProfile;
  isPreview?: boolean;
  activeMembership: Membership | null;
  memberships: Membership[];
  classrooms: Classroom[];
  students: Student[];
  grades: GradeRecord[];
  messages: MessageItem[];
  notifications: NotificationItem[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenClass: (classe: string) => void;
}) {
  const teacherRecord =
    activeMembership ?? (isPreview ? memberships.find((m) => m.role === 'teacher') ?? null : null);
  const assignedNames = teacherRecord?.assignedClasses ?? [];

  const assignedClassrooms = useMemo(() => {
    if (assignedNames.length > 0) {
      return classrooms.filter((c) => assignedNames.includes(c.name));
    }
    return isPreview ? classrooms.slice(0, 4) : [];
  }, [classrooms, assignedNames, isPreview]);

  const effectiveClassNames = useMemo(() => {
    if (assignedNames.length > 0) return assignedNames;
    return assignedClassrooms.map((c) => c.name);
  }, [assignedNames, assignedClassrooms]);

  const myStudents = useMemo(
    () =>
      students.filter(
        (s) => s.status === 'actif' && effectiveClassNames.includes(s.classe)
      ),
    [students, effectiveClassNames]
  );

  const unreadMessages = messages.filter((m) => !m.read).length;

  return (
    <div className="space-y-7">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-violet-800 to-purple-900 text-white p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-violet-200 mb-1">
            Espace Enseignant · {school.schoolName} · {teacherRecord?.assignedSubject || 'Corps professoral'}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Bonjour, {teacherRecord?.memberName || 'Professeur'}
          </h1>
          <p className="text-sm text-violet-100/90 mt-1">
            Retrouvez uniquement les classes et les élèves dont vous avez la charge cette année ({school.academicYear}).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('messages')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-4 h-4 text-violet-700" />
            Messagerie Parents ({unreadMessages} non lu{unreadMessages > 1 ? 's' : ''})
          </button>
        </div>
      </div>

      {/* Teacher KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-white/95 to-indigo-100/80 backdrop-blur-xs border border-indigo-300/80 rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-indigo-600 to-violet-700" />
          <div className="p-5">
            <p className="text-xs text-indigo-800 font-semibold">Mes classes assignées</p>
            <p className="mt-2 text-2xl font-extrabold text-indigo-950 font-mono-nums">
              {effectiveClassNames.length}
            </p>
            <p className="mt-1 text-xs text-indigo-700/80 truncate">{effectiveClassNames.join(', ') || 'Toutes'}</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-violet-100/80 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-violet-700 to-purple-600" />
          <div className="p-5">
            <p className="text-xs text-violet-800 font-semibold">Élèves sous ma charge</p>
            <p className="mt-2 text-2xl font-extrabold text-violet-950 font-mono-nums">{myStudents.length}</p>
            <p className="mt-1 text-xs text-violet-700/80">Suivi des notes & présences</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-emerald-50/90 backdrop-blur-xs border border-emerald-300/80 rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-emerald-600 to-teal-600" />
          <div className="p-5">
            <p className="text-xs text-emerald-800 font-semibold">Relevés évalués</p>
            <p className="mt-2 text-2xl font-extrabold text-emerald-950 font-mono-nums">
              {grades.filter((g) => effectiveClassNames.includes(g.classe)).length}
            </p>
            <p className="mt-1 text-xs text-emerald-700/80">Saisies enregistrées</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-amber-50/90 backdrop-blur-xs border border-amber-300/80 rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-600" />
          <div className="p-5">
            <p className="text-xs text-amber-800 font-semibold">Annonces & Alertes</p>
            <p className="mt-2 text-2xl font-extrabold text-amber-950 font-mono-nums">{notifications.length}</p>
            <p className="mt-1 text-xs text-amber-700/80">Direction & absences</p>
          </div>
        </div>
      </div>

      {/* Assigned Classes Cards */}
      <div>
        <h2 className="text-sm font-bold text-violet-950 mb-3">Mes classes et cahiers de notes</h2>
        {effectiveClassNames.length === 0 ? (
          <div className="bg-violet-50/95 border border-violet-200 rounded-2xl p-8 text-center text-sm text-violet-700">
            Aucune classe ne vous est encore assignée. Demandez à l’administrateur de configurer votre affectation.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveClassNames.map((clsName) => {
              const clsObj = classrooms.find((c) => c.name === clsName);
              const theme = getClassroomTheme(clsName, clsObj);
              const clsStudents = myStudents.filter((s) => s.classe === clsName);
              const clsGrades = grades
                .filter((g) => g.classe === clsName)
                .map((g) => computeMoyMatiere(g))
                .filter((v): v is number => v !== null);
              const avg =
                clsGrades.length > 0
                  ? (clsGrades.reduce((a, b) => a + b, 0) / clsGrades.length).toFixed(2)
                  : null;

              return (
                <button
                  key={clsName}
                  type="button"
                  onClick={() => onOpenClass(clsName)}
                  className={`group text-left backdrop-blur-xs border rounded-2xl overflow-hidden transition-all shadow-xs ${theme.surfaceTintClass}`}
                >
                  <div className={`h-1.5 w-full bg-gradient-to-r ${theme.gradientClass}`} />
                  <div className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          style={{ backgroundColor: theme.accentColor }}
                          className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-xs font-extrabold shrink-0"
                        >
                          {clsName.slice(0, 3)}
                        </span>
                        <h3 className="text-base font-extrabold text-zinc-900 group-hover:text-violet-800">
                          {clsName}
                        </h3>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-violet-700" />
                    </div>
                    <p className="text-xs text-zinc-600 mt-2 truncate">{theme.series || theme.badgeLabel}</p>
                    <div className="mt-4 pt-3 border-t border-black/10 flex items-center justify-between text-xs font-mono-nums">
                      <span className="text-zinc-800 font-semibold">{clsStudents.length} élève(s)</span>
                      <span style={{ color: theme.accentColor }} className="font-bold">
                        {avg ? `Moy ${avg}/20` : 'Saisir notes →'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Assigned Students Quick Roster */}
      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Élèves dont vous avez la charge ({myStudents.length})</h2>
            <p className="text-xs text-zinc-500">Cliquez sur une classe pour saisir les notes ou contacter un parent.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('bulletins')}
            className="text-xs font-semibold text-violet-700 hover:underline"
          >
            Voir les bulletins →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase">
                <th className="py-2.5 px-4">Élève</th>
                <th className="py-2.5 px-4">Classe</th>
                <th className="py-2.5 px-4">Parent / Contact</th>
                <th className="py-2.5 px-4 text-right">Accès</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {myStudents.slice(0, 10).map((s) => (
                <tr key={s.id} className="hover:bg-violet-50/30">
                  <td className="py-2.5 px-4 font-semibold text-zinc-900">
                    {s.nom} {s.prenoms}
                  </td>
                  <td className="py-2.5 px-4 text-violet-700 font-semibold">{s.classe}</td>
                  <td className="py-2.5 px-4 text-zinc-500">
                    {s.guardianName || '—'} {s.parentEmail ? `(${s.parentEmail})` : ''}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenClass(s.classe)}
                      className="text-xs font-semibold text-violet-700 hover:underline"
                    >
                      Notes & Absences
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ParentDashboard({
  school,
  isPreview = false,
  activeMembership,
  memberships,
  classrooms,
  students,
  subjects,
  grades,
  remarks,
  messages,
  notifications,
  onNavigate,
  onOpenBulletin,
}: {
  school: SchoolProfile;
  isPreview?: boolean;
  activeMembership: Membership | null;
  memberships: Membership[];
  classrooms: Classroom[];
  students: Student[];
  subjects: Subject[];
  grades: GradeRecord[];
  remarks: BulletinRemark[];
  messages: MessageItem[];
  notifications: NotificationItem[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenBulletin: (studentId: string, trimester: 1 | 2 | 3) => void;
}) {
  const parentRecord =
    activeMembership ?? (isPreview ? memberships.find((m) => m.role === 'parent') ?? null : null);

  const myChildren = useMemo(() => {
    const active = students.filter((s) => s.status === 'actif');
    if (activeMembership) {
      const ids = activeMembership.childStudentIds ?? [];
      const matched = active.filter(
        (s) => ids.includes(s.id) || s.parentEmail === activeMembership.memberEmail
      );
      if (matched.length > 0) return matched;
    }
    if (parentRecord) {
      const ids = parentRecord.childStudentIds ?? [];
      const matched = active.filter(
        (s) => ids.includes(s.id) || s.parentEmail === parentRecord.memberEmail
      );
      if (matched.length > 0) return matched;
    }
    return isPreview ? active.slice(0, 2) : [];
  }, [students, activeMembership, parentRecord, isPreview]);

  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const unreadMsgs = messages.filter((m) => !m.read).length;

  return (
    <div className="space-y-7">
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-purple-800 to-indigo-900 text-white p-6 shadow-md border border-violet-700/70 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-violet-200 mb-1">
            Espace Parent d’élève · {school.schoolName} · {school.academicYear}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Suivi scolaire de mes enfants
          </h1>
          <p className="text-sm text-violet-100/90 mt-1">
            Consultez en temps réel les notes, bulletins, absences et échanges avec les enseignants.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 border border-white/25 hover:bg-white/25 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Bell className="w-4 h-4 text-white" />
            Notifications ({unreadNotifs} nouvelle{unreadNotifs > 1 ? 's' : ''})
          </button>
          <button
            onClick={() => onNavigate('messages')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-4 h-4 text-violet-700" />
            Écrire à un enseignant ({unreadMsgs})
          </button>
        </div>
      </div>

      {/* Children Cards */}
      {myChildren.length === 0 ? (
        <div className="bg-violet-50/95 border border-violet-200 rounded-2xl p-10 text-center text-sm text-violet-700">
          Aucun élève n’est encore associé à votre compte parent. Contactez le secrétariat de {school.schoolName}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {myChildren.map((child) => {
            const childGrades = grades.filter((g) => g.studentId === child.id && g.trimester === 1);
            const clsObj = classrooms.find((c) => c.name === child.classe);
            const effectiveSubjects = getEffectiveSubjectsForClass(
              child.classe,
              subjects,
              clsObj,
              childGrades
            );
            let weighted = 0;
            let totalCoef = 0;
            for (const sub of effectiveSubjects) {
              const g = childGrades.find((item) => item.subjectId === sub.id);
              const moy = g ? computeMoyMatiere(g) : null;
              if (moy !== null) {
                weighted += moy * sub.coef;
                totalCoef += sub.coef;
              }
            }
            const avg = totalCoef > 0 ? Number((weighted / totalCoef).toFixed(2)) : null;
            const mention = getMentionFromAverage(avg);
            const remark = remarks.find((r) => r.studentId === child.id && r.trimester === 1);

            return (
              <div
                key={child.id}
                className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-violet-700 text-white flex items-center justify-center font-bold text-lg">
                      <GraduationCap className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-base font-extrabold text-zinc-900">
                        {child.nom} {child.prenoms}
                      </h2>
                      <p className="text-xs text-zinc-500">
                        Classe : <strong className="text-violet-700">{child.classe}</strong> ({child.cycle}) · Matricule{' '}
                        <span className="font-mono-nums">{child.matricule}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-zinc-500">Moy. Trimestre 1</p>
                    <p className="text-xl font-extrabold text-violet-700 font-mono-nums">
                      {avg !== null ? `${avg.toFixed(2)}/20` : '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 bg-[#FAF9FE] border border-violet-100 rounded-xl p-3 text-xs">
                  <div>
                    <span className="text-zinc-500 block">Mention</span>
                    <strong className="text-zinc-900">{mention.label.split(' · ')[0]}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Absences (T1)</span>
                    <strong className="font-mono-nums text-zinc-900">{remark?.absences ?? 0} h</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Matières notées</span>
                    <strong className="font-mono-nums text-zinc-900">{childGrades.length}</strong>
                  </div>
                </div>

                {/* Recent subject scores */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-700">Dernières notes publiées</p>
                  <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl text-xs">
                    {childGrades.slice(0, 4).map((g) => {
                      const moy = computeMoyMatiere(g);
                      return (
                        <div key={g.id} className="px-3 py-2 flex items-center justify-between">
                          <span className="font-medium text-zinc-800">{g.subjectName}</span>
                          <span
                            className={`font-mono-nums font-bold ${
                              moy !== null && moy >= 10 ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {moy !== null ? `${moy.toFixed(2)} / 20` : 'En attente'}
                          </span>
                        </div>
                      );
                    })}
                    {childGrades.length === 0 && (
                      <div className="px-3 py-3 text-zinc-400 text-center">Aucune note saisie pour le moment.</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenBulletin(child.id, 1)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Consulter & Imprimer le Bulletin
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('messages')}
                    className="text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Contacter les profs →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Latest Parent Notifications */}
      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">Dernières notifications (Notes, Absences, Annonces)</h2>
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="text-xs font-semibold text-violet-700 hover:underline"
          >
            Tout voir →
          </button>
        </div>

        <div className="divide-y divide-zinc-100">
          {notifications.slice(0, 4).map((n) => (
            <div key={n.id} className="py-3 flex items-start gap-3 text-xs">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  n.type === 'grade'
                    ? 'bg-emerald-50 text-emerald-700'
                    : n.type === 'absence'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-violet-50 text-violet-700'
                }`}
              >
                {n.type === 'grade' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : n.type === 'absence' ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <Megaphone className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-zinc-900">{n.title}</p>
                <p className="text-zinc-600 mt-0.5">{n.message}</p>
              </div>
            </div>
          ))}
          {notifications.length === 0 && (
            <p className="py-4 text-xs text-zinc-400 text-center">Aucune notification récente.</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface RoleManagementViewProps {
  uid: string;
  schoolId: string;
  classrooms: Classroom[];
  students: Student[];
  memberships: Membership[];
}

export function RoleManagementView({
  uid,
  schoolId,
  classrooms,
  students,
  memberships,
}: RoleManagementViewProps) {
  const [role, setRole] = useState<'teacher' | 'parent'>('teacher');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [assignedSubject, setAssignedSubject] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const toggleClass = (clsName: string) => {
    setSelectedClasses((prev) =>
      prev.includes(clsName) ? prev.filter((c) => c !== clsName) : [...prev, clsName]
    );
  };

  const toggleStudent = (sid: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid]
    );
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberEmail.trim() || !memberName.trim()) return;
    const cleanTargetEmail = memberEmail.trim().toLowerCase();
    if (role === 'teacher') {
      const matchedStudent = students.find(
        (s) => (s.studentEmail ?? '').trim().toLowerCase() === cleanTargetEmail
      );
      if (matchedStudent) {
        setFeedback({
          type: 'error',
          text: `Blocage sécurité : l'email ${cleanTargetEmail} est celui de l'élève ${matchedStudent.nom} ${matchedStudent.prenoms} (${matchedStudent.classe}). Un élève de l'école ne peut jamais être connecté en tant qu'enseignant ici.`,
        });
        return;
      }
    }
    setSaving(true);
    setFeedback(null);
    try {
      await createMembership(uid, schoolId, {
        memberEmail,
        memberName,
        role,
        assignedClasses: role === 'teacher' ? selectedClasses : [],
        assignedSubject: role === 'teacher' ? assignedSubject : '',
        childStudentIds: role === 'parent' ? selectedStudentIds : [],
      });
      setFeedback({
        type: 'success',
        text: `${memberName} (${role === 'teacher' ? 'Enseignant' : 'Parent'}) ajouté(e) avec succès. À sa connexion Google avec ${memberEmail}, son tableau de bord personnalisé s'ouvrira automatiquement.`,
      });
      setMemberEmail('');
      setMemberName('');
      setAssignedSubject('');
      setSelectedClasses([]);
      setSelectedStudentIds([]);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : "Erreur lors de l'ajout de l'accès.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeMember = async (membershipId: string) => {
    setFeedback(null);
    try {
      await deleteMembershipById(uid, schoolId, membershipId);
      setFeedback({ type: 'success', text: 'Accès révoqué avec succès.' });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la révocation.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 shadow-md border border-violet-700/70">
        <h1 className="text-xl font-extrabold text-white">Gestion des Enseignants & Parents (RBAC)</h1>
        <p className="text-xs text-violet-100/90 mt-1">
          Assignez les classes aux enseignants et liez les parents à leurs enfants pour activer leurs tableaux de bord personnalisés.
        </p>
      </div>

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

      <form
        onSubmit={handleAddMember}
        className="bg-violet-50/90 backdrop-blur-xs border border-violet-300/80 rounded-2xl p-6 space-y-5 shadow-xs"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRole('teacher')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              role === 'teacher'
                ? 'bg-violet-700 text-white border-violet-700'
                : 'bg-white text-zinc-700 border-zinc-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 inline mr-1.5" />
            Ajouter un Enseignant
          </button>
          <button
            type="button"
            onClick={() => setRole('parent')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              role === 'parent'
                ? 'bg-violet-700 text-white border-violet-700'
                : 'bg-white text-zinc-700 border-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5" />
            Associer un Parent
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Nom complet *</label>
            <input
              type="text"
              required
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder={role === 'teacher' ? 'Ex : Prof. Houngbédji' : 'Ex : M. Adjaho Komlan'}
              className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Email Google *</label>
            <input
              type="email"
              required
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="compte@gmail.com"
              className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
            />
          </div>
          {role === 'teacher' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Matière enseignée</label>
              <input
                type="text"
                value={assignedSubject}
                onChange={(e) => setAssignedSubject(e.target.value)}
                placeholder="Ex : Maths & Physique"
                className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 text-xs outline-none focus:border-violet-600"
              />
            </div>
          )}
        </div>

        {role === 'teacher' ? (
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">
              Classes / divisions confiées ({selectedClasses.length})
            </label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
              {classrooms.map((c) => {
                const active = selectedClasses.includes(c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClass(c.name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-violet-700 text-white border-violet-700'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">
              Enfant(s) rattaché(s) ({selectedStudentIds.length})
            </label>
            <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
              {students.map((s) => {
                const active = selectedStudentIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleStudent(s.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-300'
                    }`}
                  >
                    {s.nom} {s.prenoms} ({s.classe})
                  </button>
                );
              })}
              {students.length === 0 && (
                <span className="text-xs text-zinc-400">Inscrivez d’abord des élèves pour les lier à un parent.</span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Enregistrement...' : 'Enregistrer l’accès'}
          </button>
        </div>
      </form>

      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">Comptes autorisés ({memberships.length})</h2>
        </div>
        {memberships.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">Aucun enseignant ni parent configuré pour le moment.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {memberships.map((m) => (
              <div key={m.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-900">{m.memberName}</span>
                    <span className="text-zinc-500">({m.memberEmail})</span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        m.role === 'teacher'
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {m.role === 'teacher' ? 'Enseignant' : 'Parent'}
                    </span>
                  </div>
                  <p className="text-zinc-500 mt-1">
                    {m.role === 'teacher'
                      ? `${m.assignedSubject || 'Matière non précisée'} · Classes : ${(m.assignedClasses ?? []).join(', ') || 'Aucune'}`
                      : `Enfant(s) lié(s) : ${(m.childStudentIds ?? []).length}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeMember(m.id)}
                  className="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50"
                  title="Retirer l’accès"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
