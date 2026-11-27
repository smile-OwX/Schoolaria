import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'violet';
  requireTextMatch?: string;
  requireTextLabel?: string;
  loading?: boolean;
  error?: string | null;
  children?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  tone = 'danger',
  requireTextMatch,
  requireTextLabel,
  loading = false,
  error = null,
  children,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    if (open) {
      setTypedText('');
    }
  }, [open, requireTextMatch]);

  if (!open) return null;

  const isMatchSatisfied =
    !requireTextMatch || typedText.trim() === requireTextMatch.trim();

  const headerTone =
    tone === 'danger'
      ? 'bg-rose-50 border-rose-200 text-rose-800'
      : tone === 'warning'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'theme-pill-soft theme-border-soft';

  const confirmButtonTone =
    tone === 'danger'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : tone === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700 text-white'
      : 'theme-btn-primary';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-[2px] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="my-auto w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl border border-zinc-200 shadow-2xl">
        <div className={`px-5 py-4 border-b flex items-start justify-between gap-3 ${headerTone}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 id="confirm-modal-title" className="text-sm font-extrabold leading-snug break-words">
              {title}
            </h3>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0 disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs sm:text-sm text-zinc-700 leading-relaxed">{description}</p>

          {children}

          {requireTextMatch && (
            <div className="space-y-1.5 bg-rose-50/70 border border-rose-200 rounded-xl p-3">
              <label className="block text-[11px] font-bold text-rose-900">
                {requireTextLabel ||
                  `Tapez exactement « ${requireTextMatch} » pour confirmer :`}
              </label>
              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                placeholder={requireTextMatch}
                className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-white text-xs font-semibold text-zinc-900 outline-none focus:border-rose-600"
              />
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={loading}
              onClick={onCancel}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={loading || !isMatchSatisfied}
              onClick={() => void onConfirm()}
              className={`w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-45 whitespace-nowrap ${confirmButtonTone}`}
            >
              {loading ? 'Suppression...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
