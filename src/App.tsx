import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Archive,
  CalendarClock,
  Check,
  CheckCircle2,
  AlertTriangle,
  Megaphone,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  auth,
  isCompiledShell,
  processAuthRedirectResult,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase.ts';
import {
  formatAuthIdentifierForDisplay,
  isUserAccountVerified,
} from './lib/phoneAuth.ts';
import {
  cleanupNotificationsBulk,
  deleteSchoolCascade,
  dismissOrDeleteNotification,
  initializeDefaultClassrooms,
  markAllNotificationsRead,
  markNotificationRead,
  recordAuditLog,
  saveSchoolProfile,
  seedDemoSchoolData,
  setAuditActorContext,
  subscribeSchoolResources,
  subscribeWorkspaceDiscovery,
  syncAccessPropagation,
  syncTogoCurriculum,
  updateSchoolTheme,
} from './lib/schoolService.ts';
import {
  SchoolUniformTheme,
  applySchoolThemeToDocument,
  getSavedPreviewTheme,
  normalizeSchoolTheme,
  savePreviewTheme,
} from './lib/schoolTheme.ts';
import {
  canAccessTab,
  canBatchPrintBulletinsForRole,
  canChangeSchoolThemeForRole,
  canEditBulletinsForRole,
  canManageLeadershipForRole,
  canManageSecretaireForRole,
  canManageYearLifecycleForRole,
} from './lib/rolePermissions.ts';
import { filterChildrenForParent } from './lib/parentHelpers.ts';
import {
  ALL_CLASSES,
  AcademicArchive,
  AuditLogEntry,
  BulletinRemark,
  Classroom,
  ClassroomMotif,
  DEFAULT_SUBJECTS_BY_CYCLE,
  GradeRecord,
  Membership,
  MessageItem,
  NotificationItem,
  ROLE_SHORT_LABELS,
  SchoolProfile,
  Student,
  Subject,
  UserRole,
  WorkspaceOption,
  canEditGrades,
  canManageClasses,
  canManageStudents,
  canManageSubjects,
  getClassroomTheme,
  isNotificationVisibleForUser,
  isTeacherTitulaire,
  normalizeSubjectKey,
  sortClassrooms,
} from './types/school.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import {
  AuthGate,
  DesktopBrowserAuthBridge,
  SchoolSetupForm,
} from './components/OnboardingSetup.tsx';
import { FloatingAcademicBackdrop } from './components/FloatingAcademicBackdrop.tsx';
import { UniformThemePicker } from './components/UniformThemePicker.tsx';
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
import { AcademicYearModal, ArchivesView } from './components/AcademicYearModal.tsx';
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
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('autostart') !== '1';
    }
    return true;
  });
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [verifiedVersion, setVerifiedVersion] = useState(0);

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState<string | null>(null);
  const [creatingOwnSchool, setCreatingOwnSchool] = useState(false);

  const [savingTheme, setSavingTheme] = useState(false);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [remarks, setRemarks] = useState<BulletinRemark[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [archives, setArchives] = useState<AcademicArchive[]>([]);
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
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [yearModalOpen, setYearModalOpen] = useState(false);
  const [yearSuccessBanner, setYearSuccessBanner] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const didInitClassrooms = useRef(false);
  const didSyncStaff = useRef(false);
  const didSyncTogo = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

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
        setArchives([]);
        applySchoolThemeToDocument(getSavedPreviewTheme());
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

  // Step 1: Discover all establishments & roles ONLY when account is verified (Google, verified email, or phone account)
  const accountVerified = isUserAccountVerified(user);
  useEffect(() => {
    if (!user || !accountVerified) return;
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
  }, [user, accountVerified, verifiedVersion]);

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
  const effectiveRole: UserRole = actualRole;
  const activeMembership: Membership | null = activeWorkspace?.membership ?? null;

  const activeSchoolTheme: SchoolUniformTheme = school
    ? normalizeSchoolTheme(school.theme)
    : getSavedPreviewTheme();

  useEffect(() => {
    applySchoolThemeToDocument(activeSchoolTheme);
  }, [activeSchoolTheme]);

  // Ensure activeTab never points to a panel forbidden for the user's strict role
  useEffect(() => {
    if (!canAccessTab(effectiveRole, activeTab)) {
      setActiveTab('hub');
    }
  }, [effectiveRole, activeTab]);

  const handleSelectWorkspace = (wsKey: string) => {
    setActiveWorkspaceKey(wsKey);
    if (user) {
      try {
        localStorage.setItem(`schoolaria_ws_${user.uid}`, wsKey);
      } catch {
        // Ignore storage error
      }
    }
    setActiveTab('hub');
    setMobileMenuOpen(false);
  };

  const handleQuickThemeChange = async (nextTheme: SchoolUniformTheme) => {
    savePreviewTheme(nextTheme);
    applySchoolThemeToDocument(nextTheme);
    if (!school || !canChangeSchoolThemeForRole(effectiveRole)) return;
    setSavingTheme(true);
    try {
      await updateSchoolTheme(school.id, nextTheme);
    } catch (err: unknown) {
      setDbError(err instanceof Error ? err.message : 'Erreur lors du changement de thème.');
    } finally {
      setSavingTheme(false);
    }
  };

  // Step 2: Subscribe strictly to the active workspace's resources (blocked if studentLocked or unverified)
  useEffect(() => {
    if (!user || !accountVerified || !activeWorkspace) return;
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
    setArchives([]);

    if (
      activeWorkspace.studentLocked &&
      (activeWorkspace.role === 'teacher' ||
        activeWorkspace.role === 'censeur' ||
        activeWorkspace.role === 'secretaire')
    ) {
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
      onArchives: (list) => setArchives(list),
      onError: (err) => setDbError(err.message),
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, accountVerified, verifiedVersion, activeWorkspace?.key, activeWorkspace?.studentLocked]);

  useEffect(() => {
    if (!school || !classroomsLoaded) return;
    const initKey = `schoolaria_cls_init_${school.id}`;
    if (classrooms.length > 0) {
      try {
        localStorage.setItem(initKey, '1');
      } catch {
        // Ignore storage error
      }
      return;
    }
    let alreadyInitialized = false;
    try {
      alreadyInitialized = localStorage.getItem(initKey) === '1';
    } catch {
      alreadyInitialized = false;
    }
    if (
      user &&
      actualRole === 'admin' &&
      !alreadyInitialized &&
      !didInitClassrooms.current
    ) {
      didInitClassrooms.current = true;
      try {
        localStorage.setItem(initKey, '1');
      } catch {
        // Ignore storage error
      }
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
      (school.staffEmails === undefined ||
        school.ownerEmail === undefined ||
        school.censeurEmails === undefined ||
        school.teacherEmails === undefined) &&
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

    if (missingSubject || hasDuplicateOrObsoleteClass) {
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

  // Active v1 cycles: Collège & Lycée (Primaire reserved for future version), deduplicated & sorted chronologically
  const uiClassrooms = useMemo(() => {
    const seen = new Set<string>();
    const list: Classroom[] = [];
    for (const c of classrooms) {
      if (c.cycle !== 'Collège' && c.cycle !== 'Lycée') continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      list.push(c);
    }
    return sortClassrooms(list);
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
      return uiClassrooms.filter(
        (c) => assigned.includes(c.name) || isTeacherTitulaire(c, teacherMem)
      );
    }
    return uiClassrooms;
  }, [effectiveRole, activeMembership, memberships, uiClassrooms]);

  const scopedStudents = useMemo(() => {
    if (effectiveRole === 'parent') {
      return filterChildrenForParent({
        students: uiStudents,
        activeMembership,
        memberships,
        parentEmail: user?.email,
        isPreview: false,
      });
    }
    if (effectiveRole === 'teacher') {
      const assigned = scopedClassrooms.map((c) => c.name);
      return uiStudents.filter((s) => assigned.includes(s.classe));
    }
    return uiStudents;
  }, [effectiveRole, activeMembership, memberships, user?.email, uiStudents, scopedClassrooms]);

  const activeMotif: ClassroomMotif = useMemo(() => {
    if (activeTab === 'classdetail') {
      const clsObj = classrooms.find((c) => c.name === selectedClass);
      return getClassroomTheme(selectedClass, clsObj).motif;
    }
    return 'general';
  }, [activeTab, classrooms, selectedClass]);

  const endOfYearAlert = useMemo(() => {
    if (!canManageYearLifecycleForRole(effectiveRole) || !school?.endOfYearDate) return null;
    const target = new Date(`${school.endOfYearDate}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;
    const diffDays = Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 14) {
      return { diffDays, dateStr: school.endOfYearDate };
    }
    return null;
  }, [effectiveRole, school?.endOfYearDate]);

  const cleanActorEmail = actorEmail.trim().toLowerCase();
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => isNotificationVisibleForUser(n, actorEmail, nowTick)),
    [notifications, actorEmail, nowTick]
  );

  const handleNavigate = (tab: ActiveTab) => {
    if (!canAccessTab(effectiveRole, tab)) {
      setActiveTab('hub');
      setMobileMenuOpen(false);
      return;
    }
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
    const safeSchoolName = school.schoolName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Schoolaria';
    const safeYear = school.academicYear.replace(/[^a-zA-Z0-9_-]+/g, '_');
    a.download = `Backup_${safeSchoolName}_${safeYear}.json`;
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

  if (!user || !accountVerified) {
    return (
      <div className="relative min-h-screen">
        <FloatingAcademicBackdrop />
        <AuthGate
          pendingVerificationUser={user && !accountVerified ? user : null}
          onVerificationComplete={(verifiedUser) => {
            setUser(verifiedUser);
            setVerifiedVersion((v) => v + 1);
          }}
        />
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

  if (creatingOwnSchool) {
    return (
      <div className="relative min-h-screen">
        <FloatingAcademicBackdrop />
        <SchoolSetupForm
          defaultAdminName={user.displayName || 'Directeur'}
          cancelLabel={school !== null ? 'Retour à mes espaces' : 'Retour'}
          onCancel={() => setCreatingOwnSchool(false)}
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
            setActiveTab('hub');
          }}
        />
      </div>
    );
  }

  if (school === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative">
        <FloatingAcademicBackdrop />
        <div className="relative z-10 max-w-lg w-full bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xl">
          <div className="theme-surface-header p-6 flex items-center gap-3 border-b">
            <div className="w-11 h-11 rounded-xl theme-nav-active flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold">Aucun établissement rattaché</h1>
              <p className="text-xs theme-header-subtext break-all">
                {user.displayName ? `${user.displayName} · ` : ''}
                {formatAuthIdentifierForDisplay(user.email)}
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-7 space-y-4">
            <div className="p-4 rounded-xl theme-pill-soft border text-xs sm:text-sm leading-relaxed space-y-2">
              <p className="font-bold">Vous êtes parent d’élève ou membre du personnel ?</p>
              <p className="text-zinc-700 text-xs leading-relaxed">
                Demandez au secrétariat de votre établissement d’enregistrer exactement cet identifiant (
                <strong className="theme-text-ink">{formatAuthIdentifierForDisplay(user.email)}</strong>) sur la fiche de votre enfant ou dans{' '}
                <em>Rôles & Direction</em>, puis cliquez sur <strong>Actualiser mon accès</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setVerifiedVersion((v) => v + 1)}
                className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl theme-btn-primary text-xs font-bold transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Actualiser mon accès
              </button>
              <button
                type="button"
                onClick={() => void signOutUser()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Changer de compte
              </button>
            </div>

            <div className="pt-4 border-t theme-border-soft flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs text-zinc-600">
                Vous êtes Directeur et créez une nouvelle école ?
              </span>
              <button
                type="button"
                onClick={() => setCreatingOwnSchool(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl theme-pill-soft border text-xs font-bold transition-colors shrink-0"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Créer mon établissement scolaire
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isStaffBlockedByStudentLock =
    Boolean(activeWorkspace?.studentLocked) &&
    (activeWorkspace?.role === 'teacher' ||
      activeWorkspace?.role === 'censeur' ||
      activeWorkspace?.role === 'secretaire');

  if (isStaffBlockedByStudentLock) {
    const safeAlternatives = workspaces.filter(
      (w) =>
        !(
          w.studentLocked &&
          (w.role === 'teacher' || w.role === 'censeur' || w.role === 'secretaire')
        )
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
                Accès Personnel bloqué dans cet établissement
              </h2>
              <p className="text-xs text-rose-700 font-medium">{school.schoolName}</p>
            </div>
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            Votre identifiant (<strong>{formatAuthIdentifierForDisplay(user.email)}</strong>) figure dans le registre des élèves de{' '}
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
                className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-semibold"
              >
                Ouvrir {alt.school.schoolName} ({alt.role})
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCreatingOwnSchool(true)}
              className="px-4 py-2 rounded-xl theme-pill-soft border text-xs font-semibold"
            >
              + Créer mon établissement
            </button>
              <button
              type="button"
              onClick={() => signOutUser()}
              className="px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50 text-xs font-semibold"
            >
              Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unreadMessagesCount = messages.filter(
    (m) => !m.read && m.senderEmail.trim().toLowerCase() !== cleanActorEmail
  ).length;
  const unreadNotifsCount = visibleNotifications.filter((n) => !n.read).length;

  const allNavItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }> = [
    { id: 'hub', label: 'Tableau de bord', icon: LayoutGrid },
    { id: 'inscription', label: 'Inscription', icon: UserPlus },
    {
      id: 'makelist',
      label:
        effectiveRole === 'teacher'
          ? 'Mes Classes & Notes'
          : effectiveRole === 'admin'
          ? 'Classes & Divisions'
          : effectiveRole === 'secretaire'
          ? 'Classes & Listes'
          : 'Classes & Notes',
      icon: ClipboardList,
    },
    { id: 'bulletins', label: 'Bulletins & Suivi', icon: FileSpreadsheet },
    { id: 'stats', label: 'Statistiques', icon: BarChart3 },
    {
      id: 'messages',
      label: 'Messagerie',
      icon: MessageSquare,
      badge: unreadMessagesCount,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadNotifsCount,
    },
    {
      id: 'roles',
      label:
        effectiveRole === 'admin'
          ? 'Rôles & Direction'
          : effectiveRole === 'censeur'
          ? 'Secrétaire, Profs & Parents'
          : 'Profs & Parents',
      icon: Shield,
    },
    { id: 'archives', label: 'Archives', icon: Archive },
    { id: 'audit', label: 'Journaux & Sécurité', icon: ShieldCheck },
    { id: 'assistant', label: 'Yasmine (IA)', icon: Bot },
    { id: 'settings', label: 'Établissement', icon: Settings },
  ];

  const visibleNavItems = allNavItems.filter((item) => canAccessTab(effectiveRole, item.id));
  const currentRouteKey =
    effectiveRole + '_' + activeTab + (activeTab === 'classdetail' ? selectedClass : '');

  const renderSidebarBody = (scope: 'desktop' | 'mobile') => (
    <>
      <div className="space-y-1">
        <div className="px-3.5 py-3 mb-3 rounded-2xl theme-header-chip border space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-extrabold truncate">{school.schoolName}</p>
              <p className="text-[11px] theme-header-subtext truncate">
                {school.adminName} · {school.academicYear}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-md theme-nav-active text-[10px] font-bold uppercase shrink-0">
              {ROLE_SHORT_LABELS[actualRole]}
            </span>
          </div>

          {school.city && (
            <p className="text-[10px] theme-header-subtext truncate">
              {school.city}
              {school.registrationCode ? ` · ${school.registrationCode}` : ''}
            </p>
          )}

          {workspaces.length > 1 && (
            <div className="pt-1.5 border-t border-current/15">
              <label className="text-[10px] font-semibold theme-header-subtext flex items-center gap-1 mb-1">
                <Building2 className="w-3 h-3 shrink-0" />
                Changer d'établissement / rôle
              </label>
              <select
                value={activeWorkspace?.key ?? ''}
                onChange={(e) => handleSelectWorkspace(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl bg-white border border-zinc-300 text-zinc-900 text-[11px] font-semibold outline-none theme-input"
              >
                {workspaces.map((ws) => {
                  const roleTag = ws.studentLocked
                    ? `${ROLE_SHORT_LABELS[ws.role]} (bloqué élève)`
                    : ROLE_SHORT_LABELS[ws.role];
                  return (
                    <option key={ws.key} value={ws.key}>
                      {ws.school.schoolName} · {roleTag}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {canChangeSchoolThemeForRole(effectiveRole) && (
            <div className="pt-1.5 border-t border-current/15">
              <p className="text-[10px] font-semibold theme-header-subtext mb-1.5">
                Uniforme de l’école
              </p>
              <UniformThemePicker
                variant="header"
                value={activeSchoolTheme}
                disabled={savingTheme}
                onChange={(nextTheme) => void handleQuickThemeChange(nextTheme)}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setCreatingOwnSchool(true);
            }}
            className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl theme-header-chip border text-[11px] font-semibold transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Créer mon établissement</span>
          </button>
        </div>

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
              className={`group relative w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-sm transition-colors whitespace-nowrap ${
                isActive ? 'font-bold text-[var(--theme-nav-active-fg)]' : 'font-medium theme-nav-inactive'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId={`sidebar-active-pill-${scope}`}
                  transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                  className="absolute inset-0 rounded-2xl bg-[var(--theme-nav-active-bg)] shadow-md"
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
                    isActive ? 'theme-btn-primary' : 'theme-header-chip border'
                  }`}
                >
                  {item.badge}
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      <div className="pt-4 mt-4 border-t border-current/15 space-y-2">
        {!isCompiledShell() && <PWAInstallButton variant="sidebar" />}
        <button
          type="button"
          onClick={() => signOutUser()}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold theme-nav-inactive hover:bg-rose-500/20 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span className="truncate">
            Déconnexion ({user.displayName || formatAuthIdentifierForDisplay(user.email).split('@')[0]})
          </span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen theme-text-ink flex flex-col relative overflow-x-clip">
      <OfflineIndicator />
      <FloatingAcademicBackdrop motif={activeMotif} />

      {/* Top Bar — Dynamic School Uniform Theme */}
      <header className="no-print sticky top-0 z-30 theme-surface-header border-b shadow-md px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4 max-w-full">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-full theme-header-chip border shrink-0"
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
            className="group flex items-center gap-2 sm:gap-2.5 whitespace-nowrap shrink-0"
          >
            <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl group-hover:rounded-2xl theme-nav-active flex items-center justify-center shadow-xs transition-all duration-200 group-hover:-rotate-6">
              <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />
            </span>
            <span className="text-sm sm:text-base font-extrabold tracking-tight">
              School<span className="theme-header-subtext">aria</span>
            </span>
          </motion.button>

          {workspaces.length > 1 ? (
            <div className="flex items-center gap-1.5 min-w-0 max-w-[165px] sm:max-w-[230px]">
              <Building2 className="w-3.5 h-3.5 shrink-0 hidden sm:block theme-header-subtext" />
              <select
                aria-label="Basculer d'établissement ou de rôle"
                value={activeWorkspace?.key ?? ''}
                onChange={(e) => handleSelectWorkspace(e.target.value)}
                className="w-full min-w-0 truncate px-2.5 py-1.5 rounded-full bg-white/95 border border-zinc-300 text-zinc-900 text-[11px] font-bold outline-none shadow-xs"
              >
                {workspaces.map((ws) => {
                  const roleTag = ws.studentLocked
                    ? `${ROLE_SHORT_LABELS[ws.role]} (bloqué)`
                    : ROLE_SHORT_LABELS[ws.role];
                  return (
                    <option key={ws.key} value={ws.key}>
                      {ws.school.schoolName} · {roleTag}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full theme-header-chip border text-[11px] font-semibold max-w-[200px] truncate">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{school.schoolName}</span>
            </span>
          )}
        </div>

        {/* Expressive Gliding Capsule Navigation */}
        <nav className="hidden lg:flex items-center gap-1 text-sm font-medium theme-header-chip border rounded-full p-1">
          {visibleNavItems.slice(0, 5).map((item) => {
            const isActive =
              activeTab === item.id || (activeTab === 'classdetail' && item.id === 'makelist');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`relative whitespace-nowrap shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
                  isActive ? 'text-[var(--theme-nav-active-fg)] font-bold' : 'theme-nav-inactive'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="top-nav-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 33 }}
                    className="absolute inset-0 rounded-full bg-[var(--theme-nav-active-bg)] shadow-sm"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
                {item.badge ? (
                  <span
                    className={`relative z-10 px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono-nums ${
                      isActive ? 'theme-btn-primary' : 'theme-nav-active'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {canChangeSchoolThemeForRole(effectiveRole) && (
            <div className="hidden xl:block">
              <UniformThemePicker
                variant="header"
                value={activeSchoolTheme}
                disabled={savingTheme}
                onChange={(nextTheme) => void handleQuickThemeChange(nextTheme)}
              />
            </div>
          )}
          {!isCompiledShell() && (
            <div className="hidden sm:block">
              <PWAInstallButton variant="header" />
            </div>
          )}
          <button
            type="button"
            onClick={() => setNotifPanelOpen((v) => !v)}
            aria-expanded={notifPanelOpen}
            aria-label="Notifications rapides"
            title="Notifications"
            className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${
              notifPanelOpen
                ? 'theme-nav-active shadow-md'
                : 'theme-header-chip'
            }`}
          >
            <Bell className="w-4 h-4" />
            {unreadNotifsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold font-mono-nums flex items-center justify-center shadow-xs">
                {unreadNotifsCount > 99 ? '99+' : unreadNotifsCount}
              </span>
            )}
          </button>
          <GoogleAppsLauncher
            items={visibleNavItems}
            activeTab={activeTab}
            onSelect={handleNavigate}
          />
          {canManageStudents(effectiveRole) ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleNavigate('inscription')}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              <span className="sm:hidden">+ Élève</span>
              <span className="hidden sm:inline">+ Inscrire un élève</span>
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleNavigate('messages')}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full theme-nav-active text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              Messagerie
            </motion.button>
          )}
        </div>

        <ExpressiveNavSweep routeKey={currentRouteKey} />
      </header>

      {notifPanelOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              onClick={() => setNotifPanelOpen(false)}
              className="fixed inset-0 z-40 bg-black/25 sm:bg-transparent"
              aria-hidden="true"
            />
            <div className="fixed top-[4.25rem] left-3 right-3 sm:left-auto sm:right-6 sm:w-[380px] max-h-[78dvh] flex flex-col rounded-3xl bg-white/98 backdrop-blur-xl border theme-border-soft shadow-2xl z-50 text-zinc-900 overflow-hidden">
              <div className="px-4 py-3 border-b theme-border-soft flex items-center justify-between gap-2 theme-pill-soft">
                <div>
                  <p className="text-xs font-extrabold theme-text-ink">Notifications</p>
                  <p className="text-[11px] theme-text-accent">
                    {unreadNotifsCount > 0
                      ? `${unreadNotifsCount} non lue${unreadNotifsCount > 1 ? 's' : ''}`
                      : 'Tout est à jour'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {unreadNotifsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        void markAllNotificationsRead(
                          visibleNotifications.filter((n) => !n.read).map((n) => n.id)
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg theme-btn-primary text-[11px] font-bold"
                    >
                      Tout lu
                    </button>
                  )}
                  {visibleNotifications.some((n) => n.read) && (
                    <button
                      type="button"
                      onClick={() => {
                        void cleanupNotificationsBulk(
                          visibleNotifications.filter((n) => n.read),
                          actorEmail,
                          effectiveRole
                        );
                      }}
                      className="px-2 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] font-bold text-zinc-700"
                    >
                      Nettoyer lues
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotifPanelOpen(false)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100"
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto divide-y divide-zinc-100 flex-1">
                {visibleNotifications.length === 0 ? (
                  <p className="p-6 text-center text-xs text-zinc-500">Aucune notification pour le moment.</p>
                ) : (
                  [...visibleNotifications]
                    .sort((a, b) => b.id.localeCompare(a.id))
                    .slice(0, 6)
                    .map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 flex items-start gap-2.5 text-xs ${!n.read ? 'bg-zinc-50/80' : ''}`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            n.type === 'grade'
                              ? 'bg-emerald-100 text-emerald-700'
                              : n.type === 'absence'
                              ? 'bg-amber-100 text-amber-700'
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
                            <div className="flex items-center gap-1 shrink-0">
                              {!n.read && (
                                <button
                                  type="button"
                                  onClick={() => void markNotificationRead(n.id)}
                                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-zinc-900 text-white text-[10px] font-bold"
                                >
                                  <Check className="w-3 h-3" />
                                  Vu
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  void dismissOrDeleteNotification(n, actorEmail, effectiveRole)
                                }
                                title="Supprimer"
                                className="p-1 rounded-md text-zinc-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-zinc-600 mt-0.5 line-clamp-2 break-words">
                            {n.message}
                          </p>
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className="p-2.5 border-t theme-border-soft bg-zinc-50/70">
                <button
                  type="button"
                  onClick={() => {
                    setNotifPanelOpen(false);
                    handleNavigate('notifications');
                  }}
                  className="w-full py-2 rounded-xl theme-btn-primary text-xs font-bold transition-colors"
                >
                  Ouvrir le centre de notifications ({visibleNotifications.length})
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

      <div className="flex-1 flex max-w-[1440px] w-full mx-auto relative z-10">
        {/* Desktop Sidebar — Dynamic School Uniform Theme */}
        <aside className="no-print hidden lg:flex w-64 shrink-0 border-r theme-surface-header p-4 flex-col justify-between">
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
                className="no-print lg:hidden fixed inset-0 top-16 z-30 bg-black/50 backdrop-blur-xs"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                className="no-print lg:hidden fixed inset-y-16 bottom-0 left-0 z-40 w-72 overflow-y-auto border-r theme-surface-header p-4 flex flex-col justify-between shadow-2xl"
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

          {yearSuccessBanner && (
            <div className="no-print mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
              <span>{yearSuccessBanner}</span>
              <button
                type="button"
                onClick={() => setYearSuccessBanner(null)}
                className="text-emerald-700 font-bold hover:underline shrink-0"
              >
                Fermer
              </button>
            </div>
          )}

          {endOfYearAlert && (
            <div className="no-print mb-5 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CalendarClock className="w-5 h-5 text-amber-700 shrink-0" />
                <div>
                  <p className="font-bold">
                    {endOfYearAlert.diffDays <= 0
                      ? `Date de fin d'année scolaire atteinte (${endOfYearAlert.dateStr})`
                      : `Fin d'année scolaire proche : ${endOfYearAlert.dateStr} (J-${endOfYearAlert.diffDays})`}
                  </p>
                  <p className="text-amber-800 mt-0.5">
                    Archivez l'année {school.academicYear} et lancez la promotion automatique par classe.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setYearModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold whitespace-nowrap shrink-0"
              >
                Passer à une nouvelle année
              </button>
            </div>
          )}

          <SpatialViewStage routeKey={currentRouteKey} direction={navDirection}>
              {activeTab === 'hub' && (
                <PersonalizedDashboard
                  effectiveRole={effectiveRole}
                  actorEmail={actorEmail}
                  activeMembership={activeMembership}
                  school={school}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  subjects={subjects}
                  grades={grades}
                  remarks={remarks}
                  messages={messages}
                  notifications={visibleNotifications}
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

              {activeTab === 'inscription' && canAccessTab(effectiveRole, 'inscription') && canManageStudents(effectiveRole) && (
                <InscriptionView
                  uid={ownerUid}
                  schoolId={school.id}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'makelist' && canAccessTab(effectiveRole, 'makelist') && (
                <MakeListView
                  uid={ownerUid}
                  schoolId={school.id}
                  canManageClasses={canManageClasses(effectiveRole)}
                  canOpenClassDetail={canAccessTab(effectiveRole, 'classdetail')}
                  classrooms={effectiveRole === 'teacher' ? scopedClassrooms : uiClassrooms}
                  students={scopedStudents}
                  subjects={subjects}
                  grades={grades}
                  memberships={memberships}
                  schoolMemberEmails={school.memberEmails ?? []}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'classdetail' && canAccessTab(effectiveRole, 'classdetail') && (
                <ClassRosterView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  actorRole={effectiveRole}
                  canManageSchool={canManageSubjects(effectiveRole)}
                  canManageClasses={canManageClasses(effectiveRole)}
                  canScanEnrollments={canManageStudents(effectiveRole)}
                  canEditGrades={canEditGrades(effectiveRole)}
                  school={school}
                  classe={selectedClass}
                  classroom={uiClassrooms.find((c) => c.name === selectedClass)}
                  classrooms={uiClassrooms}
                  students={effectiveRole === 'teacher' ? scopedStudents : uiStudents}
                  subjects={subjects}
                  grades={grades}
                  memberships={memberships}
                  onBack={() => handleNavigate('makelist')}
                  onOpenBulletin={handleOpenBulletin}
                />
              )}

              {activeTab === 'bulletins' && canAccessTab(effectiveRole, 'bulletins') && (
                <BulletinView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  actorRole={effectiveRole}
                  readOnly={!canEditBulletinsForRole(effectiveRole)}
                  allowBatchPrint={canBatchPrintBulletinsForRole(effectiveRole)}
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

              {activeTab === 'stats' && canAccessTab(effectiveRole, 'stats') && (
                <StatisticsView
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  subjects={subjects}
                  grades={grades}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'messages' && canAccessTab(effectiveRole, 'messages') && (
                <MessagingView
                  ownerUid={ownerUid}
                  actorUid={user.uid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  actualRole={actualRole}
                  effectiveRole={effectiveRole}
                  school={school}
                  students={scopedStudents}
                  memberships={memberships}
                  messages={messages}
                />
              )}

              {activeTab === 'notifications' && canAccessTab(effectiveRole, 'notifications') && (
                <NotificationsCenterView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  effectiveRole={effectiveRole}
                  school={school}
                  classrooms={uiClassrooms}
                  students={scopedStudents}
                  memberships={memberships}
                  notifications={visibleNotifications}
                />
              )}

              {activeTab === 'roles' && canAccessTab(effectiveRole, 'roles') && (
                <RoleManagementView
                  uid={ownerUid}
                  schoolId={school.id}
                  canAssignLeadership={canManageLeadershipForRole(effectiveRole)}
                  canAssignSecretaire={canManageSecretaireForRole(effectiveRole)}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  memberships={memberships}
                />
              )}

              {activeTab === 'archives' && canAccessTab(effectiveRole, 'archives') && (
                <ArchivesView
                  schoolName={school.schoolName}
                  archives={archives}
                  onBack={() => handleNavigate('hub')}
                />
              )}

              {activeTab === 'audit' && canAccessTab(effectiveRole, 'audit') && (
                <AuditLogsView school={school} auditLogs={auditLogs} />
              )}

              {activeTab === 'assistant' && canAccessTab(effectiveRole, 'assistant') && (
                <AiAssistantView
                  school={school}
                  students={scopedStudents}
                  grades={grades}
                />
              )}

              {activeTab === 'settings' && canAccessTab(effectiveRole, 'settings') && (
                <SchoolSetupForm
                  key={`${school.id}_${school.theme || 'violet'}`}
                  isEdit
                  isOwner={canManageYearLifecycleForRole(effectiveRole) && school.ownerId === user.uid}
                  defaultAdminName={school.adminName}
                  initialValues={{
                    schoolName: school.schoolName,
                    adminName: school.adminName,
                    academicYear: school.academicYear,
                    endOfYearDate: school.endOfYearDate ?? '',
                    motto: school.motto,
                    phone: school.phone,
                    email: school.email,
                    address: school.address,
                    city: school.city,
                    registrationCode: school.registrationCode,
                    theme: activeSchoolTheme,
                  }}
                  onExportBackup={handleExportLocalBackup}
                  onOpenYearTransition={() => setYearModalOpen(true)}
                  onOpenArchives={() => handleNavigate('archives')}
                  onDeleteSchool={async () => {
                    if (school.ownerId !== user.uid) {
                      throw new Error('Seul le Proviseur propriétaire peut supprimer cet établissement.');
                    }
                    await deleteSchoolCascade(ownerUid, school.id, school.schoolName);
                    setActiveWorkspaceKey(null);
                    setActiveTab('hub');
                  }}
                  onCancel={() => handleNavigate('hub')}
                  onSubmit={async (values) => {
                    await saveSchoolProfile(ownerUid, values, false, school.id);
                    if (values.theme) {
                      savePreviewTheme(values.theme);
                      applySchoolThemeToDocument(values.theme);
                    }
                    handleNavigate('hub');
                  }}
                />
              )}
          </SpatialViewStage>
        </main>
      </div>

      {canManageYearLifecycleForRole(effectiveRole) && (
        <AcademicYearModal
          open={yearModalOpen}
          uid={ownerUid}
          actorEmail={actorEmail}
          actorName={actorName}
          school={school}
          classrooms={uiClassrooms}
          students={uiStudents}
          subjects={subjects}
          grades={grades}
          onClose={() => setYearModalOpen(false)}
          onSuccess={(summaryText) => {
            setYearModalOpen(false);
            setYearSuccessBanner(summaryText);
            handleNavigate('archives');
          }}
        />
      )}
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
