import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  GraduationCap,
  LayoutGrid,
  UserPlus,
  ClipboardList,
  FileSpreadsheet,
  BarChart3,
  Bot,
  Settings,
  LogOut,
  Menu,
  X,
  MessageSquare,
  Bell,
  Shield,
  ShieldCheck,
  Building2,
  PlusCircle,
  Lock,
} from 'lucide-react';
import {
  auth,
  isCompiledShell,
  processAuthRedirectResult,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase.ts';
import {
  initializeDefaultClassrooms,
  recordAuditLog,
  saveSchoolProfile,
  seedDemoSchoolData,
  setAuditActorContext,
  subscribeSchoolResources,
  subscribeWorkspaceDiscovery,
  syncAccessPropagation,
  syncTogoCurriculum,
} from './lib/schoolService.ts';
import {
  ALL_CLASSES,
  AuditLogEntry,
  BulletinRemark,
  Classroom,
  ClassroomMotif,
  DEFAULT_SUBJECTS_BY_CYCLE,
  GradeRecord,
  Membership,
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  Subject,
  UserRole,
  WorkspaceOption,
  getClassroomTheme,
  normalizeSubjectKey,
} from './types/school.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import {
  AuthGate,
  DesktopBrowserAuthBridge,
  SchoolSetupForm,
} from './components/OnboardingSetup.tsx';
import { FloatingAcademicBackdrop } from './components/FloatingAcademicBackdrop.tsx';
import {
  ActiveTab,
  PersonalizedDashboard,
  RoleManagementView,
} from './components/RoleDashboards.tsx';
import { InscriptionView } from './components/InscriptionView.tsx';
import { MakeListView } from './components/MakeListView.tsx';
import { ClassRosterView } from './components/ClassRosterView.tsx';
import { BulletinView } from './components/BulletinView.tsx';
import { StatisticsView } from './components/StatisticsView.tsx';
import { AiAssistantView } from './components/AiAssistantView.tsx';
import {
  MessagingView,
  NotificationsCenterView,
} from './components/MessagingNotificationsView.tsx';
import {
  OfflineIndicator,
  PWAInstallButton,
} from './components/PWAInstallBanner.tsx';
import { AuditLogsView } from './components/AuditLogsView.tsx';
import {
  ExpressiveNavSweep,
  GoogleAppsLauncher,
  NavDirection,
  SpatialViewStage,
  computeNavDirection,
  useGlobalMaterialRipple,
} from './components/MaterialMotion.tsx';

function AppShell() {
  useGlobalMaterialRipple();
  const [showSplash, setShowSplash] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState<string | null>(null);
  const [creatingOwnSchool, setCreatingOwnSchool] = useState(false);

  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [remarks, setRemarks] = useState<BulletinRemark[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [classroomsLoaded, setClassroomsLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('hub');
  const [navDirection, setNavDirection] = useState<NavDirection>('forward');
  const [selectedClass, setSelectedClass] = useState<string>('6ème A');
  const [bulletinTarget, setBulletinTarget] = useState<{
    studentId: string | null;
    trimester: 1 | 2 | 3;
  }>({ studentId: null, trimester: 1 });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const didInitClassrooms = useRef(false);
  const didSyncStaff = useRef(false);
  const didSyncTogo = useRef(false);

  useEffect(() => {
    void processAuthRedirectResult();
    testFirestoreConnection();
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      didInitClassrooms.current = false;
      didSyncStaff.current = false;
      didSyncTogo.current = false;
      setClassroomsLoaded(false);
      if (!currentUser) {
        setWorkspaces([]);
        setDiscoveryLoading(true);
        setActiveWorkspaceKey(null);
        setCreatingOwnSchool(false);
        setClassrooms([]);
        setMemberships([]);
        setStudents([]);
        setSubjects([]);
        setGrades([]);
        setRemarks([]);
        setMessages([]);
        setNotifications([]);
        setAuditLogs([]);
        setPreviewRole(null);
      } else {
        try {
          const savedKey = localStorage.getItem(`schoolaria_ws_${currentUser.uid}`);
          setActiveWorkspaceKey(savedKey);
        } catch {
          setActiveWorkspaceKey(null);
        }
      }
    });
    return () => unsubAuth();
  }, []);

  // Step 1: Discover all establishments & roles (owned admin + teacher + parent) + studentLocks
  useEffect(() => {
    if (!user) return;
    setDbError(null);
    setDiscoveryLoading(true);
    const unsubs = subscribeWorkspaceDiscovery(user.uid, user.email || '', {
      onWorkspaces: (list, loading) => {
        setWorkspaces(list);
        setDiscoveryLoading(loading);
      },
      onError: (err) => setDbError(err.message),
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user]);

  const activeWorkspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (activeWorkspaceKey) {
      const found = workspaces.find((w) => w.key === activeWorkspaceKey);
      if (found) return found;
    }
    return workspaces[0];
  }, [workspaces, activeWorkspaceKey]);

  const school: SchoolProfile | null | undefined = discoveryLoading
    ? undefined
    : activeWorkspace?.school ?? null;
  const actualRole: UserRole = activeWorkspace?.role ?? 'admin';
  const activeMembership: Membership | null = activeWorkspace?.membership ?? null;

  const handleSelectWorkspace = (wsKey: string) => {
    setActiveWorkspaceKey(wsKey);
    if (user) {
      try {
        localStorage.setItem(`schoolaria_ws_${user.uid}`, wsKey);
      } catch {
        // Ignore storage error
      }
    }
    setPreviewRole(null);
    setActiveTab('hub');
    setMobileMenuOpen(false);
  };

  // Step 2: Subscribe strictly to the active workspace's resources (blocked if studentLocked)
  useEffect(() => {
    if (!user || !activeWorkspace) return;
    didInitClassrooms.current = false;
    didSyncStaff.current = false;
    didSyncTogo.current = false;
    setClassroomsLoaded(false);
    setClassrooms([]);
    setMemberships([]);
    setStudents([]);
    setSubjects([]);
    setGrades([]);
    setRemarks([]);
    setMessages([]);
    setNotifications([]);
    setAuditLogs([]);

    if (activeWorkspace.studentLocked && activeWorkspace.role === 'teacher') {
      return;
    }

    const unsubs = subscribeSchoolResources(activeWorkspace, user.uid, user.email || '', {
      onClassrooms: (list) => setClassrooms(list),
      onClassroomsLoaded: () => setClassroomsLoaded(true),
      onMemberships: (list) => setMemberships(list),
      onStudents: (list) => setStudents(list),
      onSubjects: (list) => setSubjects(list),
      onGrades: (list) => setGrades(list),
      onRemarks: (list) => setRemarks(list),
      onMessages: (list) => setMessages(list),
      onNotifications: (list) => setNotifications(list),
      onAuditLogs: (list) => setAuditLogs(list),
      onError: (err) => setDbError(err.message),
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, activeWorkspace?.key, activeWorkspace?.studentLocked]);

  useEffect(() => {
    if (
      user &&
      actualRole === 'admin' &&
      school &&
      classroomsLoaded &&
      classrooms.length === 0 &&
      !didInitClassrooms.current
    ) {
      didInitClassrooms.current = true;
      initializeDefaultClassrooms(user.uid, school.id, school.memberEmails ?? []).catch(() => {
        // Ignore if already initialized concurrently
      });
    }
  }, [user, actualRole, school, classroomsLoaded, classrooms.length]);

  useEffect(() => {
    if (
      user &&
      actualRole === 'admin' &&
      school &&
      school.staffEmails === undefined &&
      !didSyncStaff.current
    ) {
      didSyncStaff.current = true;
      syncAccessPropagation(user.uid, school.id).catch(() => {
        // Non-blocking backfill for pre-existing schools
      });
    }
  }, [user, actualRole, school]);

  useEffect(() => {
    if (
      !user ||
      actualRole !== 'admin' ||
      !school ||
      !classroomsLoaded ||
      subjects.length === 0 ||
      classrooms.length === 0 ||
      didSyncTogo.current
    ) {
      return;
    }

    const collegeKeys = new Set(
      subjects.filter((s) => s.cycle === 'Collège').map((s) => normalizeSubjectKey(s.name))
    );
    const lyceeKeys = new Set(
      subjects.filter((s) => s.cycle === 'Lycée').map((s) => normalizeSubjectKey(s.name))
    );
    const missingSubject =
      DEFAULT_SUBJECTS_BY_CYCLE.Collège.some(
        (item) => !collegeKeys.has(normalizeSubjectKey(item.name))
      ) ||
      DEFAULT_SUBJECTS_BY_CYCLE.Lycée.some(
        (item) => !lyceeKeys.has(normalizeSubjectKey(item.name))
      ) ||
      subjects.some(
        (s) =>
          (s.cycle === 'Collège' && normalizeSubjectKey(s.name) === 'physique' && s.name !== 'PCT') ||
          (s.cycle === 'Lycée' && normalizeSubjectKey(s.name) === 'anglais' && s.name !== 'Anglais (LV1)')
      );
    const missingClass = ALL_CLASSES.some(
      (cl) => !classrooms.some((c) => c.name === cl.name)
    );
    const officialNames = new Set(ALL_CLASSES.map((c) => c.name));
    const seenClassNames = new Set<string>();
    let hasDuplicateOrObsoleteClass = false;
    for (const c of classrooms) {
      const isAutoDefault =
        c.id.startsWith(`${school.id}_cls_`) || c.id.startsWith(`${school.id}_tg_cls_`);
      const hasStudents = students.some((s) => s.classe === c.name);
      if ((seenClassNames.has(c.name) && isAutoDefault) || (isAutoDefault && !officialNames.has(c.name) && !hasStudents)) {
        hasDuplicateOrObsoleteClass = true;
        break;
      }
      seenClassNames.add(c.name);
    }

    if (missingSubject || missingClass || hasDuplicateOrObsoleteClass) {
      didSyncTogo.current = true;
      syncTogoCurriculum(
        user.uid,
        school.id,
        subjects,
        classrooms,
        school.memberEmails ?? [],
        students
      ).catch(() => {
        // Non-blocking curriculum sync
      });
    } else {
      didSyncTogo.current = true;
    }
  }, [user, actualRole, school, classroomsLoaded, subjects, classrooms, students]);

  const isPreview = actualRole === 'admin' && previewRole !== null;
  const effectiveRole: UserRole = isPreview && previewRole ? previewRole : actualRole;

  const ownerUid = school?.ownerId ?? user?.uid ?? '';
  const actorEmail = user?.email || school?.email || 'direction@ecole.com';
  const actorName =
    activeMembership?.memberName || user?.displayName || school?.adminName || 'Utilisateur';

  useEffect(() => {
    if (!user) {
      setAuditActorContext(null);
      return;
    }
    setAuditActorContext({
      ownerId: school?.ownerId ?? user.uid,
      schoolId: school?.id ?? '',
      actorUid: user.uid,
      actorEmail: user.email || school?.email || 'utilisateur@ecole.com',
      actorName:
        activeMembership?.memberName || user.displayName || school?.adminName || 'Utilisateur',
      actorRole: actualRole,
    });
  }, [user, school, actualRole, activeMembership]);

  // Active v1 cycles: Collège & Lycée (Primaire reserved for future version), deduplicated by class name
  const uiClassrooms = useMemo(() => {
    const seen = new Set<string>();
    const list: Classroom[] = [];
    for (const c of classrooms) {
      if (c.cycle !== 'Collège' && c.cycle !== 'Lycée') continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      list.push(c);
    }
    return list;
  }, [classrooms]);

  const uiStudents = useMemo(
    () => students.filter((s) => s.cycle === 'Collège' || s.cycle === 'Lycée'),
    [students]
  );

  // Scoped students & classrooms for Teacher and Parent views (no fallback leak for real accounts)
  const scopedClassrooms = useMemo(() => {
    if (effectiveRole === 'teacher') {
      const teacherMem = activeMembership ?? memberships.find((m) => m.role === 'teacher');
      const assigned = teacherMem?.assignedClasses ?? [];
      if (assigned.length > 0) {
        return uiClassrooms.filter((c) => assigned.includes(c.name));
      }
      return isPreview ? uiClassrooms.slice(0, 4) : [];
    }
    return uiClassrooms;
  }, [effectiveRole, isPreview, activeMembership, memberships, uiClassrooms]);

  const scopedStudents = useMemo(() => {
    if (effectiveRole === 'parent') {
      const parentMem = activeMembership ?? memberships.find((m) => m.role === 'parent');
      if (parentMem) {
        const ids = parentMem.childStudentIds ?? [];
        const matched = uiStudents.filter(
          (s) => ids.includes(s.id) || (s.parentEmail && s.parentEmail === parentMem.memberEmail)
        );
        if (matched.length > 0) return matched;
      }
      return isPreview ? uiStudents.slice(0, 2) : [];
    }
    if (effectiveRole === 'teacher') {
      const assigned = scopedClassrooms.map((c) => c.name);
      return uiStudents.filter((s) => assigned.includes(s.classe));
    }
    return uiStudents;
  }, [effectiveRole, isPreview, activeMembership, memberships, uiStudents, scopedClassrooms]);

  const activeMotif: ClassroomMotif = useMemo(() => {
    if (activeTab === 'classdetail') {
      const clsObj = classrooms.find((c) => c.name === selectedClass);
      return getClassroomTheme(selectedClass, clsObj).motif;
    }
    return 'general';
  }, [activeTab, classrooms, selectedClass]);

  const handleNavigate = (tab: ActiveTab) => {
    setNavDirection(computeNavDirection(activeTab, tab));
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const handleOpenClass = (classe: string) => {
    setNavDirection(computeNavDirection(activeTab, 'classdetail'));
    setSelectedClass(classe);
    setActiveTab('classdetail');
    setMobileMenuOpen(false);
  };

  const handleOpenBulletin = (studentId: string, trimester: 1 | 2 | 3) => {
    setNavDirection(computeNavDirection(activeTab, 'bulletins'));
    setBulletinTarget({ studentId, trimester });
    setActiveTab('bulletins');
  };

  const handleExportLocalBackup = () => {
    if (!school) return;
    const backup = {
      exportedAt: new Date().toISOString(),
      school,
      classrooms,
      memberships,
      students,
      subjects,
      grades,
      remarks,
      messages,
      notifications,
      auditLogs,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_${school.schoolName.replace(/\s+/g, '_')}_${school.academicYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void recordAuditLog({
      category: 'export',
      severity: 'info',
      action: 'Sauvegarde JSON complète',
      details: `Export complet (${students.length} élèves, ${grades.length} notes, ${auditLogs.length} journaux).`,
    });
  };

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <FloatingAcademicBackdrop />
        <div className="relative z-10 text-sm font-medium text-zinc-600">Initialisation...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen">
        <FloatingAcademicBackdrop />
        <AuthGate />
      </div>
    );
  }

  if (school === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <FloatingAcademicBackdrop />
        <div className="relative z-10 text-sm font-medium text-zinc-600">
          Chargement de votre établissement...
        </div>
      </div>
    );
  }

  if (school === null || creatingOwnSchool) {
    return (
      <div className="relative min-h-screen">
        <FloatingAcademicBackdrop />
        <SchoolSetupForm
          defaultAdminName={user.displayName || 'Directeur'}
          cancelLabel={school !== null ? 'Retour à mes espaces' : undefined}
          onCancel={school !== null ? () => setCreatingOwnSchool(false) : undefined}
          onSubmit={async (values) => {
            const createdId = await saveSchoolProfile(user.uid, values, true);
            const wsKey = `${createdId}:admin`;
            setActiveWorkspaceKey(wsKey);
            try {
              localStorage.setItem(`schoolaria_ws_${user.uid}`, wsKey);
            } catch {
              // Ignore storage error
            }
            setCreatingOwnSchool(false);
            setPreviewRole(null);
            setActiveTab('hub');
          }}
        />
      </div>
    );
  }

  if (activeWorkspace?.studentLocked && activeWorkspace.role === 'teacher') {
    const safeAlternatives = workspaces.filter(
      (w) => !(w.studentLocked && w.role === 'teacher')
    );
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative">
        <FloatingAcademicBackdrop />
        <div className="relative z-10 max-w-lg w-full bg-white/95 border border-rose-200 rounded-2xl p-6 sm:p-8 shadow-xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-zinc-900">
                Accès Enseignant bloqué dans cet établissement
              </h2>
              <p className="text-xs text-rose-700 font-medium">{school.schoolName}</p>
            </div>
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            Votre adresse Google (<strong>{user.email}</strong>) figure dans le registre des élèves de{' '}
            <strong>{school.schoolName}</strong>. Par sécurité académique, un compte élève ne peut jamais accéder à l’espace Enseignant de son propre établissement.
          </p>
          <p className="text-xs text-zinc-500">
            Si vous dirigez ou enseignez dans un autre établissement, vous pouvez basculer sur un autre espace ou créer votre propre école ci-dessous.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {safeAlternatives.map((alt) => (
              <button
                key={alt.key}
                type="button"
                onClick={() => handleSelectWorkspace(alt.key)}
                className="px-4 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold"
              >
                Ouvrir {alt.school.schoolName} ({alt.role})
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCreatingOwnSchool(true)}
              className="px-4 py-2 rounded-xl bg-violet-100 hover:bg-violet-200 text-violet-900 text-xs font-semibold"
            >
              + Créer mon établissement
            </button>
            <button
              type="button"
              onClick={() => signOutUser()}
              className="px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-xs font-semibold"
            >
              Changer de compte Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unreadMessagesCount = messages.filter((m) => !m.read).length;
  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  const allNavItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof LayoutGrid;
    roles: UserRole[];
    badge?: number;
  }> = [
    { id: 'hub', label: 'Tableau de bord', icon: LayoutGrid, roles: ['admin', 'teacher', 'parent'] },
    { id: 'inscription', label: 'Inscription', icon: UserPlus, roles: ['admin'] },
    {
      id: 'makelist',
      label: effectiveRole === 'teacher' ? 'Mes Classes & Notes' : 'Classes & Notes',
      icon: ClipboardList,
      roles: ['admin', 'teacher'],
    },
    { id: 'bulletins', label: 'Bulletins & Suivi', icon: FileSpreadsheet, roles: ['admin', 'teacher', 'parent'] },
    { id: 'stats', label: 'Statistiques', icon: BarChart3, roles: ['admin'] },
    {
      id: 'messages',
      label: 'Messagerie',
      icon: MessageSquare,
      roles: ['admin', 'teacher', 'parent'],
      badge: unreadMessagesCount,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      roles: ['admin', 'teacher', 'parent'],
      badge: unreadNotifsCount,
    },
    { id: 'roles', label: 'Profs & Parents', icon: Shield, roles: ['admin'] },
    { id: 'audit', label: 'Journaux & Sécurité', icon: ShieldCheck, roles: ['admin'] },
    { id: 'assistant', label: 'Yasmine (IA)', icon: Bot, roles: ['admin', 'teacher'] },
    { id: 'settings', label: 'Établissement', icon: Settings, roles: ['admin'] },
  ];

  const visibleNavItems = allNavItems.filter((item) => item.roles.includes(effectiveRole));
  const currentRouteKey =
    effectiveRole + '_' + activeTab + (activeTab === 'classdetail' ? selectedClass : '');

  const renderSidebarBody = (scope: 'desktop' | 'mobile') => (
    <>
      <div className="space-y-1">
        <div className="px-3.5 py-3 mb-3 rounded-2xl bg-white/10 border border-white/20 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-white truncate">{school.schoolName}</p>
              <p className="text-[11px] text-violet-200 truncate">
                {school.adminName} · {school.academicYear}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-white/15 text-[10px] font-bold text-white uppercase shrink-0">
              {actualRole === 'admin' ? 'Direction' : actualRole === 'teacher' ? 'Prof' : 'Parent'}
            </span>
          </div>

          {school.city && (
            <p className="text-[10px] text-violet-300 truncate">
              {school.city}
              {school.registrationCode ? ` · ${school.registrationCode}` : ''}
            </p>
          )}

          {workspaces.length > 1 && (
            <div className="pt-1.5 border-t border-white/15">
              <label className="text-[10px] font-semibold text-violet-200 flex items-center gap-1 mb-1">
                <Building2 className="w-3 h-3 shrink-0" />
                Changer d'établissement / rôle
              </label>
              <select
                value={activeWorkspace?.key ?? ''}
                onChange={(e) => handleSelectWorkspace(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl bg-violet-950/90 border border-white/25 text-white text-[11px] font-semibold outline-none focus:border-white"
              >
                {workspaces.map((ws) => {
                  const roleTag =
                    ws.role === 'admin'
                      ? 'Directeur'
                      : ws.role === 'teacher'
                      ? ws.studentLocked
                        ? 'Prof (bloqué élève)'
                        : 'Enseignant'
                      : 'Parent';
                  return (
                    <option key={ws.key} value={ws.key}>
                      {ws.school.schoolName} · {roleTag}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setCreatingOwnSchool(true);
            }}
            className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-[11px] font-semibold text-white transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Créer mon établissement</span>
          </button>
        </div>

        {/* Admin Role Preview Switcher with Google Material gliding pill */}
        {actualRole === 'admin' && (
          <div className="mb-3 p-2 rounded-2xl bg-violet-900/75 border border-violet-700/70">
            <p className="text-[10px] font-bold text-violet-200 uppercase tracking-wider px-1 mb-1.5">
              Vue du tableau de bord
            </p>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'admin', label: 'Admin' },
                  { id: 'teacher', label: 'Prof' },
                  { id: 'parent', label: 'Parent' },
                ] as const
              ).map((r) => {
                const isSelected = effectiveRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setNavDirection('backward');
                      setPreviewRole(r.id === 'admin' ? null : r.id);
                      setActiveTab('hub');
                    }}
                    className={`relative py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                      isSelected ? 'text-violet-950' : 'text-violet-200 hover:text-white'
                    }`}
                  >
                    {isSelected && (
                      <motion.span
                        layoutId={`role-switch-pill-${scope}`}
                        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                        className="absolute inset-0 rounded-xl bg-white shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {visibleNavItems.map((item, idx) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id || (activeTab === 'classdetail' && item.id === 'makelist');
          return (
            <motion.button
              key={item.id}
              type="button"
              initial={scope === 'mobile' ? { opacity: 0, x: -14 } : false}
              animate={scope === 'mobile' ? { opacity: 1, x: 0 } : undefined}
              transition={
                scope === 'mobile'
                  ? { delay: Math.min(idx * 0.025, 0.2), type: 'spring', stiffness: 420, damping: 30 }
                  : undefined
              }
              onClick={() => handleNavigate(item.id)}
              className={`group relative w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? 'text-violet-950 font-bold' : 'text-violet-100/90 hover:bg-white/10 hover:text-white'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId={`sidebar-active-pill-${scope}`}
                  transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                  className="absolute inset-0 rounded-2xl bg-white shadow-md shadow-violet-950/25"
                />
              )}
              <span className="relative z-10 flex items-center gap-3">
                <motion.span
                  animate={isActive ? { scale: 1.12, rotate: -4 } : { scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                  className="inline-flex"
                >
                  <Icon className="w-4 h-4 shrink-0" />
                </motion.span>
                <span>{item.label}</span>
              </span>
              {item.badge ? (
                <span
                  className={`relative z-10 px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono-nums ${
                    isActive ? 'bg-violet-700 text-white' : 'bg-white/20 text-white'
                  }`}
                >
                  {item.badge}
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      <div className="pt-4 mt-4 border-t border-white/15 space-y-2">
        {!isCompiledShell() && <PWAInstallButton variant="sidebar" />}
        <button
          type="button"
          onClick={() => signOutUser()}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold text-violet-200 hover:text-white hover:bg-rose-500/30 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Déconnexion ({user.email?.split('@')[0]})</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen text-[#1e1038] flex flex-col relative">
      <OfflineIndicator />
      <FloatingAcademicBackdrop motif={activeMotif} />

      {/* Top Bar — Google Material Expressive Royal Violet & Crisp White */}
      <header className="no-print sticky top-0 z-30 bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white border-b border-violet-700/80 shadow-md px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-full text-violet-100 hover:bg-white/15"
            aria-label="Menu"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={mobileMenuOpen ? 'close' : 'open'}
                initial={{ rotate: -45, opacity: 0, scale: 0.8 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 45, opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.14 }}
                className="inline-flex"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleNavigate('hub')}
            className="group flex items-center gap-2.5 whitespace-nowrap shrink-0"
          >
            <span className="w-9 h-9 rounded-xl group-hover:rounded-2xl bg-white text-violet-900 flex items-center justify-center shadow-xs transition-all duration-200 group-hover:-rotate-6">
              <GraduationCap className="w-5 h-5" />
            </span>
            <span className="text-base font-extrabold tracking-tight text-white">
              School<span className="text-violet-200">aria</span>
            </span>
          </motion.button>
        </div>

        {/* Expressive Gliding Capsule Navigation */}
        <nav className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-violet-100 bg-white/10 border border-white/15 rounded-full p-1">
          {visibleNavItems.slice(0, 5).map((item) => {
            const isActive =
              activeTab === item.id || (activeTab === 'classdetail' && item.id === 'makelist');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`relative whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-colors ${
                  isActive ? 'text-violet-950 font-bold' : 'text-violet-100 hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="top-nav-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 33 }}
                    className="absolute inset-0 rounded-full bg-white shadow-sm"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
                {item.badge ? (
                  <span
                    className={`relative z-10 px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono-nums ${
                      isActive ? 'bg-violet-700 text-white' : 'bg-white text-violet-900'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {!isCompiledShell() && (
            <div className="hidden sm:block">
              <PWAInstallButton variant="header" />
            </div>
          )}
          <GoogleAppsLauncher
            items={visibleNavItems}
            activeTab={activeTab}
            onSelect={handleNavigate}
          />
          {effectiveRole === 'admin' ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleNavigate('inscription')}
              className="px-4 py-2 rounded-full bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              + Inscrire un élève
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleNavigate('messages')}
              className="px-4 py-2 rounded-full bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              Messagerie
            </motion.button>
          )}
        </div>

        <ExpressiveNavSweep routeKey={currentRouteKey} />
      </header>

      <div className="flex-1 flex max-w-[1440px] w-full mx-auto relative z-10">
        {/* Desktop Sidebar — Deep Royal Violet & Crisp White */}
        <aside className="no-print hidden lg:flex w-64 shrink-0 border-r border-violet-800/70 bg-gradient-to-b from-violet-950 via-[#2e1065] to-indigo-950 text-violet-100 p-4 flex-col justify-between">
          {renderSidebarBody('desktop')}
        </aside>

        {/* Expressive Animated Mobile Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setMobileMenuOpen(false)}
                className="no-print lg:hidden fixed inset-0 top-16 z-30 bg-violet-950/55 backdrop-blur-xs"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                className="no-print lg:hidden fixed inset-y-16 bottom-0 left-0 z-40 w-72 overflow-y-auto border-r border-violet-800/70 bg-gradient-to-b from-violet-950 via-[#2e1065] to-indigo-950 text-violet-100 p-4 flex flex-col justify-between shadow-2xl"
              >
                {renderSidebarBody('mobile')}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content Viewport with Google Shared-Axis Spatial Transitions */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-x-clip">
          {dbError && (
            <div className="no-print mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {dbError}
            </div>
          )}

          <SpatialViewStage routeKey={currentRouteKey} direction={navDirection}>
              {activeTab === 'hub' && (
                <PersonalizedDashboard
                  effectiveRole={effectiveRole}
                  isPreview={isPreview}
                  activeMembership={activeMembership}
                  school={school}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  subjects={subjects}
                  grades={grades}
                  remarks={remarks}
                  messages={messages}
                  notifications={notifications}
                  memberships={memberships}
                  onNavigate={handleNavigate}
                  onOpenClass={handleOpenClass}
                  onOpenBulletin={handleOpenBulletin}
                  onSeedDemo={() =>
                    seedDemoSchoolData(
                      ownerUid,
                      school.id,
                      subjects,
                      actorEmail,
                      school.adminName
                    )
                  }
                />
              )}

              {activeTab === 'inscription' && effectiveRole === 'admin' && (
                <InscriptionView
                  uid={ownerUid}
                  schoolId={school.id}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'makelist' && (effectiveRole === 'admin' || effectiveRole === 'teacher') && (
                <MakeListView
                  uid={ownerUid}
                  schoolId={school.id}
                  canManageClasses={effectiveRole === 'admin'}
                  classrooms={effectiveRole === 'teacher' ? scopedClassrooms : uiClassrooms}
                  students={scopedStudents}
                  grades={grades}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'classdetail' && (effectiveRole === 'admin' || effectiveRole === 'teacher') && (
                <ClassRosterView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  canManageSchool={effectiveRole === 'admin'}
                  school={school}
                  classe={selectedClass}
                  classroom={uiClassrooms.find((c) => c.name === selectedClass)}
                  classrooms={uiClassrooms}
                  students={effectiveRole === 'teacher' ? scopedStudents : uiStudents}
                  subjects={subjects}
                  grades={grades}
                  onBack={() => handleNavigate('makelist')}
                  onOpenBulletin={handleOpenBulletin}
                />
              )}

              {activeTab === 'bulletins' && (
                <BulletinView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  readOnly={effectiveRole === 'parent'}
                  school={school}
                  classrooms={uiClassrooms}
                  students={scopedStudents}
                  subjects={subjects}
                  grades={grades}
                  remarks={remarks}
                  initialStudentId={bulletinTarget.studentId}
                  initialTrimester={bulletinTarget.trimester}
                />
              )}

              {activeTab === 'stats' && effectiveRole === 'admin' && (
                <StatisticsView
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  subjects={subjects}
                  grades={grades}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'messages' && (
                <MessagingView
                  ownerUid={ownerUid}
                  actorUid={user.uid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  effectiveRole={effectiveRole}
                  school={school}
                  students={scopedStudents}
                  memberships={memberships}
                  messages={messages}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationsCenterView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  effectiveRole={effectiveRole}
                  school={school}
                  classrooms={uiClassrooms}
                  students={scopedStudents}
                  memberships={memberships}
                  notifications={notifications}
                />
              )}

              {activeTab === 'roles' && effectiveRole === 'admin' && (
                <RoleManagementView
                  uid={ownerUid}
                  schoolId={school.id}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  memberships={memberships}
                />
              )}

              {activeTab === 'audit' && effectiveRole === 'admin' && (
                <AuditLogsView school={school} auditLogs={auditLogs} />
              )}

              {activeTab === 'assistant' && (effectiveRole === 'admin' || effectiveRole === 'teacher') && (
                <AiAssistantView
                  school={school}
                  students={scopedStudents}
                  grades={grades}
                />
              )}

              {activeTab === 'settings' && effectiveRole === 'admin' && (
                <SchoolSetupForm
                  isEdit
                  defaultAdminName={school.adminName}
                  initialValues={{
                    schoolName: school.schoolName,
                    adminName: school.adminName,
                    academicYear: school.academicYear,
                    motto: school.motto,
                    phone: school.phone,
                    email: school.email,
                    address: school.address,
                    city: school.city,
                    registrationCode: school.registrationCode,
                  }}
                  onExportBackup={handleExportLocalBackup}
                  onCancel={() => handleNavigate('hub')}
                  onSubmit={async (values) => {
                    await saveSchoolProfile(ownerUid, values, false, school.id);
                    handleNavigate('hub');
                  }}
                />
              )}
          </SpatialViewStage>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const desktopAuthNonce = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('desktopAuth') === '1') {
      return params.get('nonce') || '';
    }
    return null;
  }, []);

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        {desktopAuthNonce ? (
          <div className="relative min-h-screen">
            <FloatingAcademicBackdrop />
            <DesktopBrowserAuthBridge nonce={desktopAuthNonce} />
          </div>
        ) : (
          <AppShell />
        )}
      </MotionConfig>
    </ErrorBoundary>
  );
}
