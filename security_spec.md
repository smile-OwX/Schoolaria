# Security Specification — Schoolaria

## 1. Data Invariants
1. **School Ownership**: Every `schools/{schoolId}` document must have `ownerId == request.auth.uid` and verified email (`request.auth.token.email_verified == true`).
2. **Relational Master Gate**: Every `students`, `subjects`, `grades`, and `bulletinRemarks` document must reference an existing `schoolId` whose `ownerId == request.auth.uid`.
3. **Grade Integrity**: `grades` documents must additionally reference an existing `studentId` belonging to the same `ownerId` and `schoolId`, with scores strictly bounded between `0` and `20` (or `null`), and `trimester` in `{1, 2, 3}`.
4. **Immutable Ownership & Timestamps**: `ownerId`, `schoolId`, and `createdAt` can never be changed after creation; `createdAt == request.time` on create and `updatedAt == request.time` on update.
5. **Strict Key Allowlisting**: No unvalidated or shadow fields (`isAdmin`, `role`, `verified`, etc.) may be written to any collection.
6. **Query Enforcer**: `allow list` never uses `get()` or `exists()` and strictly constrains `resource.data.ownerId == request.auth.uid` (or explicit email-scoped access).
7. **Staff vs Parent/Student Isolation**: Only school owners and `staffEmails` (verified teachers without an active `studentLocks` record for that `schoolId`) may create `notifications`, write grades/remarks, or send `messages` with `senderRole: 'teacher'`. Parents/students cannot forge `senderRole: 'admin'` or `senderRole: 'teacher'`, teachers cannot alter `parentEmail`, `teacherEmails`, `classe`, or `coef` on existing grades, and no `teacher` membership may be created for an email locked in `studentLocks/{stulock_...}`.
8. **Immutable Weekly Audit Trail**: `auditLogs` entries require `actorUid == request.auth.uid`, `actorEmail == request.auth.token.email.lower()`, server `createdAt == request.time`, valid ISO `weekKey` (`YYYY-Www`), and forbid all `update` and `delete` operations (`if false`). Only the school owner/admin can read/list `auditLogs`.
9. **Deterministic Membership & StudentLock IDs**: `memberships` and `studentLocks` use deterministic IDs scoped by `schoolId` (`mem_{schoolId}_{role}_{emailKey}` and `stulock_{schoolId}_{emailKey}`) so multi-school users and large schools (>100 parents) remain isolated and enforceable without array caps.

## 2. "Dirty Dozen" Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. **Identity Spoofing on School**: Creating `schools/fake_1` with `ownerId: "other_uid"`.
2. **Unverified Email Write or Read**: Reading/creating records while `request.auth.token.email_verified == false`.
3. **Orphaned Student**: Creating `students/s1` with a non-existent `schoolId`.
4. **Cross-Tenant Student Injection**: Creating `students/s2` referencing another user's `schoolId`.
5. **Shadow Field Injection**: Creating/updating `students/s1` with `{ ..., isAdmin: true }`.
6. **ID Poisoning**: Creating `students/a..2000chars` or `students/invalid$id`.
7. **Out-of-Range Grade Poisoning**: Setting `compo: 25` or `int1: -3` on `grades/{id}`.
8. **Invalid Trimester**: Setting `trimester: 5` on `grades/{id}`.
9. **Immutable Field Mutation**: Updating `ownerId` or `createdAt` on an existing `students/{id}` document.
10. **Timestamp Spoofing**: Creating a student, `studentLock`, or audit log with client-forged `createdAt` not equal to `request.time`.
11. **Role Spoofing & Student-as-Teacher Escalation**: A parent/student creating a `notifications` document, sending a `messages` document with `senderRole: 'teacher'`, writing grades while listed in `studentLocks/{schoolId}`, or creating a `teacher` membership for a `studentEmail` locked in `studentLocks`.
12. **Audit Log Tampering / Snooping**: Any user updating/deleting an `auditLogs/{logId}` entry, or a non-owner reading `auditLogs`.

