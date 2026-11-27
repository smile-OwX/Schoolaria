import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, LucideIcon, X } from 'lucide-react';
import type { ActiveTab } from './RoleDashboards.tsx';

export type NavDirection = 'forward' | 'backward' | 'lateral-left' | 'lateral-right';

const TAB_ORDER: ActiveTab[] = [
  'hub',
  'inscription',
  'makelist',
  'classdetail',
  'bulletins',
  'stats',
  'archives',
  'messages',
  'notifications',
  'roles',
  'audit',
  'assistant',
  'settings',
];

const TAB_DEPTH: Record<ActiveTab, number> = {
  hub: 0,
  inscription: 1,
  makelist: 1,
  bulletins: 1,
  stats: 1,
  archives: 1,
  messages: 1,
  notifications: 1,
  roles: 1,
  audit: 1,
  assistant: 1,
  settings: 1,
  classdetail: 2,
};

export function computeNavDirection(prevTab: ActiveTab, nextTab: ActiveTab): NavDirection {
  if (prevTab === nextTab) return 'forward';
  if (prevTab === 'classdetail' && nextTab === 'bulletins') return 'forward';
  if (prevTab === 'bulletins' && nextTab === 'classdetail') return 'backward';

  const prevDepth = TAB_DEPTH[prevTab] ?? 1;
  const nextDepth = TAB_DEPTH[nextTab] ?? 1;

  if (nextDepth > prevDepth) return 'forward';
  if (nextDepth < prevDepth) return 'backward';

  const prevIdx = TAB_ORDER.indexOf(prevTab);
  const nextIdx = TAB_ORDER.indexOf(nextTab);
  return nextIdx >= prevIdx ? 'lateral-right' : 'lateral-left';
}

/**
 * Installs a lightweight, global Google Material 3 radial ink-ripple system on interactive buttons.
 * Uses an isolated `m3-ripple-host` layer so parent overflow / popovers are never clipped.
 */
export function useGlobalMaterialRipple(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const btn = target.closest('button, [role="button"]') as HTMLElement | null;
      if (!btn || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
        return;
      }
      if (btn.classList.contains('no-ripple') || btn.dataset.noRipple === 'true') {
        return;
      }

      const rect = btn.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;

      const computedStyle = window.getComputedStyle(btn);
      if (computedStyle.position === 'static') {
        btn.style.position = 'relative';
      }

      let host = btn.querySelector(':scope > .m3-ripple-host') as HTMLSpanElement | null;
      if (!host) {
        host = document.createElement('span');
        host.className = 'm3-ripple-host';
        host.setAttribute('aria-hidden', 'true');
        btn.appendChild(host);
      }

      const clientX = e.clientX || rect.left + rect.width / 2;
      const clientY = e.clientY || rect.top + rect.height / 2;
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const maxDistX = Math.max(x, rect.width - x);
      const maxDistY = Math.max(y, rect.height - y);
      const diameter = Math.ceil(Math.hypot(maxDistX, maxDistY) * 2.15);

      const cls = typeof btn.className === 'string' ? btn.className : '';
      const isDarkSurface =
        /(theme-btn-primary|bg-emerald-[6-9]|bg-zinc-9|text-white)/.test(
          cls
        ) && !/bg-white(\s|$)/.test(cls);

      const wave = document.createElement('span');
      wave.className = `m3-ripple-wave ${isDarkSurface ? 'm3-ripple-light' : 'm3-ripple-violet'}`;
      wave.style.width = `${diameter}px`;
      wave.style.height = `${diameter}px`;
      wave.style.left = `${x - diameter / 2}px`;
      wave.style.top = `${y - diameter / 2}px`;

      host.appendChild(wave);

      const cleanup = () => {
        wave.remove();
      };
      wave.addEventListener('animationend', cleanup, { once: true });
      window.setTimeout(cleanup, 650);
    };

    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);
}

/**
 * Crisp 2.5px luminous Material progress ribbon anchored to the bottom of the header on route switches.
 */
export function ExpressiveNavSweep({ routeKey }: { routeKey: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={routeKey}
        aria-hidden="true"
        initial={{ scaleX: 0, opacity: 0.95 }}
        animate={{ scaleX: 1, opacity: [0.95, 1, 0] }}
        transition={{
          scaleX: { duration: 0.34, ease: [0.05, 0.7, 0.1, 1] },
          opacity: { duration: 0.45, times: [0, 0.65, 1], ease: 'easeOut' },
        }}
        style={{ transformOrigin: 'left center', background: 'var(--theme-accent)' }}
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2.5px] opacity-80"
      />
    </AnimatePresence>
  );
}

/**
 * Google Material 3 Shared-Axis Spatial View Stage.
 * Uses Z-axis depth zoom for drill-down/back and X-axis lateral glide for peer modules.
 */
export function SpatialViewStage({
  routeKey,
  direction,
  children,
}: {
  routeKey: string;
  direction: NavDirection;
  children: React.ReactNode;
}) {
  const variants = {
    initial: (dir: NavDirection) => {
      if (dir === 'forward') {
        return { opacity: 0, y: 10, x: 0 };
      }
      if (dir === 'backward') {
        return { opacity: 0, y: -8, x: 0 };
      }
      if (dir === 'lateral-right') {
        return { opacity: 0, x: 28, y: 0 };
      }
      return { opacity: 0, x: -28, y: 0 };
    },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: {
        duration: 0.24,
        ease: [0.05, 0.7, 0.1, 1] as const,
      },
    },
    exit: (dir: NavDirection) => {
      if (dir === 'forward') {
        return {
          opacity: 0,
          y: -6,
          x: 0,
          transition: { duration: 0.14, ease: [0.3, 0, 0.8, 0.15] as const },
        };
      }
      if (dir === 'backward') {
        return {
          opacity: 0,
          y: 8,
          x: 0,
          transition: { duration: 0.14, ease: [0.3, 0, 0.8, 0.15] as const },
        };
      }
      if (dir === 'lateral-right') {
        return {
          opacity: 0,
          x: -24,
          y: 0,
          transition: { duration: 0.14, ease: [0.3, 0, 0.8, 0.15] as const },
        };
      }
      return {
        opacity: 0,
        x: 24,
        y: 0,
        transition: { duration: 0.14, ease: [0.3, 0, 0.8, 0.15] as const },
      };
    },
  };

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={routeKey}
        custom={direction}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export interface LauncherNavItem {
  id: ActiveTab;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

/**
 * Google Workspace-inspired 9-dot animated App Launcher in Schoolaria's Royal Violet & Crisp White theme.
 */
export function GoogleAppsLauncher({
  items,
  activeTab,
  onSelect,
}: {
  items: LauncherNavItem[];
  activeTab: ActiveTab;
  onSelect: (tab: ActiveTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const popoverPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setOpen(false)}
                  className="fixed inset-0 z-40 bg-black/25 sm:bg-transparent"
                  aria-hidden="true"
                />
                <motion.div
                  ref={popoverRef}
                  initial={{ opacity: 0, scale: 0.92, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: -6 }}
                  transition={{ type: 'spring', stiffness: 430, damping: 28 }}
                  style={{ transformOrigin: 'top right' }}
                  className="fixed top-[4.25rem] left-3 right-3 sm:left-auto sm:right-6 sm:w-[360px] max-h-[78dvh] overflow-y-auto rounded-3xl bg-white/98 backdrop-blur-xl border theme-border-soft shadow-2xl p-4 z-50 text-zinc-900"
                >
                  <div className="flex items-center justify-between px-2 pb-3 mb-2 border-b theme-border-soft">
                    <div>
                      <p className="text-xs font-extrabold theme-text-ink tracking-tight">
                        Fonctions Schoolaria
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Accès instantané aux modules
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold theme-text-accent font-mono-nums">
                        {items.length} outils
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="sm:hidden p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100"
                        aria-label="Fermer le lanceur"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {items.map((item, idx) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <motion.button
                          key={item.id}
                          type="button"
                          initial={{ opacity: 0, y: 8, scale: 0.94 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{
                            delay: Math.min(idx * 0.02, 0.18),
                            type: 'spring',
                            stiffness: 450,
                            damping: 26,
                          }}
                          whileHover={{ y: -2, scale: 1.03 }}
                          whileTap={{ scale: 0.94 }}
                          onClick={() => {
                            onSelect(item.id);
                            setOpen(false);
                          }}
                          className={`group relative flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border text-center transition-colors ${
                            isActive
                              ? 'theme-btn-primary border-transparent shadow-md'
                              : 'theme-pill-soft'
                          }`}
                        >
                          {item.badge ? (
                            <span
                              className={`absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold font-mono-nums flex items-center justify-center ${
                                isActive
                                  ? 'bg-white text-zinc-900'
                                  : 'theme-btn-primary'
                              }`}
                            >
                              {item.badge}
                            </span>
                          ) : null}

                          <span
                            className={`w-10 h-10 rounded-xl group-hover:rounded-2xl flex items-center justify-center transition-all duration-200 ${
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-white theme-text-accent shadow-xs group-hover:scale-105'
                            }`}
                          >
                            <Icon className="w-5 h-5" />
                          </span>
                          <span className="text-[11px] font-semibold leading-tight line-clamp-1 max-w-full">
                            {item.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        aria-expanded={open}
        aria-label="Lanceur rapide des fonctions Schoolaria"
        title="Toutes les fonctions (Menu rapide)"
        className={`group w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${
          open
            ? 'theme-nav-active border-transparent shadow-md'
            : 'theme-header-chip'
        }`}
      >
        {/* Animated 3x3 Waffle Matrix */}
        <span className="grid grid-cols-3 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, idx) => (
            <span
              key={idx}
              style={{
                backgroundColor: open ? 'var(--theme-nav-active-fg)' : 'var(--theme-header-fg)',
              }}
              className={`w-[3.5px] h-[3.5px] rounded-full transition-transform duration-200 ${
                idx === 0
                  ? 'group-hover:-translate-x-[0.5px] group-hover:-translate-y-[0.5px]'
                  : idx === 2
                  ? 'group-hover:translate-x-[0.5px] group-hover:-translate-y-[0.5px]'
                  : idx === 6
                  ? 'group-hover:-translate-x-[0.5px] group-hover:translate-y-[0.5px]'
                  : idx === 8
                  ? 'group-hover:translate-x-[0.5px] group-hover:translate-y-[0.5px]'
                  : idx === 4
                  ? 'group-hover:scale-125'
                  : ''
              }`}
            />
          ))}
        </span>
      </motion.button>
      {popoverPortal}
    </div>
  );
}

/**
 * Expressive Google-style animated module button for Dashboard cards.
 */
export function ExpressiveModuleCard({
  index,
  title,
  subtitle,
  icon: Icon,
  accentClass,
  onClick,
}: {
  index: number;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accentClass: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: index * 0.035,
        type: 'spring',
        stiffness: 420,
        damping: 28,
      }}
      whileHover={{ y: -3, scale: 1.012 }}
      whileTap={{ scale: 0.975 }}
      className="group text-left bg-white/95 backdrop-blur-xs hover:bg-white border theme-border-soft rounded-2xl p-5 transition-shadow hover:shadow-lg flex items-start justify-between gap-3 shadow-xs"
    >
      <div className="flex items-start gap-3.5">
        <div
          className={`w-11 h-11 rounded-xl group-hover:rounded-2xl flex items-center justify-center shrink-0 transition-all duration-200 group-hover:scale-110 group-hover:-rotate-3 ${accentClass}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold theme-text-ink transition-colors">
            {title}
          </h3>
          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{subtitle}</p>
        </div>
      </div>
      <ArrowUpRight className="w-4 h-4 theme-text-accent opacity-65 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform shrink-0 mt-1" />
    </motion.button>
  );
}
