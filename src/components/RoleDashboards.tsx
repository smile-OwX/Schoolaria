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
  Check,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  ArrowUpRight,
  Archive,
  Briefcase,
  UserCheck,
  Pencil,
} from 'lucide-react';
import {
  BulletinRemark,
  Classroom,
  GradeRecord,
  Membership,
  MembershipRole,
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  Subject,
  UserRole,
  compareClassNames,
  computeMoyMatiere,
  getClassroomTheme,
  getEffectiveSubjectsForClass,
  getMentionFromAverage,
  getPeriodLabel,
  getPeriodShortLabel,
  getPeriodsForCycle,
  isTeacherTitulaire,
  sortClassrooms,
} from '../types/school.ts';
import {
  createMembership,
  deleteMembershipById,
  dismissOrDeleteNotification,
  markNotificationRead,
  normalizeEmail,
  updateClassroomTitulaire,
} from '../lib/schoolService.ts';
import { formatAuthIdentifierForDisplay } from '../lib/phoneAuth.ts';
import { filterChildrenForParent } from '../lib/parentHelpers.ts';
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
  | 'archives'
  | 'audit'
  | 'assistant'
  | 'settings';

interface RoleDashboardProps {
  effectiveRole: UserRole;
  isPreview?: boolean;
  actorEmail?: string;
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
  actorEmail,
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
        actorEmail={actorEmail}
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
        actorEmail={actorEmail}
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
      effectiveRole={effectiveRole}
      actorEmail={actorEmail}
      activeMembership={activeMembership}
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
  effectiveRole,
  actorEmail,
  activeMembership,
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
  effectiveRole: UserRole;
  actorEmail?: string;
  activeMembership: Membership | null;
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
  const titulaireAssignedCount = activeClassrooms.filter((c) => Boolean(c.headTeacher?.trim())).length;
  const computedAverages = grades
    .map((g) => computeMoyMatiere(g))
    .filter((v): v is number => v !== null);
  const overallAvg =
    computedAverages.length > 0
      ? (computedAverages.reduce((a, b) => a + b, 0) / computedAverages.length).toFixed(2)
      : '—';

  const teachersCount = memberships.filter((m) => m.role === 'teacher').length;
  const parentsCount = memberships.filter((m) => m.role === 'parent').length;
  const cleanActor = (actorEmail ?? '').trim().toLowerCase();
  const unreadMessages = messages.filter(
    (m) => !m.read && (!cleanActor || m.senderEmail.trim().toLowerCase() !== cleanActor)
  ).length;

  const isDirector = effectiveRole === 'admin';
  const isCenseur = effectiveRole === 'censeur';
  const isSecretaire = effectiveRole === 'secretaire';

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

  const primaryActions = useMemo(() => {
    if (isSecretaire) {
      return [
        {
          id: 'inscription' as ActiveTab,
          title: 'Inscriptions & Dossiers',
          subtitle: 'Inscrire, modifier ou supprimer un élève et gérer les dossiers scolaires',
          icon: UserPlus,
          accent: 'theme-btn-primary',
        },
        {
          id: 'makelist' as ActiveTab,
          title: 'Classes & Listes',
          subtitle: 'Créer ou supprimer des classes et consulter les effectifs en lecture seule',
          icon: ClipboardList,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'bulletins' as ActiveTab,
          title: 'Édition & Impression PDF',
          subtitle: 'Consulter et imprimer les bulletins (lots PDF) sans modification de notes',
          icon: FileSpreadsheet,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'archives' as ActiveTab,
          title: 'Archives annuelles',
          subtitle: 'Consulter les listes et résultats archivés des années précédentes',
          icon: Archive,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'messages' as ActiveTab,
          title: 'Messagerie équipe & direction',
          subtitle: `${messages.length} échange(s) · ${unreadMessages} non lu(s) avec Directeur, Censeur & Profs`,
          icon: MessageSquare,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'notifications' as ActiveTab,
          title: 'Notifications équipe',
          subtitle: `Notifier Directeur, Censeur et Professeurs uniquement (${notifications.length})`,
          icon: Megaphone,
          accent: 'bg-emerald-100 text-emerald-800',
        },
      ];
    }

    if (isCenseur) {
      return [
        {
          id: 'makelist' as ActiveTab,
          title: 'Classes & Notes (Make List)',
          subtitle: 'Créer ou supprimer des classes (coefficients fixes) et saisir les notes',
          icon: ClipboardList,
          accent: 'theme-btn-primary',
        },
        {
          id: 'bulletins' as ActiveTab,
          title: 'Bulletins & Suivi',
          subtitle: 'Saisir les appréciations et générer les bulletins PDF/Word',
          icon: FileSpreadsheet,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'stats' as ActiveTab,
          title: 'Statistiques globales',
          subtitle: 'Effectifs par division, parité, réussite et majors de classe',
          icon: BarChart3,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'roles' as ActiveTab,
          title: 'Secrétaire, Profs & Parents',
          subtitle: `${teachersCount} enseignant(s) · ${parentsCount} parent(s) · Secrétariat`,
          icon: Shield,
          accent: 'bg-emerald-100 text-emerald-800',
        },
        {
          id: 'messages' as ActiveTab,
          title: 'Messagerie sécurisée',
          subtitle: `${messages.length} échange(s) · ${unreadMessages} non lu(s) avec tout l’établissement`,
          icon: MessageSquare,
          accent: 'theme-pill-soft border',
        },
        {
          id: 'notifications' as ActiveTab,
          title: 'Annonces & Alertes',
          subtitle: `Diffuser à tout l’établissement, parents et profs (${notifications.length})`,
          icon: Megaphone,
          accent: 'bg-amber-100 text-amber-800',
        },
      ];
    }

    return [
      {
        id: 'makelist' as ActiveTab,
        title: 'Classes & Divisions',
        subtitle: `${activeClassCount} classe(s) · Ajouter ou supprimer des classes (coefficients fixes)`,
        icon: ClipboardList,
        accent: 'theme-btn-primary',
      },
      {
        id: 'roles' as ActiveTab,
        title: 'Direction, Profs & Parents (RBAC)',
        subtitle: `Nommer Censeur, Secrétaire · ${teachersCount} Prof(s) · ${parentsCount} Parent(s)`,
        icon: Shield,
        accent: 'theme-pill-soft border',
      },
      {
        id: 'stats' as ActiveTab,
        title: 'Statistiques globales',
        subtitle: 'Effectifs par division, parité, réussite et majors de classe',
        icon: BarChart3,
        accent: 'theme-pill-soft border',
      },
      {
        id: 'archives' as ActiveTab,
        title: 'Archives annuelles',
        subtitle: 'Historique des clôtures et promotions annuelles',
        icon: Archive,
        accent: 'theme-pill-soft border',
      },
      {
        id: 'audit' as ActiveTab,
        title: 'Journaux & Sécurité',
        subtitle: 'Traçabilité des actions, rôles et verrouillage élèves',
        icon: Shield,
        accent: 'theme-pill-soft border',
      },
      {
        id: 'messages' as ActiveTab,
        title: 'Messagerie sécurisée',
        subtitle: `${messages.length} échange(s) · ${unreadMessages} non lu(s) avec tout l’établissement`,
        icon: MessageSquare,
        accent: 'theme-pill-soft border',
      },
      {
        id: 'notifications' as ActiveTab,
        title: 'Annonces officielles',
        subtitle: `Notifier tout l’établissement ou une classe (${notifications.length})`,
        icon: Megaphone,
        accent: 'bg-emerald-100 text-emerald-800',
      },
    ];
  }, [isSecretaire, isCenseur, activeClassCount, messages.length, unreadMessages, notifications.length, teachersCount, parentsCount]);

  const roleHeaderLabel = isDirector
    ? `Espace Directeur (Admin Suprême) · ${school.schoolName} · ${school.academicYear}`
    : isCenseur
    ? `Espace Censeur (Pédagogie & Notes) · ${school.schoolName} · ${school.academicYear}`
    : `Espace Secrétaire (Inscriptions & Listes) · ${school.schoolName} · ${school.academicYear}`;

  const roleGreeting = isDirector
    ? `Bienvenue, ${school.adminName}. Pilotez la gouvernance, les nominations, le thème de l’école, les archives et la communication.`
    : isCenseur
    ? `Bienvenue, ${activeMembership?.memberName || 'Censeur'}. Supervisez les notes, les matières, les bulletins et le suivi pédagogique.`
    : `Bienvenue, ${activeMembership?.memberName || 'Secrétaire'}. Gérez les inscriptions, les listes de classes, la messagerie interne et l’édition PDF.`;

  return (
    <div className="space-y-7">
      {/* Uniform-Themed Hero Banner */}
      <div className="rounded-2xl theme-surface-header p-6 shadow-md border flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold theme-header-subtext mb-1">
            {roleHeaderLabel}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-balance">
            {isSecretaire ? 'Secrétariat académique & listes' : isCenseur ? 'Direction des études & pédagogie' : 'Tableau de pilotage global'}
          </h1>
          <p className="text-sm theme-header-subtext mt-1">
            {roleGreeting}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDirector && activeStudents.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border theme-header-chip text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-4 h-4" />
              {seeding ? 'Chargement des données...' : 'Charger des données de démonstration'}
            </button>
          )}
          {(isDirector || isSecretaire) && (
            <button
              onClick={() => onNavigate('archives')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border theme-header-chip text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Archive className="w-4 h-4" />
              Archives annuelles
            </button>
          )}
          {isDirector && (
            <button
              onClick={() => onNavigate('audit')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border theme-header-chip text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Shield className="w-4 h-4" />
              Journaux & Sécurité
            </button>
          )}
          <button
            onClick={() => onNavigate('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Megaphone className="w-4 h-4" />
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
        <div className="bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 theme-surface-header" />
          <div className="p-5">
            <p className="text-xs theme-text-accent font-semibold">Élèves inscrits</p>
            <p className="mt-2 text-2xl font-extrabold theme-text-ink font-mono-nums">{activeStudents.length}</p>
            <p className="mt-1 text-xs text-zinc-600">
              {activeStudents.filter((s) => s.sexe === 'M').length} G · {activeStudents.filter((s) => s.sexe === 'F').length} F
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-sky-50/75 backdrop-blur-xs border border-sky-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-sky-600 to-blue-600" />
          <div className="p-5">
            <p className="text-xs text-sky-800 font-semibold">Classes & divisions</p>
            <p className="mt-2 text-2xl font-extrabold text-sky-950 font-mono-nums">{activeClassCount}</p>
            <p className="mt-1 text-xs text-sky-700/80">
              {titulaireAssignedCount}/{activeClassCount} avec titulaire
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-amber-50/70 backdrop-blur-xs border border-amber-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-amber-600 to-orange-500" />
          <div className="p-5">
            <p className="text-xs text-amber-800 font-semibold">Moyenne générale école</p>
            <p className="mt-2 text-2xl font-extrabold text-amber-950 font-mono-nums">
              {overallAvg}
              {overallAvg !== '—' && <span className="text-sm font-normal text-amber-600"> /20</span>}
            </p>
            <p className="mt-1 text-xs text-amber-700/80">{grades.length} notes enregistrées</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-white/95 to-emerald-50/90 backdrop-blur-xs border border-emerald-200/80 rounded-2xl overflow-hidden shadow-xs">
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
        <h2 className="text-sm font-bold theme-text-ink mb-3">Modules de gestion</h2>
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

      {/* AI Assistant Strip (Directeur, Censeur & Secrétaire — bloqué pour Parents & Professeurs) */}
      {(isDirector || isCenseur || isSecretaire) && (
        <div className="theme-surface-header border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl theme-header-chip border flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">
                Yasmine · Assistante Pédagogique & Numérisation
              </h3>
              <p className="text-xs theme-header-subtext">
                Générez vos appréciations de bulletins ou analysez les relevés pédagogiques avec Yasmine.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('assistant')}
            className="px-4 py-2 rounded-xl theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            Parler à Yasmine
          </button>
        </div>
      )}
    </div>
  );
}

function TeacherDashboard({
  school,
  isPreview = false,
  actorEmail,
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
  actorEmail?: string;
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

  const titulaireClassNames = useMemo(
    () => classrooms.filter((c) => isTeacherTitulaire(c, teacherRecord)).map((c) => c.name),
    [classrooms, teacherRecord]
  );

  const effectiveClassNames = useMemo(() => {
    const merged = Array.from(new Set([...assignedNames, ...titulaireClassNames]));
    if (merged.length > 0) return merged;
    if (isPreview) return classrooms.slice(0, 4).map((c) => c.name);
    return [];
  }, [assignedNames, titulaireClassNames, classrooms, isPreview]);

  const myStudents = useMemo(
    () =>
      students.filter(
        (s) => s.status === 'actif' && effectiveClassNames.includes(s.classe)
      ),
    [students, effectiveClassNames]
  );

  const cleanActor = (actorEmail ?? '').trim().toLowerCase();
  const unreadMessages = messages.filter(
    (m) => !m.read && (!cleanActor || m.senderEmail.trim().toLowerCase() !== cleanActor)
  ).length;

  return (
    <div className="space-y-7">
      <div className="rounded-2xl theme-surface-header p-6 shadow-md border flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold theme-header-subtext mb-1">
            Espace Enseignant · {school.schoolName} · {teacherRecord?.assignedSubject || 'Corps professoral'}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Bonjour, {teacherRecord?.memberName || 'Professeur'}
          </h1>
          <p className="text-sm theme-header-subtext mt-1">
            Retrouvez uniquement les classes et les élèves dont vous avez la charge cette année ({school.academicYear}).
          </p>
          {titulaireClassNames.length > 0 && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full theme-header-chip border text-xs font-bold">
              <UserCheck className="w-3.5 h-3.5" />
              Titulaire de : {titulaireClassNames.join(', ')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border theme-header-chip text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Bell className="w-4 h-4" />
            Notifier Censeur / Directeur
          </button>
          <button
            type="button"
            onClick={() => onNavigate('messages')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-4 h-4" />
            Contacter Censeur / Directeur ({unreadMessages})
          </button>
        </div>
      </div>

      {/* Teacher KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-white/95 to-sky-50/85 backdrop-blur-xs border border-sky-200/80 rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-sky-600 to-blue-700" />
          <div className="p-5">
            <p className="text-xs text-sky-800 font-semibold">Mes classes assignées</p>
            <p className="mt-2 text-2xl font-extrabold text-sky-950 font-mono-nums">
              {effectiveClassNames.length}
            </p>
            <p className="mt-1 text-xs text-sky-700/80 truncate">{effectiveClassNames.join(', ') || 'Toutes'}</p>
          </div>
        </div>

        <div className="bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden">
          <div className="h-1.5 theme-surface-header" />
          <div className="p-5">
            <p className="text-xs theme-text-accent font-semibold">Élèves sous ma charge</p>
            <p className="mt-2 text-2xl font-extrabold theme-text-ink font-mono-nums">{myStudents.length}</p>
            <p className="mt-1 text-xs text-zinc-600">Suivi des notes & présences</p>
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
        <h2 className="text-sm font-bold theme-text-ink mb-3">Mes classes et cahiers de notes</h2>
        {effectiveClassNames.length === 0 ? (
          <div className="theme-pill-soft border rounded-2xl p-8 text-center text-sm">
            Aucune classe ne vous est encore assignée. Demandez au Censeur de configurer votre affectation.
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          style={{ backgroundColor: theme.accentColor }}
                          className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-xs font-extrabold shrink-0"
                        >
                          {clsName.slice(0, 3)}
                        </span>
                        <h3 className="text-base font-extrabold text-zinc-900 group-hover:text-[var(--theme-accent-text)] truncate">
                          {clsName}
                        </h3>
                        {isTeacherTitulaire(clsObj, teacherRecord) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md theme-btn-primary text-[10px] font-bold shrink-0">
                            <UserCheck className="w-3 h-3" />
                            Titulaire
                          </span>
                        )}
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-[var(--theme-accent-text)] shrink-0" />
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
            <p className="text-xs text-zinc-500">Cliquez sur une classe pour saisir les notes ou signaler une absence au Censeur.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('bulletins')}
            className="text-xs font-semibold theme-text-accent hover:underline"
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
                <th className="py-2.5 px-4">Tuteur déclaré</th>
                <th className="py-2.5 px-4 text-right">Accès</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {myStudents.slice(0, 10).map((s) => (
                <tr key={s.id} className="hover:bg-zinc-50/70">
                  <td className="py-2.5 px-4 font-semibold text-zinc-900">
                    {s.nom} {s.prenoms}
                  </td>
                  <td className="py-2.5 px-4 theme-text-accent font-semibold">{s.classe}</td>
                  <td className="py-2.5 px-4 text-zinc-500">
                    {s.guardianName || '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenClass(s.classe)}
                      className="text-xs font-semibold theme-text-accent hover:underline"
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
  actorEmail,
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
  actorEmail?: string;
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
  const [selectedPeriod, setSelectedPeriod] = useState<1 | 2 | 3>(1);

  const myChildren = useMemo(
    () =>
      filterChildrenForParent({
        students,
        activeMembership,
        memberships,
        parentEmail: actorEmail,
        isPreview,
        activeOnly: true,
      }),
    [students, activeMembership, memberships, actorEmail, isPreview]
  );

  const hasCollegeChild = myChildren.some((c) => c.cycle !== 'Lycée');
  const periodOptions: Array<1 | 2 | 3> = hasCollegeChild ? [1, 2, 3] : [1, 2];

  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const cleanActor = (actorEmail ?? '').trim().toLowerCase();
  const unreadMsgs = messages.filter(
    (m) => !m.read && (!cleanActor || m.senderEmail.trim().toLowerCase() !== cleanActor)
  ).length;

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="rounded-2xl theme-surface-header p-5 sm:p-6 shadow-md border flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold theme-header-subtext mb-1">
            Espace Parent d’élève · {school.schoolName} · {school.academicYear}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Suivi scolaire de mes enfants
          </h1>
          <p className="text-sm theme-header-subtext mt-1">
            Consultez en temps réel les notes, bulletins, absences et échangez directement avec le Censeur.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border theme-header-chip text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Bell className="w-4 h-4" />
            Notifier le Censeur ({unreadNotifs})
          </button>
          <button
            type="button"
            onClick={() => onNavigate('messages')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-4 h-4" />
            Écrire au Censeur ({unreadMsgs})
          </button>
        </div>
      </div>

      {myChildren.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white/95 border theme-border-soft rounded-2xl px-4 py-3">
          <span className="text-xs font-bold theme-text-ink">Période affichée :</span>
          <div className="inline-flex p-1 rounded-xl theme-pill-soft border gap-1">
            {periodOptions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelectedPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  selectedPeriod === p
                    ? 'theme-btn-primary shadow-xs'
                    : 'theme-text-ink hover:bg-white/70'
                }`}
              >
                {hasCollegeChild ? `Trimestre ${p}` : `Semestre ${p}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Children Cards */}
      {myChildren.length === 0 ? (
        <div className="theme-pill-soft border rounded-2xl p-8 sm:p-10 text-center text-sm space-y-2">
          <p className="font-bold">Aucun élève n’est encore associé à votre adresse ({formatAuthIdentifierForDisplay(actorEmail) || 'votre compte'}).</p>
          <p className="text-xs opacity-90">
            Demandez au secrétariat de {school.schoolName} d’enregistrer cet identifiant exact comme contact parent sur la fiche de votre enfant.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {myChildren.map((child) => {
            const childPeriod: 1 | 2 | 3 =
              child.cycle === 'Lycée' && selectedPeriod === 3 ? 2 : selectedPeriod;
            const validPeriods = getPeriodsForCycle(child.cycle);
            const childGrades = grades.filter(
              (g) => g.studentId === child.id && g.trimester === childPeriod
            );
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
            const remark = remarks.find(
              (r) => r.studentId === child.id && r.trimester === childPeriod
            );
            const periodShort = getPeriodShortLabel(child.cycle, childPeriod);
            const periodFull = getPeriodLabel(child.cycle, childPeriod);

            return (
              <div
                key={child.id}
                className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-4 sm:p-6 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl theme-btn-primary flex items-center justify-center font-bold text-lg shrink-0">
                      <GraduationCap className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-extrabold text-zinc-900 truncate">
                        {child.nom} {child.prenoms}
                      </h2>
                      <p className="text-xs text-zinc-500">
                        Classe : <strong className="theme-text-accent">{child.classe}</strong> ({child.cycle}) ·{' '}
                        <span className="font-mono-nums">{child.matricule}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] text-zinc-500">Moy. {periodFull}</p>
                    <p className="text-xl font-extrabold theme-text-accent font-mono-nums">
                      {avg !== null ? `${avg.toFixed(2)}/20` : '—'}
                    </p>
                  </div>
                </div>

                {validPeriods.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {validPeriods.map((vp) => (
                      <button
                        key={vp}
                        type="button"
                        onClick={() => setSelectedPeriod(vp)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border ${
                          childPeriod === vp
                            ? 'theme-pill-soft'
                            : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:text-zinc-800'
                        }`}
                      >
                        {getPeriodShortLabel(child.cycle, vp)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-zinc-50/90 border theme-border-soft rounded-xl p-3 text-xs">
                  <div>
                    <span className="text-zinc-500 block">Mention</span>
                    <strong className="text-zinc-900">{mention.label.split(' · ')[0]}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Absences ({periodShort})</span>
                    <strong className="font-mono-nums text-zinc-900">{remark?.absences ?? 0} h</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Matières notées</span>
                    <strong className="font-mono-nums text-zinc-900">{childGrades.length}</strong>
                  </div>
                </div>

                {/* Recent subject scores */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-700">
                    Notes publiées ({periodFull})
                  </p>
                  <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl text-xs">
                    {childGrades.slice(0, 4).map((g) => {
                      const moy = computeMoyMatiere(g);
                      return (
                        <div key={g.id} className="px-3 py-2 flex items-center justify-between gap-2">
                          <span className="font-medium text-zinc-800 truncate">{g.subjectName}</span>
                          <span
                            className={`font-mono-nums font-bold shrink-0 ${
                              moy !== null && moy >= 10 ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {moy !== null ? `${moy.toFixed(2)} / 20` : 'En attente'}
                          </span>
                        </div>
                      );
                    })}
                    {childGrades.length === 0 && (
                      <div className="px-3 py-3 text-zinc-400 text-center">
                        Aucune note saisie pour cette période.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenBulletin(child.id, childPeriod)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl theme-btn-primary text-xs font-semibold transition-colors"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Consulter & Imprimer le Bulletin
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('messages')}
                    className="text-xs font-semibold theme-text-accent hover:underline"
                  >
                    Contacter le Censeur →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Latest Parent Notifications */}
      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-900">Dernières notifications (Notes, Absences, Annonces)</h2>
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="text-xs font-semibold theme-text-accent hover:underline shrink-0"
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
                    : 'theme-pill-soft border'
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
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-zinc-900 break-words">{n.title}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => void markNotificationRead(n.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-semibold"
                      >
                        <Check className="w-3 h-3" />
                        Vu
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void dismissOrDeleteNotification(n, cleanActor, 'parent')}
                      title="Supprimer cette notification"
                      aria-label={`Supprimer la notification ${n.title}`}
                      className="p-1 rounded-md text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-zinc-600 mt-0.5 break-words">{n.message}</p>
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
  canAssignLeadership?: boolean;
  canAssignSecretaire?: boolean;
  classrooms: Classroom[];
  students: Student[];
  memberships: Membership[];
}

export function RoleManagementView({
  uid,
  schoolId,
  canAssignLeadership = false,
  canAssignSecretaire,
  classrooms,
  students,
  memberships,
}: RoleManagementViewProps) {
  const allowSecretaireMgmt = canAssignSecretaire ?? canAssignLeadership;
  const [role, setRole] = useState<MembershipRole>('teacher');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [assignedSubject, setAssignedSubject] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [titulaireClasses, setTitulaireClasses] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [updatingTitulaireId, setUpdatingTitulaireId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sortedClassrooms = useMemo(() => sortClassrooms(classrooms), [classrooms]);
  const teacherMemberships = useMemo(
    () => memberships.filter((m) => m.role === 'teacher').sort((a, b) => a.memberName.localeCompare(b.memberName)),
    [memberships]
  );
  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => compareClassNames(a.classe, b.classe) || a.nom.localeCompare(b.nom)
      ),
    [students]
  );

  const isStaffRole = role === 'censeur' || role === 'secretaire' || role === 'teacher';

  const toggleClass = (clsName: string) => {
    setSelectedClasses((prev) => {
      const next = prev.includes(clsName) ? prev.filter((c) => c !== clsName) : [...prev, clsName];
      if (!next.includes(clsName)) {
        setTitulaireClasses((tPrev) => tPrev.filter((c) => c !== clsName));
      }
      return next;
    });
  };

  const toggleTitulaireClass = (clsName: string) => {
    setTitulaireClasses((prev) => {
      const exists = prev.includes(clsName);
      if (!exists) {
        setSelectedClasses((cPrev) => (cPrev.includes(clsName) ? cPrev : [...cPrev, clsName]));
      }
      return exists ? prev.filter((c) => c !== clsName) : [...prev, clsName];
    });
  };

  const toggleStudent = (sid: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid]
    );
  };

  const handleAssignTitulaireRow = async (cls: Classroom, value: string) => {
    setUpdatingTitulaireId(cls.id);
    setFeedback(null);
    try {
      if (value === '__none__') {
        await updateClassroomTitulaire(uid, schoolId, cls, '', '');
        setFeedback({ type: 'success', text: `Titulaire retiré pour ${cls.name}.` });
      } else {
        const teacher = teacherMemberships.find((t) => t.memberEmail === value);
        if (teacher) {
          await updateClassroomTitulaire(uid, schoolId, cls, teacher.memberName, teacher.memberEmail);
          setFeedback({
            type: 'success',
            text: `${teacher.memberName} désigné(e) Titulaire de la classe ${cls.name}.`,
          });
        }
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la mise à jour du titulaire.',
      });
    } finally {
      setUpdatingTitulaireId(null);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberEmail.trim() || !memberName.trim()) return;
    if (role === 'censeur' && !canAssignLeadership) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur (Admin Suprême) peut nommer un Censeur.',
      });
      return;
    }
    if (role === 'secretaire' && !allowSecretaireMgmt) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur ou le Censeur peut nommer un Secrétaire.',
      });
      return;
    }

    const cleanTargetEmail = normalizeEmail(memberEmail);
    if (isStaffRole) {
      const matchedStudent = students.find(
        (s) => normalizeEmail(s.studentEmail) === cleanTargetEmail
      );
      if (matchedStudent) {
        setFeedback({
          type: 'error',
          text: `Blocage sécurité : l'identifiant ${formatAuthIdentifierForDisplay(cleanTargetEmail)} est celui de l'élève ${matchedStudent.nom} ${matchedStudent.prenoms} (${matchedStudent.classe}). Un élève de l'école ne peut pas accéder en tant que membre du personnel.`,
        });
        return;
      }
    }
    setSaving(true);
    setFeedback(null);
    try {
      const mergedClasses =
        role === 'teacher' ? Array.from(new Set([...selectedClasses, ...titulaireClasses])) : [];
      await createMembership(uid, schoolId, {
        memberEmail: cleanTargetEmail,
        memberName,
        role,
        assignedClasses: mergedClasses,
        assignedSubject: role === 'teacher' ? assignedSubject : '',
        childStudentIds: role === 'parent' ? selectedStudentIds : [],
      });
      if (role === 'teacher' && titulaireClasses.length > 0) {
        for (const clsName of titulaireClasses) {
          const targetCls = sortedClassrooms.find((c) => c.name === clsName);
          if (targetCls) {
            await updateClassroomTitulaire(uid, schoolId, targetCls, memberName, cleanTargetEmail);
          }
        }
      }
      const roleWord =
        role === 'censeur'
          ? 'Censeur'
          : role === 'secretaire'
          ? 'Secrétaire'
          : role === 'teacher'
          ? 'Enseignant'
          : 'Parent';
      setFeedback({
        type: 'success',
        text: `${memberName} (${roleWord}${role === 'teacher' && titulaireClasses.length > 0 ? ` · Titulaire de ${titulaireClasses.join(', ')}` : ''}) ajouté(e) avec succès. À sa connexion (${formatAuthIdentifierForDisplay(cleanTargetEmail)}), son espace personnalisé s'ouvrira automatiquement.`,
      });
      setMemberEmail('');
      setMemberName('');
      setAssignedSubject('');
      setSelectedClasses([]);
      setTitulaireClasses([]);
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

  const handleEditMember = (m: Membership) => {
    if (m.role === 'censeur' && !canAssignLeadership) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur peut modifier un Censeur.',
      });
      return;
    }
    if (m.role === 'secretaire' && !allowSecretaireMgmt) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur ou le Censeur peut modifier un Secrétaire.',
      });
      return;
    }
    setRole(m.role);
    setMemberEmail(formatAuthIdentifierForDisplay(m.memberEmail));
    setMemberName(m.memberName);
    setAssignedSubject(m.assignedSubject ?? '');
    setSelectedClasses(m.assignedClasses ?? []);
    setTitulaireClasses(
      m.role === 'teacher'
        ? sortedClassrooms.filter((c) => isTeacherTitulaire(c, m)).map((c) => c.name)
        : []
    );
    setSelectedStudentIds(m.childStudentIds ?? []);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRevokeMember = async (m: Membership) => {
    if (m.role === 'censeur' && !canAssignLeadership) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur peut révoquer un Censeur.',
      });
      return;
    }
    if (m.role === 'secretaire' && !allowSecretaireMgmt) {
      setFeedback({
        type: 'error',
        text: 'Seul le Directeur ou le Censeur peut révoquer un Secrétaire.',
      });
      return;
    }
    setFeedback(null);
    try {
      await deleteMembershipById(uid, schoolId, m.id);
      setFeedback({ type: 'success', text: 'Accès révoqué avec succès.' });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la révocation.',
      });
    }
  };

  const roleBadge = (r: MembershipRole) => {
    if (r === 'censeur') return { label: 'Censeur · Pédagogie', cls: 'theme-pill-soft border' };
    if (r === 'secretaire') return { label: 'Secrétaire · Listes', cls: 'bg-amber-100 text-amber-800 border border-amber-200' };
    if (r === 'teacher') return { label: 'Enseignant', cls: 'bg-sky-50 text-sky-700 border border-sky-200' };
    return { label: 'Parent', cls: 'bg-emerald-50 text-emerald-700' };
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl theme-surface-header p-6 shadow-md border">
        <h1 className="text-xl font-extrabold">
          {canAssignLeadership
            ? 'Gestion hiérarchique des rôles (Censeur, Secrétaire, Profs & Parents)'
            : allowSecretaireMgmt
            ? 'Gestion de l’équipe (Secrétaire, Enseignants & Parents)'
            : 'Gestion des Enseignants & Parents (RBAC)'}
        </h1>
        <p className="text-xs theme-header-subtext mt-1">
          {canAssignLeadership
            ? 'Nommez un ou plusieurs Censeurs (pédagogie & notes), le Secrétaire (inscriptions & listes), assignez les classes aux professeurs et liez les parents.'
            : allowSecretaireMgmt
            ? 'Nommez et gérez la Secrétaire de l’établissement, assignez les classes aux professeurs et liez les parents à leurs enfants.'
            : 'Assignez les classes aux enseignants et liez les parents à leurs enfants pour activer leurs tableaux de bord personnalisés.'}
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
        className="bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl p-6 space-y-5 shadow-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          {canAssignLeadership && (
            <button
              type="button"
              onClick={() => setRole('censeur')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                role === 'censeur'
                  ? 'theme-btn-primary border-transparent'
                  : 'bg-white text-zinc-700 border-zinc-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 inline mr-1.5" />
              Nommer un Censeur
            </button>
          )}
          {allowSecretaireMgmt && (
            <button
              type="button"
              onClick={() => setRole('secretaire')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                role === 'secretaire'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-zinc-700 border-zinc-200'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 inline mr-1.5" />
              Nommer un Secrétaire
            </button>
          )}
          <button
            type="button"
            onClick={() => setRole('teacher')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              role === 'teacher'
                ? 'theme-btn-primary border-transparent'
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
                ? 'theme-btn-primary border-transparent'
                : 'bg-white text-zinc-700 border-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5" />
            Associer un Parent
          </button>
        </div>

        {(role === 'censeur' || role === 'secretaire') && (
          <div className="p-3 rounded-xl theme-pill-soft border text-xs">
            {role === 'censeur' ? (
              <span>
                <strong>Droits du Censeur :</strong> pédagogie, notes, matières, appréciations de bulletins, statistiques, Yasmine IA, ajout/gestion des Secrétaires, Enseignants et Parents, et communication avec tout l’établissement (sans accès au panel Secrétaire ni suppression de l’école).
              </span>
            ) : (
              <span>
                <strong>Droits du Secrétaire :</strong> inscriptions, dossiers élèves, création/suppression de classes, impression PDF des bulletins et notifications/messages vers Directeur, Censeur et Professeurs (aucun envoi vers les parents, notes en lecture seule).
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">Nom complet *</label>
            <input
              type="text"
              required
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder={
                role === 'censeur'
                  ? 'Ex : M. Kossi (Censeur)'
                  : role === 'secretaire'
                  ? 'Ex : Mme Mensah (Secrétariat)'
                  : role === 'teacher'
                  ? 'Ex : Prof. Houngbédji'
                  : 'Ex : M. Adjaho Komlan'
              }
              className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none theme-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">N° de téléphone ou E-mail de connexion *</label>
            <input
              type="text"
              required
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="90 12 34 56 ou compte@exemple.com"
              className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none theme-input"
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
                className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 bg-white text-xs outline-none theme-input"
              />
            </div>
          )}
        </div>

        {role === 'teacher' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-2">
                Classes / divisions confiées ({selectedClasses.length})
              </label>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
                {sortedClassrooms.map((c) => {
                  const active = selectedClasses.includes(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.name)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        active
                          ? 'theme-btn-primary border-transparent'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Titulaire de classe / Professeur Principal ({titulaireClasses.length})
              </label>
              <p className="text-[11px] text-zinc-500 mb-2">
                Optionnel : désignez cet enseignant comme Titulaire d’une ou plusieurs classes (affiché sur les bulletins).
              </p>
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-3 rounded-xl border theme-border-soft bg-white">
                {sortedClassrooms.map((c) => {
                  const isTit = titulaireClasses.includes(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleTitulaireClass(c.name)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        isTit
                          ? 'theme-btn-primary border-transparent'
                          : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:border-zinc-400'
                      }`}
                    >
                      <UserCheck className="w-3 h-3" />
                      {c.name}
                      {!isTit && c.headTeacher ? (
                        <span className="text-[10px] text-zinc-400 ml-1">({c.headTeacher})</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {role === 'parent' && (
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">
              Enfant(s) rattaché(s) ({selectedStudentIds.length})
            </label>
            <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-3 rounded-xl border border-zinc-200 bg-zinc-50/50">
              {sortedStudents.map((s) => {
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
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl theme-btn-primary text-xs font-semibold disabled:opacity-60"
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
          <div className="p-8 text-center text-xs text-zinc-500">Aucun compte rattaché pour le moment.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {memberships.map((m) => {
              const badge = roleBadge(m.role);
              const canRevokeThis =
                canAssignLeadership ||
                (m.role === 'secretaire' && allowSecretaireMgmt) ||
                (m.role !== 'censeur' && m.role !== 'secretaire');
              const memberTitulaireClasses =
                m.role === 'teacher'
                  ? sortedClassrooms.filter((c) => isTeacherTitulaire(c, m)).map((c) => c.name)
                  : [];
              return (
                <div key={m.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-zinc-900">{m.memberName}</span>
                      <span className="text-zinc-500">({formatAuthIdentifierForDisplay(m.memberEmail)})</span>
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {memberTitulaireClasses.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold theme-pill-soft border">
                          <UserCheck className="w-3 h-3" />
                          Titulaire : {memberTitulaireClasses.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-500 mt-1">
                      {m.role === 'teacher'
                        ? `${m.assignedSubject || 'Matière non précisée'} · Classes : ${(m.assignedClasses ?? []).join(', ') || 'Aucune'}`
                        : m.role === 'censeur'
                        ? 'Accès pédagogique complet : notes, matières, bulletins, stats & communication tout l’établissement'
                        : m.role === 'secretaire'
                        ? 'Accès secrétariat : inscriptions, dossiers élèves, listes, PDF & communication équipe'
                        : `Enfant(s) lié(s) : ${(m.childStudentIds ?? []).length}`}
                    </p>
                  </div>
                  {canRevokeThis && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEditMember(m)}
                        className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100"
                        title="Modifier l’accès"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevokeMember(m)}
                        className="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Retirer l’accès"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tableau récapitulatif des Titulaires de classes */}
      <div className="bg-white/95 backdrop-blur-xs border border-zinc-200/90 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              Titulaires des classes (Professeurs Principaux)
            </h2>
            <p className="text-xs text-zinc-500">
              Attribuez rapidement un enseignant titulaire à chaque division (affiché dans les classes et sur les bulletins).
            </p>
          </div>
          <span className="px-3 py-1 rounded-full theme-pill-soft border text-xs font-bold self-start sm:self-auto">
            {sortedClassrooms.filter((c) => Boolean(c.headTeacher?.trim())).length} / {sortedClassrooms.length} assigné(s)
          </span>
        </div>

        <div className="divide-y divide-zinc-100">
          {sortedClassrooms.map((cls) => {
            const matched = teacherMemberships.find((t) => isTeacherTitulaire(cls, t));
            return (
              <div key={cls.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg theme-pill-soft border font-extrabold">
                    {cls.name}
                  </span>
                  <span className="text-zinc-500">{cls.cycle}</span>
                  {cls.headTeacher ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-zinc-800">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                      {cls.headTeacher}
                    </span>
                  ) : (
                    <span className="text-zinc-400 italic">Non assigné</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={matched ? matched.memberEmail : '__none__'}
                    disabled={updatingTitulaireId === cls.id}
                    onChange={(e) => handleAssignTitulaireRow(cls, e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 outline-none theme-input disabled:opacity-60"
                  >
                    <option value="__none__">— Aucun titulaire —</option>
                    {teacherMemberships.map((t) => (
                      <option key={t.id} value={t.memberEmail}>
                        {t.memberName} {t.assignedSubject ? `(${t.assignedSubject})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
