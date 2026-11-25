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
} from 'lucide-react';
import {
  auth,
  isCompiledShell,
  processAuthRedirectResult,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase.ts';
import {
  deleteSchoolCascade,
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
} from './lib/schoolService.ts';
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
  isSchoolWideStaffRole,
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
  const [showSplash, setShowSplash] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [verifiedVersion, setVerifiedVersion] = useState(0);

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
        setArchives([]);
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

  // Step 1: Discover all establishments & roles ONLY when email is verified
  useEffect(() => {
    if (!user || !user.emailVerified) return;
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
  }, [user, user?.emailVerified, verifiedVersion]);

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

  // Step 2: Subscribe strictly to the active workspace's resources (blocked if studentLocked or unverified)
  useEffect(() => {
    if (!user || !user.emailVerified || !activeWorkspace) return;
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
  }, [user, user?.emailVerified, verifiedVersion, activeWorkspace?.key, activeWorkspace?.studentLocked]);

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
      const matching = uiClassrooms.filter(
        (c) => assigned.includes(c.name) || isTeacherTitulaire(c, teacherMem)
      );
      if (matching.length > 0) {
        return matching;
      }
      return isPreview ? uiClassrooms.slice(0, 4) : [];
    }
    return uiClassrooms;
  }, [effectiveRole, isPreview, activeMembership, memberships, uiClassrooms]);

  const scopedStudents = useMemo(() => {
    if (effectiveRole === 'parent') {
      return filterChildrenForParent({
        students: uiStudents,
        activeMembership,
        memberships,
        parentEmail: user?.email,
        isPreview,
      });
    }
    if (effectiveRole === 'teacher') {
      const assigned = scopedClassrooms.map((c) => c.name);
      return uiStudents.filter((s) => assigned.includes(s.classe));
    }
    return uiStudents;
  }, [effectiveRole, isPreview, activeMembership, memberships, user?.email, uiStudents, scopedClassrooms]);

  const activeMotif: ClassroomMotif = useMemo(() => {
    if (activeTab === 'classdetail') {
      const clsObj = classrooms.find((c) => c.name === selectedClass);
      return getClassroomTheme(selectedClass, clsObj).motif;
    }
    return 'general';
  }, [activeTab, classrooms, selectedClass]);

  const endOfYearAlert = useMemo(() => {
    if (actualRole !== 'admin' || isPreview || !school?.endOfYearDate) return null;
    const target = new Date(`${school.endOfYearDate}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;
    const diffDays = Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 14) {
      return { diffDays, dateStr: school.endOfYearDate };
    }
    return null;
  }, [actualRole, isPreview, school?.endOfYearDate]);

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

  if (!user || !user.emailVerified) {
    return (
      <div className="relative min-h-screen">
        <FloatingAcademicBackdrop />
        <AuthGate
          pendingVerificationUser={user && !user.emailVerified ? user : null}
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
            setPreviewRole(null);
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
        <div className="relative z-10 max-w-lg w-full bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xl">
          <div className="bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white text-violet-900 flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white">Aucun établissement rattaché</h1>
              <p className="text-xs text-violet-200 break-all">{user.email}</p>
            </div>
          </div>

          <div className="p-6 sm:p-7 space-y-4">
            <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 text-xs sm:text-sm text-violet-950 leading-relaxed space-y-2">
              <p className="font-bold">Vous êtes parent d’élève ou membre du personnel ?</p>
              <p className="text-zinc-700 text-xs leading-relaxed">
                Demandez au secrétariat de votre établissement d’enregistrer exactement cette adresse e-mail (
                <strong className="text-violet-900">{user.email}</strong>) sur la fiche de votre enfant ou dans{' '}
                <em>Rôles & Direction</em>, puis cliquez sur <strong>Actualiser mon accès</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setVerifiedVersion((v) => v + 1)}
                className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-bold transition-colors"
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

            <div className="pt-4 border-t border-violet-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs text-zinc-600">
                Vous êtes Directeur et créez une nouvelle école ?
              </span>
              <button
                type="button"
                onClick={() => setCreatingOwnSchool(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-100 hover:bg-violet-200 text-violet-900 text-xs font-bold transition-colors shrink-0"
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
            Votre adresse e-mail (<strong>{user.email}</strong>) figure dans le registre des élèves de{' '}
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
              Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cleanActorEmail = actorEmail.trim().toLowerCase();
  const unreadMessagesCount = messages.filter(
    (m) => !m.read && m.senderEmail.trim().toLowerCase() !== cleanActorEmail
  ).length;
  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  const allNavItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof LayoutGrid;
    roles: UserRole[];
    badge?: number;
  }> = [
    { id: 'hub', label: 'Tableau de bord', icon: LayoutGrid, roles: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'] },
    { id: 'inscription', label: 'Inscription', icon: UserPlus, roles: ['admin', 'censeur', 'secretaire'] },
    {
      id: 'makelist',
      label:
        effectiveRole === 'teacher'
          ? 'Mes Classes & Notes'
          : effectiveRole === 'secretaire'
          ? 'Classes & Listes'
          : 'Classes & Notes',
      icon: ClipboardList,
      roles: ['admin', 'censeur', 'secretaire', 'teacher'],
    },
    { id: 'bulletins', label: 'Bulletins & Suivi', icon: FileSpreadsheet, roles: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'] },
    { id: 'stats', label: 'Statistiques', icon: BarChart3, roles: ['admin', 'censeur', 'secretaire'] },
    {
      id: 'messages',
      label: 'Messagerie',
      icon: MessageSquare,
      roles: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
      badge: unreadMessagesCount,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      roles: ['admin', 'censeur', 'secretaire', 'teacher', 'parent'],
      badge: unreadNotifsCount,
    },
    {
      id: 'roles',
      label: effectiveRole === 'admin' ? 'Rôles & Direction' : 'Profs & Parents',
      icon: Shield,
      roles: ['admin', 'censeur'],
    },
    { id: 'archives', label: 'Archives', icon: Archive, roles: ['admin', 'censeur', 'secretaire'] },
    { id: 'audit', label: 'Journaux & Sécurité', icon: ShieldCheck, roles: ['admin'] },
    { id: 'assistant', label: 'Yasmine (IA)', icon: Bot, roles: ['admin', 'censeur', 'teacher'] },
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
              {ROLE_SHORT_LABELS[actualRole]}
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

        {/* Admin Role Preview Switcher with Google Material gliding pill (5 roles) */}
        {actualRole === 'admin' && (
          <div className="mb-3 p-2 rounded-2xl bg-violet-900/75 border border-violet-700/70">
            <p className="text-[10px] font-bold text-violet-200 uppercase tracking-wider px-1 mb-1.5">
              Vue du tableau de bord
            </p>
            <div className="grid grid-cols-5 gap-1">
              {(
                [
                  { id: 'admin', label: 'Dir.' },
                  { id: 'censeur', label: 'Cens.' },
                  { id: 'secretaire', label: 'Secr.' },
                  { id: 'teacher', label: 'Prof' },
                  { id: 'parent', label: 'Par.' },
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
                    className={`relative py-1.5 rounded-xl text-[10px] font-bold transition-colors ${
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
    <div className="min-h-screen text-[#1e1038] flex flex-col relative overflow-x-clip">
      <OfflineIndicator />
      <FloatingAcademicBackdrop motif={activeMotif} />

      {/* Top Bar — Google Material Expressive Royal Violet & Crisp White */}
      <header className="no-print sticky top-0 z-30 bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white border-b border-violet-700/80 shadow-md px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4 max-w-full">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-full text-violet-100 hover:bg-white/15 shrink-0"
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
            <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl group-hover:rounded-2xl bg-white text-violet-900 flex items-center justify-center shadow-xs transition-all duration-200 group-hover:-rotate-6">
              <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />
            </span>
            <span className="text-sm sm:text-base font-extrabold tracking-tight text-white">
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

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
                ? 'bg-white text-violet-900 border-white shadow-md'
                : 'bg-white/12 hover:bg-white/22 text-white border-white/20'
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
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
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
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white hover:bg-violet-100 text-violet-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 shadow-xs"
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
              className="fixed inset-0 z-40 bg-violet-950/25 sm:bg-transparent"
              aria-hidden="true"
            />
            <div className="fixed top-[4.25rem] left-3 right-3 sm:left-auto sm:right-6 sm:w-[380px] max-h-[78dvh] flex flex-col rounded-3xl bg-white/98 backdrop-blur-xl border border-violet-200 shadow-2xl shadow-violet-950/25 z-50 text-zinc-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-violet-100 flex items-center justify-between gap-2 bg-violet-50/70">
                <div>
                  <p className="text-xs font-extrabold text-violet-950">Notifications</p>
                  <p className="text-[11px] text-violet-700">
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
                          notifications.filter((n) => !n.read).map((n) => n.id)
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-bold"
                    >
                      Tout lu
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotifPanelOpen(false)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-violet-100"
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto divide-y divide-zinc-100 flex-1">
                {notifications.length === 0 ? (
                  <p className="p-6 text-center text-xs text-zinc-500">Aucune notification pour le moment.</p>
                ) : (
                  [...notifications]
                    .sort((a, b) => b.id.localeCompare(a.id))
                    .slice(0, 6)
                    .map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 flex items-start gap-2.5 text-xs ${!n.read ? 'bg-violet-50/50' : ''}`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            n.type === 'grade'
                              ? 'bg-emerald-100 text-emerald-700'
                              : n.type === 'absence'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-violet-100 text-violet-700'
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
                            {!n.read && (
                              <button
                                type="button"
                                onClick={() => void markNotificationRead(n.id)}
                                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-zinc-900 text-white text-[10px] font-bold shrink-0"
                              >
                                <Check className="w-3 h-3" />
                                Vu
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-600 mt-0.5 line-clamp-2 break-words">
                            {n.message}
                          </p>
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className="p-2.5 border-t border-violet-100 bg-violet-50/50">
                <button
                  type="button"
                  onClick={() => {
                    setNotifPanelOpen(false);
                    handleNavigate('notifications');
                  }}
                  className="w-full py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-bold transition-colors"
                >
                  Ouvrir le centre de notifications ({notifications.length})
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

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
                  isPreview={isPreview}
                  actorEmail={actorEmail}
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

              {activeTab === 'inscription' && canManageStudents(effectiveRole) && (
                <InscriptionView
                  uid={ownerUid}
                  schoolId={school.id}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'makelist' && (isSchoolWideStaffRole(effectiveRole) || effectiveRole === 'teacher') && (
                <MakeListView
                  uid={ownerUid}
                  schoolId={school.id}
                  canManageClasses={canManageClasses(effectiveRole)}
                  classrooms={effectiveRole === 'teacher' ? scopedClassrooms : uiClassrooms}
                  students={scopedStudents}
                  grades={grades}
                  memberships={memberships}
                  onBack={() => handleNavigate('hub')}
                  onSelectClass={handleOpenClass}
                />
              )}

              {activeTab === 'classdetail' && (isSchoolWideStaffRole(effectiveRole) || effectiveRole === 'teacher') && (
                <ClassRosterView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  canManageSchool={canManageSubjects(effectiveRole)}
                  canManageClasses={canManageClasses(effectiveRole)}
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

              {activeTab === 'bulletins' && (
                <BulletinView
                  ownerUid={ownerUid}
                  actorEmail={actorEmail}
                  actorName={actorName}
                  readOnly={!canEditGrades(effectiveRole)}
                  allowBatchPrint={effectiveRole !== 'parent'}
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

              {activeTab === 'stats' && (effectiveRole === 'admin' || effectiveRole === 'censeur' || effectiveRole === 'secretaire') && (
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
                  actualRole={actualRole}
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

              {activeTab === 'roles' && (effectiveRole === 'admin' || effectiveRole === 'censeur') && (
                <RoleManagementView
                  uid={ownerUid}
                  schoolId={school.id}
                  canAssignLeadership={effectiveRole === 'admin'}
                  classrooms={uiClassrooms}
                  students={uiStudents}
                  memberships={memberships}
                />
              )}

              {activeTab === 'archives' && (effectiveRole === 'admin' || effectiveRole === 'censeur' || effectiveRole === 'secretaire') && (
                <ArchivesView
                  schoolName={school.schoolName}
                  archives={archives}
                  onBack={() => handleNavigate('hub')}
                />
              )}

              {activeTab === 'audit' && effectiveRole === 'admin' && (
                <AuditLogsView school={school} auditLogs={auditLogs} />
              )}

              {activeTab === 'assistant' && (effectiveRole === 'admin' || effectiveRole === 'censeur' || effectiveRole === 'teacher') && (
                <AiAssistantView
                  school={school}
                  students={scopedStudents}
                  grades={grades}
                />
              )}

              {activeTab === 'settings' && effectiveRole === 'admin' && (
                <SchoolSetupForm
                  key={school.id}
                  isEdit
                  isOwner={actualRole === 'admin' && !isPreview}
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
                  }}
                  onExportBackup={handleExportLocalBackup}
                  onOpenYearTransition={() => setYearModalOpen(true)}
                  onOpenArchives={() => handleNavigate('archives')}
                  onDeleteSchool={async () => {
                    await deleteSchoolCascade(ownerUid, school.id, school.schoolName);
                    setActiveWorkspaceKey(null);
                    setPreviewRole(null);
                    setActiveTab('hub');
                  }}
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

      {actualRole === 'admin' && (
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
