export type CycleType = 'Collège' | 'Lycée';
export type UserRole = 'admin' | 'censeur' | 'secretaire' | 'teacher' | 'parent';
export type MembershipRole = 'censeur' | 'secretaire' | 'teacher' | 'parent';
export type ClassroomMotif = 'maths-physique' | 'lettres-philo' | 'sciences-nat' | 'general';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Directeur · Admin Suprême',
  censeur: 'Censeur · Pédagogie & Notes',
  secretaire: 'Secrétaire · Inscriptions & Listes',
  teacher: 'Professeur',
  parent: 'Parent / Élève',
};

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  admin: 'Directeur',
  censeur: 'Censeur',
  secretaire: 'Secrétaire',
  teacher: 'Professeur',
  parent: 'Parent',
};

export function isSchoolWideStaffRole(role: UserRole): boolean {
  return role === 'admin' || role === 'censeur' || role === 'secretaire';
}

export function canEditGrades(role: UserRole): boolean {
  return role === 'admin' || role === 'censeur' || role === 'teacher';
}

export function canManageSubjects(role: UserRole): boolean {
  return role === 'admin' || role === 'censeur';
}

export function canManageStudents(role: UserRole): boolean {
  return role === 'admin' || role === 'censeur' || role === 'secretaire';
}

export function canManageClasses(role: UserRole): boolean {
  return role === 'admin' || role === 'censeur' || role === 'secretaire';
}

export function canManageLeadership(role: UserRole): boolean {
  return role === 'admin';
}

export function canManageYearLifecycle(role: UserRole): boolean {
  return role === 'admin';
}

export interface ClassDefinition {
  name: string;
  cycle: CycleType;
  label: string;
  level?: string;
  series?: string;
  motif?: ClassroomMotif;
  accentColor?: string;
  slogan?: string;
}

export const CYCLES: Record<CycleType, ClassDefinition[]> = {
  Collège: [
    {
      name: '6ème A',
      cycle: 'Collège',
      label: 'Sixième · Section A',
      level: '6ème',
      series: 'Section A · Adaptation & Sciences',
      motif: 'general',
      accentColor: '#6d28d9',
      slogan: 'Rigueur & autonomie dès l’entrée au collège',
    },
    {
      name: '6ème B',
      cycle: 'Collège',
      label: 'Sixième · Section B',
      level: '6ème',
      series: 'Section B · Langues & Culture',
      motif: 'lettres-philo',
      accentColor: '#4338ca',
      slogan: 'Esprit d’équipe et curiosité intellectuelle',
    },
    {
      name: '5ème A',
      cycle: 'Collège',
      label: 'Cinquième · Section A',
      level: '5ème',
      series: 'Section A · Observation & SVT',
      motif: 'sciences-nat',
      accentColor: '#0f766e',
      slogan: 'Expérimenter et comprendre la nature',
    },
    {
      name: '5ème B',
      cycle: 'Collège',
      label: 'Cinquième · Section B',
      level: '5ème',
      series: 'Section B · Expression & Calcul',
      motif: 'general',
      accentColor: '#0369a1',
      slogan: 'Progresser avec méthode chaque jour',
    },
    {
      name: '4ème A',
      cycle: 'Collège',
      label: 'Quatrième · Section A',
      level: '4ème',
      series: 'Section A · Physique & Lettres',
      motif: 'lettres-philo',
      accentColor: '#a21caf',
      slogan: 'Construire son raisonnement scientifique et littéraire',
    },
    {
      name: '4ème B',
      cycle: 'Collège',
      label: 'Quatrième · Section B',
      level: '4ème',
      series: 'Section B · Sciences & Expression',
      motif: 'maths-physique',
      accentColor: '#7c3aed',
      slogan: 'Approfondir la méthode et la rigueur scientifique',
    },
    {
      name: '3ème A',
      cycle: 'Collège',
      label: 'Troisième · Section A',
      level: '3ème',
      series: 'Objectif BEPC · Maths & Physique',
      motif: 'maths-physique',
      accentColor: '#5b21b6',
      slogan: 'Cap sur le BEPC · Section A',
    },
    {
      name: '3ème B',
      cycle: 'Collège',
      label: 'Troisième · Section B',
      level: '3ème',
      series: 'Objectif BEPC · Polyvalent',
      motif: 'maths-physique',
      accentColor: '#be123c',
      slogan: 'Cap sur le BEPC · Section B',
    },
  ],
  Lycée: [
    {
      name: '2nde A4',
      cycle: 'Lycée',
      label: 'Seconde Littéraire',
      level: '2nde',
      series: 'Série A · Lettres & Langues',
      motif: 'lettres-philo',
      accentColor: '#b45309',
      slogan: 'Maîtrise du verbe, culture & pensée critique',
    },
    {
      name: '2nde CD',
      cycle: 'Lycée',
      label: 'Seconde Scientifique',
      level: '2nde',
      series: 'Séries C/D · Sciences',
      motif: 'maths-physique',
      accentColor: '#4338ca',
      slogan: 'Rigueur mathématique & démarche expérimentale',
    },
    {
      name: '1ère A4',
      cycle: 'Lycée',
      label: 'Première Littéraire',
      level: '1ère',
      series: 'Série A · Lettres & Philo',
      motif: 'lettres-philo',
      accentColor: '#be123c',
      slogan: 'Humanités classiques, analyse & expression',
    },
    {
      name: '1ère C',
      cycle: 'Lycée',
      label: 'Première Maths & Physique',
      level: '1ère',
      series: 'Série C · Maths & Sciences Physiques',
      motif: 'maths-physique',
      accentColor: '#0284c7',
      slogan: 'Excellence en Mathématiques & Physique-Chimie',
    },
    {
      name: '1ère D',
      cycle: 'Lycée',
      label: 'Première Scientifique',
      level: '1ère',
      series: 'Série D · SVT, Maths & Physique',
      motif: 'sciences-nat',
      accentColor: '#047857',
      slogan: 'Observer, modéliser et démontrer avec précision',
    },
    {
      name: 'Tle A4',
      cycle: 'Lycée',
      label: 'Terminale Littéraire',
      level: 'Terminale',
      series: 'Série A · Philosophie & Lettres',
      motif: 'lettres-philo',
      accentColor: '#9f1239',
      slogan: 'Objectif Bac A · Excellence littéraire et philosophique',
    },
    {
      name: 'Tle C',
      cycle: 'Lycée',
      label: 'Terminale Maths & Physique',
      level: 'Terminale',
      series: 'Série C · Sciences Exactes',
      motif: 'maths-physique',
      accentColor: '#4f46e5',
      slogan: 'Objectif Bac C · Mathématiques & Physique-Chimie',
    },
    {
      name: 'Tle D',
      cycle: 'Lycée',
      label: 'Terminale Scientifique',
      level: 'Terminale',
      series: 'Série D · Sciences Expérimentales',
      motif: 'sciences-nat',
      accentColor: '#5b21b6',
      slogan: 'Objectif Bac D · SVT, Physique & Mathématiques',
    },
  ],
};

export const ALL_CLASSES: ClassDefinition[] = [
  ...CYCLES.Collège,
  ...CYCLES.Lycée,
];

export const LEVEL_SUGGESTIONS: Record<CycleType, string[]> = {
  Collège: ['6ème', '5ème', '4ème', '3ème'],
  Lycée: ['2nde', '1ère', 'Terminale'],
};

export function getCycleForClass(classe: string, classrooms?: Classroom[]): CycleType {
  const fromDynamic = classrooms?.find((c) => c.name === classe);
  if (fromDynamic && (fromDynamic.cycle === 'Collège' || fromDynamic.cycle === 'Lycée')) {
    return fromDynamic.cycle;
  }
  const found = ALL_CLASSES.find((c) => c.name === classe);
  if (found) return found.cycle;
  const lower = classe.toLowerCase();
  if (
    lower.startsWith('2nd') ||
    lower.startsWith('1èr') ||
    lower.startsWith('1er') ||
    lower.startsWith('1re') ||
    lower.startsWith('tle') ||
    lower.startsWith('term')
  ) {
    return 'Lycée';
  }
  return 'Collège';
}

export function getPeriodsForCycle(cycle: CycleType): Array<1 | 2 | 3> {
  return cycle === 'Lycée' ? [1, 2] : [1, 2, 3];
}

export function getPeriodNoun(cycle: CycleType): 'Semestre' | 'Trimestre' {
  return cycle === 'Lycée' ? 'Semestre' : 'Trimestre';
}

export function getPeriodLabel(cycle: CycleType, period: 1 | 2 | 3): string {
  if (cycle === 'Lycée') {
    const safePeriod = period === 3 ? 2 : period;
    return `Semestre ${safePeriod}`;
  }
  return `Trimestre ${period}`;
}

export function getPeriodShortLabel(cycle: CycleType, period: 1 | 2 | 3): string {
  if (cycle === 'Lycée') {
    const safePeriod = period === 3 ? 2 : period;
    return `S${safePeriod}`;
  }
  return `T${period}`;
}

function normalizeClassCompareKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function getClassProgressionRank(name: string, cycleHint?: CycleType): number {
  const n = normalizeClassCompareKey(name);
  if (/^6/.test(n) || n.includes('sixieme')) return 10;
  if (/^5/.test(n) || n.includes('cinquieme')) return 20;
  if (/^4/.test(n) || n.includes('quatrieme')) return 30;
  if (/^3/.test(n) || n.includes('troisieme')) return 40;
  if (/^2nd/.test(n) || /^2e\b/.test(n) || n.includes('seconde')) return 50;
  if (/^1er/.test(n) || /^1re/.test(n) || n.includes('premiere')) return 60;
  if (/^tle/.test(n) || n.includes('terminale')) return 70;
  return cycleHint === 'Lycée' ? 85 : 45;
}

function getSeriesSuffixRank(name: string): number {
  const n = normalizeClassCompareKey(name);
  if (/\ba4\b/.test(n) || /\ba\b$/.test(n)) return 1;
  if (/\bb\b$/.test(n)) return 2;
  if (/\bcd\b/.test(n)) return 3;
  if (/\bc\b$/.test(n)) return 4;
  if (/\bd\b$/.test(n)) return 5;
  return 10;
}

export function compareClassNames(a: string, b: string): number {
  const rankA = getClassProgressionRank(a);
  const rankB = getClassProgressionRank(b);
  if (rankA !== rankB) return rankA - rankB;
  const sufA = getSeriesSuffixRank(a);
  const sufB = getSeriesSuffixRank(b);
  if (sufA !== sufB) return sufA - sufB;
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
}

export function sortClassrooms<T extends Pick<Classroom, 'name' | 'cycle'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const rankA = getClassProgressionRank(a.name, a.cycle);
    const rankB = getClassProgressionRank(b.name, b.cycle);
    if (rankA !== rankB) return rankA - rankB;
    const sufA = getSeriesSuffixRank(a.name);
    const sufB = getSeriesSuffixRank(b.name);
    if (sufA !== sufB) return sufA - sufB;
    return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
  });
}

export interface ProgressionRecommendation {
  action: 'promote' | 'graduate';
  targetClasse: string;
  targetCycle: CycleType;
}

export function getNextProgressionTarget(
  currentClasse: string,
  availableClassrooms: Array<Pick<Classroom, 'name' | 'cycle'>>
): ProgressionRecommendation {
  const rank = getClassProgressionRank(currentClasse);
  const sorted = sortClassrooms(availableClassrooms);
  const suffixMatch = currentClasse.trim().match(/\s+([AB]|A4|CD|C|D)$/i);
  const suffix = suffixMatch ? suffixMatch[1].toUpperCase() : '';

  const findNextByRank = (targetRank: number, preferredSuffixes: string[]): string | null => {
    const candidates = sorted.filter((c) => getClassProgressionRank(c.name, c.cycle) === targetRank);
    if (candidates.length === 0) return null;
    for (const pref of preferredSuffixes) {
      const exact = candidates.find((c) => c.name.toUpperCase().endsWith(` ${pref}`) || c.name.toUpperCase().endsWith(pref));
      if (exact) return exact.name;
    }
    return candidates[0].name;
  };

  if (rank === 10) {
    const target = findNextByRank(20, [suffix || 'A', 'A']) || (suffix === 'B' ? '5ème B' : '5ème A');
    return { action: 'promote', targetClasse: target, targetCycle: 'Collège' };
  }
  if (rank === 20) {
    const target = findNextByRank(30, [suffix || 'A', 'A']) || (suffix === 'B' ? '4ème B' : '4ème A');
    return { action: 'promote', targetClasse: target, targetCycle: 'Collège' };
  }
  if (rank === 30) {
    const target = findNextByRank(40, [suffix || 'A', 'A']) || (suffix === 'B' ? '3ème B' : '3ème A');
    return { action: 'promote', targetClasse: target, targetCycle: 'Collège' };
  }
  if (rank === 40) {
    const target = findNextByRank(50, ['CD', 'A4']) || '2nde CD';
    return { action: 'promote', targetClasse: target, targetCycle: 'Lycée' };
  }
  if (rank === 50) {
    const pref = suffix === 'A4' ? ['A4', 'D', 'C'] : ['D', 'C', 'A4'];
    const target = findNextByRank(60, pref) || (suffix === 'A4' ? '1ère A4' : '1ère D');
    return { action: 'promote', targetClasse: target, targetCycle: 'Lycée' };
  }
  if (rank === 60) {
    const pref = suffix ? [suffix] : ['D', 'A4', 'C'];
    const target = findNextByRank(70, pref) || (suffix ? `Tle ${suffix}` : 'Tle D');
    return { action: 'promote', targetClasse: target, targetCycle: 'Lycée' };
  }
  return {
    action: 'graduate',
    targetClasse: 'Diplômé / Sortant',
    targetCycle: 'Lycée',
  };
}

export interface ClassroomThemeInfo {
  motif: ClassroomMotif;
  accentColor: string;
  series: string;
  slogan: string;
  symbols: string[];
  badgeLabel: string;
  gradientClass: string;
  surfaceTintClass: string;
}

const COLOR_STYLES_BY_HEX: Record<string, { gradientClass: string; surfaceTintClass: string }> = {
  '#059669': {
    gradientClass: 'from-emerald-600 via-teal-600 to-violet-700',
    surfaceTintClass: 'bg-emerald-50/90 border-emerald-300/80 hover:border-emerald-500',
  },
  '#047857': {
    gradientClass: 'from-emerald-600 via-teal-700 to-indigo-800',
    surfaceTintClass: 'bg-emerald-50/90 border-emerald-300/80 hover:border-emerald-500',
  },
  '#0f766e': {
    gradientClass: 'from-teal-600 via-emerald-700 to-violet-800',
    surfaceTintClass: 'bg-teal-50/90 border-teal-300/80 hover:border-teal-500',
  },
  '#0284c7': {
    gradientClass: 'from-sky-600 via-blue-600 to-violet-700',
    surfaceTintClass: 'bg-sky-50/90 border-sky-300/80 hover:border-sky-500',
  },
  '#0369a1': {
    gradientClass: 'from-sky-600 via-cyan-700 to-indigo-800',
    surfaceTintClass: 'bg-sky-50/90 border-sky-300/80 hover:border-sky-500',
  },
  '#4f46e5': {
    gradientClass: 'from-indigo-600 via-violet-600 to-purple-800',
    surfaceTintClass: 'bg-indigo-50/90 border-indigo-300/80 hover:border-indigo-500',
  },
  '#4338ca': {
    gradientClass: 'from-indigo-700 via-blue-700 to-violet-900',
    surfaceTintClass: 'bg-indigo-50/90 border-indigo-300/80 hover:border-indigo-500',
  },
  '#7c3aed': {
    gradientClass: 'from-violet-600 via-purple-600 to-indigo-700',
    surfaceTintClass: 'bg-violet-100/80 border-violet-300/85 hover:border-violet-500',
  },
  '#6d28d9': {
    gradientClass: 'from-violet-700 via-purple-700 to-indigo-800',
    surfaceTintClass: 'bg-violet-100/80 border-violet-300/85 hover:border-violet-500',
  },
  '#5b21b6': {
    gradientClass: 'from-violet-800 via-indigo-800 to-purple-950',
    surfaceTintClass: 'bg-violet-100/85 border-violet-300/90 hover:border-violet-600',
  },
  '#9333ea': {
    gradientClass: 'from-purple-600 via-fuchsia-600 to-violet-800',
    surfaceTintClass: 'bg-purple-100/80 border-purple-300/85 hover:border-purple-500',
  },
  '#a21caf': {
    gradientClass: 'from-fuchsia-700 via-purple-700 to-violet-800',
    surfaceTintClass: 'bg-fuchsia-50/90 border-fuchsia-300/80 hover:border-fuchsia-500',
  },
  '#d97706': {
    gradientClass: 'from-amber-500 via-orange-600 to-violet-700',
    surfaceTintClass: 'bg-amber-50/90 border-amber-300/80 hover:border-amber-500',
  },
  '#b45309': {
    gradientClass: 'from-amber-600 via-rose-600 to-violet-700',
    surfaceTintClass: 'bg-amber-50/90 border-amber-300/80 hover:border-amber-500',
  },
  '#be123c': {
    gradientClass: 'from-rose-600 via-pink-700 to-violet-800',
    surfaceTintClass: 'bg-rose-50/90 border-rose-300/80 hover:border-rose-500',
  },
  '#9f1239': {
    gradientClass: 'from-rose-700 via-fuchsia-800 to-violet-900',
    surfaceTintClass: 'bg-rose-50/90 border-rose-300/80 hover:border-rose-500',
  },
};

export function getClassroomTheme(classe: string, classroom?: Classroom): ClassroomThemeInfo {
  const preset = ALL_CLASSES.find((c) => c.name === classe);
  const cycle = classroom?.cycle ?? getCycleForClass(classe);
  const motif: ClassroomMotif =
    classroom?.motif ??
    preset?.motif ??
    (cycle === 'Lycée'
      ? classe.toUpperCase().includes('A')
        ? 'lettres-philo'
        : 'maths-physique'
      : 'general');

  const accentColor = classroom?.accentColor ?? preset?.accentColor ?? '#6d28d9';
  const series = classroom?.series || preset?.series || '';
  const slogan = classroom?.slogan || preset?.slogan || '';
  const colorLook = COLOR_STYLES_BY_HEX[accentColor.toLowerCase()];

  if (motif === 'lettres-philo') {
    return {
      motif,
      accentColor,
      series: series || 'Lettres & Culture',
      slogan: slogan || '« Penser par soi-même et maîtriser le discours »',
      symbols: ['Φ', 'Ψ', 'Logos', 'A4'],
      badgeLabel: cycle === 'Collège' ? 'Lettres & Langues' : 'Lettres & Philo',
      gradientClass: colorLook?.gradientClass ?? 'from-amber-600 via-rose-600 to-violet-700',
      surfaceTintClass: colorLook?.surfaceTintClass ?? 'bg-amber-50/90 border-amber-300/80 hover:border-amber-500',
    };
  }
  if (motif === 'sciences-nat') {
    return {
      motif,
      accentColor,
      series: series || 'Sciences Naturelles & SVT',
      slogan: slogan || '« Comprendre le vivant et la matière »',
      symbols: ['ADN', 'O₂', 'ΔG', 'ATP'],
      badgeLabel: 'Sciences & SVT',
      gradientClass: colorLook?.gradientClass ?? 'from-emerald-600 via-teal-600 to-indigo-700',
      surfaceTintClass: colorLook?.surfaceTintClass ?? 'bg-emerald-50/90 border-emerald-300/80 hover:border-emerald-500',
    };
  }
  if (motif === 'maths-physique') {
    return {
      motif,
      accentColor,
      series: series || 'Maths & Sciences Physiques',
      slogan: slogan || '« E = mc² · L’exactitude au service de l’excellence »',
      symbols: ['∑', '∫', 'E=mc²', 'Δ'],
      badgeLabel: 'Maths & Physique',
      gradientClass: colorLook?.gradientClass ?? 'from-indigo-700 via-violet-700 to-purple-800',
      surfaceTintClass: colorLook?.surfaceTintClass ?? 'bg-indigo-50/90 border-indigo-300/80 hover:border-indigo-500',
    };
  }

  return {
    motif,
    accentColor,
    series: series || `${cycle} · Programme officiel`,
    slogan: slogan || 'Discipline · Travail · Réussite collective',
    symbols: ['π', '∑', '√x'],
    badgeLabel: 'Section Collège',
    gradientClass: colorLook?.gradientClass ?? 'from-violet-700 via-purple-700 to-indigo-800',
    surfaceTintClass: colorLook?.surfaceTintClass ?? 'bg-violet-100/80 border-violet-300/85 hover:border-violet-500',
  };
}

export interface SchoolProfile {
  id: string;
  ownerId: string;
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
  memberEmails?: string[];
  staffEmails?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Classroom {
  id: string;
  ownerId: string;
  schoolId: string;
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
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Membership {
  id: string;
  ownerId: string;
  schoolId: string;
  memberEmail: string;
  memberName: string;
  role: MembershipRole;
  assignedClasses?: string[];
  assignedSubject?: string;
  childStudentIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function isTeacherTitulaire(
  classroom: Pick<Classroom, 'headTeacher' | 'headTeacherEmail'> | undefined,
  teacher: Pick<Membership, 'memberName' | 'memberEmail'> | null | undefined
): boolean {
  if (!classroom || !teacher) return false;
  const clsEmail = (classroom.headTeacherEmail ?? '').trim().toLowerCase();
  const memEmail = (teacher.memberEmail ?? '').trim().toLowerCase();
  if (clsEmail && memEmail) {
    return clsEmail === memEmail;
  }
  const clsName = (classroom.headTeacher ?? '').trim().toLowerCase();
  const memName = (teacher.memberName ?? '').trim().toLowerCase();
  return Boolean(clsName && memName && clsName === memName);
}

export interface StudentArchiveSummary {
  studentId: string;
  matricule: string;
  fullName: string;
  classe: string;
  cycle: CycleType;
  sexe: 'M' | 'F';
  annualAverage: number | null;
  decision: 'promote' | 'repeat' | 'graduate' | 'withdraw';
  nextClasse: string;
}

export interface AcademicArchive {
  id: string;
  ownerId: string;
  schoolId: string;
  academicYear: string;
  closedAtIso: string;
  endOfYearDate?: string;
  closedByEmail: string;
  closedByName: string;
  totalStudents: number;
  promotedCount: number;
  repeatedCount: number;
  graduatedCount: number;
  withdrawnCount: number;
  classSummaries: Array<{
    classe: string;
    cycle: CycleType;
    effectif: number;
    average: number | null;
  }>;
  studentRecords: StudentArchiveSummary[];
  createdAt?: unknown;
}

export interface Student {
  id: string;
  ownerId: string;
  schoolId: string;
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
  status: 'actif' | 'archive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentLock {
  id: string;
  ownerId: string;
  schoolId: string;
  studentId: string;
  studentEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkspaceOption {
  key: string;
  school: SchoolProfile;
  role: UserRole;
  membership: Membership | null;
  studentLocked?: boolean;
}

export interface Subject {
  id: string;
  ownerId: string;
  schoolId: string;
  name: string;
  cycle: CycleType;
  coef: number;
  teacherName?: string;
  memberEmails?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GradeRecord {
  id: string;
  ownerId: string;
  schoolId: string;
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
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BulletinRemark {
  id: string;
  ownerId: string;
  schoolId: string;
  studentId: string;
  trimester: 1 | 2 | 3;
  absences: number;
  conduite?: string;
  decision?: string;
  generalRemark?: string;
  parentEmail?: string;
  teacherEmails?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MessageItem {
  id: string;
  ownerId: string;
  schoolId: string;
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
  read: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationItem {
  id: string;
  ownerId: string;
  schoolId: string;
  type: 'grade' | 'absence' | 'announcement';
  title: string;
  message: string;
  targetClasse?: string;
  studentId?: string;
  audienceEmails: string[];
  createdByEmail: string;
  createdByName: string;
  read: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const DEFAULT_SUBJECTS_BY_CYCLE: Record<CycleType, Array<{ name: string; coef: number }>> = {
  Collège: [
    { name: 'Français', coef: 3 },
    { name: 'Histoire-Géographie', coef: 2 },
    { name: 'ECM', coef: 2 },
    { name: 'Anglais', coef: 2 },
    { name: 'Mathématiques', coef: 3 },
    { name: 'PCT', coef: 3 },
    { name: 'SVT', coef: 2 },
    { name: 'EPS', coef: 1 },
    { name: 'AM', coef: 1 },
  ],
  Lycée: [
    { name: 'Français', coef: 3 },
    { name: 'Philosophie', coef: 2 },
    { name: 'Histoire-Géographie', coef: 2 },
    { name: 'Anglais (LV1)', coef: 2 },
    { name: 'LV2 (Allemand / Espagnol)', coef: 2 },
    { name: 'Mathématiques', coef: 3 },
    { name: 'Physique-Chimie', coef: 3 },
    { name: 'SVT', coef: 3 },
    { name: 'ECM', coef: 2 },
    { name: 'EPS', coef: 1 },
    { name: 'AM', coef: 1 },
  ],
};

export type TogoSubjectKey =
  | 'francais'
  | 'philosophie'
  | 'histgeo'
  | 'ecm'
  | 'anglais'
  | 'lv2'
  | 'maths'
  | 'physique'
  | 'svt'
  | 'eps'
  | 'am'
  | 'custom';

export function normalizeSubjectKey(name: string): TogoSubjectKey {
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (n.includes('francais')) return 'francais';
  if (n.includes('philo')) return 'philosophie';
  if (n.includes('hist') || n.includes('geog')) return 'histgeo';
  if (n === 'ecm' || n.includes('civique') || n.includes('morale')) return 'ecm';
  if (n.includes('lv2') || n.includes('allemand') || n.includes('espagnol')) return 'lv2';
  if (n.includes('anglais') || n.includes('lv1')) return 'anglais';
  if (n.includes('math')) return 'maths';
  if (n === 'pct' || n.startsWith('pct ') || n.includes('physique') || n.includes('chimie')) return 'physique';
  if (n.includes('svt') || n.includes('sciences de la vie')) return 'svt';
  if (n === 'eps' || n.startsWith('eps ') || n.includes('sport') || n.includes('education physique')) return 'eps';
  if (
    n === 'am' ||
    n.startsWith('am ') ||
    n.includes('arts menagers') ||
    n.includes('enseignement menager') ||
    n.includes('dessin') ||
    n.includes('musique')
  ) {
    return 'am';
  }
  return 'custom';
}

export interface TogoClassProfile {
  cycle: CycleType;
  level: '6e' | '5e' | '4e' | '3e' | '2nde' | '1re' | 'Tle';
  series: 'A' | 'C' | 'D' | 'CD' | null;
}

export function parseTogoClassProfile(classe: string, classroom?: Classroom): TogoClassProfile {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const cleanClasse = norm(classe);
  const cleanMeta = norm(`${classroom?.level ?? ''} ${classroom?.series ?? ''}`);
  const combined = `${cleanClasse} ${cleanMeta}`;

  const isLycee =
    classroom?.cycle === 'Lycée' ||
    /\b(2nd|2nde|seconde|1er|1ere|1re|premiere|tle|term|terminale)\b/.test(combined);

  if (isLycee) {
    let level: '2nde' | '1re' | 'Tle' = '2nde';
    if (/\b(tle|term|terminale)\b/.test(combined)) level = 'Tle';
    else if (/\b(1er|1ere|1re|premiere)\b/.test(combined)) level = '1re';

    let series: 'A' | 'C' | 'D' | 'CD' = 'D';
    if (/\bcd\b|c\/d|c-d/.test(cleanClasse) || /\bcd\b|c\/d|c-d/.test(cleanMeta)) series = 'CD';
    else if (/\ba4?\b/.test(cleanClasse) || /\b(?:serie|section)\s+a4?\b|\ba4\b|litteraire/.test(cleanMeta)) series = 'A';
    else if (/\bc\b/.test(cleanClasse) || /\b(?:serie|section)\s+c\b/.test(cleanMeta)) series = 'C';
    else if (/\bd\b/.test(cleanClasse) || /\b(?:serie|section)\s+d\b/.test(cleanMeta)) series = 'D';
    else if (level === '2nde') series = 'CD';

    return { cycle: 'Lycée', level, series };
  }

  let level: '6e' | '5e' | '4e' | '3e' = '6e';
  if (/\b3/.test(combined)) level = '3e';
  else if (/\b4/.test(combined)) level = '4e';
  else if (/\b5/.test(combined)) level = '5e';
  else level = '6e';

  return { cycle: 'Collège', level, series: null };
}

/**
 * Référentiel officiel des coefficients au Togo (Collège 1er cycle 2022-2023 & Lycée 2nd cycle Séries A, C, D)
 */
export function getTogoSubjectCoef(
  classe: string,
  subjectName: string,
  fallbackCoef: number,
  classroom?: Classroom
): number {
  const key = normalizeSubjectKey(subjectName);
  if (key === 'custom') return fallbackCoef;

  const profile = parseTogoClassProfile(classe, classroom);

  if (profile.cycle === 'Collège') {
    if (profile.level === '6e' || profile.level === '5e') {
      return 1;
    }
    // 4ème & 3ème
    const coefs4e3e: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
      francais: 3,
      maths: 3,
      physique: 3, // PCT
      histgeo: 2,
      ecm: 2,
      anglais: 2,
      svt: 2,
      eps: 1,
      am: 1,
      philosophie: 1,
      lv2: 1,
    };
    return coefs4e3e[key];
  }

  // Lycée — Seconde
  if (profile.level === '2nde') {
    if (profile.series === 'A') {
      const coefs2ndeA: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
        francais: 4,
        maths: 2,
        physique: 1,
        svt: 1,
        histgeo: 3,
        anglais: 3,
        lv2: 2,
        ecm: 2,
        eps: 1,
        am: 1,
        philosophie: 2,
      };
      return coefs2ndeA[key];
    }
    // 2nde C / D / CD
    const coefs2ndeCD: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
      francais: 2,
      maths: 4,
      physique: 3,
      svt: 3,
      histgeo: 2,
      anglais: 2,
      lv2: 2,
      ecm: 2,
      eps: 1,
      am: 1,
      philosophie: 2,
    };
    return coefs2ndeCD[key];
  }

  // Lycée — Première (1re)
  if (profile.level === '1re') {
    if (profile.series === 'A') {
      const coefs1reA: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
        francais: 4,
        philosophie: 2,
        histgeo: 3,
        anglais: 3,
        lv2: 2,
        maths: 2,
        physique: 1,
        svt: 1,
        ecm: 2,
        eps: 1,
        am: 1,
      };
      return coefs1reA[key];
    }
    if (profile.series === 'C') {
      const coefs1reC: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
        francais: 2,
        philosophie: 2,
        histgeo: 2,
        anglais: 2,
        lv2: 2,
        maths: 5,
        physique: 4,
        svt: 2,
        ecm: 2,
        eps: 1,
        am: 1,
      };
      return coefs1reC[key];
    }
    // 1re D / CD
    const coefs1reD: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
      francais: 2,
      philosophie: 2,
      histgeo: 2,
      anglais: 2,
      lv2: 2,
      maths: 3,
      physique: 3,
      svt: 4,
      ecm: 2,
      eps: 1,
      am: 1,
    };
    return coefs1reD[key];
  }

  // Lycée — Terminale (Tle) : plus d'ECM en Terminale
  if (profile.series === 'A') {
    const coefsTleA: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
      francais: 3,
      philosophie: 4,
      histgeo: 3,
      anglais: 3,
      lv2: 2,
      maths: 2,
      physique: 1,
      svt: 1,
      ecm: 0,
      eps: 1,
      am: 1,
    };
    return coefsTleA[key];
  }
  if (profile.series === 'C') {
    const coefsTleC: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
      francais: 2,
      philosophie: 2,
      histgeo: 2,
      anglais: 2,
      lv2: 2,
      maths: 5,
      physique: 4,
      svt: 2,
      ecm: 0,
      eps: 1,
      am: 1,
    };
    return coefsTleC[key];
  }
  // Tle D / CD
  const coefsTleD: Record<Exclude<TogoSubjectKey, 'custom'>, number> = {
    francais: 2,
    philosophie: 2,
    histgeo: 2,
    anglais: 2,
    lv2: 2,
    maths: 3,
    physique: 3,
    svt: 4,
    ecm: 0,
    eps: 1,
    am: 1,
  };
  return coefsTleD[key];
}

const SUBJECT_ORDER: Record<TogoSubjectKey, number> = {
  francais: 1,
  philosophie: 2,
  histgeo: 3,
  ecm: 4,
  anglais: 5,
  lv2: 6,
  maths: 7,
  physique: 8,
  svt: 9,
  eps: 10,
  am: 11,
  custom: 50,
};

export function getEffectiveSubjectsForClass(
  classe: string,
  allSubjects: Subject[],
  classroom?: Classroom,
  studentGrades?: GradeRecord[]
): Subject[] {
  const profile = parseTogoClassProfile(classe, classroom);
  const gradedSubjectIds = new Set((studentGrades ?? []).map((g) => g.subjectId));

  const filtered = allSubjects
    .filter((sub) => sub.cycle === profile.cycle)
    .filter((sub) => {
      const key = normalizeSubjectKey(sub.name);
      if (profile.cycle === 'Collège' && (key === 'philosophie' || key === 'lv2')) {
        return false;
      }
      if (profile.level === '2nde' && key === 'philosophie') return false;
      if (profile.level === 'Tle' && key === 'ecm') return false;
      if (gradedSubjectIds.has(sub.id)) return true;
      if (key === 'lv2' && profile.series !== 'A') return false;
      return true;
    })
    .map((sub) => {
      const key = normalizeSubjectKey(sub.name);
      const displayName =
        profile.cycle === 'Collège' && key === 'physique'
          ? 'PCT'
          : profile.cycle === 'Lycée' && key === 'anglais' && sub.name.toLowerCase() === 'anglais'
          ? 'Anglais (LV1)'
          : sub.name;
      return {
        ...sub,
        name: displayName,
        coef: getTogoSubjectCoef(classe, sub.name, sub.coef, classroom),
      };
    });

  // Deduplicate standard keys (keep graded or first matching entry)
  const seenKeys = new Set<string>();
  const deduped: Subject[] = [];
  for (const sub of filtered) {
    const key = normalizeSubjectKey(sub.name);
    if (key !== 'custom') {
      if (seenKeys.has(key) && !gradedSubjectIds.has(sub.id)) continue;
      seenKeys.add(key);
    }
    deduped.push(sub);
  }

  return deduped.sort((a, b) => {
    const orderA = SUBJECT_ORDER[normalizeSubjectKey(a.name)];
    const orderB = SUBJECT_ORDER[normalizeSubjectKey(b.name)];
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export function computeMoyClasse(grade: Pick<GradeRecord, 'int1' | 'int2' | 'devoir'>): number | null {
  const ints = [grade.int1, grade.int2].filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const moyInt = ints.length > 0 ? ints.reduce((a, b) => a + b, 0) / ints.length : null;
  const hasDevoir = typeof grade.devoir === 'number' && !Number.isNaN(grade.devoir);

  if (moyInt !== null && hasDevoir) {
    return Number(((moyInt + (grade.devoir as number)) / 2).toFixed(2));
  }
  if (moyInt !== null) return Number(moyInt.toFixed(2));
  if (hasDevoir) return Number((grade.devoir as number).toFixed(2));
  return null;
}

export function computeMoyMatiere(grade: Pick<GradeRecord, 'int1' | 'int2' | 'devoir' | 'compo'>): number | null {
  const moyClasse = computeMoyClasse(grade);
  const hasCompo = typeof grade.compo === 'number' && !Number.isNaN(grade.compo);

  if (moyClasse !== null && hasCompo) {
    return Number(((moyClasse + (grade.compo as number) * 2) / 3).toFixed(2));
  }
  if (hasCompo) return Number((grade.compo as number).toFixed(2));
  return moyClasse;
}

export function getAutoAppreciation(score: number | null): string {
  if (score === null) return 'Non évalué';
  if (score >= 16) return 'Excellent';
  if (score >= 14) return 'Très Bien';
  if (score >= 12) return 'Bien';
  if (score >= 10) return 'Assez Bien';
  if (score >= 8) return 'Passable';
  return 'Insuffisant';
}

export function getMentionFromAverage(avg: number | null): { label: string; tone: 'emerald' | 'violet' | 'amber' | 'rose' } {
  if (avg === null) return { label: 'En attente', tone: 'amber' };
  if (avg >= 16) return { label: 'Tableau d’Honneur · Félicitations', tone: 'emerald' };
  if (avg >= 14) return { label: 'Tableau d’Honneur · Encouragements', tone: 'emerald' };
  if (avg >= 12) return { label: 'Assez Bien · Admis', tone: 'violet' };
  if (avg >= 10) return { label: 'Passable · Admis', tone: 'amber' };
  return { label: 'Insuffisant · À renforcer', tone: 'rose' };
}

export function formatRank(rank: number, total: number): string {
  if (rank <= 0 || total <= 0) return '—';
  const suffix = rank === 1 ? 'er' : 'ème';
  return `${rank}${suffix} / ${total}`;
}

export type AuditLogCategory =
  | 'auth'
  | 'student'
  | 'grade'
  | 'bulletin'
  | 'classroom'
  | 'subject'
  | 'rbac'
  | 'settings'
  | 'security'
  | 'export'
  | 'archive';

export type AuditLogSeverity = 'info' | 'warning' | 'critical';

export interface AuditLogEntry {
  id: string;
  ownerId: string;
  schoolId: string;
  weekKey: string;
  category: AuditLogCategory;
  severity: AuditLogSeverity;
  action: string;
  details: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: UserRole;
  targetId?: string;
  createdAt?: unknown;
}

export function getISOWeekKey(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getWeekDateRangeLabel(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekKey;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) {
    monday.setUTCDate(simple.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  } else {
    monday.setUTCDate(simple.getUTCDate() + 8 - dow);
  }
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt(monday)} → ${fmt(sunday)}`;
}

