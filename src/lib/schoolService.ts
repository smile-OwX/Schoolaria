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
} from 'firebase/firestore';
import { auth, awaitWithOfflineQueue, db, handleFirestoreError, OperationType } from './firebase.ts';
import {
  ALL_CLASSES,
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
  MessageItem,
  NotificationItem,
  SchoolProfile,
  Student,
  StudentLock,
  Subject,
  UserRole,
  WorkspaceOption,
  getEffectiveSubjectsForClass,
  getISOWeekKey,
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

export function setAuditActorContext(ctx: AuditActorContext | null): void {
  activeAuditContext = ctx;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

export function normalizeEmail(raw?: string): string {
  return (raw ?? '').trim().toLowerCase().slice(0, 120);
}

export function safeEmailKey(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9_-]/g, '_');
}

export function membershipDocId(schoolId: string, role: 'teacher' | 'parent', email: string): string {
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
      const isLockedAsStudent = mem.role === 'teacher' && lockedSchoolIds.has(sch.id);
      options.push({
        key,
        school: sch,
        role: mem.role,
        membership: mem,
        studentLocked: isLockedAsStudent,
      });
    }

    // 3. Implicit parent links discovered via students.parentEmail
    for (const stu of parentLinkedStudents) {
      const sch = byId.get(stu.schoolId);
      if (!sch) continue;
      const hasAdminOrParent =
        seenKeys.has(`${sch.id}:admin`) || seenKeys.has(`${sch.id}:parent`);
      if (hasAdminOrParent) continue;
      const key = `${sch.id}:parent`;
      seenKeys.add(key);
      options.push({
        key,
        school: sch,
        role: 'parent',
        membership: null,
        studentLocked: false,
      });
    }

    // Sort: admin first, then teacher, then parent
    const roleOrder: Record<UserRole, number> = { admin: 0, teacher: 1, parent: 2 };
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

  // Memberships
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'memberships'), where('ownerId', '==', uid)),
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
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'classrooms'), where('ownerId', '==', uid)),
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
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'students'), where('ownerId', '==', uid)),
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
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'subjects'), where('ownerId', '==', uid)),
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
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'grades'), where('ownerId', '==', uid)),
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
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'bulletinRemarks'), where('ownerId', '==', uid)),
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

  // Notifications
  if (role === 'admin') {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('ownerId', '==', uid)),
        (snap) => {
          callbacks.onNotifications(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) })))
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
  } else if (cleanEmail) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('audienceEmails', 'array-contains', cleanEmail)),
        (snap) => {
          callbacks.onNotifications(
            bySchool(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) })))
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
    motto?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    registrationCode?: string;
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

  try {
    if (isNew) {
      await awaitWithOfflineQueue(
        setDoc(ref, {
          ownerId: uid,
          schoolName: payload.schoolName.trim().slice(0, 120),
          adminName: payload.adminName.trim().slice(0, 100),
          academicYear: payload.academicYear.trim().slice(0, 20),
          motto: (payload.motto ?? '').trim().slice(0, 160),
          phone: (payload.phone ?? '').trim().slice(0, 30),
          email: normalizeEmail(payload.email),
          address: (payload.address ?? '').trim().slice(0, 160),
          city: (payload.city ?? '').trim().slice(0, 80),
          registrationCode: (payload.registrationCode ?? '').trim().slice(0, 60),
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
      await awaitWithOfflineQueue(
        updateDoc(ref, {
          schoolName: payload.schoolName.trim().slice(0, 120),
          adminName: payload.adminName.trim().slice(0, 100),
          academicYear: payload.academicYear.trim().slice(0, 20),
          motto: (payload.motto ?? '').trim().slice(0, 160),
          phone: (payload.phone ?? '').trim().slice(0, 30),
          email: normalizeEmail(payload.email),
          address: (payload.address ?? '').trim().slice(0, 160),
          city: (payload.city ?? '').trim().slice(0, 80),
          registrationCode: (payload.registrationCode ?? '').trim().slice(0, 60),
          updatedAt: serverTimestamp(),
        })
      );
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
      slogan: (cl.slogan ?? '').slice(0, 140),
      teacherEmails: [],
      memberEmails: memberEmails.slice(0, 100),
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

    ALL_CLASSES.forEach((cl, index) => {
      if (!keptNames.has(cl.name)) {
        const clsId = sanitizeId(`${schoolId}_tg_cls_${index}_${cl.name}`);
        if (!existingIds.has(clsId)) {
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
            slogan: (cl.slogan ?? '').slice(0, 140),
            teacherEmails: [],
            memberEmails: cleanMembers,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          keptNames.add(cl.name);
          opsCount++;
        }
      }
    });
  }

  if (opsCount === 0) return false;

  try {
    await awaitWithOfflineQueue(batch.commit());
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'subjects');
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
    slogan?: string;
    teacherEmails?: string[];
    memberEmails?: string[];
  }
): Promise<string> {
  const clsId = sanitizeId(`cls_${Date.now()}_${data.name}`);
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
        slogan: (data.slogan ?? '').trim().slice(0, 140),
        teacherEmails: (data.teacherEmails ?? []).slice(0, 25),
        memberEmails: (data.memberEmails ?? []).slice(0, 100),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'classroom',
      severity: 'info',
      action: 'Création classe / division',
      details: `Classe "${data.name.trim()}" (${data.cycle}) créée.`,
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
    slogan?: string;
  }
): Promise<void> {
  try {
    await awaitWithOfflineQueue(
      updateDoc(doc(db, 'classrooms', classroomId), {
        name: data.name.trim().slice(0, 40),
        level: data.level.trim().slice(0, 30),
        cycle: data.cycle,
        series: (data.series ?? '').trim().slice(0, 40),
        motif: data.motif,
        accentColor: data.accentColor.trim().slice(0, 30) || '#6d28d9',
        room: (data.room ?? '').trim().slice(0, 40),
        headTeacher: (data.headTeacher ?? '').trim().slice(0, 80),
        slogan: (data.slogan ?? '').trim().slice(0, 140),
        updatedAt: serverTimestamp(),
      })
    );
    void recordAuditLog({
      category: 'classroom',
      severity: 'info',
      action: 'Modification classe',
      details: `Classe "${data.name.trim()}" (${data.cycle}) personnalisée.`,
      targetId: classroomId,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `classrooms/${classroomId}`);
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

export async function syncAccessPropagation(uid: string, schoolId: string): Promise<void> {
  const [memSnap, clsSnap, stuSnap, subSnap, gradeSnap, remarkSnap] = await Promise.all([
    getDocs(query(collection(db, 'memberships'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'classrooms'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'students'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'subjects'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'grades'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'bulletinRemarks'), where('ownerId', '==', uid))),
  ]);

  const memberships = memSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Membership, 'id'>) }))
    .filter((m) => m.schoolId === schoolId);
  const clsDocs = clsSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const stuDocs = stuSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const subDocs = subSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const gradeDocs = gradeSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);
  const remarkDocs = remarkSnap.docs.filter((d) => (d.data() as { schoolId?: string }).schoolId === schoolId);

  // Prioritize teachers first in memberEmails (cap 100) so teachers are always searchable,
  // while parents >100 seamlessly rely on deterministic doc IDs (`mem_{schoolId}_parent_{emailKey}`).
  const sortedMemberships = [...memberships].sort((a, b) =>
    a.role === b.role ? 0 : a.role === 'teacher' ? -1 : 1
  );
  const allMemberEmails = Array.from(
    new Set(sortedMemberships.map((m) => normalizeEmail(m.memberEmail)).filter(Boolean))
  ).slice(0, 100);
  const staffEmails = Array.from(
    new Set(
      memberships
        .filter((m) => m.role === 'teacher')
        .map((m) => normalizeEmail(m.memberEmail))
        .filter(Boolean)
    )
  ).slice(0, 100);

  const teacherEmailsForClass = (classe: string): string[] =>
    Array.from(
      new Set(
        memberships
          .filter((m) => m.role === 'teacher' && (m.assignedClasses ?? []).includes(classe))
          .map((m) => normalizeEmail(m.memberEmail))
          .filter(Boolean)
      )
    ).slice(0, 25);

  const parentEmailByStudentId = new Map<string, string>();
  memberships
    .filter((m) => m.role === 'parent')
    .forEach((m) => {
      (m.childStudentIds ?? []).forEach((sid) => {
        parentEmailByStudentId.set(sid, normalizeEmail(m.memberEmail));
      });
    });

  const studentAccessById = new Map<string, { parentEmail: string; teacherEmails: string[] }>();
  stuDocs.forEach((d) => {
    const s = d.data() as Student;
    const pEmail = parentEmailByStudentId.get(d.id) ?? normalizeEmail(s.parentEmail);
    const tEmails = teacherEmailsForClass(s.classe);
    studentAccessById.set(d.id, { parentEmail: pEmail, teacherEmails: tEmails });
  });

  type PendingUpdate = {
    ref: ReturnType<typeof doc>;
    data: Record<string, unknown>;
  };
  const updates: PendingUpdate[] = [
    {
      ref: doc(db, 'schools', schoolId),
      data: {
        memberEmails: allMemberEmails,
        staffEmails,
        updatedAt: serverTimestamp(),
      },
    },
  ];

  subDocs.forEach((d) => {
    updates.push({
      ref: d.ref,
      data: { memberEmails: allMemberEmails, updatedAt: serverTimestamp() },
    });
  });

  clsDocs.forEach((d) => {
    const c = d.data() as Classroom;
    updates.push({
      ref: d.ref,
      data: {
        teacherEmails: teacherEmailsForClass(c.name),
        memberEmails: allMemberEmails,
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
        updatedAt: serverTimestamp(),
      },
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
    role: 'teacher' | 'parent';
    assignedClasses?: string[];
    assignedSubject?: string;
    childStudentIds?: string[];
  }
): Promise<string> {
  const email = normalizeEmail(data.memberEmail);
  const memId = membershipDocId(schoolId, data.role, email);

  if (data.role === 'teacher') {
    const lockId = studentLockDocId(schoolId, email);
    const lockSnap = await getDoc(doc(db, 'studentLocks', lockId));
    if (lockSnap.exists()) {
      throw new Error(
        `Action bloquée : l'adresse ${email} correspond à un élève inscrit dans cet établissement. Un compte élève ne peut pas être connecté comme enseignant.`
      );
    }
    const stuSnap = await getDocs(query(collection(db, 'students'), where('ownerId', '==', uid)));
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

  try {
    await setDoc(doc(db, 'memberships', memId), {
      ownerId: uid,
      schoolId,
      memberEmail: email,
      memberName: data.memberName.trim().slice(0, 100),
      role: data.role,
      assignedClasses: (data.assignedClasses ?? []).slice(0, 25),
      assignedSubject: (data.assignedSubject ?? '').trim().slice(0, 80),
      childStudentIds: (data.childStudentIds ?? []).slice(0, 15),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncAccessPropagation(uid, schoolId);
    void recordAuditLog({
      ownerId: uid,
      schoolId,
      category: 'rbac',
      severity: 'warning',
      action: 'Attribution rôle RBAC',
      details: `${data.memberName.trim()} (${email}) ajouté comme ${data.role === 'teacher' ? 'Enseignant' : 'Parent'}.`,
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
    await syncAccessPropagation(uid, schoolId);
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
      const stuSnap = await getDocs(query(collection(db, 'students'), where('ownerId', '==', uid)));
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
    await awaitWithOfflineQueue(
      setDoc(doc(db, 'studentLocks', lockId), {
        ownerId: uid,
        schoolId,
        studentId,
        studentEmail: cleanStudentEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
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
            memberName: (data.guardianName || cleanParentEmail.split('@')[0] || 'Parent').trim().slice(0, 100),
            role: 'parent',
            assignedClasses: [],
            assignedSubject: '',
            childStudentIds: [studentId],
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
        parentEmail: normalizeEmail(data.parentEmail),
        studentEmail: cleanStudentEmail,
        teacherEmails: (data.teacherEmails ?? []).slice(0, 25),
        status: 'actif',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await syncStudentLockAndParentMembership(uid, schoolId, studentId, {
      guardianName: data.guardianName,
      parentEmail: data.parentEmail,
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
        parentEmail: normalizeEmail(data.parentEmail),
        studentEmail: cleanStudentEmail,
        teacherEmails: (data.teacherEmails ?? []).slice(0, 25),
        status: data.status,
        updatedAt: serverTimestamp(),
      })
    );
    if (data.ownerUid && data.schoolId) {
      await syncStudentLockAndParentMembership(data.ownerUid, data.schoolId, studentId, {
        guardianName: data.guardianName,
        parentEmail: data.parentEmail,
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
    if (cleanEmail && context?.ownerUid && context?.schoolId) {
      try {
        const stuSnap = await getDocs(
          query(collection(db, 'students'), where('ownerId', '==', context.ownerUid))
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
  actor?: { email: string; name: string; studentName?: string; moyMat?: number | null }
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    void recordAuditLog({
      ownerId: ownerUid,
      schoolId,
      category: 'grade',
      severity: existingGrade ? 'warning' : 'info',
      action: existingGrade ? 'Modification de notes' : 'Saisie de notes',
      details: `${actor?.studentName || payload.studentId} (${payload.classe}) · ${payload.subjectName} T${payload.trimester} [Int1:${nInt1 ?? '-'} Int2:${nInt2 ?? '-'} Dev:${nDevoir ?? '-'} Comp:${nCompo ?? '-'}]`,
      targetId: gradeId,
    });

    const pEmail = normalizeEmail(payload.parentEmail ?? existingGrade?.parentEmail);
    if (pEmail && actor?.email) {
      const moyTxt = actor.moyMat !== null && actor.moyMat !== undefined ? `Moyenne : ${actor.moyMat}/20` : 'Nouvelle note saisie';
      await createNotification(ownerUid, schoolId, {
        type: 'grade',
        title: `Nouvelle note en ${payload.subjectName} (T${payload.trimester})`,
        message: `${actor.studentName || 'Votre enfant'} (${payload.classe}) — ${moyTxt}. Appréciation : ${payload.appreciation || 'Enregistrée'}.`,
        targetClasse: payload.classe,
        studentId: payload.studentId,
        audienceEmails: [pEmail],
        createdByEmail: actor.email,
        createdByName: actor.name,
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
  }
): Promise<void> {
  const notifId = sanitizeId(`notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
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
        createdByEmail: normalizeEmail(payload.createdByEmail),
        createdByName: payload.createdByName.trim().slice(0, 100),
        read: false,
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
    { id: sanitizeId(`demo_${schoolId}_5`), matricule: 'SCH-26-005', nom: 'AGBESSI', prenoms: 'Yao Éric', sexe: 'M', age: 14, cycle: 'Collège', classe: '4ème', guardianName: 'Agbessi Serge', guardianPhone: '+228 93 82 14 20', parentEmail: 'parent.agbessi@exemple.com', teacherEmails: [demoTeacherEmail] },
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
      message: 'Les notes de composition du Trimestre 1 de GNASSINGBE Komi Junior (1ère C) sont disponibles.',
      targetClasse: '1ère C',
      studentId: demoStudents[7].id,
      audienceEmails: [demoParentEmail],
      createdByEmail: actorEmail,
      createdByName: 'Prof. Amégah Marc',
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
      createdByName: 'Prof. Amégah Marc',
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
      senderName: 'Prof. Amégah Marc',
      senderRole: 'teacher',
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
