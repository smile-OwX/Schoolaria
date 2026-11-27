import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  query,
  where,
  onSnapshot,
  Unsubscribe,
  getDocs,
  getDoc,
  Timestamp,
  arrayUnion,
} from 'firebase/firestore';
import { auth, awaitWithOfflineQueue, db, handleFirestoreError, OperationType } from './firebase.ts';
import { formatAuthIdentifierForDisplay, resolveIdentifierToAuthEmail } from './phoneAuth.ts';
import { DEFAULT_SCHOOL_THEME, normalizeSchoolTheme, SchoolUniformTheme } from './schoolTheme.ts';
import { canNotifyParentsForRole } from './rolePermissions.ts';
import {
  ALL_CLASSES,
  AcademicArchive,
  AuditLogCategory,
  AuditLogEntry,
  AuditLogSeverity,
  BulletinRemark,
  Classroom,
  ClassroomMotif,
  CycleType,
  DEFAULT_SUBJECTS_BY_CYCLE,
  GradeRecord,
  Membership,
  MembershipRole,
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  StudentArchiveSummary,
  StudentLock,
  Subject,
  UserRole,
  WorkspaceOption,
  getCycleForClass,
  getEffectiveSubjectsForClass,
  getISOWeekKey,
  getPeriodShortLabel,
  isNotificationVisibleForUser,
  normalizeSubjectKey,
} from '../types/school.ts';

interface AuditActorContext {
  ownerId: string;
  schoolId: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: UserRole;
}

let activeAuditContext: AuditActorContext | null = null;
const activeManagementEmailsBySchool = new Map<string, string[]>();
const activeCenseurEmailsBySchool = new Map<string, string[]>();

export function setAuditActorContext(ctx: AuditActorContext | null): void {
  activeAuditContext = ctx;
}

function getSchoolManagementEmails(schoolId: string, extraEmail?: string): string[] {
  const existing = activeManagementEmailsBySchool.get(schoolId) ?? [];
  const list = extraEmail ? [...existing, extraEmail] : existing;
  return Array.from(new Set(list.map((e) => normalizeEmail(e)).filter(Boolean))).slice(0, 20);
}

function setSchoolManagementEmails(schoolId: string, emails: string[]): string[] {
  const clean = Array.from(new Set(emails.map((e) => normalizeEmail(e)).filter(Boolean))).slice(0, 20);
  activeManagementEmailsBySchool.set(schoolId, clean);
  return clean;
}

function getSchoolCenseurEmails(schoolId: string): string[] {
  const existing = activeCenseurEmailsBySchool.get(schoolId) ?? [];
  return Array.from(new Set(existing.map((e) => normalizeEmail(e)).filter(Boolean))).slice(0, 20);
}

function setSchoolCenseurEmails(schoolId: string, emails: string[]): string[] {
  const clean = Array.from(new Set(emails.map((e) => normalizeEmail(e)).filter(Boolean))).slice(0, 20);
  activeCenseurEmailsBySchool.set(schoolId, clean);
  return clean;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

export function normalizeEmail(raw?: string | null): string {
  const clean = (raw ?? '').trim();
  if (!clean) return '';
  const resolved = resolveIdentifierToAuthEmail(clean);
  return (resolved.authEmail || clean.toLowerCase()).slice(0, 120);
}

export function safeEmailKey(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9_-]/g, '_');
}

export function membershipDocId(schoolId: string, role: MembershipRole, email: string): string {
  return `mem_${schoolId}_${role}_${safeEmailKey(email)}`.slice(0, 250);
}

export function studentLockDocId(schoolId: string, email: string): string {
  return `stulock_${schoolId}_${safeEmailKey(email)}`.slice(0, 250);
}

function dedupeById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

export interface WorkspaceDiscoveryCallbacks {
  onWorkspaces: (workspaces: WorkspaceOption[], loading: boolean) => void;
  onError: (err: Error) => void;
}

export interface WorkspaceCallbacks {
  onRoleResolved: (role: UserRole, activeMembership: Membership | null) => void;
  onSchool: (school: SchoolProfile | null) => void;
  onClassrooms: (classrooms: Classroom[]) => void;
  onClassroomsLoaded?: () => void;
  onMemberships: (memberships: Membership[]) => void;
  onStudents: (students: Student[]) => void;
  onSubjects: (subjects: Subject[]) => void;
  onGrades: (grades: GradeRecord[]) => void;
  onRemarks: (remarks: BulletinRemark[]) => void;
  onMessages: (messages: MessageItem[]) => void;
  onNotifications: (notifications: NotificationItem[]) => void;
  onAuditLogs?: (logs: AuditLogEntry[]) => void;
  onArchives?: (archives: AcademicArchive[]) => void;
  onError: (err: Error) => void;
}

/**
 * Multi-school & multi-role discovery:
 * Finds all schools owned by uid, all schools where user is teacher/parent (even >100 parents),
 * and checks studentLocks to prevent a student email from accessing a school as a teacher.
 */
export function subscribeWorkspaceDiscovery(
  uid: string,
  userEmail: string,
  callbacks: WorkspaceDiscoveryCallbacks
): Unsubscribe[] {
  const unsubs: Unsubscribe[] = [];
  const cleanEmail = normalizeEmail(userEmail);

  let ownedLoaded = false;
  let memberSchoolsLoaded = !cleanEmail;
  let membershipsLoaded = !cleanEmail;
  let locksLoaded = !cleanEmail;

  let ownedSchools: SchoolProfile[] = [];
  let memberArraySchools: SchoolProfile[] = [];
  let selfMemberships: Membership[] = [];
  let parentLinkedStudents: Student[] = [];
  let selfLocks: StudentLock[] = [];

  const fetchedSchoolsById = new Map<string, SchoolProfile>();
  const schoolDocUnsubs = new Map<string, Unsubscribe>();
  const pendingSchoolFetches = new Set<string>();

  const emitWorkspaces = () => {
    const byId = new Map<string, SchoolProfile>();
    for (const s of ownedSchools) byId.set(s.id, s);
    for (const s of memberArraySchools) byId.set(s.id, s);
    for (const [id, s] of fetchedSchoolsById.entries()) byId.set(id, s);

    const lockedSchoolIds = new Set(selfLocks.map((l) => l.schoolId));
    const options: WorkspaceOption[] = [];
    const seenKeys = new Set<string>();

    // 1. Owned schools (admin)
    for (const sch of ownedSchools) {
      const key = `${sch.id}:admin`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      options.push({
        key,
        school: sch,
        role: 'admin',
        membership: null,
        studentLocked: false,
      });
    }

    // 2. Explicit memberships (teacher or parent)
    for (const mem of selfMemberships) {
      const sch = byId.get(mem.schoolId);
      if (!sch) continue;
      const key = `${sch.id}:${mem.role}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const isLockedAsStudent =
        (mem.role === 'teacher' || mem.role === 'censeur' || mem.role === 'secretaire') &&
        lockedSchoolIds.has(sch.id);
      options.push({
        key,
        school: sch,
        role: mem.role,
        membership: mem,
        studentLocked: isLockedAsStudent,
      });
    }

    // 3. Implicit parent links discovered via students.parentEmail (even if user also teaches or directs)
    for (const stu of parentLinkedStudents) {
      const sch = byId.get(stu.schoolId);
      if (!sch) continue;
      const key = `${sch.id}:parent`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      options.push({
        key,
        school: sch,
        role: 'parent',
        membership: null,
        studentLocked: false,
      });
    }

    // Sort: admin > censeur > secretaire > teacher > parent
    const roleOrder: Record<UserRole, number> = {
      admin: 0,
      censeur: 1,
      secretaire: 2,
      teacher: 3,
      parent: 4,
    };
    options.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.school.schoolName.localeCompare(b.school.schoolName));

    const stillLoading =
      !ownedLoaded ||
      !memberSchoolsLoaded ||
      !membershipsLoaded ||
      !locksLoaded ||
      pendingSchoolFetches.size > 0;

    callbacks.onWorkspaces(options, stillLoading);
  };

  const ensureSchoolSubscribed = (schoolId: string) => {
    if (!schoolId || schoolDocUnsubs.has(schoolId)) return;
    if (ownedSchools.some((s) => s.id === schoolId) || memberArraySchools.some((s) => s.id === schoolId)) {
      return;
    }
    pendingSchoolFetches.add(schoolId);
    const u = onSnapshot(
      doc(db, 'schools', schoolId),
      (snap) => {
        pendingSchoolFetches.delete(schoolId);
        if (snap.exists()) {
          fetchedSchoolsById.set(snap.id, {
            id: snap.id,
            ...(snap.data() as Omit<SchoolProfile, 'id'>),
          });
        } else {
          fetchedSchoolsById.delete(schoolId);
        }
        emitWorkspaces();
      },
      () => {
        pendingSchoolFetches.delete(schoolId);
        emitWorkspaces();
      }
    );
    schoolDocUnsubs.set(schoolId, u);
  };

  // Owned schools
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools'), where('ownerId', '==', uid)),
      (snap) => {
        ownedLoaded = true;
        ownedSchools = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SchoolProfile, 'id'>),
        }));
        emitWorkspaces();
      },
      (err) => {
        ownedLoaded = true;
        emitWorkspaces();
        try {
          handleFirestoreError(err, OperationType.LIST, 'schools');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          memberSchoolsLoaded = true;
          memberArraySchools = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SchoolProfile, 'id'>),
          }));
          emitWorkspaces();
        },
        (err) => {
          memberSchoolsLoaded = true;
          emitWorkspaces();
          try {
            handleFirestoreError(err, OperationType.LIST, 'schools');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'memberships'), where('memberEmail', '==', cleanEmail)),
        (snap) => {
          membershipsLoaded = true;
          selfMemberships = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Membership, 'id'>),
          }));
          selfMemberships.forEach((m) => ensureSchoolSubscribed(m.schoolId));
          emitWorkspaces();
        },
        (err) => {
          membershipsLoaded = true;
          emitWorkspaces();
          try {
            handleFirestoreError(err, OperationType.LIST, 'memberships');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'students'), where('parentEmail', '==', cleanEmail)),
        (snap) => {
          parentLinkedStudents = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Student, 'id'>),
          }));
          parentLinkedStudents.forEach((s) => ensureSchoolSubscribed(s.schoolId));
          emitWorkspaces();
        },
        () => {
          // Non-blocking secondary parent discovery
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'studentLocks'), where('studentEmail', '==', cleanEmail)),
        (snap) => {
          locksLoaded = true;
          selfLocks = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StudentLock, 'id'>),
          }));
          emitWorkspaces();
        },
        () => {
          locksLoaded = true;
          emitWorkspaces();
        }
      )
    );
  }

  unsubs.push(() => {
    schoolDocUnsubs.forEach((u) => u());
    schoolDocUnsubs.clear();
  });

  return unsubs;
}

/**
 * Subscribe strictly to the data of the active selected workspace (scoped by schoolId + role).
 */
export function subscribeSchoolResources(
  workspace: WorkspaceOption,
  uid: string,
  userEmail: string,
  callbacks: Omit<WorkspaceCallbacks, 'onRoleResolved' | 'onSchool'>
): Unsubscribe[] {
  const unsubs: Unsubscribe[] = [];
  const cleanEmail = normalizeEmail(userEmail);
  const targetSchoolId = workspace.school.id;
  const role = workspace.role;

  const bySchool = <T extends { schoolId: string }>(items: T[]): T[] =>
    items.filter((item) => item.schoolId === targetSchoolId);

  const isManagementStaff = role === 'censeur' || role === 'secretaire';
  setSchoolCenseurEmails(targetSchoolId, [
    ...(workspace.school.censeurEmails ?? []),
    ...(role === 'censeur' && cleanEmail ? [cleanEmail] : []),
  ]);
  if (isManagementStaff && cleanEmail) {
    setSchoolManagementEmails(targetSchoolId, [
      ...(activeManagementEmailsBySchool.get(targetSchoolId) ?? []),
      cleanEmail,
    ]);
  }

  // Memberships
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'memberships'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          const mems = bySchool(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Membership, 'id'>) }))
          );
          const mgmt = mems
            .filter((m) => m.role === 'censeur' || m.role === 'secretaire')
            .map((m) => m.memberEmail);
          const censeurs = mems
            .filter((m) => m.role === 'censeur')
            .map((m) => m.memberEmail);
          if (isManagementStaff && cleanEmail) mgmt.push(cleanEmail);
          if (role === 'censeur' && cleanEmail) censeurs.push(cleanEmail);
          setSchoolManagementEmails(targetSchoolId, mgmt);
          setSchoolCenseurEmails(targetSchoolId, censeurs);
          callbacks.onMemberships(mems);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'memberships');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'memberships'), where('memberEmail', '==', cleanEmail)),
        (snap) => {
          callbacks.onMemberships(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Membership, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'memberships');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else {
    callbacks.onMemberships([]);
  }

  // Classrooms
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'classrooms'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          callbacks.onClassrooms(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) })))
          );
          callbacks.onClassroomsLoaded?.();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'classrooms');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    let clsTeacher: Classroom[] = [];
    let clsMember: Classroom[] = [];
    const emitCls = () => {
      callbacks.onClassrooms(bySchool(dedupeById([clsTeacher, clsMember])));
      callbacks.onClassroomsLoaded?.();
    };
    unsubs.push(
      onSnapshot(
        query(collection(db, 'classrooms'), where('teacherEmails', 'array-contains', cleanEmail)),
        (snap) => {
          clsTeacher = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }));
          emitCls();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'classrooms');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'classrooms'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          clsMember = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }));
          emitCls();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'classrooms');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Students
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'students'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          callbacks.onStudents(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'students');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'students'),
          where(role === 'teacher' ? 'teacherEmails' : 'parentEmail', role === 'teacher' ? 'array-contains' : '==', cleanEmail)
        ),
        (snap) => {
          callbacks.onStudents(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'students');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Subjects
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'subjects'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          callbacks.onSubjects(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'subjects');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'subjects'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          callbacks.onSubjects(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'subjects');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Grades
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'grades'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          callbacks.onGrades(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeRecord, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'grades');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'grades'),
          where(role === 'teacher' ? 'teacherEmails' : 'parentEmail', role === 'teacher' ? 'array-contains' : '==', cleanEmail)
        ),
        (snap) => {
          callbacks.onGrades(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeRecord, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'grades');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Bulletin Remarks
  if (role === 'admin' || isManagementStaff) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'bulletinRemarks'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          callbacks.onRemarks(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BulletinRemark, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'bulletinRemarks');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'bulletinRemarks'),
          where(role === 'teacher' ? 'teacherEmails' : 'parentEmail', role === 'teacher' ? 'array-contains' : '==', cleanEmail)
        ),
        (snap) => {
          callbacks.onRemarks(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BulletinRemark, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'bulletinRemarks');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Messages
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'messages'), where('ownerId', '==', uid)),
        (snap) => {
          callbacks.onMessages(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'messages');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (cleanEmail) {
    let msgSent: MessageItem[] = [];
    let msgRecv: MessageItem[] = [];
    const emitMsg = () => callbacks.onMessages(bySchool(dedupeById([msgSent, msgRecv])));
    unsubs.push(
      onSnapshot(
        query(collection(db, 'messages'), where('senderEmail', '==', cleanEmail)),
        (snap) => {
          msgSent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) }));
          emitMsg();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'messages');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'messages'), where('recipientEmail', '==', cleanEmail)),
        (snap) => {
          msgRecv = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) }));
          emitMsg();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'messages');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Notifications (automatically filtered for expired or user-dismissed entries)
  const filterVisibleNotifs = (items: NotificationItem[]): NotificationItem[] =>
    bySchool(items).filter((n) => isNotificationVisibleForUser(n, cleanEmail));

  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('ownerId', '==', uid)),
        (snap) => {
          callbacks.onNotifications(
            filterVisibleNotifs(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
            )
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else if (role === 'censeur' && cleanEmail) {
    let notifMgmt: NotificationItem[] = [];
    let notifAudience: NotificationItem[] = [];
    let notifSent: NotificationItem[] = [];
    const emitCenseurNotifs = () =>
      callbacks.onNotifications(filterVisibleNotifs(dedupeById([notifMgmt, notifAudience, notifSent])));

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('managementEmails', 'array-contains', cleanEmail)),
        (snap) => {
          notifMgmt = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitCenseurNotifs();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      ),
      onSnapshot(
        query(collection(db, 'notifications'), where('audienceEmails', 'array-contains', cleanEmail)),
        (snap) => {
          notifAudience = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitCenseurNotifs();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      ),
      onSnapshot(
        query(collection(db, 'notifications'), where('createdByEmail', '==', cleanEmail)),
        (snap) => {
          notifSent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitCenseurNotifs();
        },
        () => {
          // Optional sender history
        }
      )
    );
  } else if (cleanEmail) {
    let notifAudience: NotificationItem[] = [];
    let notifSent: NotificationItem[] = [];
    const emitScopedNotifs = () =>
      callbacks.onNotifications(filterVisibleNotifs(dedupeById([notifAudience, notifSent])));

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('audienceEmails', 'array-contains', cleanEmail)),
        (snap) => {
          notifAudience = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitScopedNotifs();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      ),
      onSnapshot(
        query(collection(db, 'notifications'), where('createdByEmail', '==', cleanEmail)),
        (snap) => {
          notifSent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitScopedNotifs();
        },
        () => {
          // Optional sender history
        }
      )
    );
  } else {
    callbacks.onNotifications([]);
  }

  // Academic Archives (Direction / Censeur / Secrétaire)
  if ((role === 'admin' || isManagementStaff) && callbacks.onArchives) {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'academicArchives'),
          role === 'admin'
            ? where('ownerId', '==', uid)
            : where('managementEmails', 'array-contains', cleanEmail)
        ),
        (snap) => {
          const list = bySchool(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AcademicArchive, 'id'>) }))
          ).sort((a, b) => (b.closedAtIso || '').localeCompare(a.closedAtIso || ''));
          callbacks.onArchives?.(list);
        },
        () => {
          callbacks.onArchives?.([]);
        }
      )
    );
  } else {
    callbacks.onArchives?.([]);
  }

  // Audit Logs (owner-only)
  if (role === 'admin' && callbacks.onAuditLogs) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'auditLogs'), where('ownerId', '==', uid)),
        (snap) => {
          callbacks.onAuditLogs?.(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogEntry, 'id'>) })))
          );
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'auditLogs');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else {
    callbacks.onAuditLogs?.([]);
  }

  return unsubs;
}

export interface WorkspaceCallbacksLegacy extends WorkspaceCallbacks {}

export function subscribeWorkspaceData(
  uid: string,
  userEmail: string,
  callbacks: WorkspaceCallbacks
): Unsubscribe[] {
  const unsubs: Unsubscribe[] = [];
  const cleanEmail = normalizeEmail(userEmail);

  let ownedSchool: SchoolProfile | null | undefined = undefined;
  let memberSchool: SchoolProfile | null | undefined = undefined;
  let myMembership: Membership | null = null;

  const emitResolvedSchool = () => {
    if (ownedSchool) {
      callbacks.onRoleResolved('admin', null);
      callbacks.onSchool(ownedSchool);
    } else if (memberSchool && myMembership) {
      callbacks.onRoleResolved(myMembership.role, myMembership);
      callbacks.onSchool(memberSchool);
    } else if (ownedSchool === null && (memberSchool === null || !cleanEmail)) {
      callbacks.onRoleResolved('admin', null);
      callbacks.onSchool(null);
    } else if (ownedSchool === null && memberSchool && !myMembership) {
      callbacks.onRoleResolved('parent', null);
      callbacks.onSchool(memberSchool);
    }
  };

  // Schools: owned + member
  unsubs.push(
    onSnapshot(
      query(collection(db, 'schools'), where('ownerId', '==', uid)),
      (snap) => {
        ownedSchool = snap.empty
          ? null
          : { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<SchoolProfile, 'id'>) };
        emitResolvedSchool();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'schools');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'schools'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          memberSchool = snap.empty
            ? null
            : { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<SchoolProfile, 'id'>) };
          emitResolvedSchool();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'schools');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  } else {
    memberSchool = null;
  }

  // Memberships: owned + own membership
  let ownedMemberships: Membership[] = [];
  let selfMemberships: Membership[] = [];
  const emitMemberships = () => {
    const merged = dedupeById([ownedMemberships, selfMemberships]);
    myMembership = selfMemberships[0] ?? null;
    callbacks.onMemberships(merged);
    emitResolvedSchool();
  };

  unsubs.push(
    onSnapshot(
      query(collection(db, 'memberships'), where('ownerId', '==', uid)),
      (snap) => {
        ownedMemberships = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Membership, 'id'>),
        }));
        emitMemberships();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'memberships');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'memberships'), where('memberEmail', '==', cleanEmail)),
        (snap) => {
          selfMemberships = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Membership, 'id'>),
          }));
          emitMemberships();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'memberships');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Classrooms: owned + teacherEmails + memberEmails
  let clsOwned: Classroom[] = [];
  let clsTeacher: Classroom[] = [];
  let clsMember: Classroom[] = [];
  const emitClassrooms = () => callbacks.onClassrooms(dedupeById([clsOwned, clsTeacher, clsMember]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'classrooms'), where('ownerId', '==', uid)),
      (snap) => {
        clsOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }));
        emitClassrooms();
        callbacks.onClassroomsLoaded?.();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'classrooms');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'classrooms'), where('teacherEmails', 'array-contains', cleanEmail)),
        (snap) => {
          clsTeacher = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }));
          emitClassrooms();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'classrooms');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'classrooms'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          clsMember = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }));
          emitClassrooms();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'classrooms');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Students: owned + teacherEmails + parentEmail
  let stuOwned: Student[] = [];
  let stuTeacher: Student[] = [];
  let stuParent: Student[] = [];
  const emitStudents = () => callbacks.onStudents(dedupeById([stuOwned, stuTeacher, stuParent]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'students'), where('ownerId', '==', uid)),
      (snap) => {
        stuOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }));
        emitStudents();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'students');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'students'), where('teacherEmails', 'array-contains', cleanEmail)),
        (snap) => {
          stuTeacher = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }));
          emitStudents();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'students');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'students'), where('parentEmail', '==', cleanEmail)),
        (snap) => {
          stuParent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }));
          emitStudents();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'students');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Subjects: owned + memberEmails
  let subOwned: Subject[] = [];
  let subMember: Subject[] = [];
  const emitSubjects = () => callbacks.onSubjects(dedupeById([subOwned, subMember]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'subjects'), where('ownerId', '==', uid)),
      (snap) => {
        subOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) }));
        emitSubjects();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'subjects');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'subjects'), where('memberEmails', 'array-contains', cleanEmail)),
        (snap) => {
          subMember = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) }));
          emitSubjects();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'subjects');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Grades: owned + teacherEmails + parentEmail
  let grdOwned: GradeRecord[] = [];
  let grdTeacher: GradeRecord[] = [];
  let grdParent: GradeRecord[] = [];
  const emitGrades = () => callbacks.onGrades(dedupeById([grdOwned, grdTeacher, grdParent]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'grades'), where('ownerId', '==', uid)),
      (snap) => {
        grdOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeRecord, 'id'>) }));
        emitGrades();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'grades');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'grades'), where('teacherEmails', 'array-contains', cleanEmail)),
        (snap) => {
          grdTeacher = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeRecord, 'id'>) }));
          emitGrades();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'grades');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'grades'), where('parentEmail', '==', cleanEmail)),
        (snap) => {
          grdParent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeRecord, 'id'>) }));
          emitGrades();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'grades');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Remarks: owned + teacherEmails + parentEmail
  let rmkOwned: BulletinRemark[] = [];
  let rmkTeacher: BulletinRemark[] = [];
  let rmkParent: BulletinRemark[] = [];
  const emitRemarks = () => callbacks.onRemarks(dedupeById([rmkOwned, rmkTeacher, rmkParent]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'bulletinRemarks'), where('ownerId', '==', uid)),
      (snap) => {
        rmkOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BulletinRemark, 'id'>) }));
        emitRemarks();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'bulletinRemarks');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'bulletinRemarks'), where('teacherEmails', 'array-contains', cleanEmail)),
        (snap) => {
          rmkTeacher = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BulletinRemark, 'id'>) }));
          emitRemarks();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'bulletinRemarks');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'bulletinRemarks'), where('parentEmail', '==', cleanEmail)),
        (snap) => {
          rmkParent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BulletinRemark, 'id'>) }));
          emitRemarks();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'bulletinRemarks');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Messages: owned + senderEmail + recipientEmail
  let msgOwned: MessageItem[] = [];
  let msgSent: MessageItem[] = [];
  let msgRecv: MessageItem[] = [];
  const emitMessages = () => callbacks.onMessages(dedupeById([msgOwned, msgSent, msgRecv]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'messages'), where('ownerId', '==', uid)),
      (snap) => {
        msgOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) }));
        emitMessages();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'messages');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'messages'), where('senderEmail', '==', cleanEmail)),
        (snap) => {
          msgSent = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) }));
          emitMessages();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'messages');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'messages'), where('recipientEmail', '==', cleanEmail)),
        (snap) => {
          msgRecv = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MessageItem, 'id'>) }));
          emitMessages();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'messages');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Notifications: owned + audienceEmails
  let notifOwned: NotificationItem[] = [];
  let notifAudience: NotificationItem[] = [];
  const emitNotifs = () => callbacks.onNotifications(dedupeById([notifOwned, notifAudience]));

  unsubs.push(
    onSnapshot(
      query(collection(db, 'notifications'), where('ownerId', '==', uid)),
      (snap) => {
        notifOwned = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
        emitNotifs();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'notifications');
        } catch (e) {
          callbacks.onError(e as Error);
        }
      }
    )
  );

  if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('audienceEmails', 'array-contains', cleanEmail)),
        (snap) => {
          notifAudience = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }));
          emitNotifs();
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  // Audit Logs (owner-only read/list)
  if (callbacks.onAuditLogs) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'auditLogs'), where('ownerId', '==', uid)),
        (snap) => {
          const logs = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<AuditLogEntry, 'id'>),
          }));
          callbacks.onAuditLogs?.(logs);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'auditLogs');
          } catch (e) {
            callbacks.onError(e as Error);
          }
        }
      )
    );
  }

  return unsubs;
}

export async function recordAuditLog(input: {
  ownerId?: string;
  schoolId?: string;
  category: AuditLogCategory;
  severity: AuditLogSeverity;
  action: string;
  details: string;
  targetId?: string;
  actorRole?: UserRole;
  actorName?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  const ctx = activeAuditContext;
  const actorUid = currentUser?.uid || ctx?.actorUid;
  const actorEmail = normalizeEmail(currentUser?.email || ctx?.actorEmail);
  const ownerId = input.ownerId || ctx?.ownerId;
  const schoolId = input.schoolId || ctx?.schoolId;

  if (!actorUid || !actorEmail || !ownerId || !schoolId) return;

  const actorRole: UserRole =
    input.actorRole || ctx?.actorRole || (actorUid === ownerId ? 'admin' : 'teacher');
  const actorName = (
    input.actorName ||
    ctx?.actorName ||
    currentUser?.displayName ||
    actorEmail.split('@')[0] ||
    'Utilisateur'
  )
    .trim()
    .slice(0, 100);

  const weekKey = getISOWeekKey();
  const logId = sanitizeId(`log_${weekKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      ownerId,
      schoolId,
      weekKey,
      category: input.category,
      severity: input.severity,
      action: input.action.trim().slice(0, 100) || 'Action',
      details: input.details.trim().slice(0, 500) || 'Événement enregistré',
      actorUid,
      actorEmail,
      actorName,
      actorRole,
      targetId: input.targetId ? sanitizeId(input.targetId).slice(0, 128) : '',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write skipped:', err);
  }
}

export async function saveSchoolProfile(
  uid: string,
  payload: {
    schoolName: string;
    adminName: string;
    academicYear: string;
    endOfYearDate?: string;
    motto?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    registrationCode?: string;
    theme?: SchoolUniformTheme;
  },
  isNew: boolean,
  schoolIdOverride?: string
): Promise<string> {
  const schoolId = schoolIdOverride
    ? sanitizeId(schoolIdOverride)
    : isNew
    ? sanitizeId(`${uid}_sch_${Date.now().toString(36)}`)
    : sanitizeId(uid);
  // Preserve legacy single-school ID `sanitizeId(uid)` if user has no school yet so everything works identically
  const resolvedId =
    !schoolIdOverride && isNew
      ? await (async () => {
          const legacyRef = doc(db, 'schools', sanitizeId(uid));
          try {
            const snap = await getDoc(legacyRef);
            return snap.exists() ? sanitizeId(`${uid}_sch_${Date.now().toString(36)}`) : sanitizeId(uid);
          } catch {
            return sanitizeId(uid);
          }
        })()
      : schoolId;
  const ref = doc(db, 'schools', resolvedId);
  const ownerEmail = auth.currentUser?.uid === uid ? normalizeEmail(auth.currentUser?.email) : '';
  const cleanTheme = payload.theme ? normalizeSchoolTheme(payload.theme) : DEFAULT_SCHOOL_THEME;

  try {
    if (isNew) {
      await awaitWithOfflineQueue(
        setDoc(ref, {
          ownerId: uid,
          ownerEmail,
          schoolName: payload.schoolName.trim().slice(0, 120),
          adminName: payload.adminName.trim().slice(0, 100),
          academicYear: payload.academicYear.trim().slice(0, 20),
          endOfYearDate: (payload.endOfYearDate ?? '').trim().slice(0, 20),
          motto: (payload.motto ?? '').trim().slice(0, 160),
          phone: (payload.phone ?? '').trim().slice(0, 30),
          email: normalizeEmail(payload.email),
          address: (payload.address ?? '').trim().slice(0, 160),
          city: (payload.city ?? '').trim().slice(0, 80),
          registrationCode: (payload.registrationCode ?? '').trim().slice(0, 60),
          theme: cleanTheme,
          censeurEmails: [],
          censeurNames: [],
          teacherEmails: [],
          memberEmails: [],
          staffEmails: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      await initializeDefaultSubjects(uid, resolvedId);
      await initializeDefaultClassrooms(uid, resolvedId);
      void recordAuditLog({
        ownerId: uid,
        schoolId: resolvedId,
        category: 'settings',
        severity: 'info',
        action: 'Création établissement',
        details: `Établissement "${payload.schoolName.trim()}" (${payload.academicYear.trim()}) initialisé.`,
        targetId: resolvedId,
        actorRole: 'admin',
        actorName: payload.adminName,
      });
    } else {
      const updatePayload: Record<string, unknown> = {
        schoolName: payload.schoolName.trim().slice(0, 120),
        adminName: payload.adminName.trim().slice(0, 100),
        academicYear: payload.academicYear.trim().slice(0, 20),
        endOfYearDate: (payload.endOfYearDate ?? '').trim().slice(0, 20),
        motto: (payload.motto ?? '').trim().slice(0, 160),
        phone: (payload.phone ?? '').trim().slice(0, 30),
        email: normalizeEmail(payload.email),
        address: (payload.address ?? '').trim().slice(0, 160),
        city: (payload.city ?? '').trim().slice(0, 80),
        registrationCode: (payload.registrationCode ?? '').trim().slice(0, 60),
        updatedAt: serverTimestamp(),
      };
      if (payload.theme) {
        updatePayload.theme = cleanTheme;
      }
      if (ownerEmail) {
        updatePayload.ownerEmail = ownerEmail;
      }
      await awaitWithOfflineQueue(updateDoc(ref, updatePayload));
      void recordAuditLog({
        ownerId: uid,
        schoolId: resolvedId,
        category: 'settings',
        severity: 'warning',
        action: 'Mise à jour établissement',
        details: `Paramètres de "${payload.schoolName.trim()}" (${payload.academicYear.trim()}) modifiés.`,
        targetId: resolvedId,
      });
    }
    return resolvedId;
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, `schools/${resolvedId}`);
  }
}

export async function updateSchoolTheme(
  schoolId: string,
  theme: SchoolUniformTheme
): Promise<void> {
  const cleanTheme = normalizeSchoolTheme(theme);
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'schools', schoolId), {
        theme: cleanTheme,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `schools/${schoolId}`);
  }
}

export async function initializeDefaultSubjects(uid: string, schoolId: string): Promise<void> {
  const batch = writeBatch(db);
  const cycles: CycleType[] = ['Collège', 'Lycée'];

  for (const cycle of cycles) {
    const items = DEFAULT_SUBJECTS_BY_CYCLE[cycle];
    items.forEach((item, index) => {
      const subId = sanitizeId(`${schoolId}_${cycle}_${index}`);
      const ref = doc(db, 'subjects', subId);
      batch.set(ref, {
        ownerId: uid,
        schoolId,
        name: item.name.slice(0, 80),
        cycle,
        coef: item.coef,
        teacherName: '',
        memberEmails: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  try {
    await awaitWithOfflineQueue(batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'subjects');
  }
}

export async function initializeDefaultClassrooms(
  uid: string,
  schoolId: string,
  memberEmails: string[] = []
): Promise<void> {
  const existingSnap = await getDocs(
    query(collection(db, 'classrooms'), where('ownerId', '==', uid))
  );
  const schoolDocs = existingSnap.docs.filter(
    (d) => (d.data() as { schoolId?: string }).schoolId === schoolId
  );
  const existingIds = new Set(schoolDocs.map((d) => d.id));
  const existingNames = new Set(
    schoolDocs.map((d) => String((d.data() as { name?: string }).name ?? ''))
  );

  const batch = writeBatch(db);
  let opsCount = 0;

  ALL_CLASSES.forEach((cl, index) => {
    const clsId = sanitizeId(`${schoolId}_cls_${index}_${cl.name}`);
    if (existingIds.has(clsId) || existingNames.has(cl.name)) {
      return;
    }
    batch.set(doc(db, 'classrooms', clsId), {
      ownerId: uid,
      schoolId,
      name: cl.name.slice(0, 40),
      level: (cl.level ?? cl.name).slice(0, 30),
      cycle: cl.cycle,
      series: (cl.series ?? '').slice(0, 40),
      motif: cl.motif ?? 'general',
      accentColor: cl.accentColor ?? '#6d28d9',
      room: '',
      headTeacher: '',
      headTeacherEmail: '',
      slogan: (cl.slogan ?? '').slice(0, 140),
      teacherEmails: [],
      memberEmails: memberEmails.slice(0, 100),
      managementEmails: getSchoolManagementEmails(schoolId),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    opsCount++;
  });

  if (opsCount === 0) return;

  try {
    await awaitWithOfflineQueue(batch.commit());
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'classrooms');
  }
}

export async function syncTogoCurriculum(
  uid: string,
  schoolId: string,
  existingSubjects: Subject[],
  existingClassrooms: Classroom[],
  memberEmails: string[] = [],
  existingStudents: Student[] = []
): Promise<boolean> {
  const batch = writeBatch(db);
  let opsCount = 0;

  const cleanMembers = memberEmails.slice(0, 100);
  const cycles: CycleType[] = ['Collège', 'Lycée'];

  for (const cycle of cycles) {
    const cycleSubs = existingSubjects.filter((s) => s.cycle === cycle);
    const existingKeys = new Set<string>();

    for (const sub of cycleSubs) {
      const key = normalizeSubjectKey(sub.name);
      existingKeys.add(key);

      if (cycle === 'Collège' && key === 'physique' && sub.name !== 'PCT') {
        batch.update(doc(db, 'subjects', sub.id), {
          name: 'PCT',
          coef: 3,
          updatedAt: serverTimestamp(),
        });
        opsCount++;
      } else if (cycle === 'Lycée' && key === 'anglais' && sub.name !== 'Anglais (LV1)') {
        batch.update(doc(db, 'subjects', sub.id), {
          name: 'Anglais (LV1)',
          updatedAt: serverTimestamp(),
        });
        opsCount++;
      }
    }

    DEFAULT_SUBJECTS_BY_CYCLE[cycle].forEach((item, idx) => {
      const key = normalizeSubjectKey(item.name);
      if (!existingKeys.has(key)) {
        const subId = sanitizeId(`${schoolId}_tg_${cycle}_${key}_${idx}`);
        if (!existingSubjects.some((s) => s.id === subId)) {
          batch.set(doc(db, 'subjects', subId), {
            ownerId: uid,
            schoolId,
            name: item.name.slice(0, 80),
            cycle,
            coef: item.coef,
            teacherName: '',
            memberEmails: cleanMembers,
            managementEmails: getSchoolManagementEmails(schoolId),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          existingKeys.add(key);
          opsCount++;
        }
      }
    });
  }

  if (existingClassrooms.length > 0) {
    const officialNames = new Set(ALL_CLASSES.map((c) => c.name));
    const studentCountByClass = new Map<string, number>();
    existingStudents.forEach((s) => {
      studentCountByClass.set(s.classe, (studentCountByClass.get(s.classe) ?? 0) + 1);
    });

    const keptNames = new Set<string>();
    const existingIds = new Set(existingClassrooms.map((c) => c.id));

    for (const cls of existingClassrooms) {
      const isAutoDefault =
        cls.id.startsWith(`${schoolId}_cls_`) || cls.id.startsWith(`${schoolId}_tg_cls_`);
      const hasStudents = (studentCountByClass.get(cls.name) ?? 0) > 0;
      const isDuplicateName = keptNames.has(cls.name);
      const isObsoleteDefault = isAutoDefault && !officialNames.has(cls.name) && !hasStudents;

      if (cls.ownerId === uid && ((isDuplicateName && isAutoDefault) || isObsoleteDefault)) {
        batch.delete(doc(db, 'classrooms', cls.id));
        opsCount++;
        continue;
      }

      keptNames.add(cls.name);
    }
  }

  if (opsCount === 0) return false;

  try {
    await awaitWithOfflineQueue(batch.commit());
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'subjects');
  }
}

export async function ensureDefaultSubjectsForCycle(
  ownerUid: string,
  schoolId: string,
  cycle: CycleType,
  memberEmails: string[] = []
): Promise<void> {
  try {
    const callerEmail = normalizeEmail(auth.currentUser?.email);
    const isOwner = auth.currentUser?.uid === ownerUid;
    const scopeConstraint = isOwner
      ? where('ownerId', '==', ownerUid)
      : where('managementEmails', 'array-contains', callerEmail);
    const snap = await getDocs(query(collection(db, 'subjects'), scopeConstraint));
    const existingForCycle = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) }))
      .filter((s) => s.schoolId === schoolId && s.cycle === cycle);
    const existingKeys = new Set(existingForCycle.map((s) => normalizeSubjectKey(s.name)));

    const batch = writeBatch(db);
    let ops = 0;
    const cleanMembers = memberEmails.slice(0, 100);
    const mgmt = getSchoolManagementEmails(schoolId);

    DEFAULT_SUBJECTS_BY_CYCLE[cycle].forEach((item, idx) => {
      const key = normalizeSubjectKey(item.name);
      if (!existingKeys.has(key)) {
        const subId = sanitizeId(`${schoolId}_tg_${cycle}_${key}_${idx}`);
        if (!existingForCycle.some((s) => s.id === subId)) {
          batch.set(doc(db, 'subjects', subId), {
            ownerId: ownerUid,
            schoolId,
            name: item.name.slice(0, 80),
            cycle,
            coef: item.coef,
            teacherName: '',
            memberEmails: cleanMembers,
            managementEmails: mgmt,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          existingKeys.add(key);
          ops++;
        }
      }
    });

    if (ops > 0) {
      await awaitWithOfflineQueue(batch.commit());
    }
  } catch {
    // Non-blocking for roles without subject write access (e.g., Secretaire)
  }
}

export async function createClassroom(
  uid: string,
  schoolId: string,
  data: {
    name: string;
    level: string;
    cycle: CycleType;
    series?: string;
    motif: ClassroomMotif;
    accentColor: string;
    room?: string;
    headTeacher?: string;
    headTeacherEmail?: string;
    slogan?: string;
    closingDate?: string;
    teacherEmails?: string[];
    memberEmails?: string[];
  }
): Promise<string> {
  const clsId = sanitizeId(`cls_${Date.now()}_${data.name}`);
  const cleanHeadEmail = normalizeEmail(data.headTeacherEmail);
  const teacherEmails = Array.from(
    new Set([...(data.teacherEmails ?? []).map((e) => normalizeEmail(e)), cleanHeadEmail].filter(Boolean))
  ).slice(0, 25);
  try {
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'classrooms', clsId), {
        ownerId: uid,
        schoolId,
        name: data.name.trim().slice(0, 40),
        level: data.level.trim().slice(0, 30),
        cycle: data.cycle,
        series: (data.series ?? '').trim().slice(0, 40),
        motif: data.motif,
        accentColor: data.accentColor.trim().slice(0, 30) || '#6d28d9',
        room: (data.room ?? '').trim().slice(0, 40),
        headTeacher: (data.headTeacher ?? '').trim().slice(0, 80),
        headTeacherEmail: cleanHeadEmail,
        slogan: (data.slogan ?? '').trim().slice(0, 140),
        closingDate: (data.closingDate ?? '').trim().slice(0, 20),
        teacherEmails,
        memberEmails: (data.memberEmails ?? []).slice(0, 100),
        managementEmails: getSchoolManagementEmails(schoolId),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    void ensureDefaultSubjectsForCycle(uid, schoolId, data.cycle, data.memberEmails ?? []);
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'classroom',
      severity: 'info',
      action: 'Création classe / division',
      details: `Classe "${data.name.trim()}" (${data.cycle}) créée avec matières et coefficients standards.${data.headTeacher?.trim() ? ` Titulaire : ${data.headTeacher.trim()}.` : ''}`,
      targetId: clsId,
    });
    return clsId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `classrooms/${clsId}`);
  }
}

export async function updateClassroom(
  classroomId: string,
  data: {
    name: string;
    level: string;
    cycle: CycleType;
    series?: string;
    motif: ClassroomMotif;
    accentColor: string;
    room?: string;
    headTeacher?: string;
    headTeacherEmail?: string;
    slogan?: string;
    closingDate?: string;
  },
  options?: {
    ownerUid?: string;
    schoolId?: string;
    previousName?: string;
  }
): Promise<void> {
  const nextName = data.name.trim().slice(0, 40);
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'classrooms', classroomId), {
        name: nextName,
        level: data.level.trim().slice(0, 30),
        cycle: data.cycle,
        series: (data.series ?? '').trim().slice(0, 40),
        motif: data.motif,
        accentColor: data.accentColor.trim().slice(0, 30) || '#6d28d9',
        room: (data.room ?? '').trim().slice(0, 40),
        headTeacher: (data.headTeacher ?? '').trim().slice(0, 80),
        headTeacherEmail: normalizeEmail(data.headTeacherEmail),
        slogan: (data.slogan ?? '').trim().slice(0, 140),
        closingDate: (data.closingDate ?? '').trim().slice(0, 20),
        updatedAt: serverTimestamp(),
      })
    );

    if (options?.ownerUid && options?.schoolId) {
      const prevName = (options.previousName ?? '').trim();
      if (prevName && prevName !== nextName) {
        try {
          const callerEmail = normalizeEmail(auth.currentUser?.email);
          const isOwner = auth.currentUser?.uid === options.ownerUid;
          const scopeConstraint = isOwner
            ? where('ownerId', '==', options.ownerUid)
            : where('managementEmails', 'array-contains', callerEmail);
          const stuSnap = await getDocs(query(collection(db, 'students'), scopeConstraint));
          const movedStudents = stuSnap.docs.filter((d) => {
            const s = d.data() as Student;
            return s.schoolId === options.schoolId && s.classe === prevName;
          });
          for (let i = 0; i < movedStudents.length; i += 380) {
            const batch = writeBatch(db);
            for (const d of movedStudents.slice(i, i + 380)) {
              batch.update(d.ref, {
                classe: nextName,
                cycle: data.cycle,
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
        } catch {
          // Non-blocking rename cascade
        }
      }
      await syncAccessPropagation(options.ownerUid, options.schoolId).catch(() => {});
    }

    void recordAuditLog({
      ownerId: options?.ownerUid,
      schoolId: options?.schoolId,
      category: 'classroom',
      severity: 'info',
      action: 'Modification classe',
      details: `Classe "${nextName}" (${data.cycle}) personnalisée.`,
      targetId: classroomId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `classrooms/${classroomId}`);
  }
}

export async function updateClassroomTitulaire(
  ownerUid: string,
  schoolId: string,
  classroom: Classroom,
  headTeacher: string,
  headTeacherEmail?: string
): Promise<void> {
  const cleanName = headTeacher.trim().slice(0, 80);
  const cleanEmail = cleanName ? normalizeEmail(headTeacherEmail) : '';
  if (classroom.id.startsWith('fallback_')) {
    await createClassroom(ownerUid, schoolId, {
      name: classroom.name,
      level: classroom.level || classroom.name,
      cycle: classroom.cycle,
      series: classroom.series,
      motif: classroom.motif,
      accentColor: classroom.accentColor,
      room: classroom.room,
      headTeacher: cleanName,
      headTeacherEmail: cleanEmail,
      slogan: classroom.slogan,
      closingDate: classroom.closingDate,
      teacherEmails: cleanEmail ? [cleanEmail] : [],
    });
    await syncAccessPropagation(ownerUid, schoolId).catch(() => {});
    return;
  }
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'classrooms', classroom.id), {
        headTeacher: cleanName,
        headTeacherEmail: cleanEmail,
        updatedAt: serverTimestamp(),
      })
    );
    await syncAccessPropagation(ownerUid, schoolId).catch(() => {});
    void recordAuditLog({
      ownerId: ownerUid,
      schoolId,
      category: 'classroom',
      severity: 'info',
      action: cleanName ? 'Désignation titulaire de classe' : 'Retrait titulaire de classe',
      details: cleanName
        ? `${cleanName} désigné(e) Titulaire de la classe ${classroom.name}.`
        : `Titulaire retiré pour la classe ${classroom.name}.`,
      targetId: classroom.id,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `classrooms/${classroom.id}`);
  }
}

export async function deleteClassroomById(classroomId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(deleteDoc(doc(db, 'classrooms', classroomId)));
    void recordAuditLog({
      category: 'classroom',
      severity: 'warning',
      action: 'Suppression classe',
      details: `Classe supprimée (ID: ${classroomId}).`,
      targetId: classroomId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `classrooms/${classroomId}`);
  }
}

export async function deleteClassroomCascade(
  ownerUid: string,
  schoolId: string,
  classroom: Classroom,
  mode: 'transfer' | 'delete-students',
  targetClassName?: string
): Promise<{ affectedStudents: number }> {
  try {
    const callerEmail = normalizeEmail(auth.currentUser?.email);
    const isOwner = auth.currentUser?.uid === ownerUid;
    const scopeConstraint = isOwner
      ? where('ownerId', '==', ownerUid)
      : where('managementEmails', 'array-contains', callerEmail);

    const [stuSnap, gradeSnap, remarkSnap] = await Promise.all([
      getDocs(query(collection(db, 'students'), scopeConstraint)),
      getDocs(query(collection(db, 'grades'), scopeConstraint)),
      getDocs(query(collection(db, 'bulletinRemarks'), scopeConstraint)),
    ]);

    const classStudents = stuSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as Student, id: d.id }))
      .filter((item) => item.data.schoolId === schoolId && item.data.classe === classroom.name);
    const classStudentIds = new Set(classStudents.map((s) => s.id));

    type BatchOp =
      | { kind: 'delete'; ref: ReturnType<typeof doc> }
      | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> };
    const ops: BatchOp[] = [];
    const gradeAndRemarkOps: BatchOp[] = [];

    if (mode === 'transfer') {
      const destName = (targetClassName || '').trim();
      if (!destName || destName === classroom.name) {
        throw new Error('Sélectionnez une classe de destination valide.');
      }
      const destCycle = getCycleForClass(destName);
      for (const s of classStudents) {
        ops.push({
          kind: 'update',
          ref: s.ref,
          data: {
            classe: destName.slice(0, 40),
            cycle: destCycle,
            updatedAt: serverTimestamp(),
          },
        });
      }
      gradeSnap.docs.forEach((d) => {
        const g = d.data() as GradeRecord;
        if (classStudentIds.has(g.studentId)) {
          gradeAndRemarkOps.push({
            kind: 'update',
            ref: d.ref,
            data: { classe: destName.slice(0, 40), updatedAt: serverTimestamp() },
          });
        }
      });
    } else {
      for (const s of classStudents) {
        ops.push({ kind: 'delete', ref: s.ref });
      }
      gradeSnap.docs.forEach((d) => {
        const g = d.data() as GradeRecord;
        if (classStudentIds.has(g.studentId)) {
          gradeAndRemarkOps.push({ kind: 'delete', ref: d.ref });
        }
      });
      remarkSnap.docs.forEach((d) => {
        const r = d.data() as BulletinRemark;
        if (classStudentIds.has(r.studentId)) {
          gradeAndRemarkOps.push({ kind: 'delete', ref: d.ref });
        }
      });
    }

    ops.push({ kind: 'delete', ref: doc(db, 'classrooms', classroom.id) });

    const CHUNK = 380;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.kind === 'delete') batch.delete(op.ref);
        else batch.update(op.ref, op.data);
      }
      await batch.commit();
    }

    if (gradeAndRemarkOps.length > 0) {
      try {
        for (let i = 0; i < gradeAndRemarkOps.length; i += CHUNK) {
          const chunk = gradeAndRemarkOps.slice(i, i + CHUNK);
          const batch = writeBatch(db);
          for (const op of chunk) {
            if (op.kind === 'delete') batch.delete(op.ref);
            else batch.update(op.ref, op.data);
          }
          await batch.commit();
        }
      } catch {
        // Non-blocking when caller role (e.g., Secretaire) cannot modify grades
      }
    }

    if (ownerUid) {
      await syncAccessPropagation(ownerUid, schoolId).catch(() => {});
    }

    void recordAuditLog({
      ownerId: ownerUid,
      schoolId,
      category: 'classroom',
      severity: 'critical',
      action: 'Suppression classe confirmée',
      details:
        mode === 'transfer'
          ? `Classe "${classroom.name}" supprimée avec transfert de ${classStudents.length} élève(s) vers "${targetClassName}".`
          : `Classe "${classroom.name}" et ${classStudents.length} dossier(s) élève supprimés.`,
      targetId: classroom.id,
    });

    return { affectedStudents: classStudents.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `classrooms/${classroom.id}`);
  }
}

export async function deleteSchoolCascade(
  ownerUid: string,
  schoolId: string,
  schoolName: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== ownerUid) {
    throw new Error('Action refusée : seul le Proviseur créateur de l’établissement peut supprimer cette école.');
  }
  try {
    const ownedCollections = [
      'classrooms',
      'memberships',
      'students',
      'studentLocks',
      'subjects',
      'grades',
      'bulletinRemarks',
      'messages',
      'notifications',
      'academicArchives',
    ];

    const snaps = await Promise.all(
      ownedCollections.map((colName) =>
        getDocs(query(collection(db, colName), where('ownerId', '==', ownerUid)))
      )
    );

    const refsToDelete: Array<ReturnType<typeof doc>> = [];
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const data = d.data() as { schoolId?: string };
        if (data.schoolId === schoolId) {
          refsToDelete.push(d.ref);
        }
      }
    }
    refsToDelete.push(doc(db, 'schools', schoolId));

    const CHUNK = 380;
    for (let i = 0; i < refsToDelete.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const ref of refsToDelete.slice(i, i + CHUNK)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    console.info(`Établissement "${schoolName}" (${schoolId}) supprimé.`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `schools/${schoolId}`);
  }
}

export async function executeAcademicYearTransition(
  ownerUid: string,
  school: SchoolProfile,
  params: {
    newAcademicYear: string;
    newEndOfYearDate?: string;
    closedByEmail: string;
    closedByName: string;
    decisions: Array<{
      student: Student;
      annualAverage: number | null;
      action: 'promote' | 'repeat' | 'graduate' | 'withdraw';
      targetClasse: string;
      targetCycle: CycleType;
    }>;
    classSummaries: Array<{
      classe: string;
      cycle: CycleType;
      effectif: number;
      average: number | null;
    }>;
    resetGradesAndRemarks?: boolean;
  }
): Promise<string> {
  const archiveId = sanitizeId(`arch_${school.id}_${Date.now().toString(36)}`);
  const shouldReset = params.resetGradesAndRemarks !== false;

  try {
    const studentRecords: StudentArchiveSummary[] = params.decisions.map((d) => ({
      studentId: d.student.id,
      matricule: d.student.matricule,
      fullName: `${d.student.nom} ${d.student.prenoms}`.trim(),
      classe: d.student.classe,
      cycle: d.student.cycle,
      sexe: d.student.sexe,
      annualAverage: d.annualAverage,
      decision: d.action,
      nextClasse:
        d.action === 'graduate'
          ? 'Diplômé / Sortant'
          : d.action === 'withdraw'
          ? 'Retiré'
          : d.action === 'repeat'
          ? d.student.classe
          : d.targetClasse,
    }));

    const promotedCount = params.decisions.filter((d) => d.action === 'promote').length;
    const repeatedCount = params.decisions.filter((d) => d.action === 'repeat').length;
    const graduatedCount = params.decisions.filter((d) => d.action === 'graduate').length;
    const withdrawnCount = params.decisions.filter((d) => d.action === 'withdraw').length;

    await setDoc(doc(db, 'academicArchives', archiveId), {
      ownerId: ownerUid,
      schoolId: school.id,
      academicYear: school.academicYear,
      closedAtIso: new Date().toISOString(),
      endOfYearDate: school.endOfYearDate ?? '',
      closedByEmail: normalizeEmail(params.closedByEmail),
      closedByName: params.closedByName.trim().slice(0, 100),
      totalStudents: params.decisions.length,
      promotedCount,
      repeatedCount,
      graduatedCount,
      withdrawnCount,
      classSummaries: params.classSummaries,
      studentRecords,
      managementEmails: getSchoolManagementEmails(school.id),
      createdAt: serverTimestamp(),
    });

    type BatchOp =
      | { kind: 'update'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'delete'; ref: ReturnType<typeof doc> };
    const ops: BatchOp[] = [];

    const removedStudentIds = new Set<string>();
    const remainingStudentEmails = new Set<string>();
    const candidateRemovedEmails = new Set<string>();

    for (const d of params.decisions) {
      const stuEmail = normalizeEmail(d.student.studentEmail);
      if (d.action === 'promote') {
        if (stuEmail) remainingStudentEmails.add(stuEmail);
        ops.push({
          kind: 'update',
          ref: doc(db, 'students', d.student.id),
          data: {
            classe: d.targetClasse.trim().slice(0, 40),
            cycle: d.targetCycle,
            updatedAt: serverTimestamp(),
          },
        });
      } else if (d.action === 'repeat') {
        if (stuEmail) remainingStudentEmails.add(stuEmail);
      } else if (d.action === 'graduate' || d.action === 'withdraw') {
        removedStudentIds.add(d.student.id);
        if (stuEmail) candidateRemovedEmails.add(stuEmail);
        ops.push({ kind: 'delete', ref: doc(db, 'students', d.student.id) });
      }
    }

    for (const removedEmail of candidateRemovedEmails) {
      if (!remainingStudentEmails.has(removedEmail)) {
        ops.push({
          kind: 'delete',
          ref: doc(db, 'studentLocks', studentLockDocId(school.id, removedEmail)),
        });
      }
    }

    if (shouldReset || removedStudentIds.size > 0) {
      const [gradeSnap, remarkSnap] = await Promise.all([
        getDocs(query(collection(db, 'grades'), where('ownerId', '==', ownerUid))),
        getDocs(query(collection(db, 'bulletinRemarks'), where('ownerId', '==', ownerUid))),
      ]);
      gradeSnap.docs.forEach((docSnap) => {
        const g = docSnap.data() as { schoolId?: string; studentId?: string };
        if (g.schoolId === school.id && (shouldReset || (g.studentId && removedStudentIds.has(g.studentId)))) {
          ops.push({ kind: 'delete', ref: docSnap.ref });
        }
      });
      remarkSnap.docs.forEach((docSnap) => {
        const r = docSnap.data() as { schoolId?: string; studentId?: string };
        if (r.schoolId === school.id && (shouldReset || (r.studentId && removedStudentIds.has(r.studentId)))) {
          ops.push({ kind: 'delete', ref: docSnap.ref });
        }
      });
    }

    ops.push({
      kind: 'update',
      ref: doc(db, 'schools', school.id),
      data: {
        academicYear: params.newAcademicYear.trim().slice(0, 20),
        endOfYearDate: (params.newEndOfYearDate ?? '').trim().slice(0, 20),
        updatedAt: serverTimestamp(),
      },
    });

    const CHUNK = 380;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK)) {
        if (op.kind === 'delete') batch.delete(op.ref);
        else batch.update(op.ref, op.data);
      }
      await batch.commit();
    }

    await syncAccessPropagation(ownerUid, school.id).catch(() => {});

    void recordAuditLog({
      ownerId: ownerUid,
      schoolId: school.id,
      category: 'archive',
      severity: 'critical',
      action: 'Passage à une nouvelle année scolaire',
      details: `Clôture ${school.academicYear} → Ouverture ${params.newAcademicYear} (${promotedCount} promus, ${repeatedCount} redoublants, ${graduatedCount} diplômés, ${withdrawnCount} retirés).`,
      targetId: archiveId,
    });

    return archiveId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `academicArchives/${archiveId}`);
  }
}

export async function syncAccessPropagation(uid: string, schoolId: string): Promise<void> {
  const callerEmail = normalizeEmail(auth.currentUser?.email);
  const isOwner = auth.currentUser?.uid === uid;
  const scopeConstraint = isOwner
    ? where('ownerId', '==', uid)
    : where('managementEmails', 'array-contains', callerEmail);

  const [memSnap, clsSnap, stuSnap, subSnap, gradeSnap, remarkSnap] = await Promise.all([
    getDocs(query(collection(db, 'memberships'), scopeConstraint)),
    getDocs(query(collection(db, 'classrooms'), scopeConstraint)),
    getDocs(query(collection(db, 'students'), scopeConstraint)),
    getDocs(query(collection(db, 'subjects'), scopeConstraint)),
    getDocs(query(collection(db, 'grades'), scopeConstraint)),
    getDocs(query(collection(db, 'bulletinRemarks'), scopeConstraint)),
  ]);

  let notifDocs: Array<{ ref: ReturnType<typeof doc> }> = [];
  let archiveDocs: Array<{ ref: ReturnType<typeof doc> }> = [];
  try {
    const archSnap = await getDocs(query(collection(db, 'academicArchives'), scopeConstraint));
    archiveDocs = archSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
    if (isOwner) {
      const notifSnap = await getDocs(query(collection(db, 'notifications'), where('ownerId', '==', uid)));
      notifDocs = notifSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
    }
  } catch {
    // Optional secondary propagation
  }

  const memberships = memSnap.docs
    .map((d) => ({ ref: d.ref, id: d.id, ...(d.data() as Omit<Membership, 'id'>) }))
    .filter((m) => m.schoolId === schoolId);
  const clsDocs = clsSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const stuDocs = stuSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const subDocs = subSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const gradeDocs = gradeSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const remarkDocs = remarkSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);

  const memberPriority: Record<MembershipRole, number> = {
    censeur: 0,
    secretaire: 1,
    teacher: 2,
    parent: 3,
  };
  const sortedMemberships = [...memberships].sort(
    (a, b) => memberPriority[a.role] - memberPriority[b.role]
  );
  const allMemberEmails = Array.from(
    new Set(sortedMemberships.map((m) => normalizeEmail(m.memberEmail)).filter(Boolean))
  ).slice(0, 100);
  const staffEmails = Array.from(
    new Set(
      memberships
        .filter((m) => m.role === 'censeur' || m.role === 'secretaire' || m.role === 'teacher')
        .map((m) => normalizeEmail(m.memberEmail))
        .filter(Boolean)
    )
  ).slice(0, 100);
  const censeurMembers = memberships.filter((m) => m.role === 'censeur');
  const censeurEmails = setSchoolCenseurEmails(
    schoolId,
    censeurMembers.map((m) => normalizeEmail(m.memberEmail)).filter(Boolean)
  );
  const censeurNames = censeurEmails.map((em) => {
    const found = censeurMembers.find((m) => normalizeEmail(m.memberEmail) === em);
    return (found?.memberName ?? 'Censeur').trim().slice(0, 80);
  });
  const teacherEmails = Array.from(
    new Set(
      memberships
        .filter((m) => m.role === 'teacher')
        .map((m) => normalizeEmail(m.memberEmail))
        .filter(Boolean)
    )
  ).slice(0, 100);
  const managementEmails = setSchoolManagementEmails(
    schoolId,
    memberships
      .filter((m) => m.role === 'censeur' || m.role === 'secretaire')
      .map((m) => normalizeEmail(m.memberEmail))
      .filter(Boolean)
  );

  const teacherEmailsForClass = (classe: string, headTeacherEmail?: string): string[] => {
    const cleanHead = normalizeEmail(headTeacherEmail);
    const hasTeacherMembership =
      Boolean(cleanHead) &&
      memberships.some((m) => m.role === 'teacher' && normalizeEmail(m.memberEmail) === cleanHead);
    return Array.from(
      new Set(
        [
          ...memberships
            .filter((m) => m.role === 'teacher' && (m.assignedClasses ?? []).includes(classe))
            .map((m) => normalizeEmail(m.memberEmail)),
          hasTeacherMembership ? cleanHead : '',
        ].filter(Boolean)
      )
    ).slice(0, 25);
  };

  const parentEmailByStudentId = new Map<string, string>();
  memberships
    .filter((m) => m.role === 'parent')
    .forEach((m) => {
      (m.childStudentIds ?? []).forEach((sid) => {
        parentEmailByStudentId.set(sid, normalizeEmail(m.memberEmail));
      });
    });

  const classroomHeadEmailByName = new Map<string, string>();
  clsDocs.forEach((d) => {
    const c = d.data() as Classroom;
    if (c.headTeacherEmail) {
      classroomHeadEmailByName.set(c.name, c.headTeacherEmail);
    }
  });

  const studentAccessById = new Map<string, { parentEmail: string; teacherEmails: string[] }>();
  stuDocs.forEach((d) => {
    const s = d.data() as Student;
    const pEmail =
      parentEmailByStudentId.get(d.id) ??
      (normalizeEmail(s.parentEmail) || normalizeEmail(s.guardianPhone));
    const tEmails = teacherEmailsForClass(s.classe, classroomHeadEmailByName.get(s.classe));
    studentAccessById.set(d.id, { parentEmail: pEmail, teacherEmails: tEmails });
  });

  type PendingUpdate = {
    ref: ReturnType<typeof doc>;
    data: Record<string, unknown>;
  };
  const schoolSyncData: Record<string, unknown> = {
    memberEmails: allMemberEmails,
    staffEmails,
    censeurEmails,
    censeurNames,
    teacherEmails,
    updatedAt: serverTimestamp(),
  };
  if (isOwner && callerEmail) {
    schoolSyncData.ownerEmail = callerEmail;
  }
  const updates: PendingUpdate[] = [
    {
      ref: doc(db, 'schools', schoolId),
      data: schoolSyncData,
    },
  ];

  memberships.forEach((m) => {
    updates.push({
      ref: m.ref,
      data: { managementEmails, updatedAt: serverTimestamp() },
    });
  });

  subDocs.forEach((d) => {
    updates.push({
      ref: d.ref,
      data: { memberEmails: allMemberEmails, managementEmails, updatedAt: serverTimestamp() },
    });
  });

  clsDocs.forEach((d) => {
    const c = d.data() as Classroom;
    updates.push({
      ref: d.ref,
      data: {
        teacherEmails: teacherEmailsForClass(c.name, c.headTeacherEmail),
        memberEmails: allMemberEmails,
        managementEmails,
        updatedAt: serverTimestamp(),
      },
    });
  });

  stuDocs.forEach((d) => {
    const access = studentAccessById.get(d.id);
    if (!access) return;
    updates.push({
      ref: d.ref,
      data: {
        parentEmail: access.parentEmail,
        teacherEmails: access.teacherEmails,
        managementEmails,
        updatedAt: serverTimestamp(),
      },
    });
  });

  gradeDocs.forEach((d) => {
    const g = d.data() as GradeRecord;
    const access = studentAccessById.get(g.studentId);
    if (!access) return;
    updates.push({
      ref: d.ref,
      data: {
        parentEmail: access.parentEmail,
        teacherEmails: access.teacherEmails,
        managementEmails,
        updatedAt: serverTimestamp(),
      },
    });
  });

  remarkDocs.forEach((d) => {
    const r = d.data() as BulletinRemark;
    const access = studentAccessById.get(r.studentId);
    if (!access) return;
    updates.push({
      ref: d.ref,
      data: {
        parentEmail: access.parentEmail,
        teacherEmails: access.teacherEmails,
        managementEmails,
        updatedAt: serverTimestamp(),
      },
    });
  });

  notifDocs.forEach((d) => {
    updates.push({
      ref: d.ref,
      data: { managementEmails: censeurEmails, updatedAt: serverTimestamp() },
    });
  });

  archiveDocs.forEach((d) => {
    updates.push({
      ref: d.ref,
      data: { managementEmails },
    });
  });

  // Chunk writes into batches <= 400 to avoid Firestore's 500-operation batch limit
  const CHUNK_SIZE = 400;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.update(item.ref, item.data);
    }
    await batch.commit();
  }
}

export async function createMembership(
  uid: string,
  schoolId: string,
  data: {
    memberEmail: string;
    memberName: string;
    role: MembershipRole;
    assignedClasses?: string[];
    assignedSubject?: string;
    childStudentIds?: string[];
  }
): Promise<string> {
  const email = normalizeEmail(data.memberEmail);
  const memId = membershipDocId(schoolId, data.role, email);

  if (data.role === 'teacher' || data.role === 'censeur' || data.role === 'secretaire') {
    const lockId = studentLockDocId(schoolId, email);
    const lockSnap = await getDoc(doc(db, 'studentLocks', lockId));
    if (lockSnap.exists()) {
      throw new Error(
        `Action bloquée : l'adresse ${email} correspond à un élève inscrit dans cet établissement. Un compte élève ne peut pas accéder en tant que membre du personnel.`
      );
    }
    const callerEmail = normalizeEmail(auth.currentUser?.email);
    const isOwner = auth.currentUser?.uid === uid;
    const stuSnap = await getDocs(
      query(
        collection(db, 'students'),
        isOwner ? where('ownerId', '==', uid) : where('managementEmails', 'array-contains', callerEmail)
      )
    );
    const matchingStudent = stuSnap.docs.find((d) => {
      const s = d.data() as Student;
      return s.schoolId === schoolId && normalizeEmail(s.studentEmail) === email;
    });
    if (matchingStudent) {
      throw new Error(
        `Action bloquée : l'adresse ${email} est associée au dossier d'un élève de cet établissement.`
      );
    }
  }

  const roleLabelMap: Record<MembershipRole, string> = {
    censeur: 'Censeur',
    secretaire: 'Secrétaire',
    teacher: 'Enseignant',
    parent: 'Parent',
  };

  try {
    const mgmtEmails =
      data.role === 'censeur' || data.role === 'secretaire'
        ? getSchoolManagementEmails(schoolId, email)
        : getSchoolManagementEmails(schoolId);
    const memRef = doc(db, 'memberships', memId);
    const existingMemSnap = await getDoc(memRef);
    const cleanName = data.memberName.trim().slice(0, 100);
    const cleanClasses = (data.assignedClasses ?? []).slice(0, 25);
    const cleanSubject = (data.assignedSubject ?? '').trim().slice(0, 80);
    const cleanChildren = (data.childStudentIds ?? []).slice(0, 15);

    if (existingMemSnap.exists()) {
      await updateDoc(memRef, {
        memberEmail: email,
        memberName: cleanName,
        role: data.role,
        assignedClasses: cleanClasses,
        assignedSubject: cleanSubject,
        childStudentIds: cleanChildren,
        managementEmails: mgmtEmails,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(memRef, {
        ownerId: uid,
        schoolId,
        memberEmail: email,
        memberName: cleanName,
        role: data.role,
        assignedClasses: cleanClasses,
        assignedSubject: cleanSubject,
        childStudentIds: cleanChildren,
        managementEmails: mgmtEmails,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await syncAccessPropagation(uid, schoolId).catch(() => {});
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'rbac',
      severity: 'warning',
      action: existingMemSnap.exists() ? 'Mise à jour rôle RBAC' : 'Attribution rôle RBAC',
      details: `${cleanName} (${email}) ${existingMemSnap.exists() ? 'mis à jour' : 'ajouté'} comme ${roleLabelMap[data.role]}.`,
      targetId: memId,
    });
    return memId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `memberships/${memId}`);
  }
}

export async function deleteMembershipById(
  uid: string,
  schoolId: string,
  membershipId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'memberships', membershipId));
    await syncAccessPropagation(uid, schoolId).catch(() => {});
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'rbac',
      severity: 'critical',
      action: 'Révocation accès RBAC',
      details: `Rattachement d'accès révoqué (ID: ${membershipId}).`,
      targetId: membershipId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `memberships/${membershipId}`);
  }
}

export async function createSubject(
  uid: string,
  schoolId: string,
  data: { name: string; cycle: CycleType; coef: number; teacherName?: string; memberEmails?: string[] }
): Promise<void> {
  const subId = sanitizeId(`sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'subjects', subId), {
        ownerId: uid,
        schoolId,
        name: data.name.trim().slice(0, 80),
        cycle: data.cycle,
        coef: Math.min(10, Math.max(1, Number(data.coef) || 1)),
        teacherName: (data.teacherName ?? '').trim().slice(0, 80),
        memberEmails: (data.memberEmails ?? []).slice(0, 100),
        managementEmails: getSchoolManagementEmails(schoolId),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'subject',
      severity: 'info',
      action: 'Ajout matière',
      details: `Matière "${data.name.trim()}" (${data.cycle}, coef ${Math.min(10, Math.max(1, Number(data.coef) || 1))}) créée.`,
      targetId: subId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `subjects/${subId}`);
  }
}

export async function deleteSubjectById(subjectId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(deleteDoc(doc(db, 'subjects', subjectId)));
    void recordAuditLog({
      category: 'subject',
      severity: 'warning',
      action: 'Suppression matière',
      details: `Matière supprimée (ID: ${subjectId}).`,
      targetId: subjectId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `subjects/${subjectId}`);
  }
}

async function syncStudentLockAndParentMembership(
  uid: string,
  schoolId: string,
  studentId: string,
  data: {
    guardianName?: string;
    parentEmail?: string;
    studentEmail?: string;
    previousStudentEmail?: string;
  }
): Promise<void> {
  const cleanStudentEmail = normalizeEmail(data.studentEmail);
  const cleanPrevEmail = normalizeEmail(data.previousStudentEmail);
  const cleanParentEmail = normalizeEmail(data.parentEmail);

  // 1. Remove obsolete lock if student email changed or cleared
  if (cleanPrevEmail && cleanPrevEmail !== cleanStudentEmail) {
    try {
      const callerEmail = normalizeEmail(auth.currentUser?.email);
      const isOwner = auth.currentUser?.uid === uid;
      const stuSnap = await getDocs(
        query(
          collection(db, 'students'),
          isOwner ? where('ownerId', '==', uid) : where('managementEmails', 'array-contains', callerEmail)
        )
      );
      const stillUsed = stuSnap.docs.some(
        (d) =>
          d.id !== studentId &&
          (d.data() as Student).schoolId === schoolId &&
          normalizeEmail((d.data() as Student).studentEmail) === cleanPrevEmail
      );
      if (!stillUsed) {
        await deleteDoc(doc(db, 'studentLocks', studentLockDocId(schoolId, cleanPrevEmail)));
      }
    } catch {
      // Non-blocking cleanup
    }
  }

  // 2. Create/update deterministic student lock & revoke conflicting teacher role in same school
  if (cleanStudentEmail) {
    const lockId = studentLockDocId(schoolId, cleanStudentEmail);
    const lockRef = doc(db, 'studentLocks', lockId);
    const existingLockSnap = await getDoc(lockRef).catch(() => null);
    if (existingLockSnap?.exists()) {
      await awaitWithOfflineQueue(
        updateDoc(lockRef, {
          studentId,
          studentEmail: cleanStudentEmail,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await awaitWithOfflineQueue(
        setDoc(lockRef, {
          ownerId: uid,
          schoolId,
          studentId,
          studentEmail: cleanStudentEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    try {
      const conflictingTeacherId = membershipDocId(schoolId, 'teacher', cleanStudentEmail);
      const tSnap = await getDoc(doc(db, 'memberships', conflictingTeacherId));
      if (tSnap.exists()) {
        await deleteDoc(doc(db, 'memberships', conflictingTeacherId));
        await syncAccessPropagation(uid, schoolId);
      }
    } catch {
      // Non-blocking teacher conflict cleanup
    }
  }

  // 3. Ensure deterministic parent membership exists when parentEmail is linked on student sheet
  if (cleanParentEmail) {
    const pMemId = membershipDocId(schoolId, 'parent', cleanParentEmail);
    try {
      const pRef = doc(db, 'memberships', pMemId);
      const existingSnap = await getDoc(pRef);
      if (existingSnap.exists()) {
        const prevChildren = (existingSnap.data() as Membership).childStudentIds ?? [];
        if (!prevChildren.includes(studentId)) {
          await awaitWithOfflineQueue(
            updateDoc(pRef, {
              childStudentIds: [...prevChildren, studentId].slice(0, 15),
              updatedAt: serverTimestamp(),
            })
          );
        }
      } else {
        await awaitWithOfflineQueue(
          setDoc(pRef, {
            ownerId: uid,
            schoolId,
            memberEmail: cleanParentEmail,
            memberName: (data.guardianName || formatAuthIdentifierForDisplay(cleanParentEmail).split('@')[0] || 'Parent').trim().slice(0, 100),
            role: 'parent',
            assignedClasses: [],
            assignedSubject: '',
            childStudentIds: [studentId],
            managementEmails: getSchoolManagementEmails(schoolId),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    } catch {
      // Non-blocking parent membership backfill
    }
  }
}

export async function createStudent(
  uid: string,
  schoolId: string,
  data: {
    matricule: string;
    nom: string;
    prenoms: string;
    sexe: 'M' | 'F';
    age: number;
    cycle: CycleType;
    classe: string;
    guardianName?: string;
    guardianPhone?: string;
    parentEmail?: string;
    studentEmail?: string;
    teacherEmails?: string[];
  }
): Promise<string> {
  const studentId = sanitizeId(`stu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const cleanStudentEmail = normalizeEmail(data.studentEmail);
  const cleanParentEmail = normalizeEmail(data.parentEmail) || normalizeEmail(data.guardianPhone);
  try {
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'students', studentId), {
        ownerId: uid,
        schoolId,
        matricule: data.matricule.trim().slice(0, 30),
        nom: data.nom.trim().toUpperCase().slice(0, 80),
        prenoms: data.prenoms.trim().slice(0, 100),
        sexe: data.sexe,
        age: Math.min(30, Math.max(3, Math.round(data.age))),
        cycle: data.cycle,
        classe: data.classe.trim().slice(0, 40),
        guardianName: (data.guardianName ?? '').trim().slice(0, 100),
        guardianPhone: (data.guardianPhone ?? '').trim().slice(0, 30),
        parentEmail: cleanParentEmail,
        studentEmail: cleanStudentEmail,
        teacherEmails: (data.teacherEmails ?? []).slice(0, 25),
        managementEmails: getSchoolManagementEmails(schoolId),
        status: 'actif',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await syncStudentLockAndParentMembership(uid, schoolId, studentId, {
      guardianName: data.guardianName,
      parentEmail: cleanParentEmail,
      studentEmail: cleanStudentEmail,
    });
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'student',
      severity: 'info',
      action: 'Inscription élève',
      details: `${data.nom.trim().toUpperCase()} ${data.prenoms.trim()} (${data.matricule.trim()}) inscrit en ${data.classe.trim()}.`,
      targetId: studentId,
    });
    return studentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `students/${studentId}`);
  }
}

export async function updateStudent(
  studentId: string,
  data: {
    ownerUid?: string;
    schoolId?: string;
    matricule: string;
    nom: string;
    prenoms: string;
    sexe: 'M' | 'F';
    age: number;
    cycle: CycleType;
    classe: string;
    guardianName?: string;
    guardianPhone?: string;
    parentEmail?: string;
    studentEmail?: string;
    previousStudentEmail?: string;
    teacherEmails?: string[];
    status: 'actif' | 'archive';
  }
): Promise<void> {
  const cleanStudentEmail = normalizeEmail(data.studentEmail);
  const cleanParentEmail = normalizeEmail(data.parentEmail) || normalizeEmail(data.guardianPhone);
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'students', studentId), {
        matricule: data.matricule.trim().slice(0, 30),
        nom: data.nom.trim().toUpperCase().slice(0, 80),
        prenoms: data.prenoms.trim().slice(0, 100),
        sexe: data.sexe,
        age: Math.min(30, Math.max(3, Math.round(data.age))),
        cycle: data.cycle,
        classe: data.classe.trim().slice(0, 40),
        guardianName: (data.guardianName ?? '').trim().slice(0, 100),
        guardianPhone: (data.guardianPhone ?? '').trim().slice(0, 30),
        parentEmail: cleanParentEmail,
        studentEmail: cleanStudentEmail,
        teacherEmails: (data.teacherEmails ?? []).slice(0, 25),
        status: data.status,
        updatedAt: serverTimestamp(),
      })
    );
    if (data.ownerUid && data.schoolId) {
      await syncStudentLockAndParentMembership(data.ownerUid, data.schoolId, studentId, {
        guardianName: data.guardianName,
        parentEmail: cleanParentEmail,
        studentEmail: cleanStudentEmail,
        previousStudentEmail: data.previousStudentEmail,
      });
    }
    void recordAuditLog({
      category: 'student',
      severity: 'info',
      action: 'Modification dossier élève',
      details: `Dossier de ${data.nom.trim().toUpperCase()} ${data.prenoms.trim()} (${data.classe.trim()}) mis à jour.`,
      targetId: studentId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `students/${studentId}`);
  }
}

export async function deleteStudentById(
  studentId: string,
  context?: { ownerUid?: string; schoolId?: string; studentEmail?: string }
): Promise<void> {
  try {
    await awaitWithOfflineQueue(deleteDoc(doc(db, 'students', studentId)));
    const cleanEmail = normalizeEmail(context?.studentEmail);
    const callerEmail = normalizeEmail(auth.currentUser?.email);
    const isOwner = Boolean(context?.ownerUid && auth.currentUser?.uid === context.ownerUid);
    const scopeConstraint =
      isOwner && context?.ownerUid
        ? where('ownerId', '==', context.ownerUid)
        : where('managementEmails', 'array-contains', callerEmail);

    if (cleanEmail && context?.schoolId) {
      try {
        const stuSnap = await getDocs(
          query(collection(db, 'students'), scopeConstraint)
        );
        const stillUsed = stuSnap.docs.some(
          (d) =>
            d.id !== studentId &&
            (d.data() as Student).schoolId === context.schoolId &&
            normalizeEmail((d.data() as Student).studentEmail) === cleanEmail
        );
        if (!stillUsed) {
          await deleteDoc(
            doc(db, 'studentLocks', studentLockDocId(context.schoolId, cleanEmail))
          );
        }
      } catch {
        // Non-blocking lock cleanup
      }
    }
    if (context?.schoolId) {
      try {
        const [gradeSnap, remarkSnap] = await Promise.all([
          getDocs(query(collection(db, 'grades'), scopeConstraint)),
          getDocs(query(collection(db, 'bulletinRemarks'), scopeConstraint)),
        ]);
        const refs = [
          ...gradeSnap.docs
            .filter((d) => {
              const g = d.data() as GradeRecord;
              return g.schoolId === context.schoolId && g.studentId === studentId;
            })
            .map((d) => d.ref),
          ...remarkSnap.docs
            .filter((d) => {
              const r = d.data() as BulletinRemark;
              return r.schoolId === context.schoolId && r.studentId === studentId;
            })
            .map((d) => d.ref),
        ];
        for (let i = 0; i < refs.length; i += 350) {
          const b = writeBatch(db);
          refs.slice(i, i + 350).forEach((r) => b.delete(r));
          await b.commit();
        }
      } catch {
        // Non-blocking cleanup (e.g., secretaire role lacks write access on grades/remarks)
      }
    }
    void recordAuditLog({
      category: 'student',
      severity: 'critical',
      action: 'Suppression élève',
      details: `Fiche élève supprimée (ID: ${studentId}).`,
      targetId: studentId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `students/${studentId}`);
  }
}

function normalizeScore(val: number | null | undefined): number | null {
  if (val === null || val === undefined || Number.isNaN(val)) return null;
  return Math.min(20, Math.max(0, Number(Number(val).toFixed(2))));
}

export async function upsertGrade(
  ownerUid: string,
  schoolId: string,
  existingGrade: GradeRecord | undefined,
  payload: {
    studentId: string;
    classe: string;
    subjectId: string;
    subjectName: string;
    coef: number;
    trimester: 1 | 2 | 3;
    int1: number | null;
    int2: number | null;
    devoir: number | null;
    compo: number | null;
    appreciation?: string;
    parentEmail?: string;
    teacherEmails?: string[];
  },
  actor?: { email: string; name: string; role?: UserRole; studentName?: string; moyMat?: number | null }
): Promise<void> {
  const gradeId = sanitizeId(`${payload.studentId}_${payload.subjectId}_T${payload.trimester}`);
  const ref = doc(db, 'grades', gradeId);
  const isOwner = auth.currentUser?.uid === ownerUid;

  const nInt1 = normalizeScore(payload.int1);
  const nInt2 = normalizeScore(payload.int2);
  const nDevoir = normalizeScore(payload.devoir);
  const nCompo = normalizeScore(payload.compo);
  const cleanAppreciation = (payload.appreciation ?? '').trim().slice(0, 200);

  try {
    if (existingGrade) {
      if (isOwner) {
        await awaitWithOfflineQueue(
          updateDoc(ref, {
            classe: payload.classe.slice(0, 40),
            subjectName: payload.subjectName.slice(0, 80),
            coef: payload.coef,
            int1: nInt1,
            int2: nInt2,
            devoir: nDevoir,
            compo: nCompo,
            appreciation: cleanAppreciation,
            parentEmail: normalizeEmail(payload.parentEmail ?? existingGrade.parentEmail),
            teacherEmails: (payload.teacherEmails ?? existingGrade.teacherEmails ?? []).slice(0, 25),
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        // Tier 2 teacher update: strictly score & appreciation fields only
        await awaitWithOfflineQueue(
          updateDoc(ref, {
            int1: nInt1,
            int2: nInt2,
            devoir: nDevoir,
            compo: nCompo,
            appreciation: cleanAppreciation,
            updatedAt: serverTimestamp(),
          })
        );
      }
    } else {
      await awaitWithOfflineQueue(
        setDoc(ref, {
          ownerId: ownerUid,
          schoolId,
          studentId: payload.studentId,
          classe: payload.classe.slice(0, 40),
          subjectId: payload.subjectId,
          subjectName: payload.subjectName.slice(0, 80),
          coef: payload.coef,
          trimester: payload.trimester,
          int1: nInt1,
          int2: nInt2,
          devoir: nDevoir,
          compo: nCompo,
          appreciation: cleanAppreciation,
          parentEmail: normalizeEmail(payload.parentEmail),
          teacherEmails: (payload.teacherEmails ?? []).slice(0, 25),
          managementEmails: getSchoolManagementEmails(schoolId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    const pCode = getPeriodShortLabel(getCycleForClass(payload.classe), payload.trimester);
    void recordAuditLog({
      ownerId: ownerUid,
      schoolId,
      category: 'grade',
      severity: existingGrade ? 'warning' : 'info',
      action: existingGrade ? 'Modification de notes' : 'Saisie de notes',
      details: `${actor?.studentName || payload.studentId} (${payload.classe}) · ${payload.subjectName} ${pCode} [Int1:${nInt1 ?? '-'} Int2:${nInt2 ?? '-'} Dev:${nDevoir ?? '-'} Comp:${nCompo ?? '-'}]`,
      targetId: gradeId,
    });

    const pEmail = normalizeEmail(payload.parentEmail ?? existingGrade?.parentEmail);
    const actorRole = actor?.role ?? activeAuditContext?.actorRole ?? 'censeur';
    if (pEmail && actor?.email && canNotifyParentsForRole(actorRole)) {
      const moyTxt = actor.moyMat !== null && actor.moyMat !== undefined ? `Moyenne : ${actor.moyMat}/20` : 'Nouvelle note saisie';
      await createNotification(ownerUid, schoolId, {
        type: 'grade',
        title: `Nouvelle note en ${payload.subjectName} (${pCode})`,
        message: `${actor.studentName || 'Votre enfant'} (${payload.classe}) — ${moyTxt}. Appréciation : ${payload.appreciation || 'Enregistrée'}.`,
        targetClasse: payload.classe,
        studentId: payload.studentId,
        audienceEmails: [pEmail],
        createdByEmail: actor.email,
        createdByName: actor.name,
        createdByRole: actorRole,
      });
    }
  } catch (error) {
    handleFirestoreError(error, existingGrade ? OperationType.UPDATE : OperationType.CREATE, `grades/${gradeId}`);
  }
}

export async function upsertBulletinRemark(
  ownerUid: string,
  schoolId: string,
  existingRemark: BulletinRemark | undefined,
  payload: {
    studentId: string;
    trimester: 1 | 2 | 3;
    absences: number;
    conduite?: string;
    decision?: string;
    generalRemark?: string;
    parentEmail?: string;
    teacherEmails?: string[];
  }
): Promise<void> {
  const remarkId = sanitizeId(`${payload.studentId}_T${payload.trimester}`);
  const ref = doc(db, 'bulletinRemarks', remarkId);
  const isOwner = auth.currentUser?.uid === ownerUid;
  const cleanAbsences = Math.min(365, Math.max(0, Math.round(payload.absences)));

  try {
    if (existingRemark) {
      if (isOwner) {
        await awaitWithOfflineQueue(
          updateDoc(ref, {
            absences: cleanAbsences,
            conduite: (payload.conduite ?? 'Bonne').trim().slice(0, 60),
            decision: (payload.decision ?? '').trim().slice(0, 80),
            generalRemark: (payload.generalRemark ?? '').trim().slice(0, 400),
            parentEmail: normalizeEmail(payload.parentEmail ?? existingRemark.parentEmail),
            teacherEmails: (payload.teacherEmails ?? existingRemark.teacherEmails ?? []).slice(0, 25),
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        // Tier 2 teacher update: strictly bulletin council & absence fields
        await awaitWithOfflineQueue(
          updateDoc(ref, {
            absences: cleanAbsences,
            conduite: (payload.conduite ?? 'Bonne').trim().slice(0, 60),
            decision: (payload.decision ?? '').trim().slice(0, 80),
            generalRemark: (payload.generalRemark ?? '').trim().slice(0, 400),
            updatedAt: serverTimestamp(),
          })
        );
      }
    } else {
      await awaitWithOfflineQueue(
        setDoc(ref, {
          ownerId: ownerUid,
          schoolId,
          studentId: payload.studentId,
          trimester: payload.trimester,
          absences: cleanAbsences,
          conduite: (payload.conduite ?? 'Bonne').trim().slice(0, 60),
          decision: (payload.decision ?? '').trim().slice(0, 80),
          generalRemark: (payload.generalRemark ?? '').trim().slice(0, 400),
          parentEmail: normalizeEmail(payload.parentEmail),
          teacherEmails: (payload.teacherEmails ?? []).slice(0, 25),
          managementEmails: getSchoolManagementEmails(schoolId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    void recordAuditLog({
      ownerId: ownerUid,
      schoolId,
      category: 'bulletin',
      severity: 'info',
      action: 'Mise à jour bulletin',
      details: `Bulletin T${payload.trimester} (Élève ${payload.studentId}) : ${cleanAbsences}h absence(s), conduite "${(payload.conduite ?? 'Bonne').trim()}", décision "${(payload.decision ?? '—').trim()}".`,
      targetId: remarkId,
    });
  } catch (error) {
    handleFirestoreError(
      error,
      existingRemark ? OperationType.UPDATE : OperationType.CREATE,
      `bulletinRemarks/${remarkId}`
    );
  }
}

export async function sendMessage(
  ownerUid: string,
  schoolId: string,
  payload: {
    senderUid: string;
    senderEmail: string;
    senderName: string;
    senderRole: UserRole;
    recipientEmail: string;
    recipientName: string;
    studentId?: string;
    studentName?: string;
    classe?: string;
    subject: string;
    body: string;
  }
): Promise<void> {
  const msgId = sanitizeId(`msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'messages', msgId), {
        ownerId: ownerUid,
        schoolId,
        senderUid: payload.senderUid,
        senderEmail: normalizeEmail(payload.senderEmail),
        senderName: payload.senderName.trim().slice(0, 100),
        senderRole: payload.senderRole,
        recipientEmail: normalizeEmail(payload.recipientEmail),
        recipientName: payload.recipientName.trim().slice(0, 100),
        studentId: (payload.studentId ?? '').slice(0, 128),
        studentName: (payload.studentName ?? '').slice(0, 120),
        classe: (payload.classe ?? '').slice(0, 40),
        subject: payload.subject.trim().slice(0, 140),
        body: payload.body.trim().slice(0, 2000),
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `messages/${msgId}`);
  }
}

export async function markMessageRead(messageId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'messages', messageId), {
        read: true,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `messages/${messageId}`);
  }
}

export async function deleteMessageById(messageId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(deleteDoc(doc(db, 'messages', messageId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `messages/${messageId}`);
  }
}

export async function createNotification(
  ownerUid: string,
  schoolId: string,
  payload: {
    type: 'grade' | 'absence' | 'announcement';
    title: string;
    message: string;
    targetClasse?: string;
    studentId?: string;
    audienceEmails: string[];
    createdByEmail: string;
    createdByName: string;
    createdByRole?: UserRole;
    expiresAt?: Date | null;
  }
): Promise<void> {
  const notifId = sanitizeId(`notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const createdByRole: UserRole =
    payload.createdByRole ?? activeAuditContext?.actorRole ?? 'admin';
  try {
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'notifications', notifId), {
        ownerId: ownerUid,
        schoolId,
        type: payload.type,
        title: payload.title.trim().slice(0, 140),
        message: payload.message.trim().slice(0, 600),
        targetClasse: (payload.targetClasse ?? '').slice(0, 40),
        studentId: (payload.studentId ?? '').slice(0, 128),
        audienceEmails: Array.from(new Set(payload.audienceEmails.map((e) => normalizeEmail(e)).filter(Boolean))).slice(0, 100),
        dismissedByEmails: [],
        managementEmails: getSchoolCenseurEmails(schoolId),
        createdByEmail: normalizeEmail(payload.createdByEmail),
        createdByName: payload.createdByName.trim().slice(0, 100),
        createdByRole,
        read: false,
        expiresAt: payload.expiresAt ? Timestamp.fromDate(payload.expiresAt) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `notifications/${notifId}`);
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'notifications', notificationId), {
        read: true,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function markAllNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const CHUNK = 380;
  for (let i = 0; i < notificationIds.length; i += CHUNK) {
    const chunk = notificationIds.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.update(doc(db, 'notifications', id), {
          read: true,
          updatedAt: serverTimestamp(),
        });
      }
      await awaitWithOfflineQueue(batch.commit());
    } catch {
      await Promise.allSettled(chunk.map((id) => markNotificationRead(id)));
    }
  }
}

export async function deleteNotificationById(notificationId: string): Promise<void> {
  try {
    await awaitWithOfflineQueue(deleteDoc(doc(db, 'notifications', notificationId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `notifications/${notificationId}`);
  }
}

function shouldHardDeleteNotification(
  notif: NotificationItem,
  cleanActorEmail: string,
  actorRole: UserRole
): boolean {
  if (actorRole === 'admin' || actorRole === 'censeur') return true;
  if (cleanActorEmail && normalizeEmail(notif.createdByEmail) === cleanActorEmail) return true;
  const audience = (notif.audienceEmails ?? []).map((e) => normalizeEmail(e)).filter(Boolean);
  return audience.length <= 1;
}

export async function dismissOrDeleteNotification(
  notif: NotificationItem,
  actorEmail: string,
  actorRole: UserRole
): Promise<void> {
  const cleanActor = normalizeEmail(actorEmail);
  const hardDelete = shouldHardDeleteNotification(notif, cleanActor, actorRole);
  if (hardDelete) {
    await deleteNotificationById(notif.id);
    return;
  }
  if (!cleanActor) return;
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'notifications', notif.id), {
        dismissedByEmails: arrayUnion(cleanActor),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notif.id}`);
  }
}

export async function cleanupNotificationsBulk(
  notifs: NotificationItem[],
  actorEmail: string,
  actorRole: UserRole
): Promise<void> {
  if (notifs.length === 0) return;
  const cleanActor = normalizeEmail(actorEmail);
  const CHUNK = 380;
  for (let i = 0; i < notifs.length; i += CHUNK) {
    const chunk = notifs.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const n of chunk) {
        const ref = doc(db, 'notifications', n.id);
        if (shouldHardDeleteNotification(n, cleanActor, actorRole)) {
          batch.delete(ref);
        } else if (cleanActor) {
          batch.update(ref, {
            dismissedByEmails: arrayUnion(cleanActor),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await awaitWithOfflineQueue(batch.commit());
    } catch {
      await Promise.allSettled(
        chunk.map((n) => dismissOrDeleteNotification(n, cleanActor, actorRole))
      );
    }
  }
}

export async function seedDemoSchoolData(
  uid: string,
  schoolId: string,
  subjects: Subject[],
  currentUserEmail: string,
  adminName: string
): Promise<void> {
  const demoParentEmail = 'parent.adjaho@exemple.com';
  const demoTeacherEmail = 'prof.maths@exemple.com';

  const demoStudents: Array<{
    id: string;
    matricule: string;
    nom: string;
    prenoms: string;
    sexe: 'M' | 'F';
    age: number;
    cycle: CycleType;
    classe: string;
    guardianName: string;
    guardianPhone: string;
    parentEmail: string;
    teacherEmails: string[];
  }> = [
    { id: sanitizeId(`demo_${schoolId}_1`), matricule: 'SCH-26-001', nom: 'ADJAHO', prenoms: 'Koffi Emmanuel', sexe: 'M', age: 12, cycle: 'Collège', classe: '6ème A', guardianName: 'Adjaho Komlan', guardianPhone: '+228 90 11 22 33', parentEmail: demoParentEmail, teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_2`), matricule: 'SCH-26-002', nom: 'KPODAR', prenoms: 'Afiwa Grâce', sexe: 'F', age: 11, cycle: 'Collège', classe: '6ème A', guardianName: 'Kpodar Nadine', guardianPhone: '+228 91 44 55 66', parentEmail: 'parent.kpodar@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_3`), matricule: 'SCH-26-003', nom: 'AMEGAH', prenoms: 'Kodjo Rodrigue', sexe: 'M', age: 12, cycle: 'Collège', classe: '6ème B', guardianName: 'Amégah Patrick', guardianPhone: '+228 92 77 88 99', parentEmail: 'parent.amegah@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_4`), matricule: 'SCH-26-004', nom: 'LAWSON', prenoms: 'Merveille Clarisse', sexe: 'F', age: 13, cycle: 'Collège', classe: '5ème A', guardianName: 'Lawson Jean', guardianPhone: '+228 90 21 34 65', parentEmail: 'parent.lawson@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_5`), matricule: 'SCH-26-005', nom: 'AGBESSI', prenoms: 'Yao Éric', sexe: 'M', age: 14, cycle: 'Collège', classe: '4ème A', guardianName: 'Agbessi Serge', guardianPhone: '+228 93 82 14 20', parentEmail: 'parent.agbessi@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_6`), matricule: 'SCH-26-006', nom: 'MENSAH', prenoms: 'Akossiwa Prisca', sexe: 'F', age: 15, cycle: 'Collège', classe: '3ème A', guardianName: 'Mensah Mireille', guardianPhone: '+228 91 33 45 78', parentEmail: 'parent.mensah@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_7`), matricule: 'SCH-26-007', nom: 'TCHALLA', prenoms: 'Essowè Ulrich', sexe: 'M', age: 16, cycle: 'Lycée', classe: '2nde CD', guardianName: 'Tchalla Noël', guardianPhone: '+228 92 22 18 40', parentEmail: 'parent.tchalla@exemple.com', teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_8`), matricule: 'SCH-26-008', nom: 'GNASSINGBE', prenoms: 'Komi Junior', sexe: 'M', age: 17, cycle: 'Lycée', classe: '1ère C', guardianName: 'Gnassingbé Karim', guardianPhone: '+228 90 65 43 21', parentEmail: demoParentEmail, teacherEmails: [demoTeacherEmail] },
    { id: sanitizeId(`demo_${schoolId}_9`), matricule: 'SCH-26-009', nom: 'TOSSOU', prenoms: 'Bénédicte Espérance', sexe: 'F', age: 18, cycle: 'Lycée', classe: 'Tle A4', guardianName: 'Tossou Aimé', guardianPhone: '+228 91 12 98 54', parentEmail: 'parent.tossou@exemple.com', teacherEmails: [] },
    { id: sanitizeId(`demo_${schoolId}_10`), matricule: 'SCH-26-010', nom: 'KOUASSI', prenoms: 'Délali Samuel', sexe: 'M', age: 18, cycle: 'Lycée', classe: 'Tle D', guardianName: 'Kouassi Célestin', guardianPhone: '+228 93 10 20 30', parentEmail: 'parent.kouassi@exemple.com', teacherEmails: [demoTeacherEmail] },
  ];

  // Step 1: Create students
  const studentBatch = writeBatch(db);
  for (const s of demoStudents) {
    studentBatch.set(doc(db, 'students', s.id), {
      ownerId: uid,
      schoolId,
      matricule: s.matricule,
      nom: s.nom,
      prenoms: s.prenoms,
      sexe: s.sexe,
      age: s.age,
      cycle: s.cycle,
      classe: s.classe,
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone,
      parentEmail: s.parentEmail,
      teacherEmails: s.teacherEmails,
      status: 'actif',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await studentBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'students');
  }

  // Step 2: Grades (official Togo coefficients per class/series) + Demo Memberships + Notifications + Messages
  const writeOps: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

  demoStudents.forEach((student, sIdx) => {
    const classSubjects = getEffectiveSubjectsForClass(student.classe, subjects);
    classSubjects.forEach((sub, subIdx) => {
      [1, 2].forEach((trimester) => {
        const base = 11 + ((sIdx * 3 + subIdx * 2 + trimester) % 7);
        const int1 = Math.min(20, base + (sIdx % 2 === 0 ? 1 : -0.5));
        const int2 = Math.min(20, base + (subIdx % 2 === 0 ? 0.5 : 1.5));
        const devoir = Math.min(20, base + (trimester === 2 ? 1 : 0));
        const compo = Math.min(20, base + (sIdx % 3 === 0 ? 1.5 : -0.5));
        const gradeId = sanitizeId(`${student.id}_${sub.id}_T${trimester}`);
        writeOps.push({
          ref: doc(db, 'grades', gradeId),
          data: {
            ownerId: uid,
            schoolId,
            studentId: student.id,
            classe: student.classe,
            subjectId: sub.id,
            subjectName: sub.name,
            coef: sub.coef,
            trimester,
            int1,
            int2,
            devoir,
            compo,
            appreciation: compo >= 15 ? 'Très bon travail' : compo >= 12 ? 'Bon ensemble' : 'Peut mieux faire',
            parentEmail: student.parentEmail,
            teacherEmails: student.teacherEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
      });
    });
  });

  // Demo Memberships (Teacher + Parent)
  writeOps.push({
    ref: doc(db, 'memberships', sanitizeId(`demo_mem_teacher_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      memberEmail: demoTeacherEmail,
      memberName: 'Prof. Amégah Marc',
      role: 'teacher',
      assignedClasses: ['6ème A', '6ème B', '3ème A', '1ère C', 'Tle D'],
      assignedSubject: 'Mathématiques & PCT',
      childStudentIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });
  writeOps.push({
    ref: doc(db, 'memberships', sanitizeId(`demo_mem_parent_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      memberEmail: demoParentEmail,
      memberName: 'M. Adjaho Komlan',
      role: 'parent',
      assignedClasses: [],
      assignedSubject: '',
      childStudentIds: [demoStudents[0].id, demoStudents[7].id],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });

  // Demo Notifications
  const actorEmail = normalizeEmail(currentUserEmail) || 'direction@ecole.com';
  writeOps.push({
    ref: doc(db, 'notifications', sanitizeId(`demo_notif_1_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      type: 'announcement',
      title: 'Conseil de classe du 1er Trimestre',
      message: 'La remise officielle des bulletins scolaires aura lieu samedi prochain à partir de 08h30 dans la grande salle.',
      targetClasse: '',
      studentId: '',
      audienceEmails: [demoParentEmail, demoTeacherEmail],
      createdByEmail: actorEmail,
      createdByName: adminName,
      createdByRole: 'admin',
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });
  writeOps.push({
    ref: doc(db, 'notifications', sanitizeId(`demo_notif_2_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      type: 'grade',
      title: 'Notes de Mathématiques publiées · 1ère C',
      message: 'Les notes de composition du Semestre 1 de GNASSINGBE Komi Junior (1ère C) sont disponibles.',
      targetClasse: '1ère C',
      studentId: demoStudents[7].id,
      audienceEmails: [demoParentEmail],
      createdByEmail: actorEmail,
      createdByName: adminName,
      createdByRole: 'admin',
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });
  writeOps.push({
    ref: doc(db, 'notifications', sanitizeId(`demo_notif_3_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      type: 'absence',
      title: 'Suivi de présence · 6ème A',
      message: 'ADJAHO Koffi Emmanuel a été signalé absent à la séance de PCT de 10h.',
      targetClasse: '6ème A',
      studentId: demoStudents[0].id,
      audienceEmails: [demoParentEmail],
      createdByEmail: actorEmail,
      createdByName: adminName,
      createdByRole: 'admin',
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });

  // Demo Message
  writeOps.push({
    ref: doc(db, 'messages', sanitizeId(`demo_msg_1_${schoolId}`)),
    data: {
      ownerId: uid,
      schoolId,
      senderUid: uid,
      senderEmail: actorEmail,
      senderName: adminName,
      senderRole: 'admin',
      recipientEmail: demoParentEmail,
      recipientName: 'M. Adjaho Komlan',
      studentId: demoStudents[0].id,
      studentName: 'ADJAHO Koffi Emmanuel',
      classe: '6ème A',
      subject: 'Félicitations pour les progrès en Mathématiques',
      body: 'Bonjour M. Adjaho, Koffi a obtenu une excellente moyenne au devoir de ce trimestre. Continuons cet accompagnement pour la composition.',
      read: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });

  try {
    const CHUNK_SIZE = 380;
    for (let i = 0; i < writeOps.length; i += CHUNK_SIZE) {
      const chunk = writeOps.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of chunk) {
        batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
    await syncAccessPropagation(uid, schoolId);
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'settings',
      severity: 'info',
      action: 'Données démo chargées',
      details: `${demoStudents.length} élèves de démonstration (Collège & Lycée Togo) et notes importés.`,
      targetId: schoolId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'grades');
  }
}
