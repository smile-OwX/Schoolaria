import type { Membership, Student } from '../types/school.ts';

function cleanEmail(raw?: string | null): string {
  return (raw ?? '').trim().toLowerCase();
}

export function filterChildrenForParent(options: {
  students: Student[];
  activeMembership?: Membership | null;
  memberships?: Membership[];
  parentEmail?: string | null;
  isPreview?: boolean;
  activeOnly?: boolean;
}): Student[] {
  const pool = options.activeOnly
    ? options.students.filter((s) => s.status === 'actif')
    : options.students;

  const parentMem =
    options.activeMembership ??
    (options.memberships ?? []).find((m) => m.role === 'parent') ??
    null;

  const targetEmail = cleanEmail(parentMem?.memberEmail || options.parentEmail);
  const childIds = new Set(parentMem?.childStudentIds ?? []);

  if (parentMem || targetEmail) {
    const matched = pool.filter(
      (s) =>
        childIds.has(s.id) ||
        (Boolean(targetEmail) && cleanEmail(s.parentEmail) === targetEmail)
    );
    if (matched.length > 0) return matched;
  }

  return options.isPreview ? pool.slice(0, 2) : [];
}
