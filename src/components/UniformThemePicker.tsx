import { Check, Palette } from 'lucide-react';
import {
  SCHOOL_THEMES,
  SchoolUniformTheme,
  applySchoolThemeToDocument,
  normalizeSchoolTheme,
} from '../lib/schoolTheme.ts';

interface UniformThemePickerProps {
  value: SchoolUniformTheme;
  onChange: (theme: SchoolUniformTheme) => void;
  variant?: 'compact' | 'header' | 'grid';
  label?: string;
  disabled?: boolean;
}

export function UniformThemePicker({
  value,
  onChange,
  variant = 'grid',
  label,
  disabled = false,
}: UniformThemePickerProps) {
  const active = normalizeSchoolTheme(value);

  const handleSelect = (themeId: SchoolUniformTheme) => {
    if (disabled) return;
    applySchoolThemeToDocument(themeId);
    onChange(themeId);
  };

  if (variant === 'header') {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl border theme-header-chip"
        role="group"
        aria-label={label || 'Couleur d’uniforme de l’établissement'}
      >
        <Palette className="w-3.5 h-3.5 opacity-85 shrink-0" />
        <div className="flex flex-wrap items-center gap-1">
          {SCHOOL_THEMES.map((t) => {
            const isSelected = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(t.id)}
                title={t.label}
                aria-label={t.label}
                aria-pressed={isSelected}
                style={{
                  backgroundColor: t.swatchHex,
                  borderColor: t.swatchBorderHex,
                }}
                className={`w-5 h-5 rounded-md border flex items-center justify-center transition-transform shrink-0 ${
                  isSelected
                    ? 'ring-2 ring-offset-1 ring-current scale-110'
                    : 'opacity-85 hover:opacity-100 hover:scale-105'
                } disabled:opacity-50`}
              >
                {isSelected && (
                  <Check
                    className={`w-3 h-3 stroke-[3] ${
                      t.id === 'blanc' ? 'text-slate-900' : 'text-white'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
          <Palette className="w-3.5 h-3.5 theme-text-accent shrink-0" />
          <span>{label || 'Couleur d’uniforme'}</span>
        </span>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={label || 'Couleur d’uniforme'}
        >
          {SCHOOL_THEMES.map((t) => {
            const isSelected = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(t.id)}
                title={t.label}
                aria-label={t.label}
                aria-pressed={isSelected}
                style={{
                  backgroundColor: t.swatchHex,
                  borderColor: t.swatchBorderHex,
                }}
                className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-transform shrink-0 ${
                  isSelected
                    ? 'ring-2 ring-offset-1 ring-zinc-900 scale-110'
                    : 'opacity-85 hover:opacity-100 hover:scale-105'
                } disabled:opacity-50`}
              >
                {isSelected && (
                  <Check
                    className={`w-3.5 h-3.5 stroke-[3] ${
                      t.id === 'blanc' ? 'text-slate-900' : 'text-white'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 theme-text-accent shrink-0" />
          <span>{label || 'Couleur de l’uniforme scolaire (thème de l’établissement)'}</span>
        </label>
        <span className="text-[11px] font-bold theme-text-accent">
          {SCHOOL_THEMES.find((t) => t.id === active)?.label}
        </span>
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
        role="group"
        aria-label={label || 'Couleur d’uniforme de l’établissement'}
      >
        {SCHOOL_THEMES.map((t) => {
          const isSelected = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(t.id)}
              aria-pressed={isSelected}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'theme-pill-soft shadow-xs ring-1 ring-current'
                  : 'bg-white border-zinc-200 hover:border-zinc-400 text-zinc-800'
              } disabled:opacity-50`}
            >
              <span
                style={{
                  backgroundColor: t.swatchHex,
                  borderColor: t.swatchBorderHex,
                }}
                className="w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0"
              >
                {isSelected && (
                  <Check
                    className={`w-3.5 h-3.5 stroke-[3] ${
                      t.id === 'blanc' ? 'text-slate-900' : 'text-white'
                    }`}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold truncate">{t.shortLabel}</span>
                <span className="block text-[10px] opacity-75 truncate">{t.uniformNote}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
