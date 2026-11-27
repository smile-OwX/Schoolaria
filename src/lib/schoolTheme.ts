export type SchoolUniformTheme =
  | 'violet'
  | 'bleu'
  | 'blanc'
  | 'rouge'
  | 'verte'
  | 'orange'
  | 'marron'
  | 'gris';

export interface SchoolThemeDefinition {
  id: SchoolUniformTheme;
  label: string;
  shortLabel: string;
  uniformNote: string;
  swatchHex: string;
  swatchBorderHex: string;
  accentHex: string;
  headerIsLight: boolean;
}

export const DEFAULT_SCHOOL_THEME: SchoolUniformTheme = 'violet';

export const THEME_STORAGE_KEY = 'schoolaria_uniform_theme';

export const SCHOOL_THEMES: SchoolThemeDefinition[] = [
  {
    id: 'violet',
    label: 'Uniforme Violet',
    shortLabel: 'Violet',
    uniformNote: 'Violet royal (couleur de base)',
    swatchHex: '#6d28d9',
    swatchBorderHex: '#4c1d95',
    accentHex: '#6d28d9',
    headerIsLight: false,
  },
  {
    id: 'bleu',
    label: 'Uniforme Bleu',
    shortLabel: 'Bleu',
    uniformNote: 'Bleu marine & bleu roi',
    swatchHex: '#1d4ed8',
    swatchBorderHex: '#1e3a8a',
    accentHex: '#1d4ed8',
    headerIsLight: false,
  },
  {
    id: 'blanc',
    label: 'Uniforme Blanc',
    shortLabel: 'Blanc',
    uniformNote: 'Chemise blanche & ardoise sobre',
    swatchHex: '#ffffff',
    swatchBorderHex: '#94a3b8',
    accentHex: '#1e293b',
    headerIsLight: true,
  },
  {
    id: 'rouge',
    label: 'Uniforme Rouge',
    shortLabel: 'Rouge',
    uniformNote: 'Bordeaux & rouge académique',
    swatchHex: '#b91c1c',
    swatchBorderHex: '#7f1d1d',
    accentHex: '#b91c1c',
    headerIsLight: false,
  },
  {
    id: 'verte',
    label: 'Uniforme Vert',
    shortLabel: 'Vert',
    uniformNote: 'Vert forêt & émeraude scolaire',
    swatchHex: '#047857',
    swatchBorderHex: '#064e3b',
    accentHex: '#047857',
    headerIsLight: false,
  },
  {
    id: 'orange',
    label: 'Uniforme Orange',
    shortLabel: 'Orange',
    uniformNote: 'Orange terracotta & ambre',
    swatchHex: '#c2410c',
    swatchBorderHex: '#7c2d12',
    accentHex: '#c2410c',
    headerIsLight: false,
  },
  {
    id: 'marron',
    label: 'Uniforme Marron',
    shortLabel: 'Marron',
    uniformNote: 'Kaki & marron classique',
    swatchHex: '#78350f',
    swatchBorderHex: '#451a03',
    accentHex: '#78350f',
    headerIsLight: false,
  },
  {
    id: 'gris',
    label: 'Uniforme Gris',
    shortLabel: 'Gris',
    uniformNote: 'Gris ardoise & perle académique',
    swatchHex: '#475569',
    swatchBorderHex: '#334155',
    accentHex: '#475569',
    headerIsLight: false,
  },
];

export const VALID_SCHOOL_THEME_IDS: SchoolUniformTheme[] = SCHOOL_THEMES.map((t) => t.id);

export function normalizeSchoolTheme(raw?: string | null): SchoolUniformTheme {
  const clean = (raw ?? '').trim().toLowerCase();
  if (clean === 'purple' || clean === 'violets') return 'violet';
  if (clean === 'vert') return 'verte';
  if (clean === 'marrow' || clean === 'kaki' || clean === 'maron') return 'marron';
  if (clean === 'gray' || clean === 'grey' || clean === 'grise') return 'gris';
  if ((VALID_SCHOOL_THEME_IDS as string[]).includes(clean)) {
    return clean as SchoolUniformTheme;
  }
  return DEFAULT_SCHOOL_THEME;
}

export function getSchoolThemeDefinition(theme?: string | null): SchoolThemeDefinition {
  const normalized = normalizeSchoolTheme(theme);
  return SCHOOL_THEMES.find((t) => t.id === normalized) ?? SCHOOL_THEMES[0];
}

export function getSavedPreviewTheme(): SchoolUniformTheme {
  if (typeof window === 'undefined') return DEFAULT_SCHOOL_THEME;
  try {
    return normalizeSchoolTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_SCHOOL_THEME;
  }
}

export function savePreviewTheme(theme: SchoolUniformTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeSchoolTheme(theme));
  } catch {
    // Ignore private browsing storage errors
  }
}

export function applySchoolThemeToDocument(theme?: string | null): SchoolUniformTheme {
  const normalized = normalizeSchoolTheme(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-school-theme', normalized);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', getSchoolThemeDefinition(normalized).accentHex);
    }
  }
  return normalized;
}
